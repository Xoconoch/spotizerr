"""
Artist endpoint blueprint.
"""

from flask import Blueprint, Response, request, jsonify
import json
import traceback
from routes.utils.artist import download_artist_albums

# Imports for merged watch functionality
import logging
import threading
from routes.utils.watch.db import (
    add_artist_to_watch as add_artist_db,
    remove_artist_from_watch as remove_artist_db,
    get_watched_artist,
    get_watched_artists,
    add_specific_albums_to_artist_table,
    remove_specific_albums_from_artist_table,
    is_album_in_artist_db,
)
from routes.utils.watch.manager import check_watched_artists, get_watch_config
from routes.utils.get_info import get_spotify_info

artist_bp = Blueprint("artist", __name__, url_prefix="/api/artist")

# Existing log_json can be used, or a logger instance.
# Let's initialize a logger for consistency with merged code.
logger = logging.getLogger(__name__)


def log_json(message_dict):
    print(json.dumps(message_dict))


@artist_bp.route("/download/<artist_id>", methods=["GET"])
def handle_artist_download(artist_id):
    """
    Enqueues album download tasks for the given artist.
    Expected query parameters:
      - album_type: string(s); comma-separated values such as "album,single,appears_on,compilation"
    """
    # Construct the artist URL from artist_id
    url = f"https://open.spotify.com/artist/{artist_id}"

    # Retrieve essential parameters from the request.
    album_type = request.args.get("album_type", "album,single,compilation")

    # Validate required parameters
    if not url:  # This check is mostly for safety, as url is constructed
        return Response(
            json.dumps({"error": "Missing required parameter: url"}),
            status=400,
            mimetype="application/json",
        )

    try:
        # Import and call the updated download_artist_albums() function.
        # from routes.utils.artist import download_artist_albums # Already imported at top

        # Delegate to the download_artist_albums function which will handle album filtering
        successfully_queued_albums, duplicate_albums = download_artist_albums(
            url=url, album_type=album_type, request_args=request.args.to_dict()
        )

        # Return the list of album task IDs.
        response_data = {
            "status": "complete",
            "message": f"Artist discography processing initiated. {len(successfully_queued_albums)} albums queued.",
            "queued_albums": successfully_queued_albums,
        }
        if duplicate_albums:
            response_data["duplicate_albums"] = duplicate_albums
            response_data["message"] += (
                f" {len(duplicate_albums)} albums were already in progress or queued."
            )

        return Response(
            json.dumps(response_data),
            status=202,  # Still 202 Accepted as some operations may have succeeded
            mimetype="application/json",
        )
    except Exception as e:
        return Response(
            json.dumps(
                {
                    "status": "error",
                    "message": str(e),
                    "traceback": traceback.format_exc(),
                }
            ),
            status=500,
            mimetype="application/json",
        )


@artist_bp.route("/download/cancel", methods=["GET"])
def cancel_artist_download():
    """
    Cancelling an artist download is not supported since the endpoint only enqueues album tasks.
    (Cancellation for individual album tasks can be implemented via the queue manager.)
    """
    return Response(
        json.dumps({"error": "Artist download cancellation is not supported."}),
        status=400,
        mimetype="application/json",
    )


@artist_bp.route("/info", methods=["GET"])
def get_artist_info():
    """
    Retrieves Spotify artist metadata given a Spotify artist ID.
    Expects a query parameter 'id' with the Spotify artist ID.
    """
    spotify_id = request.args.get("id")

    if not spotify_id:
        return Response(
            json.dumps({"error": "Missing parameter: id"}),
            status=400,
            mimetype="application/json",
        )

    try:
        artist_info = get_spotify_info(spotify_id, "artist_discography")

        # If artist_info is successfully fetched (it contains album items),
        # check if the artist is watched and augment album items with is_locally_known status
        if artist_info and artist_info.get("items"):
            watched_artist_details = get_watched_artist(
                spotify_id
            )  # spotify_id is the artist ID
            if watched_artist_details:  # Artist is being watched
                for album_item in artist_info["items"]:
                    if album_item and album_item.get("id"):
                        album_id = album_item["id"]
                        album_item["is_locally_known"] = is_album_in_artist_db(
                            spotify_id, album_id
                        )
                    elif album_item:  # Album object exists but no ID
                        album_item["is_locally_known"] = False
            # If not watched, or no albums, is_locally_known will not be added.
            # Frontend should handle absence of this key as false.

        return Response(
            json.dumps(artist_info), status=200, mimetype="application/json"
        )
    except Exception as e:
        return Response(
            json.dumps({"error": str(e), "traceback": traceback.format_exc()}),
            status=500,
            mimetype="application/json",
        )


