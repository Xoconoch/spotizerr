import json
import time
import uuid
import logging

from routes.utils.celery_tasks import (
    download_track,
    download_album,
    download_playlist,
    store_task_status,
    store_task_info,
    get_task_info,
    get_last_task_status,
    cancel_task as cancel_celery_task,
    retry_task as retry_celery_task,
    get_all_tasks,
    ProgressState,
)

# Configure logging
logger = logging.getLogger(__name__)

# Load configuration
CONFIG_PATH = "./data/config/main.json"
try:
    with open(CONFIG_PATH, "r") as f:
        config_data = json.load(f)
    MAX_CONCURRENT_DL = config_data.get("maxConcurrentDownloads", 3)
except Exception as e:
    print(f"Error loading configuration: {e}")
    # Fallback default
    MAX_CONCURRENT_DL = 3


def get_config_params():
    """
    Get common download parameters from the config file.
    This centralizes parameter retrieval and reduces redundancy in API calls.

    Returns:
        dict: A dictionary containing common parameters from config
    """
    try:
        with open(CONFIG_PATH, "r") as f:
            config = json.load(f)

        return {
            "spotify": config.get("spotify", ""),
            "deezer": config.get("deezer", ""),
            "fallback": config.get("fallback", False),
            "spotifyQuality": config.get("spotifyQuality", "NORMAL"),
            "deezerQuality": config.get("deezerQuality", "MP3_128"),
            "realTime": config.get("realTime", False),
            "customDirFormat": config.get("customDirFormat", "%ar_album%/%album%"),
            "customTrackFormat": config.get("customTrackFormat", "%tracknum%. %music%"),
            "tracknumPadding": config.get(
                "tracknumPadding", config.get("tracknum_padding", True)
            ),
            "saveCover": config.get("saveCover", config.get("save_cover", True)),
            "maxRetries": config.get("maxRetries", 3),
            "retryDelaySeconds": config.get("retryDelaySeconds", 5),
            "retryDelayIncrease": config.get(
                "retryDelayIncrease", config.get("retry_delay_increase", 5)
            ),
            "convertTo": config.get("convertTo", None),
            "bitrate": config.get("bitrate", None),
            "artistSeparator": config.get(
                "artistSeparator", config.get("artist_separator", "; ")
            ),
            "recursiveQuality": config.get(
                "recursiveQuality", config.get("recursive_quality", False)
            ),
            "separateTracksByUser": config.get("separateTracksByUser", False),
            "watch": config.get("watch", {}),
            "realTimeMultiplier": config.get(
                "realTimeMultiplier", config.get("real_time_multiplier", 0)
            ),
        }
    except Exception as e:
        logger.error(f"Error reading config for parameters: {e}")
        # Return defaults if config read fails
        return {
            "spotify": "",
            "deezer": "",
            "fallback": False,
            "spotifyQuality": "NORMAL",
            "deezerQuality": "MP3_128",
            "realTime": False,
            "customDirFormat": "%ar_album%/%album%",
            "customTrackFormat": "%tracknum%. %music%",
            "tracknumPadding": True,
            "saveCover": True,
            "maxRetries": 3,
            "retryDelaySeconds": 5,
            "retryDelayIncrease": 5,
            "convertTo": None,  # Default for conversion
            "bitrate": None,  # Default for bitrate
            "artistSeparator": "; ",
            "recursiveQuality": False,
            "separateTracksByUser": False,
            "watch": {},
            "realTimeMultiplier": 0,
        }


