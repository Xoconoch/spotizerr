from flask import Blueprint, Response, request
import os
import json
import traceback
from deezspot.spotloader import SpoLogin
from deezspot.deezloader import DeeLogin
from multiprocessing import Process
import random
import string
import sys

playlist_bp = Blueprint('playlist', __name__)

# Global dictionary to track running playlist download processes
playlist_processes = {}

def generate_random_filename(length=6):
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length)) + '.playlist.prg'

class FlushingFileWrapper:
    def __init__(self, file):
        self.file = file

    def write(self, text):
        for line in text.split('\n'):
            line = line.strip()
            # Only process non-empty lines that start with '{'
            if line and line.startswith('{'):
                try:
                    # Try to parse the line as JSON
                    obj = json.loads(line)
                    # If the object has a "type" key with the value "track", skip writing it.
                    if obj.get("type") == "track":
                        continue
                except ValueError:
                    # If the line isn't valid JSON, we don't filter it.
                    pass
                self.file.write(line + '\n')
        self.file.flush()

    def flush(self):
        self.file.flush()

def download_task(service, url, main, fallback, quality, fall_quality, real_time,
                  prg_path, orig_request, custom_dir_format, custom_track_format):
    try:
        from routes.utils.playlist import download_playlist
        with open(prg_path, 'w') as f:
            flushing_file = FlushingFileWrapper(f)
            original_stdout = sys.stdout
            sys.stdout = flushing_file  # Process-specific stdout

            # Write the original request data into the progress file.
            try:
                flushing_file.write(json.dumps({"original_request": orig_request}) + "\n")
            except Exception as e:
                flushing_file.write(json.dumps({
                    "status": "error",
                    "message": f"Failed to write original request data: {str(e)}"
                }) + "\n")

            try:
                download_playlist(
                    service=service,
                    url=url,
                    main=main,
                    fallback=fallback,
                    quality=quality,
                    fall_quality=fall_quality,
                    real_time=real_time,
                    custom_dir_format=custom_dir_format,
                    custom_track_format=custom_track_format
                )
                flushing_file.write(json.dumps({"status": "complete"}) + "\n")
            except Exception as e:
                error_data = json.dumps({
                    "status": "error",
                    "message": str(e),
                    "traceback": traceback.format_exc()
                })
                flushing_file.write(error_data + "\n")
            finally:
                sys.stdout = original_stdout  # Restore original stdout
    except Exception as e:
        with open(prg_path, 'w') as f:
            error_data = json.dumps({
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()
            })
            f.write(error_data + "\n")

@playlist_bp.route('/download', methods=['GET'])
def handle_download():
    service = request.args.get('service')
    url = request.args.get('url')
    main = request.args.get('main')
    fallback = request.args.get('fallback')
    quality = request.args.get('quality')
    fall_quality = request.args.get('fall_quality')
    
    # Retrieve the real_time parameter from the request query string.
    # Here, if real_time is provided as "true", "1", or "yes" (case-insensitive) it will be interpreted as True.
    real_time_str = request.args.get('real_time', 'false').lower()
    real_time = real_time_str in ['true', '1', 'yes']
    
    # New custom formatting parameters, with defaults.
    custom_dir_format = request.args.get('custom_dir_format', "%ar_album%/%album%/%copyright%")
    custom_track_format = request.args.get('custom_track_format', "%tracknum%. %music% - %artist%")
    
    if not all([service, url, main]):
        return Response(
            json.dumps({"error": "Missing parameters"}),
            status=400,
            mimetype='application/json'
        )
    
    filename = generate_random_filename()
    prg_dir = './prgs'
    os.makedirs(prg_dir, exist_ok=True)
    prg_path = os.path.join(prg_dir, filename)
    
    # Capture the original request parameters as a dictionary.
    orig_request = request.args.to_dict()
    
    process = Process(
        target=download_task,
        args=(
            service, url, main, fallback, quality, fall_quality, real_time,
            prg_path, orig_request, custom_dir_format, custom_track_format
        )
    )
    process.start()
    # Track the running process using the generated filename.
    playlist_processes[filename] = process
    
    return Response(
        json.dumps({"prg_file": filename}),
        status=202,
        mimetype='application/json'
    )

@playlist_bp.route('/download/cancel', methods=['GET'])
def cancel_download():
    """
    Cancel a running playlist download process by its process id (prg file name).
    """
    prg_file = request.args.get('prg_file')
    if not prg_file:
        return Response(
            json.dumps({"error": "Missing process id (prg_file) parameter"}),
            status=400,
            mimetype='application/json'
        )
    
    process = playlist_processes.get(prg_file)
    prg_dir = './prgs'
    prg_path = os.path.join(prg_dir, prg_file)

    if process and process.is_alive():
        # Terminate the running process and wait for it to finish
        process.terminate()
        process.join()
        # Remove it from our tracking dictionary
        del playlist_processes[prg_file]
        
        # Append a cancellation status to the log file
        try:
            with open(prg_path, 'a') as f:
                f.write(json.dumps({"status": "cancel"}) + "\n")
        except Exception as e:
            return Response(
                json.dumps({"error": f"Failed to write cancel status to file: {str(e)}"}),
                status=500,
                mimetype='application/json'
            )
        
        return Response(
            json.dumps({"status": "cancel"}),
            status=200,
            mimetype='application/json'
        )
    else:
        return Response(
            json.dumps({"error": "Process not found or already terminated"}),
            status=404,
            mimetype='application/json'
        )

# NEW ENDPOINT: Get Playlist Information
@playlist_bp.route('/info', methods=['GET'])
def get_playlist_info():
    """
    Retrieve Spotify playlist metadata given a Spotify ID.
    Expects a query parameter 'id' that contains the Spotify playlist ID.
    """
    spotify_id = request.args.get('id')
    if not spotify_id:
        return Response(
            json.dumps({"error": "Missing parameter: id"}),
            status=400,
            mimetype='application/json'
        )
    
    try:
        # Import the get_spotify_info function from the utility module.
        from routes.utils.get_info import get_spotify_info
        # Call the function with the playlist type.
        playlist_info = get_spotify_info(spotify_id, "playlist")
        return Response(
            json.dumps(playlist_info),
            status=200,
            mimetype='application/json'
        )
    except Exception as e:
        error_data = {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        return Response(
            json.dumps(error_data),
            status=500,
            mimetype='application/json'
        )
