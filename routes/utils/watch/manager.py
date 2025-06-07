import time
import threading
import logging
import json
from pathlib import Path
from typing import Any, List, Dict

from routes.utils.watch.db import (
    get_watched_playlists,
    get_watched_playlist,
    get_playlist_track_ids_from_db,
    add_tracks_to_playlist_db,
    update_playlist_snapshot,
    mark_tracks_as_not_present_in_spotify,
    # Artist watch DB functions
    get_watched_artists,
    get_watched_artist,
    get_artist_album_ids_from_db,
    update_artist_metadata_after_check,  # Renamed from update_artist_metadata
)
from routes.utils.get_info import (
    get_spotify_info,
)  # To fetch playlist, track, artist, and album details
from routes.utils.celery_queue_manager import download_queue_manager

logger = logging.getLogger(__name__)
CONFIG_FILE_PATH = Path("./data/config/watch.json")
STOP_EVENT = threading.Event()

DEFAULT_WATCH_CONFIG = {
    "enabled": False,
    "watchPollIntervalSeconds": 3600,
    "max_tracks_per_run": 50,  # For playlists
    "watchedArtistAlbumGroup": ["album", "single"],  # Default for artists
    "delay_between_playlists_seconds": 2,
    "delay_between_artists_seconds": 5,  # Added for artists
}


def get_watch_config():
    """Loads the watch configuration from watch.json.
    Creates the file with defaults if it doesn't exist.
    Ensures all default keys are present in the loaded config.
    """
    try:
        # Ensure ./data/config directory exists
        CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

        if not CONFIG_FILE_PATH.exists():
            logger.info(
                f"{CONFIG_FILE_PATH} not found. Creating with default watch config."
            )
            with open(CONFIG_FILE_PATH, "w") as f:
                json.dump(DEFAULT_WATCH_CONFIG, f, indent=2)
            return DEFAULT_WATCH_CONFIG.copy()

        with open(CONFIG_FILE_PATH, "r") as f:
            config = json.load(f)

        updated = False
        for key, value in DEFAULT_WATCH_CONFIG.items():
            if key not in config:
                config[key] = value
                updated = True

        if updated:
            logger.info(
                f"Watch configuration at {CONFIG_FILE_PATH} was missing some default keys. Updated with defaults."
            )
            with open(CONFIG_FILE_PATH, "w") as f:
                json.dump(config, f, indent=2)
        return config
    except Exception as e:
        logger.error(
            f"Error loading or creating watch config at {CONFIG_FILE_PATH}: {e}",
            exc_info=True,
        )
        return DEFAULT_WATCH_CONFIG.copy()  # Fallback


def construct_spotify_url(item_id, item_type="track"):
    return f"https://open.spotify.com/{item_type}/{item_id}"


