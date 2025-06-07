from flask import Blueprint, jsonify, request
from routes.utils.search import search  # Corrected import
from routes.config import get_config  # Import get_config function

search_bp = Blueprint("search", __name__)


@search_bp.route("/search", methods=["GET"])
def handle_search():
    try:
        # Get query parameters
        query = request.args.get("q", "")
        search_type = request.args.get("search_type", "")
        limit = int(request.args.get("limit", 10))
        main = request.args.get(
            "main", ""
        )  # Get the main parameter for account selection

        # If main parameter is not provided in the request, get it from config
        if not main:
            config = get_config()
            if config and "spotify" in config:
                main = config["spotify"]
                print(f"Using main from config: {main}")

        # Validate parameters
        if not query:
            return jsonify({"error": "Missing search query"}), 400

        valid_types = ["track", "album", "artist", "playlist", "episode"]
        if search_type not in valid_types:
            return jsonify({"error": "Invalid search type"}), 400

        # Perform the search with corrected parameter name
        raw_results = search(
            query=query,
            search_type=search_type,  # Fixed parameter name
            limit=limit,
            main=main,  # Pass the main parameter
        )

        # Extract items from the appropriate section of the response based on search_type
        items = []
        if raw_results and search_type + "s" in raw_results:
            type_key = search_type + "s"
            items = raw_results[type_key].get("items", [])
        elif raw_results and search_type in raw_results:
            items = raw_results[search_type].get("items", [])

        # Return both the items array and the full data for debugging
        return jsonify(
            {
                "items": items,
                "data": raw_results,  # Include full data for debugging
                "error": None,
            }
        )

    except ValueError as e:
        print(f"ValueError in search: {str(e)}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        import traceback

        print(f"Exception in search: {str(e)}")
        print(traceback.format_exc())
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500
