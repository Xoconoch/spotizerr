from flask import Blueprint, Response, request
import json
import traceback
import uuid
import time
from routes.utils.celery_queue_manager import download_queue_manager
from routes.utils.celery_tasks import store_task_info, store_task_status, ProgressState
from routes.utils.get_info import get_spotify_info

album_bp = Blueprint("album", __name__)


@album_bp.route("/download/<album_id>", methods=["GET"])
def handle_download(album_id):
    # Retrieve essential parameters from the request.
    # name = request.args.get('name')
    # artist = request.args.get('artist')

    # Construct the URL from album_id
    url = f"https://open.spotify.com/album/{album_id}"

    # Fetch metadata from Spotify
    try:
        album_info = get_spotify_info(album_id, "album")
        if (
            not album_info
            or not album_info.get("name")
            or not album_info.get("artists")
        ):
            return Response(
                json.dumps(
                    {"error": f"Could not retrieve metadata for album ID: {album_id}"}
                ),
                status=404,
                mimetype="application/json",
            )

        name_from_spotify = album_info.get("name")
        artist_from_spotify = (
            album_info["artists"][0].get("name")
            if album_info["artists"]
            else "Unknown Artist"
        )

    except Exception as e:
        return Response(
            json.dumps(
                {"error": f"Failed to fetch metadata for album {album_id}: {str(e)}"}
            ),
            status=500,
            mimetype="application/json",
        )

    # Validate required parameters
    if not url:
        return Response(
            json.dumps({"error": "Missing required parameter: url"}),
            status=400,
            mimetype="application/json",
        )

    # Add the task to the queue with only essential parameters
    # The queue manager will now handle all config parameters
    # Include full original request URL in metadata
    orig_params = request.args.to_dict()
    orig_params["original_url"] = request.url
    try:
        task_id = download_queue_manager.add_task(
            {
                "download_type": "album",
                "url": url,
                "name": name_from_spotify,
                "artist": artist_from_spotify,
                "orig_request": orig_params,
            }
        )
    except Exception as e:
        # Generic error handling for other issues during task submission
        # Create an error task ID if add_task itself fails before returning an ID
        error_task_id = str(uuid.uuid4())

        store_task_info(
            error_task_id,
            {
                "download_type": "album",
                "url": url,
                "name": name_from_spotify,
                "artist": artist_from_spotify,
                "original_request": orig_params,
                "created_at": time.time(),
                "is_submission_error_task": True,
            },
        )
        store_task_status(
            error_task_id,
            {
                "status": ProgressState.ERROR,
                "error": f"Failed to queue album download: {str(e)}",
                "timestamp": time.time(),
            },
        )
        return Response(
            json.dumps(
                {
                    "error": f"Failed to queue album download: {str(e)}",
                    "task_id": error_task_id,
                }
            ),
            status=500,
            mimetype="application/json",
        )

    return Response(
        json.dumps({"prg_file": task_id}), status=202, mimetype="application/json"
    )


@album_bp.route("/download/cancel", methods=["GET"])
def cancel_download():
    """
    Cancel a running download process by its prg file name.
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


@album_bp.route("/info", methods=["GET"])
def get_album_info():
    """
    Retrieve Spotify album metadata given a Spotify album ID.
    Expects a query parameter 'id' that contains the Spotify album ID.
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

        album_info = get_spotify_info(spotify_id, "album")
        return Response(json.dumps(album_info), status=200, mimetype="application/json")
    except Exception as e:
        error_data = {"error": str(e), "traceback": traceback.format_exc()}
        return Response(json.dumps(error_data), status=500, mimetype="application/json")