def check_watched_playlists(specific_playlist_id: str = None):
    """Checks watched playlists for new tracks and queues downloads.
    If specific_playlist_id is provided, only that playlist is checked.
    """
    logger.info(
        f"Playlist Watch Manager: Starting check. Specific playlist: {specific_playlist_id or 'All'}"
    )
    config = get_watch_config()

    if specific_playlist_id:
        playlist_obj = get_watched_playlist(specific_playlist_id)
        if not playlist_obj:
            logger.error(
                f"Playlist Watch Manager: Playlist {specific_playlist_id} not found in watch database."
            )
            return
        watched_playlists_to_check = [playlist_obj]
    else:
        watched_playlists_to_check = get_watched_playlists()

    if not watched_playlists_to_check:
        logger.info("Playlist Watch Manager: No playlists to check.")
        return

    for playlist_in_db in watched_playlists_to_check:
        playlist_spotify_id = playlist_in_db["spotify_id"]
        playlist_name = playlist_in_db["name"]
        logger.info(
            f"Playlist Watch Manager: Checking playlist '{playlist_name}' ({playlist_spotify_id})..."
        )

        try:
            # For playlists, we fetch all tracks in one go usually (Spotify API limit permitting)
            current_playlist_data_from_api = get_spotify_info(
                playlist_spotify_id, "playlist"
            )
            if (
                not current_playlist_data_from_api
                or "tracks" not in current_playlist_data_from_api
            ):
                logger.error(
                    f"Playlist Watch Manager: Failed to fetch data or tracks from Spotify for playlist {playlist_spotify_id}."
                )
                continue

            api_snapshot_id = current_playlist_data_from_api.get("snapshot_id")
            api_total_tracks = current_playlist_data_from_api.get("tracks", {}).get(
                "total", 0
            )

            # Paginate through playlist tracks if necessary
            all_api_track_items = []
            offset = 0
            limit = 50  # Spotify API limit for playlist items

            while True:
                # Re-fetch with pagination if tracks.next is present, or on first call.
                # get_spotify_info for playlist should ideally handle pagination internally if asked for all tracks.
                # Assuming get_spotify_info for playlist returns all items or needs to be called iteratively.
                # For simplicity, let's assume current_playlist_data_from_api has 'tracks' -> 'items' for the first page.
                # And that get_spotify_info with 'playlist' type can take offset.
                # Modifying get_spotify_info is outside current scope, so we'll assume it returns ALL items for a playlist.
                # If it doesn't, this part would need adjustment for robust pagination.
                # For now, we use the items from the initial fetch.

                paginated_playlist_data = get_spotify_info(
                    playlist_spotify_id, "playlist", offset=offset, limit=limit
                )
                if (
                    not paginated_playlist_data
                    or "tracks" not in paginated_playlist_data
                ):
                    break

                page_items = paginated_playlist_data.get("tracks", {}).get("items", [])
                if not page_items:
                    break
                all_api_track_items.extend(page_items)

                if paginated_playlist_data.get("tracks", {}).get("next"):
                    offset += limit
                else:
                    break

            current_api_track_ids = set()
            api_track_id_to_item_map = {}
            for item in all_api_track_items:  # Use all_api_track_items
                track = item.get("track")
                if track and track.get("id") and not track.get("is_local"):
                    track_id = track["id"]
                    current_api_track_ids.add(track_id)
                    api_track_id_to_item_map[track_id] = item

            db_track_ids = get_playlist_track_ids_from_db(playlist_spotify_id)

            new_track_ids_for_download = current_api_track_ids - db_track_ids
            queued_for_download_count = 0
            if new_track_ids_for_download:
                logger.info(
                    f"Playlist Watch Manager: Found {len(new_track_ids_for_download)} new tracks for playlist '{playlist_name}' to download."
                )
                for track_id in new_track_ids_for_download:
                    api_item = api_track_id_to_item_map.get(track_id)
                    if not api_item or not api_item.get("track"):
                        logger.warning(
                            f"Playlist Watch Manager: Missing track details in API map for new track_id {track_id} in playlist {playlist_spotify_id}. Cannot queue."
                        )
                        continue

                    track_to_queue = api_item["track"]
                    task_payload = {
                        "download_type": "track",
                        "url": construct_spotify_url(track_id, "track"),
                        "name": track_to_queue.get("name", "Unknown Track"),
                        "artist": ", ".join(
                            [
                                a["name"]
                                for a in track_to_queue.get("artists", [])
                                if a.get("name")
                            ]
                        ),
                        "orig_request": {
                            "source": "playlist_watch",
                            "playlist_id": playlist_spotify_id,
                            "playlist_name": playlist_name,
                            "track_spotify_id": track_id,
                            "track_item_for_db": api_item,  # Pass full API item for DB update on completion
                        },
                        # "track_details_for_db" was old name, using track_item_for_db consistent with celery_tasks
                    }
                    try:
                        task_id_or_none = download_queue_manager.add_task(
                            task_payload, from_watch_job=True
                        )
                        if task_id_or_none:  # Task was newly queued
                            logger.info(
                                f"Playlist Watch Manager: Queued download task {task_id_or_none} for new track {track_id} ('{track_to_queue.get('name')}') from playlist '{playlist_name}'."
                            )
                            queued_for_download_count += 1
                        # If task_id_or_none is None, it was a duplicate and not re-queued, Celery manager handles logging.
                    except Exception as e:
                        logger.error(
                            f"Playlist Watch Manager: Failed to queue download for new track {track_id} from playlist '{playlist_name}': {e}",
                            exc_info=True,
                        )
                logger.info(
                    f"Playlist Watch Manager: Attempted to queue {queued_for_download_count} new tracks for playlist '{playlist_name}'."
                )
            else:
                logger.info(
                    f"Playlist Watch Manager: No new tracks to download for playlist '{playlist_name}'."
                )

            # Update DB for tracks that are still present in API (e.g. update 'last_seen_in_spotify')
            # add_tracks_to_playlist_db handles INSERT OR REPLACE, updating existing entries.
            # We should pass all current API tracks to ensure their `last_seen_in_spotify` and `is_present_in_spotify` are updated.
            if (
                all_api_track_items
            ):  # If there are any tracks in the API for this playlist
                logger.info(
                    f"Playlist Watch Manager: Refreshing {len(all_api_track_items)} tracks from API in local DB for playlist '{playlist_name}'."
                )
                add_tracks_to_playlist_db(playlist_spotify_id, all_api_track_items)

            removed_db_ids = db_track_ids - current_api_track_ids
            if removed_db_ids:
                logger.info(
                    f"Playlist Watch Manager: {len(removed_db_ids)} tracks removed from Spotify playlist '{playlist_name}'. Marking in DB."
                )
                mark_tracks_as_not_present_in_spotify(
                    playlist_spotify_id, list(removed_db_ids)
                )

            update_playlist_snapshot(
                playlist_spotify_id, api_snapshot_id, api_total_tracks
            )  # api_total_tracks from initial fetch
            logger.info(
                f"Playlist Watch Manager: Finished checking playlist '{playlist_name}'. Snapshot ID updated. API Total Tracks: {api_total_tracks}."
            )

        except Exception as e:
            logger.error(
                f"Playlist Watch Manager: Error processing playlist {playlist_spotify_id}: {e}",
                exc_info=True,
            )

        time.sleep(max(1, config.get("delay_between_playlists_seconds", 2)))

    logger.info("Playlist Watch Manager: Finished checking all watched playlists.")


