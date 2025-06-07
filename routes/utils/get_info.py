from deezspot.easy_spoty import Spo
from routes.utils.celery_queue_manager import get_config_params
from routes.utils.credentials import get_credential, _get_global_spotify_api_creds

# Import Deezer API and logging
from deezspot.deezloader.dee_api import API as DeezerAPI
import logging

# Initialize logger
logger = logging.getLogger(__name__)


def get_spotify_info(spotify_id, spotify_type, limit=None, offset=None):
    """
    Get info from Spotify API. Uses global client_id/secret from search.json.
    The default Spotify account from main.json might still be relevant for other Spo settings or if Spo uses it.

    Args:
        spotify_id: The Spotify ID of the entity
        spotify_type: The type of entity (track, album, playlist, artist, artist_discography, episode)
        limit (int, optional): The maximum number of items to return. Only used if spotify_type is "artist_discography".
        offset (int, optional): The index of the first item to return. Only used if spotify_type is "artist_discography".

    Returns:
        Dictionary with the entity information
    """
    client_id, client_secret = _get_global_spotify_api_creds()

    if not client_id or not client_secret:
        raise ValueError(
            "Global Spotify API client_id or client_secret not configured in ./data/creds/search.json."
        )

    # Get config parameters including default Spotify account name
    # This might still be useful if Spo uses the account name for other things (e.g. market/region if not passed explicitly)
    # For now, we are just ensuring the API keys are set.
    config_params = get_config_params()
    main_spotify_account_name = config_params.get(
        "spotify", ""
    )  # Still good to know which account is 'default' contextually

    if not main_spotify_account_name:
        # This is less critical now that API keys are global, but could indicate a misconfiguration
        # if other parts of Spo expect an account context.
        print(
            "WARN: No default Spotify account name configured in settings (main.json). API calls will use global keys."
        )
    else:
        # Optionally, one could load the specific account's region here if Spo.init or methods need it,
        # but easy_spoty's Spo doesn't seem to take region directly in __init__.
        # It might use it internally based on account details if credentials.json (blob) contains it.
        try:
            # We call get_credential just to check if the account exists,
            # not for client_id/secret anymore for Spo.__init__
            get_credential("spotify", main_spotify_account_name)
        except FileNotFoundError:
            # This is a more serious warning if an account is expected to exist.
            print(
                f"WARN: Default Spotify account '{main_spotify_account_name}' configured in main.json was not found in credentials database."
            )
        except Exception as e:
            print(
                f"WARN: Error accessing default Spotify account '{main_spotify_account_name}': {e}"
            )

    # Initialize the Spotify client with GLOBAL credentials
    Spo.__init__(client_id, client_secret)

    if spotify_type == "track":
        return Spo.get_track(spotify_id)
    elif spotify_type == "album":
        return Spo.get_album(spotify_id)
    elif spotify_type == "playlist":
        return Spo.get_playlist(spotify_id)
    elif spotify_type == "artist_discography":
        if limit is not None and offset is not None:
            return Spo.get_artist_discography(spotify_id, limit=limit, offset=offset)
        elif limit is not None:
            return Spo.get_artist_discography(spotify_id, limit=limit)
        elif offset is not None:
            return Spo.get_artist_discography(spotify_id, offset=offset)
        else:
            return Spo.get_artist_discography(spotify_id)
    elif spotify_type == "artist":
        return Spo.get_artist(spotify_id)
    elif spotify_type == "episode":
        return Spo.get_episode(spotify_id)
    else:
        raise ValueError(f"Unsupported Spotify type: {spotify_type}")


def get_deezer_info(deezer_id, deezer_type, limit=None):
    """
    Get info from Deezer API.

    Args:
        deezer_id: The Deezer ID of the entity.
        deezer_type: The type of entity (track, album, playlist, artist, episode,
                     artist_top_tracks, artist_albums, artist_related,
                     artist_radio, artist_playlists).
        limit (int, optional): The maximum number of items to return. Used for
                               artist_top_tracks, artist_albums, artist_playlists.
                               Deezer API methods usually have their own defaults (e.g., 25)
                               if limit is not provided or None is passed to them.

    Returns:
        Dictionary with the entity information.
    Raises:
        ValueError: If deezer_type is unsupported.
        Various exceptions from DeezerAPI (NoDataApi, QuotaExceeded, requests.exceptions.RequestException, etc.)
    """
    logger.debug(
        f"Fetching Deezer info for ID {deezer_id}, type {deezer_type}, limit {limit}"
    )

    # DeezerAPI uses class methods; its @classmethod __init__ handles setup.
    # No specific ARL or account handling here as DeezerAPI seems to use general endpoints.

    if deezer_type == "track":
        return DeezerAPI.get_track(deezer_id)
    elif deezer_type == "album":
        return DeezerAPI.get_album(deezer_id)
    elif deezer_type == "playlist":
        return DeezerAPI.get_playlist(deezer_id)
    elif deezer_type == "artist":
        return DeezerAPI.get_artist(deezer_id)
    elif deezer_type == "episode":
        return DeezerAPI.get_episode(deezer_id)
    elif deezer_type == "artist_top_tracks":
        if limit is not None:
            return DeezerAPI.get_artist_top_tracks(deezer_id, limit=limit)
        return DeezerAPI.get_artist_top_tracks(deezer_id)  # Use API default limit
    elif deezer_type == "artist_albums":  # Maps to get_artist_top_albums
        if limit is not None:
            return DeezerAPI.get_artist_top_albums(deezer_id, limit=limit)
        return DeezerAPI.get_artist_top_albums(deezer_id)  # Use API default limit
    elif deezer_type == "artist_related":
        return DeezerAPI.get_artist_related(deezer_id)
    elif deezer_type == "artist_radio":
        return DeezerAPI.get_artist_radio(deezer_id)
    elif deezer_type == "artist_playlists":
        if limit is not None:
            return DeezerAPI.get_artist_top_playlists(deezer_id, limit=limit)
        return DeezerAPI.get_artist_top_playlists(deezer_id)  # Use API default limit
    else:
        logger.error(f"Unsupported Deezer type: {deezer_type}")
        raise ValueError(f"Unsupported Deezer type: {deezer_type}")
