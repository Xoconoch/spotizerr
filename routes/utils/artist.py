import json
import logging
from flask import url_for
from routes.utils.celery_queue_manager import download_queue_manager
from routes.utils.get_info import get_spotify_info
from routes.utils.credentials import get_credential, _get_global_spotify_api_creds
from routes.utils.celery_tasks import get_last_task_status, ProgressState

from deezspot.easy_spoty import Spo
from deezspot.libutils.utils import get_ids, link_is_valid

# Configure logging
logger = logging.getLogger(__name__)


def log_json(message_dict):
    """Helper function to output a JSON-formatted log message."""
    print(json.dumps(message_dict))


def get_artist_discography(
    url,
    main_spotify_account_name,
    album_type="album,single,compilation,appears_on",
    progress_callback=None,
):
    """
    Validate the URL, extract the artist ID, and retrieve the discography.
    Uses global Spotify API client_id/secret for Spo initialization.
    Args:
        url (str): Spotify artist URL.
        main_spotify_account_name (str): Name of the Spotify account (for context/logging, not API keys for Spo.__init__).
        album_type (str): Types of albums to fetch.
        progress_callback: Optional callback for progress.
    """
    if not url:
        log_json({"status": "error", "message": "No artist URL provided."})
        raise ValueError("No artist URL provided.")

    link_is_valid(link=url)  # This will raise an exception if the link is invalid.

    client_id, client_secret = _get_global_spotify_api_creds()

    if not client_id or not client_secret:
        log_json(
            {
                "status": "error",
                "message": "Global Spotify API client_id or client_secret not configured.",
            }
        )
        raise ValueError("Global Spotify API credentials are not configured.")

    if not main_spotify_account_name:
        # This is a warning now, as API keys are global.
        logger.warning(
            "main_spotify_account_name not provided for get_artist_discography context. Using global API keys."
        )
    else:
        # Check if account exists for context, good for consistency
        try:
            get_credential("spotify", main_spotify_account_name)
            logger.debug(
                f"Spotify account context '{main_spotify_account_name}' exists for get_artist_discography."
            )
        except FileNotFoundError:
            logger.warning(
                f"Spotify account '{main_spotify_account_name}' provided for discography context not found."
            )
        except Exception as e:
            logger.warning(
                f"Error checking Spotify account '{main_spotify_account_name}' for discography context: {e}"
            )

    Spo.__init__(client_id, client_secret)  # Initialize with global API keys

    try:
        artist_id = get_ids(url)
    except Exception as id_error:
        msg = f"Failed to extract artist ID from URL: {id_error}"
        log_json({"status": "error", "message": msg})
        raise ValueError(msg)

    try:
        # The progress_callback is not a standard param for Spo.get_artist
        # If Spo.get_artist is meant to be Spo.get_artist_discography, that would take limit/offset
        # Assuming it's Spo.get_artist which takes artist_id and album_type.
        # If progress_callback was for a different Spo method, this needs review.
        # For now, removing progress_callback from this specific call as Spo.get_artist doesn't use it.
        discography = Spo.get_artist(artist_id, album_type=album_type)
        return discography
    except Exception as fetch_error:
        msg = f"An error occurred while fetching the discography: {fetch_error}"
        log_json({"status": "error", "message": msg})
        raise