def check_watched_artists(specific_artist_id: str = None):
    """Checks watched artists for new albums and queues downloads."""
    logger.info(
        f"Artist Watch Manager: Starting check. Specific artist: {specific_artist_id or 'All'}"
    )
    config = get_watch_config()
    watched_album_groups = [
        g.lower() for g in config.get("watchedArtistAlbumGroup", ["album", "single"])
    ]
    logger.info(
        f"Artist Watch Manager: Watching for album groups: {watched_album_groups}"
    )

    if specific_artist_id:
        artist_obj_in_db = get_watched_artist(specific_artist_id)
        if not artist_obj_in_db:
            logger.error(
                f"Artist Watch Manager: Artist {specific_artist_id} not found in watch database."
            )
            return
        artists_to_check = [artist_obj_in_db]
    else:
        artists_to_check = get_watched_artists()

    if not artists_to_check:
        logger.info("Artist Watch Manager: No artists to check.")
        return

    for artist_in_db in artists_to_check:
        artist_spotify_id = artist_in_db["spotify_id"]
        artist_name = artist_in_db["name"]
        logger.info(
            f"Artist Watch Manager: Checking artist '{artist_name}' ({artist_spotify_id})..."
        )

        try:
            # Spotify API for artist albums is paginated.
            # We need to fetch all albums. get_spotify_info with type 'artist-albums' should handle this.
            # Let's assume get_spotify_info(artist_id, 'artist-albums') returns a list of all album objects.
            # Or we implement pagination here.

            all_artist_albums_from_api: List[Dict[str, Any]] = []
            offset = 0
            limit = 50  # Spotify API limit for artist albums
            while True:
                # The 'artist-albums' type for get_spotify_info needs to support pagination params.
                # And return a list of album objects.
                logger.debug(
                    f"Artist Watch Manager: Fetching albums for {artist_spotify_id}. Limit: {limit}, Offset: {offset}"
                )
                artist_albums_page = get_spotify_info(
                    artist_spotify_id, "artist_discography", limit=limit, offset=offset
                )

                if not artist_albums_page or not isinstance(
                    artist_albums_page.get("items"), list
                ):
                    logger.warning(
                        f"Artist Watch Manager: No album items found or invalid format for artist {artist_spotify_id} (name: '{artist_name}') at offset {offset}. Response: {artist_albums_page}"
                    )
                    break

                current_page_albums = artist_albums_page.get("items", [])
                if not current_page_albums:
                    logger.info(
                        f"Artist Watch Manager: No more albums on page for artist {artist_spotify_id} (name: '{artist_name}') at offset {offset}. Total fetched so far: {len(all_artist_albums_from_api)}."
                    )
                    break

                logger.debug(
                    f"Artist Watch Manager: Fetched {len(current_page_albums)} albums on current page for artist '{artist_name}'."
                )
                all_artist_albums_from_api.extend(current_page_albums)

                # Correct pagination: Check if Spotify indicates a next page URL
                # The `next` field in Spotify API responses is a URL to the next page or null.
                if artist_albums_page.get("next"):
                    offset += limit  # CORRECT: Increment offset by the limit used for the request
                else:
                    logger.info(
                        f"Artist Watch Manager: No 'next' page URL for artist '{artist_name}'. Pagination complete. Total albums fetched: {len(all_artist_albums_from_api)}."
                    )
                    break

            # total_albums_from_api = len(all_artist_albums_from_api)
            # Use the 'total' field from the API response for a more accurate count of all available albums (matching current API filter if any)
            api_reported_total_albums = (
                artist_albums_page.get("total", 0)
                if "artist_albums_page" in locals() and artist_albums_page
                else len(all_artist_albums_from_api)
            )
            logger.info(
                f"Artist Watch Manager: Fetched {len(all_artist_albums_from_api)} albums in total from API for artist '{artist_name}'. API reports total: {api_reported_total_albums}."
            )

            db_album_ids = get_artist_album_ids_from_db(artist_spotify_id)
            logger.info(
                f"Artist Watch Manager: Found {len(db_album_ids)} albums in DB for artist '{artist_name}'. These will be skipped if re-encountered unless logic changes."
            )

            queued_for_download_count = 0
            processed_album_ids_in_run = set()  # To avoid processing duplicate album_ids if API returns them across pages (should not happen with correct pagination)

            for album_data in all_artist_albums_from_api:
                album_id = album_data.get("id")
                album_name = album_data.get("name", "Unknown Album")
                album_group = album_data.get("album_group", "N/A").lower()
                album_type = album_data.get("album_type", "N/A").lower()

                if not album_id:
                    logger.warning(
                        f"Artist Watch Manager: Skipping album without ID for artist '{artist_name}'. Album data: {album_data}"
                    )
                    continue

                if album_id in processed_album_ids_in_run:
                    logger.debug(
                        f"Artist Watch Manager: Album '{album_name}' ({album_id}) already processed in this run. Skipping."
                    )
                    continue
                processed_album_ids_in_run.add(album_id)

                # Filter based on watchedArtistAlbumGroup
                # The album_group field is generally preferred for this type of categorization as per Spotify docs.
                is_matching_group = album_group in watched_album_groups

                logger.debug(
                    f"Artist '{artist_name}', Album '{album_name}' ({album_id}): album_group='{album_group}', album_type='{album_type}'. Watched groups: {watched_album_groups}. Match: {is_matching_group}."
                )

                if not is_matching_group:
                    logger.debug(
                        f"Artist Watch Manager: Skipping album '{album_name}' ({album_id}) by '{artist_name}' - group '{album_group}' not in watched list: {watched_album_groups}."
                    )
                    continue

                logger.info(
                    f"Artist Watch Manager: Album '{album_name}' ({album_id}) by '{artist_name}' (group: {album_group}) IS a matching group."
                )

                if album_id not in db_album_ids:
                    logger.info(
                        f"Artist Watch Manager: Found NEW matching album '{album_name}' ({album_id}) by '{artist_name}'. Queuing for download."
                    )

                    album_artists_list = album_data.get("artists", [])
                    album_main_artist_name = (
                        album_artists_list[0].get("name", "Unknown Artist")
                        if album_artists_list
                        else "Unknown Artist"
                    )

                    task_payload = {
                        "download_type": "album",  # Or "track" if downloading individual tracks of album later
                        "url": construct_spotify_url(album_id, "album"),
                        "name": album_name,
                        "artist": album_main_artist_name,  # Primary artist of the album
                        "orig_request": {
                            "source": "artist_watch",
                            "artist_spotify_id": artist_spotify_id,  # Watched artist
                            "artist_name": artist_name,
                            "album_spotify_id": album_id,
                            "album_data_for_db": album_data,  # Pass full API album object for DB update on completion/queuing
                        },
                    }
                    try:
                        # Add to DB first with task_id, then queue. Or queue and add task_id to DB.
                        # Let's use add_or_update_album_for_artist to record it with a task_id before queuing.
                        # The celery_queue_manager.add_task might return None if it's a duplicate.

                        # Record the album in DB as being processed for download
                        # Task_id will be added if successfully queued

                        # We should call add_task first, and if it returns a task_id (not a duplicate), then update our DB.
                        task_id_or_none = download_queue_manager.add_task(
                            task_payload, from_watch_job=True
                        )

                        if task_id_or_none:  # Task was newly queued
                            # REMOVED: add_or_update_album_for_artist(artist_spotify_id, album_data, task_id=task_id_or_none, is_download_complete=False)
                            # The album will be added/updated in the DB by celery_tasks.py upon successful download completion.
                            logger.info(
                                f"Artist Watch Manager: Queued download task {task_id_or_none} for new album '{album_name}' from artist '{artist_name}'. DB entry will be created/updated on success."
                            )
                            queued_for_download_count += 1
                        # If task_id_or_none is None, it was a duplicate. Celery manager handles logging.

                    except Exception as e:
                        logger.error(
                            f"Artist Watch Manager: Failed to queue download for new album {album_id} ('{album_name}') from artist '{artist_name}': {e}",
                            exc_info=True,
                        )
                else:
                    logger.info(
                        f"Artist Watch Manager: Album '{album_name}' ({album_id}) by '{artist_name}' already known in DB (ID found in db_album_ids). Skipping queue."
                    )
                    # Optionally, update its entry (e.g. last_seen, or if details changed), but for now, we only queue new ones.
                    # add_or_update_album_for_artist(artist_spotify_id, album_data, task_id=None, is_download_complete=False) # would update added_to_db_at

            logger.info(
                f"Artist Watch Manager: For artist '{artist_name}', processed {len(all_artist_albums_from_api)} API albums, attempted to queue {queued_for_download_count} new albums."
            )

            update_artist_metadata_after_check(
                artist_spotify_id, api_reported_total_albums
            )
            logger.info(
                f"Artist Watch Manager: Finished checking artist '{artist_name}'. DB metadata updated. API reported total albums (for API filter): {api_reported_total_albums}."
            )

        except Exception as e:
            logger.error(
                f"Artist Watch Manager: Error processing artist {artist_spotify_id} ('{artist_name}'): {e}",
                exc_info=True,
            )

        time.sleep(max(1, config.get("delay_between_artists_seconds", 5)))

    logger.info("Artist Watch Manager: Finished checking all watched artists.")


