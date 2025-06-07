from flask import Blueprint, Response, request, jsonify
import json
import traceback
import logging  # Added logging import
import uuid  # For generating error task IDs
import time  # For timestamps
from routes.utils.celery_queue_manager import download_queue_manager
from routes.utils.celery_tasks import (
    store_task_info,
    store_task_status,
    ProgressState,
)  # For error task creation
import threading  # For playlist watch trigger

# Imports from playlist_watch.py
from routes.utils.watch.db import (
    add_playlist_to_watch as add_playlist_db,
    remove_playlist_from_watch as remove_playlist_db,
    get_watched_playlist,
    get_watched_playlists,
    add_specific_tracks_to_playlist_table,
    remove_specific_tracks_from_playlist_table,
    is_track_in_playlist_db,  # Added import
)
from routes.utils.get_info import get_spotify_info  # Already used, but ensure it's here
from routes.utils.watch.manager import (
    check_watched_playlists,
    get_watch_config,
)  # For manual trigger & config

logger = logging.getLogger(__name__)  # Added logger initialization
playlist_bp = Blueprint("playlist", __name__, url_prefix="/api/playlist")


@playlist_bp.route("/download/<playlist_id>", methods=["GET"])
def handle_download(playlist_id):
    # Retrieve essential parameters from the request.
    # name = request.args.get('name') # Removed
    # artist = request.args.get('artist') # Removed
    orig_params = request.args.to_dict()

    # Construct the URL from playlist_id
    url = f"https://open.spotify.com/playlist/{playlist_id}"
    orig_params["original_url"] = (
        request.url
    )  # Update original_url to the constructed one

    # Fetch metadata from Spotify
    try:
        playlist_info = get_spotify_info(playlist_id, "playlist")
        if (
            not playlist_info
            or not playlist_info.get("name")
            or not playlist_info.get("owner")
        ):
            return Response(
                json.dumps(
                    {
                        "error": f"Could not retrieve metadata for playlist ID: {playlist_id}"
                    }
                ),
                status=404,
                mimetype="application/json",
            )

        name_from_spotify = playlist_info.get("name")
        # Use owner's display_name as the 'artist' for playlists
        owner_info = playlist_info.get("owner", {})
        artist_from_spotify = owner_info.get("display_name", "Unknown Owner")

    except Exception as e:
        return Response(
            json.dumps(
                {
                    "error": f"Failed to fetch metadata for playlist {playlist_id}: {str(e)}"
                }
            ),
            status=500,
            mimetype="application/json",
        )

    # Validate required parameters
    if not url:  # This check might be redundant now but kept for safety
        return Response(
            json.dumps({"error": "Missing required parameter: url"}),
            status=400,
            mimetype="application/json",
        )

    try:
        task_id = download_queue_manager.add_task(
            {
                "download_type": "playlist",
                "url": url,
                "name": name_from_spotify,  # Use fetched name
                "artist": artist_from_spotify,  # Use fetched owner name as artist
                "orig_request": orig_params,
            }
        )
    # Removed DuplicateDownloadError handling, add_task now manages this by creating an error task.
    except Exception as e:
        # Generic error handling for other issues during task submission
        error_task_id = str(uuid.uuid4())
        store_task_info(
            error_task_id,
            {
                "download_type": "playlist",
                "url": url,
                "name": name_from_spotify,  # Use fetched name
                "artist": artist_from_spotify,  # Use fetched owner name as artist
                "original_request": orig_params,
                "created_at": time.time(),
                "is_submission_error_task": True,
            },
        )
        store_task_status(
            error_task_id,
            {
                "status": ProgressState.ERROR,
                "error": f"Failed to queue playlist download: {str(e)}",
                "timestamp": time.time(),
            },
        )
        return Response(
            json.dumps(
                {
                    "error": f"Failed to queue playlist download: {str(e)}",
                    "task_id": error_task_id,
                }
            ),
            status=500,
            mimetype="application/json",
        )

    return Response(
        json.dumps({"prg_file": task_id}),  # prg_file is the old name for task_id
        status=202,
        mimetype="application/json",
    )


