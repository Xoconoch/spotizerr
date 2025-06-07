from flask import Blueprint, Response, request
import json
import traceback
import uuid  # For generating error task IDs
import time  # For timestamps
from routes.utils.celery_queue_manager import download_queue_manager
from routes.utils.celery_tasks import (
    store_task_info,
    store_task_status,
    ProgressState,
)  # For error task creation
from urllib.parse import urlparse  # for URL validation
from routes.utils.get_info import get_spotify_info  # Added import

track_bp = Blueprint("track", __name__)


@track_bp.route("/download/<track_id>", methods=["GET"])
def handle_download(track_id):
    # Retrieve essential parameters from the request.
    # name = request.args.get('name') # Removed
    # artist = request.args.get('artist') # Removed
    orig_params = request.args.to_dict()

    # Construct the URL from track_id
    url = f"https://open.spotify.com/track/{track_id}"
    orig_params["original_url"] = url  # Update original_url to the constructed one

    # Fetch metadata from Spotify
    try:
        track_info = get_spotify_info(track_id, "track")
        if (
            not track_info
            or not track_info.get("name")
            or not track_info.get("artists")
        ):
            return Response(
                json.dumps(
                    {"error": f"Could not retrieve metadata for track ID: {track_id}"}
                ),
                status=404,
                mimetype="application/json",
            )

        name_from_spotify = track_info.get("name")
        artist_from_spotify = (
            track_info["artists"][0].get("name")
            if track_info["artists"]
            else "Unknown Artist"
        )

    except Exception as e:
        return Response(
            json.dumps(
                {"error": f"Failed to fetch metadata for track {track_id}: {str(e)}"}
            ),
            status=500,
            mimetype="application/json",
        )

    # Validate required parameters
    if not url:
        return Response(
            json.dumps(
                {"error": "Missing required parameter: url", "original_url": url}
            ),
            status=400,
            mimetype="application/json",
        )
    # Validate URL domain
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if not (
        host.endswith("deezer.com")
        or host.endswith("open.spotify.com")
        or host.endswith("spotify.com")
    ):
        return Response(
            json.dumps({"error": f"Invalid Link {url} :(", "original_url": url}),
            status=400,
            mimetype="application/json",
        )

    try:
        task_id = download_queue_manager.add_task(
            {
                "download_type": "track",
                "url": url,
                "name": name_from_spotify,  # Use fetched name
                "artist": artist_from_spotify,  # Use fetched artist
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
                "download_type": "track",
                "url": url,
                "name": name_from_spotify,  # Use fetched name
                "artist": artist_from_spotify,  # Use fetched artist
                "original_request": orig_params,
                "created_at": time.time(),
                "is_submission_error_task": True,
            },
        )
        store_task_status(
            error_task_id,
            {
                "status": ProgressState.ERROR,
                "error": f"Failed to queue track download: {str(e)}",
                "timestamp": time.time(),
            },
        )
        return Response(
            json.dumps(
                {
                    "error": f"Failed to queue track download: {str(e)}",
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


@track_bp.route("/download/cancel", methods=["GET"])
def cancel_download():
    """
    Cancel a running track download process by its process id (prg file name).
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


@track_bp.route("/info", methods=["GET"])
def get_track_info():
    """
    Retrieve Spotify track metadata given a Spotify track ID.
    Expects a query parameter 'id' that contains the Spotify track ID.
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
        from routes.utils.get_info import get_spotify_info

        track_info = get_spotify_info(spotify_id, "track")
        return Response(json.dumps(track_info), status=200, mimetype="application/json")
    except Exception as e:
        error_data = {"error": str(e), "traceback": traceback.format_exc()}
        return Response(json.dumps(error_data), status=500, mimetype="application/json")