# --- Merged Artist Watch Routes ---


@artist_bp.route("/watch/<string:artist_spotify_id>", methods=["PUT"])
def add_artist_to_watchlist(artist_spotify_id):
    """Adds an artist to the watchlist."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify({"error": "Watch feature is currently disabled globally."}), 403

    logger.info(f"Attempting to add artist {artist_spotify_id} to watchlist.")
    try:
        if get_watched_artist(artist_spotify_id):
            return jsonify(
                {"message": f"Artist {artist_spotify_id} is already being watched."}
            ), 200

        # This call returns an album list-like structure based on logs
        artist_album_list_data = get_spotify_info(
            artist_spotify_id, "artist_discography"
        )

        # Check if we got any data and if it has items
        if not artist_album_list_data or not isinstance(
            artist_album_list_data.get("items"), list
        ):
            logger.error(
                f"Could not fetch album list details for artist {artist_spotify_id} from Spotify using get_spotify_info('artist_discography'). Data: {artist_album_list_data}"
            )
            return jsonify(
                {
                    "error": f"Could not fetch sufficient details for artist {artist_spotify_id} to initiate watch."
                }
            ), 404

        # Attempt to extract artist name and verify ID
        # The actual artist name might be consistently found in the items, if they exist
        artist_name_from_albums = "Unknown Artist"  # Default
        if artist_album_list_data["items"]:
            first_album = artist_album_list_data["items"][0]
            if (
                first_album
                and isinstance(first_album.get("artists"), list)
                and first_album["artists"]
            ):
                # Find the artist in the list that matches the artist_spotify_id
                found_artist = next(
                    (
                        art
                        for art in first_album["artists"]
                        if art.get("id") == artist_spotify_id
                    ),
                    None,
                )
                if found_artist and found_artist.get("name"):
                    artist_name_from_albums = found_artist["name"]
                elif first_album["artists"][0].get(
                    "name"
                ):  # Fallback to first artist if specific match not found or no ID
                    artist_name_from_albums = first_album["artists"][0]["name"]
                    logger.warning(
                        f"Could not find exact artist ID {artist_spotify_id} in first album's artists list. Using name '{artist_name_from_albums}'."
                    )
        else:
            logger.warning(
                f"No album items found for artist {artist_spotify_id} to extract name. Using default."
            )

        # Construct the artist_data object expected by add_artist_db
        # We use the provided artist_spotify_id as the primary ID.
        artist_data_for_db = {
            "id": artist_spotify_id,  # This is the crucial part
            "name": artist_name_from_albums,
            "albums": {  # Mimic structure if add_artist_db expects it for total_albums
                "total": artist_album_list_data.get("total", 0)
            },
            # Add any other fields add_artist_db might expect from a true artist object if necessary
        }

        add_artist_db(artist_data_for_db)

        logger.info(
            f"Artist {artist_spotify_id} ('{artist_name_from_albums}') added to watchlist. Their albums will be processed by the watch manager."
        )
        return jsonify(
            {
                "message": f"Artist {artist_spotify_id} added to watchlist. Albums will be processed shortly."
            }
        ), 201
    except Exception as e:
        logger.error(
            f"Error adding artist {artist_spotify_id} to watchlist: {e}", exc_info=True
        )
        return jsonify({"error": f"Could not add artist to watchlist: {str(e)}"}), 500


@artist_bp.route("/watch/<string:artist_spotify_id>/status", methods=["GET"])
def get_artist_watch_status(artist_spotify_id):
    """Checks if a specific artist is being watched."""
    logger.info(f"Checking watch status for artist {artist_spotify_id}.")
    try:
        artist = get_watched_artist(artist_spotify_id)
        if artist:
            return jsonify({"is_watched": True, "artist_data": dict(artist)}), 200
        else:
            return jsonify({"is_watched": False}), 200
    except Exception as e:
        logger.error(
            f"Error checking watch status for artist {artist_spotify_id}: {e}",
            exc_info=True,
        )
        return jsonify({"error": f"Could not check watch status: {str(e)}"}), 500


@artist_bp.route("/watch/<string:artist_spotify_id>", methods=["DELETE"])
def remove_artist_from_watchlist(artist_spotify_id):
    """Removes an artist from the watchlist."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify({"error": "Watch feature is currently disabled globally."}), 403

    logger.info(f"Attempting to remove artist {artist_spotify_id} from watchlist.")
    try:
        if not get_watched_artist(artist_spotify_id):
            return jsonify(
                {"error": f"Artist {artist_spotify_id} not found in watchlist."}
            ), 404

        remove_artist_db(artist_spotify_id)
        logger.info(f"Artist {artist_spotify_id} removed from watchlist successfully.")
        return jsonify(
            {"message": f"Artist {artist_spotify_id} removed from watchlist."}
        ), 200
    except Exception as e:
        logger.error(
            f"Error removing artist {artist_spotify_id} from watchlist: {e}",
            exc_info=True,
        )
        return jsonify(
            {"error": f"Could not remove artist from watchlist: {str(e)}"}
        ), 500