@playlist_bp.route("/download/cancel", methods=["GET"])
def cancel_download():
    """
    Cancel a running playlist download process by its prg file name.
    """
    prg_file = request.args.get("prg_file")
    if not prg_file:
        return Response(
            json.dumps({"error": "Missing process id (prg_file) parameter"}),
            status=400,
            mimetype="application/json",
        )

    # Use the queue manager's cancellation method.
    result = download_queue_manager.cancel_task(prg_file)
    status_code = 200 if result.get("status") == "cancelled" else 404

    return Response(json.dumps(result), status=status_code, mimetype="application/json")


@playlist_bp.route("/info", methods=["GET"])
def get_playlist_info():
    """
    Retrieve Spotify playlist metadata given a Spotify playlist ID.
    Expects a query parameter 'id' that contains the Spotify playlist ID.
    """
    spotify_id = request.args.get("id")

    if not spotify_id:
        return Response(
            json.dumps({"error": "Missing parameter: id"}),
            status=400,
            mimetype="application/json",
        )

    try:
        # Import and use the get_spotify_info function from the utility module.
        playlist_info = get_spotify_info(spotify_id, "playlist")

        # If playlist_info is successfully fetched, check if it's watched
        # and augment track items with is_locally_known status
        if playlist_info and playlist_info.get("id"):
            watched_playlist_details = get_watched_playlist(playlist_info["id"])
            if watched_playlist_details:  # Playlist is being watched
                if playlist_info.get("tracks") and playlist_info["tracks"].get("items"):
                    for item in playlist_info["tracks"]["items"]:
                        if item and item.get("track") and item["track"].get("id"):
                            track_id = item["track"]["id"]
                            item["track"]["is_locally_known"] = is_track_in_playlist_db(
                                playlist_info["id"], track_id
                            )
                        elif item and item.get(
                            "track"
                        ):  # Track object exists but no ID
                            item["track"]["is_locally_known"] = False
            # If not watched, or no tracks, is_locally_known will not be added, or tracks won't exist to add it to.
            # Frontend should handle absence of this key as false.

        return Response(
            json.dumps(playlist_info), status=200, mimetype="application/json"
        )
    except Exception as e:
        error_data = {"error": str(e), "traceback": traceback.format_exc()}
        return Response(json.dumps(error_data), status=500, mimetype="application/json")


@playlist_bp.route("/watch/<string:playlist_spotify_id>", methods=["PUT"])
def add_to_watchlist(playlist_spotify_id):
    """Adds a playlist to the watchlist."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify({"error": "Watch feature is currently disabled globally."}), 403

    logger.info(f"Attempting to add playlist {playlist_spotify_id} to watchlist.")
    try:
        # Check if already watched
        if get_watched_playlist(playlist_spotify_id):
            return jsonify(
                {"message": f"Playlist {playlist_spotify_id} is already being watched."}
            ), 200

        # Fetch playlist details from Spotify to populate our DB
        playlist_data = get_spotify_info(playlist_spotify_id, "playlist")
        if not playlist_data or "id" not in playlist_data:
            logger.error(
                f"Could not fetch details for playlist {playlist_spotify_id} from Spotify."
            )
            return jsonify(
                {
                    "error": f"Could not fetch details for playlist {playlist_spotify_id} from Spotify."
                }
            ), 404

        add_playlist_db(playlist_data)  # This also creates the tracks table

        # REMOVED: Do not add initial tracks directly to DB.
        # The playlist watch manager will pick them up as new and queue downloads.
        # Tracks will be added to DB only after successful download via Celery task callback.
        # initial_track_items = playlist_data.get('tracks', {}).get('items', [])
        # if initial_track_items:
        #     from routes.utils.watch.db import add_tracks_to_playlist_db # Keep local import for clarity
        #     add_tracks_to_playlist_db(playlist_spotify_id, initial_track_items)

        logger.info(
            f"Playlist {playlist_spotify_id} added to watchlist. Its tracks will be processed by the watch manager."
        )
        return jsonify(
            {
                "message": f"Playlist {playlist_spotify_id} added to watchlist. Tracks will be processed shortly."
            }
        ), 201
    except Exception as e:
        logger.error(
            f"Error adding playlist {playlist_spotify_id} to watchlist: {e}",
            exc_info=True,
        )
        return jsonify({"error": f"Could not add playlist to watchlist: {str(e)}"}), 500


@playlist_bp.route("/watch/<string:playlist_spotify_id>/status", methods=["GET"])
def get_playlist_watch_status(playlist_spotify_id):
    """Checks if a specific playlist is being watched."""
    logger.info(f"Checking watch status for playlist {playlist_spotify_id}.")
    try:
        playlist = get_watched_playlist(playlist_spotify_id)
        if playlist:
            return jsonify({"is_watched": True, "playlist_data": playlist}), 200
        else:
            # Return 200 with is_watched: false, so frontend can clearly distinguish
            # between "not watched" and an actual error fetching status.
            return jsonify({"is_watched": False}), 200
    except Exception as e:
        logger.error(
            f"Error checking watch status for playlist {playlist_spotify_id}: {e}",
            exc_info=True,
        )
        return jsonify({"error": f"Could not check watch status: {str(e)}"}), 500


@playlist_bp.route("/watch/<string:playlist_spotify_id>", methods=["DELETE"])
def remove_from_watchlist(playlist_spotify_id):
    """Removes a playlist from the watchlist."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify({"error": "Watch feature is currently disabled globally."}), 403

    logger.info(f"Attempting to remove playlist {playlist_spotify_id} from watchlist.")
    try:
        if not get_watched_playlist(playlist_spotify_id):
            return jsonify(
                {"error": f"Playlist {playlist_spotify_id} not found in watchlist."}
            ), 404

        remove_playlist_db(playlist_spotify_id)
        logger.info(
            f"Playlist {playlist_spotify_id} removed from watchlist successfully."
        )
        return jsonify(
            {"message": f"Playlist {playlist_spotify_id} removed from watchlist."}
        ), 200
    except Exception as e:
        logger.error(
            f"Error removing playlist {playlist_spotify_id} from watchlist: {e}",
            exc_info=True,
        )
        return jsonify(
            {"error": f"Could not remove playlist from watchlist: {str(e)}"}
        ), 500