def playlist_watch_scheduler():
    """Periodically calls check_watched_playlists and check_watched_artists."""
    logger.info("Watch Scheduler: Thread started.")

    while not STOP_EVENT.is_set():
        current_config = get_watch_config()  # Get latest config for this run
        interval = current_config.get("watchPollIntervalSeconds", 3600)
        watch_enabled = current_config.get("enabled", False)  # Get enabled status

        if not watch_enabled:
            logger.info(
                "Watch Scheduler: Watch feature is disabled in config. Skipping checks."
            )
            STOP_EVENT.wait(
                interval
            )  # Still respect poll interval for checking config again
            continue  # Skip to next iteration

        try:
            logger.info("Watch Scheduler: Starting playlist check run.")
            check_watched_playlists()
            logger.info("Watch Scheduler: Playlist check run completed.")
        except Exception as e:
            logger.error(
                f"Watch Scheduler: Unhandled exception during check_watched_playlists: {e}",
                exc_info=True,
            )

        # Add a small delay between playlist and artist checks if desired
        # time.sleep(current_config.get("delay_between_check_types_seconds", 10))
        if STOP_EVENT.is_set():
            break  # Check stop event again before starting artist check

        try:
            logger.info("Watch Scheduler: Starting artist check run.")
            check_watched_artists()
            logger.info("Watch Scheduler: Artist check run completed.")
        except Exception as e:
            logger.error(
                f"Watch Scheduler: Unhandled exception during check_watched_artists: {e}",
                exc_info=True,
            )

        logger.info(
            f"Watch Scheduler: All checks complete. Next run in {interval} seconds."
        )
        STOP_EVENT.wait(interval)
    logger.info("Watch Scheduler: Thread stopped.")