def download_artist_albums(
    url, album_type="album,single,compilation", request_args=None
):
    """
    Download albums by an artist, filtered by album types.

    Args:
        url (str): Spotify artist URL
        album_type (str): Comma-separated list of album types to download
                         (album, single, compilation, appears_on)
        request_args (dict): Original request arguments for tracking

    Returns:
        tuple: (list of successfully queued albums, list of duplicate albums)
    """
    if not url:
        raise ValueError("Missing required parameter: url")

    # Extract artist ID from URL
    artist_id = url.split("/")[-1]
    if "?" in artist_id:
        artist_id = artist_id.split("?")[0]

    logger.info(f"Fetching artist info for ID: {artist_id}")

    # Detect URL source (only Spotify is supported for artists)
    is_spotify_url = "open.spotify.com" in url.lower()

    # Artist functionality only works with Spotify URLs currently
    if not is_spotify_url:
        error_msg = (
            "Invalid URL: Artist functionality only supports open.spotify.com URLs"
        )
        logger.error(error_msg)
        raise ValueError(error_msg)

    # Get artist info with albums
    artist_data = get_spotify_info(artist_id, "artist_discography")

    # Debug logging to inspect the structure of artist_data
    logger.debug(
        f"Artist data structure has keys: {list(artist_data.keys() if isinstance(artist_data, dict) else [])}"
    )

    if not artist_data or "items" not in artist_data:
        raise ValueError(
            f"Failed to retrieve artist data or no albums found for artist ID {artist_id}"
        )

    # Parse the album types to filter by
    allowed_types = [t.strip().lower() for t in album_type.split(",")]
    logger.info(f"Filtering albums by types: {allowed_types}")

    # Filter albums by the specified types
    filtered_albums = []
    for album in artist_data.get("items", []):
        album_type_value = album.get("album_type", "").lower()
        album_group_value = album.get("album_group", "").lower()

        # Apply filtering logic based on album_type and album_group
        if (
            (
                "album" in allowed_types
                and album_type_value == "album"
                and album_group_value == "album"
            )
            or (
                "single" in allowed_types
                and album_type_value == "single"
                and album_group_value == "single"
            )
            or ("compilation" in allowed_types and album_type_value == "compilation")
            or ("appears_on" in allowed_types and album_group_value == "appears_on")
        ):
            filtered_albums.append(album)

    if not filtered_albums:
        logger.warning(f"No albums match the specified types: {album_type}")
        return [], []

    # Queue each album as a separate download task
    album_task_ids = []
    successfully_queued_albums = []
    duplicate_albums = []  # To store info about albums that were duplicates

    for album in filtered_albums:
        # Add detailed logging to inspect each album's structure and URLs
        logger.debug(f"Processing album: {album.get('name', 'Unknown')}")
        logger.debug(f"Album structure has keys: {list(album.keys())}")

        external_urls = album.get("external_urls", {})
        logger.debug(f"Album external_urls: {external_urls}")

        album_url = external_urls.get("spotify", "")
        album_name = album.get("name", "Unknown Album")
        album_artists = album.get("artists", [])
        album_artist = (
            album_artists[0].get("name", "Unknown Artist")
            if album_artists
            else "Unknown Artist"
        )
        album_id = album.get("id")

        logger.debug(f"Extracted album URL: {album_url}")
        logger.debug(f"Extracted album ID: {album_id}")

        if not album_url or not album_id:
            logger.warning(f"Skipping album without URL or ID: {album_name}")
            continue

        # Create album-specific request args instead of using original artist request
        album_request_args = {
            "url": album_url,
            "name": album_name,
            "artist": album_artist,
            "type": "album",
            # URL source will be automatically detected in the download functions
            "parent_artist_url": url,
            "parent_request_type": "artist",
        }

        # Include original download URL for this album task
        album_request_args["original_url"] = url_for(
            "album.handle_download", album_id=album_id, _external=True
        )

        # Create task for this album
        task_data = {
            "download_type": "album",
            "type": "album",  # Type for the download task
            "url": album_url,  # Important: use the album URL, not artist URL
            "retry_url": album_url,  # Use album URL for retry logic, not artist URL
            "name": album_name,
            "artist": album_artist,
            "orig_request": album_request_args,  # Store album-specific request params
        }

        # Debug log the task data being sent to the queue
        logger.debug(
            f"Album task data: url={task_data['url']}, retry_url={task_data['retry_url']}"
        )

        try:
            task_id = download_queue_manager.add_task(task_data)

            # Check the status of the newly added task to see if it was marked as a duplicate error
            last_status = get_last_task_status(task_id)

            if (
                last_status
                and last_status.get("status") == ProgressState.ERROR
                and last_status.get("existing_task_id")
            ):
                logger.warning(
                    f"Album {album_name} (URL: {album_url}) is a duplicate. Error task ID: {task_id}. Existing task ID: {last_status.get('existing_task_id')}"
                )
                duplicate_albums.append(
                    {
                        "name": album_name,
                        "artist": album_artist,
                        "url": album_url,
                        "error_task_id": task_id,  # This is the ID of the task marked as a duplicate error
                        "existing_task_id": last_status.get("existing_task_id"),
                        "message": last_status.get(
                            "message", "Duplicate download attempt."
                        ),
                    }
                )
            else:
                # If not a duplicate error, it was successfully queued (or failed for other reasons handled by add_task)
                # We only add to successfully_queued_albums if it wasn't a duplicate error from add_task
                # Other errors from add_task (like submission failure) would also result in an error status for task_id
                # but won't have 'existing_task_id'. The client can check the status of this task_id.
                album_task_ids.append(
                    task_id
                )  # Keep track of all task_ids returned by add_task
                successfully_queued_albums.append(
                    {
                        "name": album_name,
                        "artist": album_artist,
                        "url": album_url,
                        "task_id": task_id,
                    }
                )
                logger.info(f"Queued album download: {album_name} ({task_id})")
        except Exception as e:  # Catch any other unexpected error from add_task itself (though it should be rare now)
            logger.error(
                f"Failed to queue album {album_name} due to an unexpected error in add_task: {str(e)}"
            )
            # Optionally, collect these errors. For now, just logging and continuing.

    logger.info(
        f"Artist album processing: {len(successfully_queued_albums)} queued, {len(duplicate_albums)} duplicates found."
    )
    return successfully_queued_albums, duplicate_albums