@playlist_bp.route("/watch/<string:playlist_spotify_id>/tracks", methods=["POST"])
def mark_tracks_as_known(playlist_spotify_id):
    """Fetches details for given track IDs and adds/updates them in the playlist's local DB table."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify(
            {
                "error": "Watch feature is currently disabled globally. Cannot mark tracks."
            }
        ), 403

    logger.info(
        f"Attempting to mark tracks as known for playlist {playlist_spotify_id}."
    )
    try:
        track_ids = request.json
        if not isinstance(track_ids, list) or not all(
            isinstance(tid, str) for tid in track_ids
        ):
            return jsonify(
                {
                    "error": "Invalid request body. Expecting a JSON array of track Spotify IDs."
                }
            ), 400

        if not get_watched_playlist(playlist_spotify_id):
            return jsonify(
                {"error": f"Playlist {playlist_spotify_id} is not being watched."}
            ), 404

        fetched_tracks_details = []
        for track_id in track_ids:
            try:
                track_detail = get_spotify_info(track_id, "track")
                if track_detail and track_detail.get("id"):
                    fetched_tracks_details.append(track_detail)
                else:
                    logger.warning(
                        f"Could not fetch details for track {track_id} when marking as known for playlist {playlist_spotify_id}."
                    )
            except Exception as e:
                logger.error(
                    f"Failed to fetch Spotify details for track {track_id}: {e}"
                )

        if not fetched_tracks_details:
            return jsonify(
                {
                    "message": "No valid track details could be fetched to mark as known.",
                    "processed_count": 0,
                }
            ), 200

        add_specific_tracks_to_playlist_table(
            playlist_spotify_id, fetched_tracks_details
        )
        logger.info(
            f"Successfully marked/updated {len(fetched_tracks_details)} tracks as known for playlist {playlist_spotify_id}."
        )
        return jsonify(
            {
                "message": f"Successfully processed {len(fetched_tracks_details)} tracks for playlist {playlist_spotify_id}."
            }
        ), 200
    except Exception as e:
        logger.error(
            f"Error marking tracks as known for playlist {playlist_spotify_id}: {e}",
            exc_info=True,
        )
        return jsonify({"error": f"Could not mark tracks as known: {str(e)}"}), 500


@playlist_bp.route("/watch/<string:playlist_spotify_id>/tracks", methods=["DELETE"])
def mark_tracks_as_missing_locally(playlist_spotify_id):
    """Removes specified tracks from the playlist's local DB table."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify(
            {
                "error": "Watch feature is currently disabled globally. Cannot mark tracks."
            }
        ), 403

    logger.info(
        f"Attempting to mark tracks as missing (remove locally) for playlist {playlist_spotify_id}."
    )
    try:
        track_ids = request.json
        if not isinstance(track_ids, list) or not all(
            isinstance(tid, str) for tid in track_ids
        ):
            return jsonify(
                {
                    "error": "Invalid request body. Expecting a JSON array of track Spotify IDs."
                }
            ), 400

        if not get_watched_playlist(playlist_spotify_id):
            return jsonify(
                {"error": f"Playlist {playlist_spotify_id} is not being watched."}
            ), 404

        deleted_count = remove_specific_tracks_from_playlist_table(
            playlist_spotify_id, track_ids
        )
        logger.info(
            f"Successfully removed {deleted_count} tracks locally for playlist {playlist_spotify_id}."
        )
        return jsonify(
            {
                "message": f"Successfully removed {deleted_count} tracks locally for playlist {playlist_spotify_id}."
            }
        ), 200
    except Exception as e:
        logger.error(
            f"Error marking tracks as missing (deleting locally) for playlist {playlist_spotify_id}: {e}",
            exc_info=True,
        )
        return jsonify({"error": f"Could not mark tracks as missing: {str(e)}"}), 500


