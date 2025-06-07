import os
import json
import logging
from pathlib import Path

# Configure logging
logger = logging.getLogger(__name__)

# Redis configuration - read from environment variables
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = os.getenv("REDIS_PORT", "6379")
REDIS_DB = os.getenv("REDIS_DB", "0")
# Optional Redis password
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
# Build default URL with password if provided
_password_part = f":{REDIS_PASSWORD}@" if REDIS_PASSWORD else ""
default_redis_url = f"redis://{_password_part}{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"
REDIS_URL = os.getenv("REDIS_URL", default_redis_url)
REDIS_BACKEND = os.getenv("REDIS_BACKEND", REDIS_URL)

# Log Redis connection details
logger.info(
    f"Redis configuration: REDIS_URL={REDIS_URL}, REDIS_BACKEND={REDIS_BACKEND}"
)

# Config path
CONFIG_FILE_PATH = Path("./data/config/main.json")

DEFAULT_MAIN_CONFIG = {
    "service": "spotify",
    "spotify": "",
    "deezer": "",
    "fallback": False,
    "spotifyQuality": "NORMAL",
    "deezerQuality": "MP3_128",
    "realTime": False,
    "customDirFormat": "%ar_album%/%album%",
    "customTrackFormat": "%tracknum%. %music%",
    "tracknum_padding": True,
    "save_cover": True,
    "maxConcurrentDownloads": 3,
    "maxRetries": 3,
    "retryDelaySeconds": 5,
    "retry_delay_increase": 5,
    "convertTo": None,
    "bitrate": None,
}


def get_config_params():
    """
    Get configuration parameters from the config file.
    Creates the file with defaults if it doesn't exist.
    Ensures all default keys are present in the loaded config.

    Returns:
        dict: A dictionary containing configuration parameters
    """
    try:
        # Ensure ./data/config directory exists
        CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

        if not CONFIG_FILE_PATH.exists():
            logger.info(f"{CONFIG_FILE_PATH} not found. Creating with default values.")
            with open(CONFIG_FILE_PATH, "w") as f:
                json.dump(DEFAULT_MAIN_CONFIG, f, indent=4)
            return DEFAULT_MAIN_CONFIG.copy()  # Return a copy of defaults

        with open(CONFIG_FILE_PATH, "r") as f:
            config = json.load(f)

        # Ensure all default keys are present in the loaded config
        updated = False
        for key, value in DEFAULT_MAIN_CONFIG.items():
            if key not in config:
                config[key] = value
                updated = True

        if updated:
            logger.info(
                f"Configuration at {CONFIG_FILE_PATH} was missing some default keys. Updated with defaults."
            )
            with open(CONFIG_FILE_PATH, "w") as f:
                json.dump(config, f, indent=4)

        return config
    except Exception as e:
        logger.error(
            f"Error reading or creating config at {CONFIG_FILE_PATH}: {e}",
            exc_info=True,
        )
        # Return defaults if config read/create fails
        return DEFAULT_MAIN_CONFIG.copy()


# Load configuration values we need for Celery
config_params_values = get_config_params()  # Renamed to avoid conflict with module name
MAX_CONCURRENT_DL = config_params_values.get("maxConcurrentDownloads", 3)
MAX_RETRIES = config_params_values.get("maxRetries", 3)
RETRY_DELAY = config_params_values.get("retryDelaySeconds", 5)
RETRY_DELAY_INCREASE = config_params_values.get("retry_delay_increase", 5)

# Define task queues
task_queues = {
    "default": {
        "exchange": "default",
        "routing_key": "default",
    },
    "downloads": {
        "exchange": "downloads",
        "routing_key": "downloads",
    },
    "utility_tasks": {
        "exchange": "utility_tasks",
        "routing_key": "utility_tasks",
    },
}

# Set default queue
task_default_queue = "downloads"
task_default_exchange = "downloads"
task_default_routing_key = "downloads"

# Celery task settings
task_serializer = "json"
accept_content = ["json"]
result_serializer = "json"
enable_utc = True

# Configure worker concurrency based on MAX_CONCURRENT_DL
worker_concurrency = MAX_CONCURRENT_DL

# Configure task rate limiting - these are per-minute limits
task_annotations = {
    "routes.utils.celery_tasks.download_track": {
        "rate_limit": f"{MAX_CONCURRENT_DL}/m",
    },
    "routes.utils.celery_tasks.download_album": {
        "rate_limit": f"{MAX_CONCURRENT_DL}/m",
    },
    "routes.utils.celery_tasks.download_playlist": {
        "rate_limit": f"{MAX_CONCURRENT_DL}/m",
    },
}

# Configure retry settings
task_default_retry_delay = RETRY_DELAY  # seconds
task_max_retries = MAX_RETRIES

# Task result settings
task_track_started = True
result_expires = 60 * 60 * 24 * 7  # 7 days

# Configure visibility timeout for task messages
broker_transport_options = {
    "visibility_timeout": 3600,  # 1 hour
    "fanout_prefix": True,
    "fanout_patterns": True,
    "priority_steps": [0, 3, 6, 9],
}

# Important broker connection settings
broker_connection_retry = True
broker_connection_retry_on_startup = True
broker_connection_max_retries = 10
broker_pool_limit = 10
worker_prefetch_multiplier = 1  # Process one task at a time per worker
worker_max_tasks_per_child = 100  # Restart worker after 100 tasks
worker_disable_rate_limits = False