@artist_bp.route("/watch/list", methods=["GET"])
def list_watched_artists_endpoint():
    """Lists all artists currently in the watchlist."""
    try:
        artists = get_watched_artists()
        return jsonify([dict(artist) for artist in artists]), 200
    except Exception as e:
        logger.error(f"Error listing watched artists: {e}", exc_info=True)
        return jsonify({"error": f"Could not list watched artists: {str(e)}"}), 500


@artist_bp.route("/watch/trigger_check", methods=["POST"])
def trigger_artist_check_endpoint():
    """Manually triggers the artist checking mechanism for all watched artists."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify(
            {
                "error": "Watch feature is currently disabled globally. Cannot trigger check."
            }
        ), 403

    logger.info("Manual trigger for artist check received for all artists.")
    try:
        thread = threading.Thread(target=check_watched_artists, args=(None,))
        thread.start()
        return jsonify(
            {
                "message": "Artist check triggered successfully in the background for all artists."
            }
        ), 202
    except Exception as e:
        logger.error(
            f"Error manually triggering artist check for all: {e}", exc_info=True
        )
        return jsonify(
            {"error": f"Could not trigger artist check for all: {str(e)}"}
        ), 500


@artist_bp.route("/watch/trigger_check/<string:artist_spotify_id>", methods=["POST"])
def trigger_specific_artist_check_endpoint(artist_spotify_id: str):
    """Manually triggers the artist checking mechanism for a specific artist."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify(
            {
                "error": "Watch feature is currently disabled globally. Cannot trigger check."
            }
        ), 403

    logger.info(
        f"Manual trigger for specific artist check received for ID: {artist_spotify_id}"
    )
    try:
        watched_artist = get_watched_artist(artist_spotify_id)
        if not watched_artist:
            logger.warning(
                f"Trigger specific check: Artist ID {artist_spotify_id} not found in watchlist."
            )
            return jsonify(
                {
                    "error": f"Artist {artist_spotify_id} is not in the watchlist. Add it first."
                }
            ), 404

        thread = threading.Thread(
            target=check_watched_artists, args=(artist_spotify_id,)
        )
        thread.start()
        logger.info(
            f"Artist check triggered in background for specific artist ID: {artist_spotify_id}"
        )
        return jsonify(
            {
                "message": f"Artist check triggered successfully in the background for {artist_spotify_id}."
            }
        ), 202
    except Exception as e:
        logger.error(
            f"Error manually triggering specific artist check for {artist_spotify_id}: {e}",
            exc_info=True,
        )
        return jsonify(
            {
                "error": f"Could not trigger artist check for {artist_spotify_id}: {str(e)}"
            }
        ), 500