# --- Global thread for the scheduler ---
_watch_scheduler_thread = None  # Renamed from _playlist_watch_thread


def start_watch_manager():  # Renamed from start_playlist_watch_manager
    global _watch_scheduler_thread
    if _watch_scheduler_thread is None or not _watch_scheduler_thread.is_alive():
        STOP_EVENT.clear()
        # Initialize DBs on start
        from routes.utils.watch.db import (
            init_playlists_db,
            init_artists_db,
        )  # Updated import

        init_playlists_db()  # For playlists
        init_artists_db()  # For artists

        _watch_scheduler_thread = threading.Thread(
            target=playlist_watch_scheduler, daemon=True
        )
        _watch_scheduler_thread.start()
        logger.info(
            "Watch Manager: Background scheduler started (includes playlists and artists)."
        )
    else:
        logger.info("Watch Manager: Background scheduler already running.")


def stop_watch_manager():  # Renamed from stop_playlist_watch_manager
    global _watch_scheduler_thread
    if _watch_scheduler_thread and _watch_scheduler_thread.is_alive():
        logger.info("Watch Manager: Stopping background scheduler...")
        STOP_EVENT.set()
        _watch_scheduler_thread.join(timeout=10)
        if _watch_scheduler_thread.is_alive():
            logger.warning("Watch Manager: Scheduler thread did not stop in time.")
        else:
            logger.info("Watch Manager: Background scheduler stopped.")
        _watch_scheduler_thread = None
    else:
        logger.info("Watch Manager: Background scheduler not running.")


# If this module is imported, and you want to auto-start the manager, you could call start_watch_manager() here.
# However, it's usually better to explicitly start it from the main application/__init__.py.
