from flask import Flask, request, send_from_directory, render_template
from flask_cors import CORS
from routes.search import search_bp
from routes.credentials import credentials_bp
from routes.album import album_bp
from routes.track import track_bp
from routes.playlist import playlist_bp
from routes.prgs import prgs_bp
from routes.config import config_bp
from routes.artist import artist_bp
from routes.history import history_bp
import logging
import logging.handlers
import time
from pathlib import Path
import os
import atexit
import sys
import redis
import socket
from urllib.parse import urlparse

# Import Celery configuration and manager
from routes.utils.celery_manager import celery_manager
from routes.utils.celery_config import REDIS_URL
from routes.utils.history_manager import init_history_db


# Configure application-wide logging
def setup_logging():
    """Configure application-wide logging with rotation"""
    # Create logs directory if it doesn't exist
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)

    # Set up log file paths
    main_log = logs_dir / "spotizerr.log"

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Clear any existing handlers from the root logger
    if root_logger.hasHandlers():
        root_logger.handlers.clear()

    # Log formatting
    log_format = logging.Formatter(
        "%(asctime)s [%(processName)s:%(threadName)s] [%(name)s] [%(levelname)s] - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # File handler with rotation (10 MB max, keep 5 backups)
    file_handler = logging.handlers.RotatingFileHandler(
        main_log, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(log_format)
    file_handler.setLevel(logging.INFO)

    # Console handler for stderr
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setFormatter(log_format)
    console_handler.setLevel(logging.INFO)

    # Add handlers to root logger
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)

    # Set up specific loggers
    for logger_name in ["werkzeug", "celery", "routes", "flask", "waitress"]:
        module_logger = logging.getLogger(logger_name)
        module_logger.setLevel(logging.INFO)
        # Handlers are inherited from root logger

    # Enable propagation for all loggers
    logging.getLogger("celery").propagate = True

    # Notify successful setup
    root_logger.info("Logging system initialized")

    # Return the main file handler for permissions adjustment
    return file_handler


def check_redis_connection():
    """Check if Redis is reachable and retry with exponential backoff if not"""
    max_retries = 5
    retry_count = 0
    retry_delay = 1  # start with 1 second

    # Extract host and port from REDIS_URL
    redis_host = "redis"  # default
    redis_port = 6379  # default

    # Parse from REDIS_URL if possible
    if REDIS_URL:
        # parse hostname and port (handles optional auth)
        try:
            parsed = urlparse(REDIS_URL)
            if parsed.hostname:
                redis_host = parsed.hostname
            if parsed.port:
                redis_port = parsed.port
        except Exception:
            pass

    # Log Redis connection details
    logging.info(f"Checking Redis connection to {redis_host}:{redis_port}")

    while retry_count < max_retries:
        try:
            # First try socket connection to check if Redis port is open
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex((redis_host, redis_port))
            sock.close()

            if result != 0:
                raise ConnectionError(
                    f"Cannot connect to Redis at {redis_host}:{redis_port}"
                )

            # If socket connection successful, try Redis ping
            r = redis.Redis.from_url(REDIS_URL)
            r.ping()
            logging.info("Successfully connected to Redis")
            return True
        except Exception as e:
            retry_count += 1
            if retry_count >= max_retries:
                logging.error(
                    f"Failed to connect to Redis after {max_retries} attempts: {e}"
                )
                logging.error(
                    f"Make sure Redis is running at {redis_host}:{redis_port}"
                )
                return False

            logging.warning(f"Redis connection attempt {retry_count} failed: {e}")
            logging.info(f"Retrying in {retry_delay} seconds...")
            time.sleep(retry_delay)
            retry_delay *= 2  # exponential backoff

    return False


def create_app():
    app = Flask(__name__, template_folder="static/html")

    # Set up CORS
    CORS(app)

    # Initialize databases
    init_history_db()

    # Register blueprints
    app.register_blueprint(config_bp, url_prefix="/api")
    app.register_blueprint(search_bp, url_prefix="/api")
    app.register_blueprint(credentials_bp, url_prefix="/api/credentials")
    app.register_blueprint(album_bp, url_prefix="/api/album")
    app.register_blueprint(track_bp, url_prefix="/api/track")
    app.register_blueprint(playlist_bp, url_prefix="/api/playlist")
    app.register_blueprint(artist_bp, url_prefix="/api/artist")
    app.register_blueprint(prgs_bp, url_prefix="/api/prgs")
    app.register_blueprint(history_bp, url_prefix="/api/history")

    # Serve frontend
    @app.route("/")
    def serve_index():
        return render_template("main.html")

    # Config page route
    @app.route("/config")
    def serve_config():
        return render_template("config.html")

    # New route: Serve watch.html under /watchlist
    @app.route("/watchlist")
    def serve_watchlist():
        return render_template("watch.html")

    # New route: Serve playlist.html under /playlist/<id>
    @app.route("/playlist/<id>")
    def serve_playlist(id):
        # The id parameter is captured, but you can use it as needed.
        return render_template("playlist.html")

    @app.route("/album/<id>")
    def serve_album(id):
        # The id parameter is captured, but you can use it as needed.
        return render_template("album.html")

    @app.route("/track/<id>")
    def serve_track(id):
        # The id parameter is captured, but you can use it as needed.
        return render_template("track.html")

    @app.route("/artist/<id>")
    def serve_artist(id):
        # The id parameter is captured, but you can use it as needed.
        return render_template("artist.html")

    @app.route("/history")
    def serve_history_page():
        return render_template("history.html")

    @app.route("/static/<path:path>")
    def serve_static(path):
        return send_from_directory("static", path)

    # Serve favicon.ico from the same directory as index.html (templates)
    @app.route("/favicon.ico")
    def serve_favicon():
        return send_from_directory("static/html", "favicon.ico")

    # Add request logging middleware
    @app.before_request
    def log_request():
        request.start_time = time.time()
        app.logger.debug(f"Request: {request.method} {request.path}")

    @app.after_request
    def log_response(response):
        if hasattr(request, "start_time"):
            duration = round((time.time() - request.start_time) * 1000, 2)
            app.logger.debug(f"Response: {response.status} | Duration: {duration}ms")
        return response

    # Error logging
    @app.errorhandler(Exception)
    def handle_exception(e):
        app.logger.error(f"Server error: {str(e)}", exc_info=True)
        return "Internal Server Error", 500

    return app


def start_celery_workers():
    """Start Celery workers with dynamic configuration"""
    logging.info("Starting Celery workers with dynamic configuration")
    celery_manager.start()

    # Register shutdown handler
    atexit.register(celery_manager.stop)


if __name__ == "__main__":
    # Configure application logging
    log_handler = setup_logging()

    # Set file permissions for log files if needed
    try:
        os.chmod(log_handler.baseFilename, 0o666)
    except (OSError, FileNotFoundError) as e:
        logging.warning(f"Could not set permissions on log file: {str(e)}")

    # Log application startup
    logging.info("=== Spotizerr Application Starting ===")

    # Check Redis connection before starting workers
    if check_redis_connection():
        # Start Watch Manager
        from routes.utils.watch.manager import start_watch_manager

        start_watch_manager()

        # Start Celery workers
        start_celery_workers()

        # Create and start Flask app
        app = create_app()
        logging.info("Starting Flask server on port 7171")
        from waitress import serve

        serve(app, host="0.0.0.0", port=7171)
    else:
        logging.error("Cannot start application: Redis connection failed")
        sys.exit(1)