def get_existing_task_id(url, download_type=None):
    """
    Check if an active task with the same URL (and optionally, type) already exists.
    This function ignores tasks that are in a terminal state (e.g., completed, cancelled, or failed).

    Args:
        url (str): The URL to check for duplicates.
        download_type (str, optional): The type of download to check. Defaults to None.

    Returns:
        str | None: The task ID of the existing active task, or None if no active duplicate is found.
    """
    logger.debug(
        f"GET_EXISTING_TASK_ID: Checking for URL='{url}', type='{download_type}'"
    )
    if not url:
        logger.debug("GET_EXISTING_TASK_ID: No URL provided, returning None.")
        return None

    # Define terminal states. Tasks in these states are considered inactive and will be ignored.
    TERMINAL_STATES = {
        ProgressState.COMPLETE,
        ProgressState.DONE,
        ProgressState.CANCELLED,
        ProgressState.ERROR,
        ProgressState.ERROR_RETRIED,
        ProgressState.ERROR_AUTO_CLEANED,
        # Include string variants from standardized status_info structure
        "cancelled",
        "error",
        "done",
        "complete",
        "completed",
        "failed",
        "skipped",
    }
    logger.debug(f"GET_EXISTING_TASK_ID: Terminal states defined as: {TERMINAL_STATES}")

    all_existing_tasks_summary = (
        get_all_tasks()
    )  # This function already filters by default based on its own TERMINAL_STATES
    logger.debug(
        f"GET_EXISTING_TASK_ID: Found {len(all_existing_tasks_summary)} tasks from get_all_tasks(). Iterating..."
    )

    for task_summary in all_existing_tasks_summary:
        existing_task_id = task_summary.get("task_id")
        if not existing_task_id:
            logger.debug("GET_EXISTING_TASK_ID: Skipping summary with no task_id.")
            continue

        logger.debug(
            f"GET_EXISTING_TASK_ID: Processing existing task_id='{existing_task_id}' from summary."
        )

        # First, check the status of the task directly from its latest status record.
        # get_all_tasks() might have its own view of terminal, but we re-check here for absolute certainty.
        existing_last_status_obj = get_last_task_status(existing_task_id)
        if not existing_last_status_obj:
            logger.debug(
                f"GET_EXISTING_TASK_ID: No last status object for task_id='{existing_task_id}'. Skipping."
            )
            continue

        # Extract status from standard structure (status_info.status) or fallback to top-level status
        existing_status = None
        if (
            "status_info" in existing_last_status_obj
            and existing_last_status_obj["status_info"]
        ):
            existing_status = existing_last_status_obj["status_info"].get("status")
        if not existing_status:
            existing_status = existing_last_status_obj.get("status")

        logger.debug(
            f"GET_EXISTING_TASK_ID: Task_id='{existing_task_id}', last_status_obj='{existing_last_status_obj}', extracted status='{existing_status}'."
        )

        # If the task is in a terminal state, ignore it and move to the next one.
        if existing_status in TERMINAL_STATES:
            logger.debug(
                f"GET_EXISTING_TASK_ID: Task_id='{existing_task_id}' has terminal status='{existing_status}'. Skipping."
            )
            continue

        logger.debug(
            f"GET_EXISTING_TASK_ID: Task_id='{existing_task_id}' has ACTIVE status='{existing_status}'. Proceeding to check URL/type."
        )

        # If the task is active, then check if its URL and type match.
        existing_task_info = get_task_info(existing_task_id)
        if not existing_task_info:
            logger.debug(
                f"GET_EXISTING_TASK_ID: No task info for active task_id='{existing_task_id}'. Skipping."
            )
            continue

        existing_url = existing_task_info.get("url")
        logger.debug(
            f"GET_EXISTING_TASK_ID: Task_id='{existing_task_id}', info_url='{existing_url}'. Comparing with target_url='{url}'."
        )
        if existing_url != url:
            logger.debug(
                f"GET_EXISTING_TASK_ID: Task_id='{existing_task_id}' URL mismatch. Skipping."
            )
            continue

        if download_type:
            existing_type = existing_task_info.get("download_type")
            logger.debug(
                f"GET_EXISTING_TASK_ID: Task_id='{existing_task_id}', info_type='{existing_type}'. Comparing with target_type='{download_type}'."
            )
            if existing_type != download_type:
                logger.debug(
                    f"GET_EXISTING_TASK_ID: Task_id='{existing_task_id}' type mismatch. Skipping."
                )
                continue

        # Found an active task that matches the criteria.
        logger.info(
            f"GET_EXISTING_TASK_ID: Found ACTIVE duplicate: task_id='{existing_task_id}' for URL='{url}', type='{download_type}'. Returning this ID."
        )
        return existing_task_id

    logger.debug(
        f"GET_EXISTING_TASK_ID: No active duplicate found for URL='{url}', type='{download_type}'. Returning None."
    )
    return None


