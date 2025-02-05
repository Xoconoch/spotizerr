from flask import Blueprint, Response, request
import json
import os
import random
import string
import sys
import traceback
from multiprocessing import Process

album_bp = Blueprint('album', __name__)

# Global dictionary to keep track of running download processes.
download_processes = {}

def generate_random_filename(length=6):
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length)) + '.album.prg'

class FlushingFileWrapper:
    def __init__(self, file):
        self.file = file

    def write(self, text):
        # Process each line separately.
        for line in text.split('\n'):
            line = line.strip()
            # Only process non-empty lines that look like JSON objects.
            if line and line.startswith('{'):
                try:
                    obj = json.loads(line)
                    # Skip writing if the JSON object has a "type" of "track"
                    if obj.get("type") == "track":
                        continue
                except ValueError:
                    # If not valid JSON, write the line as is.
                    pass
                self.file.write(line + '\n')
        self.file.flush()

    def flush(self):
        self.file.flush()

def download_task(service, url, main, fallback, quality, fall_quality, real_time, prg_path, orig_request):
    """
    The download task writes out the original request data into the progress file
    and then runs the album download.
    """
    try:
        from routes.utils.album import download_album
        with open(prg_path, 'w') as f:
            flushing_file = FlushingFileWrapper(f)
            original_stdout = sys.stdout
            sys.stdout = flushing_file  # Redirect stdout

            # Write the original request data into the progress file.
            try:
                flushing_file.write(json.dumps({"original_request": orig_request}) + "\n")
            except Exception as e:
                flushing_file.write(json.dumps({
                    "status": "error",
                    "message": f"Failed to write original request data: {str(e)}"
                }) + "\n")

            try:
                download_album(
                    service=service,
                    url=url,
                    main=main,
                    fallback=fallback,
                    quality=quality,
                    fall_quality=fall_quality,
                    real_time=real_time
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
                sys.stdout = original_stdout  # Restore stdout
    except Exception as e:
        with open(prg_path, 'w') as f:
            error_data = json.dumps({
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()
            })
            f.write(error_data + "\n")

@album_bp.route('/download', methods=['GET'])
def handle_download():
    service = request.args.get('service')
    url = request.args.get('url')
    main = request.args.get('main')
    fallback = request.args.get('fallback')
    quality = request.args.get('quality')
    fall_quality = request.args.get('fall_quality')
    
    # Retrieve and normalize the real_time parameter; defaults to False.
    real_time_arg = request.args.get('real_time', 'false')
    real_time = real_time_arg.lower() in ['true', '1', 'yes']

    # Sanitize main and fallback to prevent directory traversal
    if main:
        main = os.path.basename(main)
    if fallback:
        fallback = os.path.basename(fallback)

    if not all([service, url, main]):
        return Response(
            json.dumps({"error": "Missing parameters"}),
            status=400,
            mimetype='application/json'
        )

    # Validate credentials based on service and fallback
    try:
        if service == 'spotify':
            if fallback:
                # Validate Deezer main and Spotify fallback credentials
                deezer_creds_path = os.path.abspath(os.path.join('./creds/deezer', main, 'credentials.json'))
                if not os.path.isfile(deezer_creds_path):
                    return Response(
                        json.dumps({"error": "Invalid Deezer credentials directory"}),
                        status=400,
                        mimetype='application/json'
                    )
                spotify_fallback_path = os.path.abspath(os.path.join('./creds/spotify', fallback, 'credentials.json'))
                if not os.path.isfile(spotify_fallback_path):
                    return Response(
                        json.dumps({"error": "Invalid Spotify fallback credentials directory"}),
                        status=400,
                        mimetype='application/json'
                    )
            else:
                # Validate Spotify main credentials
                spotify_creds_path = os.path.abspath(os.path.join('./creds/spotify', main, 'credentials.json'))
                if not os.path.isfile(spotify_creds_path):
                    return Response(
                        json.dumps({"error": "Invalid Spotify credentials directory"}),
                        status=400,
                        mimetype='application/json'
                    )
        elif service == 'deezer':
            # Validate Deezer main credentials
            deezer_creds_path = os.path.abspath(os.path.join('./creds/deezer', main, 'credentials.json'))
            if not os.path.isfile(deezer_creds_path):
                return Response(
                    json.dumps({"error": "Invalid Deezer credentials directory"}),
                    status=400,
                    mimetype='application/json'
                )
        else:
            return Response(
                json.dumps({"error": "Unsupported service"}),
                status=400,
                mimetype='application/json'
            )
    except Exception as e:
        return Response(
            json.dumps({"error": f"Credential validation failed: {str(e)}"}),
            status=500,
            mimetype='application/json'
        )

    filename = generate_random_filename()
    prg_dir = './prgs'
    os.makedirs(prg_dir, exist_ok=True)
    prg_path = os.path.join(prg_dir, filename)
    
    # Capture the original request parameters as a dictionary.
    orig_request = request.args.to_dict()

    # Create and start the download process, and track it in the global dictionary.
    process = Process(
        target=download_task,
        args=(service, url, main, fallback, quality, fall_quality, real_time, prg_path, orig_request)
    )
    process.start()
    download_processes[filename] = process

    return Response(
        json.dumps({"prg_file": filename}),
        status=202,
        mimetype='application/json'
    )

@album_bp.route('/download/cancel', methods=['GET'])
def cancel_download():
    """
    Cancel a running download process by its process id (prg file name).
    """
    prg_file = request.args.get('prg_file')
    if not prg_file:
        return Response(
            json.dumps({"error": "Missing process id (prg_file) parameter"}),
            status=400,
            mimetype='application/json'
        )

    process = download_processes.get(prg_file)
    prg_dir = './prgs'
    prg_path = os.path.join(prg_dir, prg_file)

    if process and process.is_alive():
        # Terminate the running process
        process.terminate()
        process.join()  # Wait for process termination
        # Remove it from our global tracking dictionary
        del download_processes[prg_file]

        # Append a cancellation status to the log file
        try:
            with open(prg_path, 'a') as f:
                f.write(json.dumps({"status": "cancel"}) + "\n")
        except Exception as e:
            # If writing fails, we log the error in the response.
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

# NEW ENDPOINT: Get Album Information
@album_bp.route('/info', methods=['GET'])
def get_album_info():
    """
    Retrieve Spotify album metadata given a Spotify album ID.
    Expects a query parameter 'id' that contains the Spotify album ID.
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
        # Call the function with the album type.
        album_info = get_spotify_info(spotify_id, "album")
        return Response(
            json.dumps(album_info),
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
