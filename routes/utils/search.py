from deezspot.easy_spoty import Spo
import logging
from routes.utils.credentials import get_credential, _get_global_spotify_api_creds

# Configure logger
logger = logging.getLogger(__name__)


def search(query: str, search_type: str, limit: int = 3, main: str = None) -> dict:
    logger.info(
        f"Search requested: query='{query}', type={search_type}, limit={limit}, main_account_name={main}"
    )

    client_id, client_secret = _get_global_spotify_api_creds()

    if not client_id or not client_secret:
        logger.error(
            "Global Spotify API client_id or client_secret not configured in ./data/creds/search.json."
        )
        raise ValueError(
            "Spotify API credentials are not configured globally for search."
        )

    if main:
        logger.debug(
            f"Spotify account context '{main}' was provided for search. API keys are global, but this account might be used for other context by Spo if relevant."
        )
        try:
            get_credential("spotify", main)
            logger.debug(f"Spotify account '{main}' exists.")
        except FileNotFoundError:
            logger.warning(
                f"Spotify account '{main}' provided for search context not found in credentials. Search will proceed with global API keys."
            )
        except Exception as e:
            logger.warning(
                f"Error checking existence of Spotify account '{main}': {e}. Search will proceed with global API keys."
            )
    else:
        logger.debug(
            "No specific 'main' account context provided for search. Using global API keys."
        )

    logger.debug("Initializing Spotify client with global API credentials for search.")
    Spo.__init__(client_id, client_secret)

    logger.debug(
        f"Executing Spotify search with query='{query}', type={search_type}, limit={limit}"
    )
    try:
        spotify_response = Spo.search(query=query, search_type=search_type, limit=limit)
        logger.info(f"Search completed successfully for query: '{query}'")
        return spotify_response
    except Exception as e:
        logger.error(
            f"Error during Spotify search for query '{query}': {e}", exc_info=True
        )
        raise