class CeleryDownloadQueueManager:
    """
    Manages a queue of download tasks using Celery.
    This is a drop-in replacement for the previous DownloadQueueManager.

    Instead of using file-based progress tracking, it uses Redis via Celery
    for task management and progress tracking.
    """

    def __init__(self):
        """Initialize the Celery-based download queue manager"""
        self.max_concurrent = MAX_CONCURRENT_DL
        self.paused = False
        logger.info(
            f"Celery Download Queue Manager initialized with max_concurrent={self.max_concurrent}"
        )

    def add_task(self, task: dict, from_watch_job: bool = False):
        """
        Add a new download task to the Celery queue.
        - If from_watch_job is True and an active duplicate is found, the task is not queued and None is returned.
        - If from_watch_job is False and an active duplicate is found, a new task ID is created,
          set to an ERROR state indicating the duplicate, and this new error task's ID is returned.

        Args:
            task (dict): Task parameters including download_type, url, etc.
            from_watch_job (bool): If True, duplicate active tasks are skipped. Defaults to False.

        Returns:
            str | None: Task ID if successfully queued or an error task ID for non-watch duplicates.
                        None if from_watch_job is True and an active duplicate was found.
        """
        try:
            # Extract essential parameters for duplicate check
            incoming_url = task.get("url")
            incoming_type = task.get("download_type", "unknown")

            if not incoming_url:
                logger.warning(
                    "Task being added with no URL. Duplicate check might be unreliable."
                )

            TERMINAL_STATES = {  # Renamed and converted to a set for consistency
                ProgressState.COMPLETE,
                ProgressState.DONE,
                ProgressState.CANCELLED,
                ProgressState.ERROR,
                ProgressState.ERROR_RETRIED,
                ProgressState.ERROR_AUTO_CLEANED,
                # Include string variants from standardized status_info structure
                "cancelled",
                "error",
                "done",
                "complete",
                "completed",
                "failed",
                "skipped",
            }

            all_existing_tasks_summary = get_all_tasks()
            if incoming_url:
                for task_summary in all_existing_tasks_summary:
                    existing_task_id = task_summary.get("task_id")
                    if not existing_task_id:
                        continue

                    # Use the pre-fetched full task info
                    existing_task_info = task_summary.get("task_info")
                    existing_last_status_obj = task_summary.get("last_status")

                    if not existing_task_info or not existing_last_status_obj:
                        continue

                    existing_url = existing_task_info.get("url")
                    existing_type = existing_task_info.get("download_type")

                    # Extract status from standard structure (status_info.status) or fallback to top-level status
                    existing_status = None
                    if (
                        "status_info" in existing_last_status_obj
                        and existing_last_status_obj["status_info"]
                    ):
                        existing_status = existing_last_status_obj["status_info"].get(
                            "status"
                        )
                    if not existing_status:
                        existing_status = existing_last_status_obj.get("status")

                    if (
                        existing_url == incoming_url
                        and existing_type == incoming_type
                        and existing_status not in TERMINAL_STATES
                    ):
                        message = f"Duplicate download: URL '{incoming_url}' (type: {incoming_type}) is already being processed by task {existing_task_id} (status: {existing_status})."
                        logger.warning(message)

                        if from_watch_job:
                            logger.info(
                                f"Task from watch job for {incoming_url} not queued due to active duplicate {existing_task_id}."
                            )
                            return None  # Skip execution for watch jobs
                        else:
                            # Create a new task_id for this duplicate request and mark it as an error
                            error_task_id = str(uuid.uuid4())
                            error_task_info_payload = {
                                "download_type": incoming_type,
                                "type": task.get("type", incoming_type),
                                "name": task.get("name", "Duplicate Task"),
                                "artist": task.get("artist", ""),
                                "url": incoming_url,
                                "original_request": task.get(
                                    "orig_request", task.get("original_request", {})
                                ),
                                "created_at": time.time(),
                                "is_duplicate_error_task": True,
                            }
                            store_task_info(error_task_id, error_task_info_payload)
                            error_status_payload = {
                                "status": ProgressState.ERROR,
                                "error": message,
                                "existing_task_id": existing_task_id,
                                "timestamp": time.time(),
                                "type": error_task_info_payload["type"],
                                "name": error_task_info_payload["name"],
                                "artist": error_task_info_payload["artist"],
                            }
                            store_task_status(error_task_id, error_status_payload)
                            return error_task_id  # Return the ID of this new error-state task

            task_id = str(uuid.uuid4())
            config_params = get_config_params()
            original_request = task.get(
                "orig_request", task.get("original_request", {})
            )

            # Get username for user-specific paths
            username = task.get("username", "")

            complete_task = {
                "download_type": incoming_type,
                "type": task.get("type", incoming_type),
                "name": task.get("name", ""),
                "artist": task.get("artist", ""),
                "url": task.get("url", ""),
                "retry_url": task.get("retry_url", ""),
                "main": original_request.get("main", config_params["deezer"]),
                "fallback": original_request.get(
                    "fallback",
                    config_params["spotify"] if config_params["fallback"] else None,
                ),
                "quality": original_request.get(
                    "quality", config_params["deezerQuality"]
                ),
                "fall_quality": original_request.get(
                    "fall_quality", config_params["spotifyQuality"]
                ),
                "real_time": self._parse_bool_param(
                    original_request.get("real_time"), config_params["realTime"]
                ),
                "custom_dir_format": self._get_user_specific_dir_format(
                    original_request.get(
                        "custom_dir_format", config_params["customDirFormat"]
                    ),
                    config_params.get("separateTracksByUser", False),
                    username,
                ),
                "custom_track_format": original_request.get(
                    "custom_track_format", config_params["customTrackFormat"]
                ),
                "pad_tracks": self._parse_bool_param(
                    original_request.get("tracknum_padding"),
                    config_params["tracknumPadding"],
                ),
                "save_cover": self._parse_bool_param(
                    original_request.get("save_cover"), config_params["saveCover"]
                ),
                "convertTo": original_request.get(
                    "convertTo", config_params.get("convertTo")
                ),
                "bitrate": original_request.get(
                    "bitrate", config_params.get("bitrate")
                ),
                "artist_separator": original_request.get(
                    "artist_separator", config_params.get("artistSeparator", "; ")
                ),
                "recursive_quality": self._parse_bool_param(
                    original_request.get("recursive_quality"),
                    config_params.get("recursiveQuality", False),
                ),
                "retry_count": 0,
                "original_request": original_request,
                "created_at": time.time(),
                "real_time_multiplier": original_request.get(
                    "real_time_multiplier", config_params.get("realTimeMultiplier", 0)
                ),
            }

            # If from_watch_job is True, ensure track_details_for_db is passed through
            if from_watch_job and "track_details_for_db" in task:
                complete_task["track_details_for_db"] = task["track_details_for_db"]

            store_task_info(task_id, complete_task)
            store_task_status(
                task_id,
                {
                    "status": ProgressState.QUEUED,
                    "timestamp": time.time(),
                    "type": complete_task["type"],
                    "name": complete_task["name"],
                    "artist": complete_task["artist"],
                    "retry_count": 0,
                    "queue_position": len(get_all_tasks()) + 1,
                },
            )

            celery_task_map = {
                "track": download_track,
                "album": download_album,
                "playlist": download_playlist,
            }

            task_func = celery_task_map.get(incoming_type)
            if task_func:
                task_func.apply_async(
                    kwargs=complete_task,
                    task_id=task_id,
                    countdown=0 if not self.paused else 3600,
                )
                logger.info(
                    f"Added {incoming_type} download task {task_id} to Celery queue."
                )
                return task_id
            else:
                store_task_status(
                    task_id,
                    {
                        "status": ProgressState.ERROR,
                        "message": f"Unsupported download type: {incoming_type}",
                        "timestamp": time.time(),
                    },
                )
                logger.error(f"Unsupported download type: {incoming_type}")
                return task_id

        except Exception as e:
            logger.error(f"Error adding task to Celery queue: {e}", exc_info=True)
            error_task_id = str(uuid.uuid4())
            store_task_status(
                error_task_id,
                {
                    "status": ProgressState.ERROR,
                    "message": f"Error adding task to queue: {str(e)}",
                    "timestamp": time.time(),
                    "type": task.get("type", "unknown"),
                    "name": task.get("name", "Unknown"),
                    "artist": task.get("artist", ""),
                },
            )
            return error_task_id

    def _parse_bool_param(self, param_value, default_value=False):
        """Helper function to parse boolean parameters from string values"""
        if param_value is None:
            return default_value
        if isinstance(param_value, bool):
            return param_value
        if isinstance(param_value, str):
            return param_value.lower() in ["true", "1", "yes", "y", "on"]
        return bool(param_value)

    def _get_user_specific_dir_format(self, base_format, separate_by_user, username):
        """
        Modify the directory format to include username if separateTracksByUser is enabled

        Args:
            base_format (str): The base directory format from config
            separate_by_user (bool): Whether to separate tracks by user
            username (str): The username to include in path

        Returns:
            str: The modified directory format
        """
        if separate_by_user and username:
            # Add username as a subdirectory at the beginning
            return f"{username}/{base_format}"
        return base_format

    def cancel_task(self, task_id):
        """
        Cancels a task by its ID.

        Args:
            task_id (str): The ID of the task to cancel

        Returns:
            dict: Status information about the cancellation
        """
        return cancel_celery_task(task_id)

    def retry_task(self, task_id):
        """
        Retry a failed task.

        Args:
            task_id (str): The ID of the failed task to retry

        Returns:
            dict: Status information about the retry
        """
        return retry_celery_task(task_id)

    def cancel_all_tasks(self):
        """
        Cancel all currently queued and running tasks.

        Returns:
            dict: Status information about the cancellation
        """
        tasks = get_all_tasks()
        cancelled_count = 0

        for task in tasks:
            task_id = task.get("task_id")
            status = task.get("status")

            # Only cancel tasks that are not already completed or cancelled
            if status not in [
                ProgressState.COMPLETE,
                ProgressState.DONE,
                ProgressState.CANCELLED,
            ]:
                result = cancel_celery_task(task_id)
                if result.get("status") == "cancelled":
                    cancelled_count += 1

        return {
            "status": "all_cancelled",
            "cancelled_count": cancelled_count,
            "total_tasks": len(tasks),
        }

    def get_queue_status(self):
        """
        Get the current status of the queue.

        Returns:
            dict: Status information about the queue
        """
        tasks = get_all_tasks()

        # Count tasks by status
        running_count = 0
        pending_count = 0
        failed_count = 0

        running_tasks = []
        failed_tasks = []

        for task in tasks:
            status = task.get("status")

            if status == ProgressState.PROCESSING:
                running_count += 1
                running_tasks.append(
                    {
                        "task_id": task.get("task_id"),
                        "name": task.get("name", "Unknown"),
                        "type": task.get("type", "unknown"),
                        "download_type": task.get("download_type", "unknown"),
                    }
                )
            elif status == ProgressState.QUEUED:
                pending_count += 1
            elif status == ProgressState.ERROR:
                failed_count += 1

                # Get task info for retry information
                last_status = get_last_task_status(task.get("task_id"))

                retry_count = 0
                if last_status:
                    retry_count = last_status.get("retry_count", 0)

                failed_tasks.append(
                    {
                        "task_id": task.get("task_id"),
                        "name": task.get("name", "Unknown"),
                        "type": task.get("type", "unknown"),
                        "download_type": task.get("download_type", "unknown"),
                        "retry_count": retry_count,
                    }
                )

        return {
            "running": running_count,
            "pending": pending_count,
            "failed": failed_count,
            "max_concurrent": self.max_concurrent,
            "paused": self.paused,
            "running_tasks": running_tasks,
            "failed_tasks": failed_tasks,
        }

    def pause(self):
        """Pause processing of new tasks."""
        self.paused = True

        # Get all queued tasks
        tasks = get_all_tasks()
        for task in tasks:
            if task.get("status") == ProgressState.QUEUED:
                # Update status to indicate the task is paused
                store_task_status(
                    task.get("task_id"),
                    {
                        "status": ProgressState.QUEUED,
                        "paused": True,
                        "message": "Queue is paused, task will run when queue is resumed",
                        "timestamp": time.time(),
                    },
                )

        logger.info("Download queue processing paused")
        return {"status": "paused"}

    def resume(self):
        """Resume processing of tasks."""
        self.paused = False

        # Get all queued tasks
        tasks = get_all_tasks()
        for task in tasks:
            if task.get("status") == ProgressState.QUEUED:
                task_id = task.get("task_id")

                # Get the task info
                task_info = get_task_info(task_id)
                if not task_info:
                    continue

                # Update status to indicate the task is no longer paused
                store_task_status(
                    task_id,
                    {
                        "status": ProgressState.QUEUED,
                        "paused": False,
                        "message": "Queue resumed, task will run soon",
                        "timestamp": time.time(),
                    },
                )

                # Reschedule the task to run immediately
                download_type = task_info.get("download_type", "unknown")

                if download_type == "track":
                    download_track.apply_async(kwargs=task_info, task_id=task_id)
                elif download_type == "album":
                    download_album.apply_async(kwargs=task_info, task_id=task_id)
                elif download_type == "playlist":
                    download_playlist.apply_async(kwargs=task_info, task_id=task_id)

        logger.info("Download queue processing resumed")
        return {"status": "resumed"}

    def start(self):
        """Start the queue manager (no-op for Celery implementation)."""
        logger.info("Celery Download Queue Manager started")
        return {"status": "started"}

    def stop(self):
        """Stop the queue manager (graceful shutdown)."""
        logger.info("Celery Download Queue Manager stopping...")

        # Cancel all tasks or just let them finish?
        # For now, we'll let them finish and just log the shutdown

        logger.info("Celery Download Queue Manager stopped")
        return {"status": "stopped"}


# Create the global instance
download_queue_manager = CeleryDownloadQueueManager()
