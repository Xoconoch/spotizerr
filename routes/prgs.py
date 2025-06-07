from flask import Blueprint, abort, jsonify, request
import logging
import time

from routes.utils.celery_tasks import (
    get_task_info,
    get_task_status,
    get_last_task_status,
    get_all_tasks,
    cancel_task,
    retry_task,
    redis_client,
)

# Configure logging
logger = logging.getLogger(__name__)

prgs_bp = Blueprint("prgs", __name__, url_prefix="/api/prgs")

# (Old .prg file system removed. Using new task system only.)


@prgs_bp.route("/<task_id>", methods=["GET"])
def get_prg_file(task_id):
    """
    Return a JSON object with the resource type, its name (title),
    the last progress update, and, if available, the original request parameters.

    This function works with both the old PRG file system (for backward compatibility)
    and the new task ID based system.

    Args:
        task_id: Either a task UUID from Celery or a PRG filename from the old system
    """
    # Only support new task IDs
    task_info = get_task_info(task_id)
    if not task_info:
        abort(404, "Task not found")

    # Dynamically construct original_url
    dynamic_original_url = ""
    download_type = task_info.get("download_type")
    # The 'url' field in task_info stores the Spotify/Deezer URL of the item
    # e.g., https://open.spotify.com/album/albumId or https://www.deezer.com/track/trackId
    item_url = task_info.get("url")

    if download_type and item_url:
        try:
            # Extract the ID from the item_url (last part of the path)
            item_id = item_url.split("/")[-1]
            if item_id:  # Ensure item_id is not empty
                base_url = request.host_url.rstrip("/")
                dynamic_original_url = (
                    f"{base_url}/api/{download_type}/download/{item_id}"
                )
            else:
                logger.warning(
                    f"Could not extract item ID from URL: {item_url} for task {task_id}. Falling back for original_url."
                )
                original_request_obj = task_info.get("original_request", {})
                dynamic_original_url = original_request_obj.get("original_url", "")
        except Exception as e:
            logger.error(
                f"Error constructing dynamic original_url for task {task_id}: {e}",
                exc_info=True,
            )
            original_request_obj = task_info.get("original_request", {})
            dynamic_original_url = original_request_obj.get(
                "original_url", ""
            )  # Fallback on any error
    else:
        logger.warning(
            f"Missing download_type ('{download_type}') or item_url ('{item_url}') in task_info for task {task_id}. Falling back for original_url."
        )
        original_request_obj = task_info.get("original_request", {})
        dynamic_original_url = original_request_obj.get("original_url", "")

    last_status = get_last_task_status(task_id)
    status_count = len(get_task_status(task_id))
    response = {
        "original_url": dynamic_original_url,
        "last_line": last_status,
        "timestamp": time.time(),
        "task_id": task_id,
        "status_count": status_count,
    }
    return jsonify(response)


@prgs_bp.route("/delete/<task_id>", methods=["DELETE"])
def delete_prg_file(task_id):
    """
    Delete a task's information and history.
    Works with both the old PRG file system and the new task ID based system.

    Args:
        task_id: Either a task UUID from Celery or a PRG filename from the old system
    """
    # Only support new task IDs
    task_info = get_task_info(task_id)
    if not task_info:
        abort(404, "Task not found")
    cancel_task(task_id)
    redis_client.delete(f"task:{task_id}:info")
    redis_client.delete(f"task:{task_id}:status")
    return {"message": f"Task {task_id} deleted successfully"}, 200


@prgs_bp.route("/list", methods=["GET"])
def list_prg_files():
    """
    Retrieve a list of all tasks in the system.
    Returns a detailed list of task objects including status and metadata.
    """
    try:
        tasks = get_all_tasks()  # This already gets summary data
        detailed_tasks = []
        for task_summary in tasks:
            task_id = task_summary.get("task_id")
            if not task_id:
                continue

            task_info = get_task_info(task_id)
            last_status = get_last_task_status(task_id)

            if task_info and last_status:
                detailed_tasks.append(
                    {
                        "task_id": task_id,
                        "type": task_info.get(
                            "type", task_summary.get("type", "unknown")
                        ),
                        "name": task_info.get(
                            "name", task_summary.get("name", "Unknown")
                        ),
                        "artist": task_info.get(
                            "artist", task_summary.get("artist", "")
                        ),
                        "download_type": task_info.get(
                            "download_type",
                            task_summary.get("download_type", "unknown"),
                        ),
                        "status": last_status.get(
                            "status", "unknown"
                        ),  # Keep summary status for quick access
                        "last_status_obj": last_status,  # Full last status object
                        "original_request": task_info.get("original_request", {}),
                        "created_at": task_info.get("created_at", 0),
                        "timestamp": last_status.get(
                            "timestamp", task_info.get("created_at", 0)
                        ),
                    }
                )
            elif (
                task_info
            ):  # If last_status is somehow missing, still provide some info
                detailed_tasks.append(
                    {
                        "task_id": task_id,
                        "type": task_info.get("type", "unknown"),
                        "name": task_info.get("name", "Unknown"),
                        "artist": task_info.get("artist", ""),
                        "download_type": task_info.get("download_type", "unknown"),
                        "status": "unknown",
                        "last_status_obj": None,
                        "original_request": task_info.get("original_request", {}),
                        "created_at": task_info.get("created_at", 0),
                        "timestamp": task_info.get("created_at", 0),
                    }
                )

        # Sort tasks by creation time (newest first, or by timestamp if creation time is missing)
        detailed_tasks.sort(
            key=lambda x: x.get("timestamp", x.get("created_at", 0)), reverse=True
        )

        return jsonify(detailed_tasks)
    except Exception as e:
        logger.error(f"Error in /api/prgs/list: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve task list"}), 500


@prgs_bp.route("/retry/<task_id>", methods=["POST"])
def retry_task_endpoint(task_id):
    """
    Retry a failed task.

    Args:
        task_id: The ID of the task to retry
    """
    try:
        # First check if this is a task ID in the new system
        task_info = get_task_info(task_id)

        if task_info:
            # This is a task ID in the new system
            result = retry_task(task_id)
            return jsonify(result)

        # If not found in new system, we need to handle the old system retry
        # For now, return an error as we're transitioning to the new system
        return jsonify(
            {
                "status": "error",
                "message": "Retry for old system is not supported in the new API. Please use the new task ID format.",
            }
        ), 400
    except Exception as e:
        abort(500, f"An error occurred: {e}")


@prgs_bp.route("/cancel/<task_id>", methods=["POST"])
def cancel_task_endpoint(task_id):
    """
    Cancel a running or queued task.

    Args:
        task_id: The ID of the task to cancel
    """
    try:
        # First check if this is a task ID in the new system
        task_info = get_task_info(task_id)

        if task_info:
            # This is a task ID in the new system
            result = cancel_task(task_id)
            return jsonify(result)

        # If not found in new system, we need to handle the old system cancellation
        # For now, return an error as we're transitioning to the new system
        return jsonify(
            {
                "status": "error",
                "message": "Cancellation for old system is not supported in the new API. Please use the new task ID format.",
            }
        ), 400
    except Exception as e:
        abort(500, f"An error occurred: {e}")
