from flask import Blueprint, jsonify, request
import json
from pathlib import Path
import logging

config_bp = Blueprint('config_bp', __name__)
CONFIG_PATH = Path('./config/main.json')

def get_config():
    try:
        if not CONFIG_PATH.exists():
            CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            CONFIG_PATH.write_text('{}')
            return {}
            
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        logging.error(f"Error reading config: {str(e)}")
        return None

@config_bp.route('/config', methods=['GET'])
def handle_config():
    config = get_config()
    if config is None:
        return jsonify({"error": "Could not read config file"}), 500
    return jsonify(config)

@config_bp.route('/config', methods=['POST', 'PUT'])
def update_config():
    try:
        new_config = request.get_json()
        if not isinstance(new_config, dict):
            return jsonify({"error": "Invalid config format"}), 400

        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_PATH, 'w') as f:
            json.dump(new_config, f, indent=2)
            
        return jsonify({"message": "Config updated successfully"})
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON data"}), 400
    except Exception as e:
        logging.error(f"Error updating config: {str(e)}")
        return jsonify({"error": "Failed to update config"}), 500