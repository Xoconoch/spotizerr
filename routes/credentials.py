from flask import Blueprint, request, jsonify
from routes.utils.credentials import (
    get_credential,
    list_credentials,
    create_credential,
    delete_credential,
    edit_credential,
    init_credentials_db,
    # Import new utility functions for global Spotify API creds
    _get_global_spotify_api_creds,
    save_global_spotify_api_creds,
)
import logging

logger = logging.getLogger(__name__)
credentials_bp = Blueprint("credentials", __name__)

# Initialize the database and tables when the blueprint is loaded
init_credentials_db()


@credentials_bp.route("/spotify_api_config", methods=["GET", "PUT"])
def handle_spotify_api_config():
    """Handles GET and PUT requests for the global Spotify API client_id and client_secret."""
    try:
        if request.method == "GET":
            client_id, client_secret = _get_global_spotify_api_creds()
            if client_id is not None and client_secret is not None:
                return jsonify(
                    {"client_id": client_id, "client_secret": client_secret}
                ), 200
            else:
                # If search.json exists but is empty/incomplete, or doesn't exist
                return jsonify(
                    {
                        "warning": "Global Spotify API credentials are not fully configured or file is missing.",
                        "client_id": client_id or "",
                        "client_secret": client_secret or "",
                    }
                ), 200

        elif request.method == "PUT":
            data = request.get_json()
            if not data or "client_id" not in data or "client_secret" not in data:
                return jsonify(
                    {
                        "error": "Request body must contain 'client_id' and 'client_secret'"
                    }
                ), 400

            client_id = data["client_id"]
            client_secret = data["client_secret"]

            if not isinstance(client_id, str) or not isinstance(client_secret, str):
                return jsonify(
                    {"error": "'client_id' and 'client_secret' must be strings"}
                ), 400

            if save_global_spotify_api_creds(client_id, client_secret):
                return jsonify(
                    {"message": "Global Spotify API credentials updated successfully."}
                ), 200
            else:
                return jsonify(
                    {"error": "Failed to save global Spotify API credentials."}
                ), 500

    except Exception as e:
        logger.error(f"Error in /spotify_api_config: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500


@credentials_bp.route("/<service>", methods=["GET"])
def handle_list_credentials(service):
    try:
        if service not in ["spotify", "deezer"]:
            return jsonify(
                {"error": "Invalid service. Must be 'spotify' or 'deezer'"}
            ), 400
        return jsonify(list_credentials(service))
    except ValueError as e:  # Should not happen with service check above
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error listing credentials for {service}: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500


@credentials_bp.route("/<service>/<name>", methods=["GET", "POST", "PUT", "DELETE"])
def handle_single_credential(service, name):
    try:
        if service not in ["spotify", "deezer"]:
            return jsonify(
                {"error": "Invalid service. Must be 'spotify' or 'deezer'"}
            ), 400

        # cred_type logic is removed for Spotify as API keys are global.
        # For Deezer, it's always 'credentials' type implicitly.

        if request.method == "GET":
            # get_credential for Spotify now only returns region and blob_file_path
            return jsonify(get_credential(service, name))

        elif request.method == "POST":
            data = request.get_json()
            if not data:
                return jsonify({"error": "Request body cannot be empty."}), 400
            # create_credential for Spotify now expects 'region' and 'blob_content'
            # For Deezer, it expects 'arl' and 'region'
            # Validation is handled within create_credential utility function
            result = create_credential(service, name, data)
            return jsonify(
                {
                    "message": f"Credential for '{name}' ({service}) created successfully.",
                    "details": result,
                }
            ), 201

        elif request.method == "PUT":
            data = request.get_json()
            if not data:
                return jsonify({"error": "Request body cannot be empty."}), 400
            # edit_credential for Spotify now handles updates to 'region', 'blob_content'
            # For Deezer, 'arl', 'region'
            result = edit_credential(service, name, data)
            return jsonify(
                {
                    "message": f"Credential for '{name}' ({service}) updated successfully.",
                    "details": result,
                }
            )

        elif request.method == "DELETE":
            # delete_credential for Spotify also handles deleting the blob directory
            result = delete_credential(service, name)
            return jsonify(
                {
                    "message": f"Credential for '{name}' ({service}) deleted successfully.",
                    "details": result,
                }
            )

    except (ValueError, FileNotFoundError, FileExistsError) as e:
        status_code = 400
        if isinstance(e, FileNotFoundError):
            status_code = 404
        elif isinstance(e, FileExistsError):
            status_code = 409
        logger.warning(f"Client error in /<{service}>/<{name}>: {str(e)}")
        return jsonify({"error": str(e)}), status_code
    except Exception as e:
        logger.error(f"Server error in /<{service}>/<{name}>: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500


# The '/search/<service>/<name>' route is now obsolete for Spotify and has been removed.


@credentials_bp.route("/all/<service>", methods=["GET"])
def handle_all_credentials(service):
    """Lists all credentials for a given service. For Spotify, API keys are global and not listed per account."""
    try:
        if service not in ["spotify", "deezer"]:
            return jsonify(
                {"error": "Invalid service. Must be 'spotify' or 'deezer'"}
            ), 400

        credentials_list = []
        account_names = list_credentials(service)  # This lists names from DB

        for name in account_names:
            try:
                # get_credential for Spotify returns region and blob_file_path.
                # For Deezer, it returns arl and region.
                account_data = get_credential(service, name)
                # We don't add global Spotify API keys here as they are separate
                credentials_list.append({"name": name, "details": account_data})
            except FileNotFoundError:
                logger.warning(
                    f"Credential name '{name}' listed for service '{service}' but not found by get_credential. Skipping."
                )
            except Exception as e_inner:
                logger.error(
                    f"Error fetching details for credential '{name}' ({service}): {e_inner}",
                    exc_info=True,
                )
                credentials_list.append(
                    {
                        "name": name,
                        "error": f"Could not retrieve details: {str(e_inner)}",
                    }
                )

        return jsonify(credentials_list)
    except Exception as e:
        logger.error(f"Error in /all/{service}: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500


@credentials_bp.route("/markets", methods=["GET"])
def handle_markets():
    """
    Returns a list of unique market regions for Deezer and Spotify accounts.
    """
    try:
        deezer_regions = set()
        spotify_regions = set()

        # Process Deezer accounts
        deezer_account_names = list_credentials("deezer")
        for name in deezer_account_names:
            try:
                account_data = get_credential("deezer", name)
                if account_data and "region" in account_data and account_data["region"]:
                    deezer_regions.add(account_data["region"])
            except Exception as e:
                logger.warning(
                    f"Could not retrieve region for deezer account {name}: {e}"
                )

        # Process Spotify accounts
        spotify_account_names = list_credentials("spotify")
        for name in spotify_account_names:
            try:
                account_data = get_credential("spotify", name)
                if account_data and "region" in account_data and account_data["region"]:
                    spotify_regions.add(account_data["region"])
            except Exception as e:
                logger.warning(
                    f"Could not retrieve region for spotify account {name}: {e}"
                )

        return jsonify(
            {
                "deezer": sorted(list(deezer_regions)),
                "spotify": sorted(list(spotify_regions)),
            }
        ), 200

    except Exception as e:
        logger.error(f"Error in /markets: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500