@artist_bp.route("/watch/<string:artist_spotify_id>/albums", methods=["POST"])
def mark_albums_as_known_for_artist(artist_spotify_id):
    """Fetches details for given album IDs and adds/updates them in the artist's local DB table."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify(
            {
                "error": "Watch feature is currently disabled globally. Cannot mark albums."
            }
        ), 403

    logger.info(f"Attempting to mark albums as known for artist {artist_spotify_id}.")
    try:
        album_ids = request.json
        if not isinstance(album_ids, list) or not all(
            isinstance(aid, str) for aid in album_ids
        ):
            return jsonify(
                {
                    "error": "Invalid request body. Expecting a JSON array of album Spotify IDs."
                }
            ), 400

        if not get_watched_artist(artist_spotify_id):
            return jsonify(
                {"error": f"Artist {artist_spotify_id} is not being watched."}
            ), 404

        fetched_albums_details = []
        for album_id in album_ids:
            try:
                # We need full album details. get_spotify_info with type "album" should provide this.
                album_detail = get_spotify_info(album_id, "album")
                if album_detail and album_detail.get("id"):
                    fetched_albums_details.append(album_detail)
                else:
                    logger.warning(
                        f"Could not fetch details for album {album_id} when marking as known for artist {artist_spotify_id}."
                    )
            except Exception as e:
                logger.error(
                    f"Failed to fetch Spotify details for album {album_id}: {e}"
                )

        if not fetched_albums_details:
            return jsonify(
                {
                    "message": "No valid album details could be fetched to mark as known.",
                    "processed_count": 0,
                }
            ), 200

        processed_count = add_specific_albums_to_artist_table(
            artist_spotify_id, fetched_albums_details
        )
        logger.info(
            f"Successfully marked/updated {processed_count} albums as known for artist {artist_spotify_id}."
        )
        return jsonify(
            {
                "message": f"Successfully processed {processed_count} albums for artist {artist_spotify_id}."
            }
        ), 200
    except Exception as e:
        logger.error(
            f"Error marking albums as known for artist {artist_spotify_id}: {e}",
            exc_info=True,
        )
        return jsonify({"error": f"Could not mark albums as known: {str(e)}"}), 500


@artist_bp.route("/watch/<string:artist_spotify_id>/albums", methods=["DELETE"])
def mark_albums_as_missing_locally_for_artist(artist_spotify_id):
    """Removes specified albums from the artist's local DB table."""
    watch_config = get_watch_config()
    if not watch_config.get("enabled", False):
        return jsonify(
            {
                "error": "Watch feature is currently disabled globally. Cannot mark albums."
            }
        ), 403

    logger.info(
        f"Attempting to mark albums as missing (delete locally) for artist {artist_spotify_id}."
    )
    try:
        album_ids = request.json
        if not isinstance(album_ids, list) or not all(
            isinstance(aid, str) for aid in album_ids
        ):
            return jsonify(
                {
                    "error": "Invalid request body. Expecting a JSON array of album Spotify IDs."
                }
            ), 400

        if not get_watched_artist(artist_spotify_id):
            return jsonify(
                {"error": f"Artist {artist_spotify_id} is not being watched."}
            ), 404

        deleted_count = remove_specific_albums_from_artist_table(
            artist_spotify_id, album_ids
        )
        logger.info(
            f"Successfully removed {deleted_count} albums locally for artist {artist_spotify_id}."
        )
        return jsonify(
            {
                "message": f"Successfully removed {deleted_count} albums locally for artist {artist_spotify_id}."
            }
        ), 200
    except Exception as e:
        logger.error(
            f"Error marking albums as missing (deleting locally) for artist {artist_spotify_id}: {e}",
            exc_info=True,
        )
        return jsonify({"error": f"Could not mark albums as missing: {str(e)}"}), 500