@playlist_bp.route("/watch/list", methods=["GET"])
def list_watched_playlists_endpoint():
    """Lists all playlists currently in the watchlist."""
    try:
        playlists = get_watched_playlists()
        return jsonify(playlists), 200
    except Exception as e:
        logger.error(f"Error listing watched playlists: {e}", exc_info=True)
        return jsonify({"error": f"Could not list watched playlists: {str(e)}"}), 500


@playlist_bp.route("/watch/trigger_check", methods=["POST"])
def trigger_playlist_check_endpoint():
    """Manually triggers the playlist checking mechanism for all watched playlists."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify(
            {
                "error": "Watch feature is currently disabled globally. Cannot trigger check."
            }
        ), 403

    logger.info("Manual trigger for playlist check received for all playlists.")
    try:
        # Run check_watched_playlists without an ID to check all
        thread = threading.Thread(target=check_watched_playlists, args=(None,))
        thread.start()
        return jsonify(
            {
                "message": "Playlist check triggered successfully in the background for all playlists."
            }
        ), 202
    except Exception as e:
        logger.error(
            f"Error manually triggering playlist check for all: {e}", exc_info=True
        )
        return jsonify(
            {"error": f"Could not trigger playlist check for all: {str(e)}"}
        ), 500


@playlist_bp.route(
    "/watch/trigger_check/<string:playlist_spotify_id>", methods=["POST"]
)
def trigger_specific_playlist_check_endpoint(playlist_spotify_id: str):
    """Manually triggers the playlist checking mechanism for a specific playlist."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify(
            {
                "error": "Watch feature is currently disabled globally. Cannot trigger check."
            }
        ), 403

    logger.info(
        f"Manual trigger for specific playlist check received for ID: {playlist_spotify_id}"
    )
    try:
        # Check if the playlist is actually in the watchlist first
        watched_playlist = get_watched_playlist(playlist_spotify_id)
        if not watched_playlist:
            logger.warning(
                f"Trigger specific check: Playlist ID {playlist_spotify_id} not found in watchlist."
            )
            return jsonify(
                {
                    "error": f"Playlist {playlist_spotify_id} is not in the watchlist. Add it first."
                }
            ), 404

        # Run check_watched_playlists with the specific ID
        thread = threading.Thread(
            target=check_watched_playlists, args=(playlist_spotify_id,)
        )
        thread.start()
        logger.info(
            f"Playlist check triggered in background for specific playlist ID: {playlist_spotify_id}"
        )
        return jsonify(
            {
                "message": f"Playlist check triggered successfully in the background for {playlist_spotify_id}."
            }
        ), 202
    except Exception as e:
        logger.error(
            f"Error manually triggering specific playlist check for {playlist_spotify_id}: {e}",
            exc_info=True,
        )
        return jsonify(
            {
                "error": f"Could not trigger playlist check for {playlist_spotify_id}: {str(e)}"
            }
        ), 500
