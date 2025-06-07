from flask import Blueprint, jsonify, request
from routes.utils.history_manager import get_history_entries
import logging

logger = logging.getLogger(__name__)
history_bp = Blueprint("history", __name__, url_prefix="/api/history")


@history_bp.route("", methods=["GET"])
def get_download_history():
    """API endpoint to retrieve download history with pagination, sorting, and filtering."""
    try:
        limit = request.args.get("limit", 25, type=int)
        offset = request.args.get("offset", 0, type=int)
        sort_by = request.args.get("sort_by", "timestamp_completed")
        sort_order = request.args.get("sort_order", "DESC")

        # Basic filtering example: filter by status_final or download_type
        filters = {}
        status_filter = request.args.get("status_final")
        if status_filter:
            filters["status_final"] = status_filter

        type_filter = request.args.get("download_type")
        if type_filter:
            filters["download_type"] = type_filter

        # Add more filters as needed, e.g., by item_name (would need LIKE for partial match)
        # search_term = request.args.get('search')
        # if search_term:
        #     filters['item_name'] = f'%{search_term}%' # This would require LIKE in get_history_entries

        entries, total_count = get_history_entries(
            limit, offset, sort_by, sort_order, filters
        )

        return jsonify(
            {
                "entries": entries,
                "total_count": total_count,
                "limit": limit,
                "offset": offset,
            }
        )
    except Exception as e:
        logger.error(f"Error in /api/history endpoint: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve download history"}), 500
