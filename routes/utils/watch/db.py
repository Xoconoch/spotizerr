import sqlite3
from pathlib import Path
import logging
import time

logger = logging.getLogger(__name__)

DB_DIR = Path("./data/watch")
# Define separate DB paths
PLAYLISTS_DB_PATH = DB_DIR / "playlists.db"
ARTISTS_DB_PATH = DB_DIR / "artists.db"

# Config path for watch.json is managed in routes.utils.watch.manager now
# CONFIG_PATH = Path('./data/config/watch.json') # Removed

# Expected column definitions
EXPECTED_WATCHED_PLAYLISTS_COLUMNS = {
    "spotify_id": "TEXT PRIMARY KEY",
    "name": "TEXT",
    "owner_id": "TEXT",
    "owner_name": "TEXT",
    "total_tracks": "INTEGER",
    "link": "TEXT",
    "snapshot_id": "TEXT",
    "last_checked": "INTEGER",
    "added_at": "INTEGER",
    "is_active": "INTEGER DEFAULT 1",
}

EXPECTED_PLAYLIST_TRACKS_COLUMNS = {
    "spotify_track_id": "TEXT PRIMARY KEY",
    "title": "TEXT",
    "artist_names": "TEXT",
    "album_name": "TEXT",
    "album_artist_names": "TEXT",
    "track_number": "INTEGER",
    "album_spotify_id": "TEXT",
    "duration_ms": "INTEGER",
    "added_at_playlist": "TEXT",
    "added_to_db": "INTEGER",
    "is_present_in_spotify": "INTEGER DEFAULT 1",
    "last_seen_in_spotify": "INTEGER",
}

EXPECTED_WATCHED_ARTISTS_COLUMNS = {
    "spotify_id": "TEXT PRIMARY KEY",
    "name": "TEXT",
    "link": "TEXT",
    "total_albums_on_spotify": "INTEGER",  # Number of albums found via API
    "last_checked": "INTEGER",
    "added_at": "INTEGER",
    "is_active": "INTEGER DEFAULT 1",
    "genres": "TEXT",  # Comma-separated
    "popularity": "INTEGER",
    "image_url": "TEXT",
}

EXPECTED_ARTIST_ALBUMS_COLUMNS = {
    "album_spotify_id": "TEXT PRIMARY KEY",
    "artist_spotify_id": "TEXT",  # Foreign key to watched_artists
    "name": "TEXT",
    "album_group": "TEXT",  # album, single, compilation, appears_on
    "album_type": "TEXT",  # album, single, compilation
    "release_date": "TEXT",
    "release_date_precision": "TEXT",  # year, month, day
    "total_tracks": "INTEGER",
    "link": "TEXT",
    "image_url": "TEXT",
    "added_to_db": "INTEGER",
    "last_seen_on_spotify": "INTEGER",  # Timestamp when last confirmed via API
    "download_task_id": "TEXT",
    "download_status": "INTEGER DEFAULT 0",  # 0: Not Queued, 1: Queued/In Progress, 2: Downloaded, 3: Error
    "is_fully_downloaded_managed_by_app": "INTEGER DEFAULT 0",  # 0: No, 1: Yes (app has marked all its tracks as downloaded)
}


def _ensure_table_schema(
    cursor: sqlite3.Cursor,
    table_name: str,
    expected_columns: dict,
    table_description: str,
):
    """
    Ensures the given table has all expected columns, adding them if necessary.
    """
    try:
        cursor.execute(f"PRAGMA table_info({table_name})")
        existing_columns_info = cursor.fetchall()
        existing_column_names = {col[1] for col in existing_columns_info}

        added_columns_to_this_table = False
        for col_name, col_type in expected_columns.items():
            if col_name not in existing_column_names:
                if (
                    "PRIMARY KEY" in col_type.upper() and existing_columns_info
                ):  # Only warn if table already exists
                    logger.warning(
                        f"Column '{col_name}' is part of PRIMARY KEY for {table_description} '{table_name}' "
                        f"and was expected to be created by CREATE TABLE. Skipping explicit ADD COLUMN. "
                        f"Manual schema review might be needed if this table was not empty."
                    )
                    continue

                col_type_for_add = col_type.replace(" PRIMARY KEY", "").strip()
                try:
                    cursor.execute(
                        f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type_for_add}"
                    )
                    logger.info(
                        f"Added missing column '{col_name} {col_type_for_add}' to {table_description} table '{table_name}'."
                    )
                    added_columns_to_this_table = True
                except sqlite3.OperationalError as alter_e:
                    logger.warning(
                        f"Could not add column '{col_name}' to {table_description} table '{table_name}': {alter_e}. "
                        f"It might already exist with a different definition or there's another schema mismatch."
                    )
        return added_columns_to_this_table
    except sqlite3.Error as e:
        logger.error(
            f"Error ensuring schema for {table_description} table '{table_name}': {e}",
            exc_info=True,
        )
        return False


def _get_playlists_db_connection():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(PLAYLISTS_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _get_artists_db_connection():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(ARTISTS_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_playlists_db():
    """Initializes the playlists database and creates/updates the main watched_playlists table."""
    try:
        with _get_playlists_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS watched_playlists (
                    spotify_id TEXT PRIMARY KEY,
                    name TEXT,
                    owner_id TEXT,
                    owner_name TEXT,
                    total_tracks INTEGER,
                    link TEXT,
                    snapshot_id TEXT,
                    last_checked INTEGER,
                    added_at INTEGER,
                    is_active INTEGER DEFAULT 1
                )
            """)
            # Ensure schema
            if _ensure_table_schema(
                cursor,
                "watched_playlists",
                EXPECTED_WATCHED_PLAYLISTS_COLUMNS,
                "watched playlists",
            ):
                conn.commit()
            logger.info(
                f"Playlists database initialized/updated successfully at {PLAYLISTS_DB_PATH}"
            )
    except sqlite3.Error as e:
        logger.error(f"Error initializing watched_playlists table: {e}", exc_info=True)
        raise


def _create_playlist_tracks_table(playlist_spotify_id: str):
    """Creates or updates a table for a specific playlist to store its tracks in playlists.db."""
    table_name = f"playlist_{playlist_spotify_id.replace('-', '_').replace(' ', '_')}"  # Sanitize table name
    try:
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            cursor.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    spotify_track_id TEXT PRIMARY KEY,
                    title TEXT,
                    artist_names TEXT, -- Comma-separated artist names
                    album_name TEXT,
                    album_artist_names TEXT, -- Comma-separated album artist names
                    track_number INTEGER,
                    album_spotify_id TEXT,
                    duration_ms INTEGER,
                    added_at_playlist TEXT, -- When track was added to Spotify playlist
                    added_to_db INTEGER, -- Timestamp when track was added to this DB table
                    is_present_in_spotify INTEGER DEFAULT 1, -- Flag to mark if still in Spotify playlist
                    last_seen_in_spotify INTEGER -- Timestamp when last confirmed in Spotify playlist
                )
            """)
            # Ensure schema
            if _ensure_table_schema(
                cursor,
                table_name,
                EXPECTED_PLAYLIST_TRACKS_COLUMNS,
                f"playlist tracks ({playlist_spotify_id})",
            ):
                conn.commit()
            logger.info(
                f"Tracks table '{table_name}' created/updated or already exists in {PLAYLISTS_DB_PATH}."
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error creating playlist tracks table {table_name} in {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        raise


def add_playlist_to_watch(playlist_data: dict):
    """Adds a playlist to the watched_playlists table and creates its tracks table in playlists.db."""
    try:
        _create_playlist_tracks_table(playlist_data["id"])
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT OR REPLACE INTO watched_playlists
                (spotify_id, name, owner_id, owner_name, total_tracks, link, snapshot_id, last_checked, added_at, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
                (
                    playlist_data["id"],
                    playlist_data["name"],
                    playlist_data["owner"]["id"],
                    playlist_data["owner"].get(
                        "display_name", playlist_data["owner"]["id"]
                    ),
                    playlist_data["tracks"]["total"],
                    playlist_data["external_urls"]["spotify"],
                    playlist_data.get("snapshot_id"),
                    int(time.time()),
                    int(time.time()),
                ),
            )
            conn.commit()
            logger.info(
                f"Playlist '{playlist_data['name']}' ({playlist_data['id']}) added to watchlist in {PLAYLISTS_DB_PATH}."
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error adding playlist {playlist_data.get('id')} to watchlist in {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        raise


def remove_playlist_from_watch(playlist_spotify_id: str):
    """Removes a playlist from watched_playlists and drops its tracks table in playlists.db."""
    table_name = f"playlist_{playlist_spotify_id.replace('-', '_')}"
    try:
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM watched_playlists WHERE spotify_id = ?",
                (playlist_spotify_id,),
            )
            cursor.execute(f"DROP TABLE IF EXISTS {table_name}")
            conn.commit()
            logger.info(
                f"Playlist {playlist_spotify_id} removed from watchlist and its table '{table_name}' dropped in {PLAYLISTS_DB_PATH}."
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error removing playlist {playlist_spotify_id} from watchlist in {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        raise


def get_watched_playlists():
    """Retrieves all active playlists from the watched_playlists table in playlists.db."""
    try:
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM watched_playlists WHERE is_active = 1")
            playlists = [dict(row) for row in cursor.fetchall()]
            return playlists
    except sqlite3.Error as e:
        logger.error(
            f"Error retrieving watched playlists from {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        return []


def get_watched_playlist(playlist_spotify_id: str):
    """Retrieves a specific playlist from the watched_playlists table in playlists.db."""
    try:
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM watched_playlists WHERE spotify_id = ?",
                (playlist_spotify_id,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    except sqlite3.Error as e:
        logger.error(
            f"Error retrieving playlist {playlist_spotify_id} from {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        return None


def update_playlist_snapshot(
    playlist_spotify_id: str, snapshot_id: str, total_tracks: int
):
    """Updates the snapshot_id and total_tracks for a watched playlist in playlists.db."""
    try:
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE watched_playlists
                SET snapshot_id = ?, total_tracks = ?, last_checked = ?
                WHERE spotify_id = ?
            """,
                (snapshot_id, total_tracks, int(time.time()), playlist_spotify_id),
            )
            conn.commit()
    except sqlite3.Error as e:
        logger.error(
            f"Error updating snapshot for playlist {playlist_spotify_id} in {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )


def get_playlist_track_ids_from_db(playlist_spotify_id: str):
    """Retrieves all track Spotify IDs from a specific playlist's tracks table in playlists.db."""
    table_name = f"playlist_{playlist_spotify_id.replace('-', '_')}"
    track_ids: set[str] = set()
    try:
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}';"
            )
            if cursor.fetchone() is None:
                logger.warning(
                    f"Track table {table_name} does not exist in {PLAYLISTS_DB_PATH}. Cannot fetch track IDs."
                )
                return track_ids
            cursor.execute(
                f"SELECT spotify_track_id FROM {table_name} WHERE is_present_in_spotify = 1"
            )
            rows = cursor.fetchall()
            for row in rows:
                track_ids.add(row["spotify_track_id"])
        return track_ids
    except sqlite3.Error as e:
        logger.error(
            f"Error retrieving track IDs for playlist {playlist_spotify_id} from table {table_name} in {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        return track_ids


def add_tracks_to_playlist_db(playlist_spotify_id: str, tracks_data: list):
    """
    Updates existing tracks in the playlist's DB table to mark them as currently present
    in Spotify and updates their last_seen timestamp. Also refreshes metadata.
    Does NOT insert new tracks. New tracks are only added upon successful download.
    """
    table_name = f"playlist_{playlist_spotify_id.replace('-', '_')}"
    if not tracks_data:
        return

    current_time = int(time.time())
    tracks_to_update = []
    for track_item in tracks_data:
        track = track_item.get("track")
        if not track or not track.get("id"):
            logger.warning(
                f"Skipping track update due to missing data or ID in playlist {playlist_spotify_id}: {track_item}"
            )
            continue

        artist_names = ", ".join(
            [
                artist["name"]
                for artist in track.get("artists", [])
                if artist.get("name")
            ]
        )
        album_artist_names = ", ".join(
            [
                artist["name"]
                for artist in track.get("album", {}).get("artists", [])
                if artist.get("name")
            ]
        )

        # Prepare tuple for UPDATE statement.
        # Order: title, artist_names, album_name, album_artist_names, track_number,
        # album_spotify_id, duration_ms, added_at_playlist,
        # is_present_in_spotify, last_seen_in_spotify, spotify_track_id (for WHERE)
        tracks_to_update.append(
            (
                track.get("name", "N/A"),
                artist_names,
                track.get("album", {}).get("name", "N/A"),
                album_artist_names,
                track.get("track_number"),
                track.get("album", {}).get("id"),
                track.get("duration_ms"),
                track_item.get("added_at"),  # From playlist item, update if changed
                1,  # is_present_in_spotify flag
                current_time,  # last_seen_in_spotify timestamp
                # added_to_db is NOT updated here as this function only updates existing records.
                track["id"],  # spotify_track_id for the WHERE clause
            )
        )

    if not tracks_to_update:
        logger.info(
            f"No valid tracks to prepare for update for playlist {playlist_spotify_id}."
        )
        return

    try:
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            # The table should have been created when the playlist was added to watch
            # or when the first track was successfully downloaded.
            # _create_playlist_tracks_table(playlist_spotify_id) # Not strictly needed here if table creation is robust elsewhere.

            # The fields in SET must match the order of ?s, excluding the last one for WHERE.
            # This will only update rows where spotify_track_id matches.
            cursor.executemany(
                f"""
                UPDATE {table_name} SET
                    title = ?,
                    artist_names = ?,
                    album_name = ?,
                    album_artist_names = ?,
                    track_number = ?,
                    album_spotify_id = ?,
                    duration_ms = ?,
                    added_at_playlist = ?,
                    is_present_in_spotify = ?,
                    last_seen_in_spotify = ?
                WHERE spotify_track_id = ?
            """,
                tracks_to_update,
            )
            conn.commit()
            logger.info(
                f"Attempted to update metadata for {len(tracks_to_update)} tracks from API in DB for playlist {playlist_spotify_id}. Actual rows updated: {cursor.rowcount if cursor.rowcount != -1 else 'unknown'}."
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error updating tracks in playlist {playlist_spotify_id} in table {table_name} in {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        # Not raising here to allow other operations to continue if one batch fails.


def mark_tracks_as_not_present_in_spotify(
    playlist_spotify_id: str, track_ids_to_mark: list
):
    """Marks specified tracks as not present in the Spotify playlist anymore in playlists.db."""
    table_name = f"playlist_{playlist_spotify_id.replace('-', '_')}"
    if not track_ids_to_mark:
        return
    try:
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            placeholders = ",".join("?" for _ in track_ids_to_mark)
            sql = f"UPDATE {table_name} SET is_present_in_spotify = 0 WHERE spotify_track_id IN ({placeholders})"
            cursor.execute(sql, track_ids_to_mark)
            conn.commit()
            logger.info(
                f"Marked {cursor.rowcount} tracks as not present in Spotify for playlist {playlist_spotify_id} in {PLAYLISTS_DB_PATH}."
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error marking tracks as not present for playlist {playlist_spotify_id} in {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )


def add_specific_tracks_to_playlist_table(
    playlist_spotify_id: str, track_details_list: list
):
    """
    Adds specific tracks (with full details fetched separately) to the playlist's table.
    This is used when a user manually marks tracks as "downloaded" or "known".
    """
    table_name = f"playlist_{playlist_spotify_id.replace('-', '_')}"
    if not track_details_list:
        return

    current_time = int(time.time())
    tracks_to_insert = []

    for (
        track
    ) in track_details_list:  # track here is assumed to be a full Spotify TrackObject
        if not track or not track.get("id"):
            logger.warning(
                f"Skipping track due to missing data or ID (manual add) in playlist {playlist_spotify_id}: {track}"
            )
            continue

        artist_names = ", ".join(
            [
                artist["name"]
                for artist in track.get("artists", [])
                if artist.get("name")
            ]
        )
        album_artist_names = ", ".join(
            [
                artist["name"]
                for artist in track.get("album", {}).get("artists", [])
                if artist.get("name")
            ]
        )

        tracks_to_insert.append(
            (
                track["id"],
                track.get("name", "N/A"),
                artist_names,
                track.get("album", {}).get("name", "N/A"),
                album_artist_names,
                track.get("track_number"),
                track.get("album", {}).get("id"),
                track.get("duration_ms"),
                None,  # added_at_playlist - not known for manually added tracks this way
                current_time,  # added_to_db
                1,  # is_present_in_spotify (assume user wants it considered present)
                current_time,  # last_seen_in_spotify
            )
        )

    if not tracks_to_insert:
        logger.info(
            f"No valid tracks to insert (manual add) for playlist {playlist_spotify_id}."
        )
        return

    try:
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            _create_playlist_tracks_table(playlist_spotify_id)  # Ensure table exists
            cursor.executemany(
                f"""
                INSERT OR REPLACE INTO {table_name}
                (spotify_track_id, title, artist_names, album_name, album_artist_names, track_number, album_spotify_id, duration_ms, added_at_playlist, added_to_db, is_present_in_spotify, last_seen_in_spotify)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                tracks_to_insert,
            )
            conn.commit()
            logger.info(
                f"Manually added/updated {len(tracks_to_insert)} tracks in DB for playlist {playlist_spotify_id} in {PLAYLISTS_DB_PATH}."
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error manually adding tracks to playlist {playlist_spotify_id} in table {table_name} in {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )


def remove_specific_tracks_from_playlist_table(
    playlist_spotify_id: str, track_spotify_ids: list
):
    """Removes specific tracks from the playlist's local track table."""
    table_name = f"playlist_{playlist_spotify_id.replace('-', '_')}"
    if not track_spotify_ids:
        return 0

    try:
        with _get_playlists_db_connection() as conn:
            cursor = conn.cursor()
            placeholders = ",".join("?" for _ in track_spotify_ids)
            # Check if table exists first
            cursor.execute(
                f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}';"
            )
            if cursor.fetchone() is None:
                logger.warning(
                    f"Track table {table_name} does not exist. Cannot remove tracks."
                )
                return 0

            cursor.execute(
                f"DELETE FROM {table_name} WHERE spotify_track_id IN ({placeholders})",
                track_spotify_ids,
            )
            conn.commit()
            deleted_count = cursor.rowcount
            logger.info(
                f"Manually removed {deleted_count} tracks from DB for playlist {playlist_spotify_id}."
            )
            return deleted_count
    except sqlite3.Error as e:
        logger.error(
            f"Error manually removing tracks for playlist {playlist_spotify_id} from table {table_name}: {e}",
            exc_info=True,
        )
        return 0


def add_single_track_to_playlist_db(playlist_spotify_id: str, track_item_for_db: dict):
    """Adds or updates a single track in the specified playlist's tracks table in playlists.db."""
    table_name = f"playlist_{playlist_spotify_id.replace('-', '_')}"
    track_detail = track_item_for_db.get("track")
    if not track_detail or not track_detail.get("id"):
        logger.warning(
            f"Skipping single track due to missing data for playlist {playlist_spotify_id}: {track_item_for_db}"
        )
        return

    current_time = int(time.time())
    artist_names = ", ".join(
        [a["name"] for a in track_detail.get("artists", []) if a.get("name")]
    )
    album_artist_names = ", ".join(
        [
            a["name"]
            for a in track_detail.get("album", {}).get("artists", [])
            if a.get("name")
        ]
    )

    track_data_tuple = (
        track_detail["id"],
        track_detail.get("name", "N/A"),
        artist_names,
        track_detail.get("album", {}).get("name", "N/A"),
        album_artist_names,
        track_detail.get("track_number"),
        track_detail.get("album", {}).get("id"),
        track_detail.get("duration_ms"),
        track_item_for_db.get("added_at"),
        current_time,
        1,
        current_time,
    )
    try:
        with _get_playlists_db_connection() as conn:  # Use playlists connection
            cursor = conn.cursor()
            _create_playlist_tracks_table(playlist_spotify_id)
            cursor.execute(
                f"""
                INSERT OR REPLACE INTO {table_name}
                (spotify_track_id, title, artist_names, album_name, album_artist_names, track_number, album_spotify_id, duration_ms, added_at_playlist, added_to_db, is_present_in_spotify, last_seen_in_spotify)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                track_data_tuple,
            )
            conn.commit()
            logger.info(
                f"Track '{track_detail.get('name')}' added/updated in DB for playlist {playlist_spotify_id} in {PLAYLISTS_DB_PATH}."
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error adding single track to playlist {playlist_spotify_id} in {PLAYLISTS_DB_PATH}: {e}",
            exc_info=True,
        )


# --- Artist Watch Database Functions ---


def init_artists_db():
    """Initializes the artists database and creates/updates the main watched_artists table."""
    try:
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            # Note: total_albums_on_spotify, genres, popularity, image_url added to EXPECTED_WATCHED_ARTISTS_COLUMNS
            # and will be added by _ensure_table_schema if missing.
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS watched_artists (
                    spotify_id TEXT PRIMARY KEY,
                    name TEXT,
                    link TEXT,
                    total_albums_on_spotify INTEGER, -- Number of albums found via API on last full check
                    last_checked INTEGER,
                    added_at INTEGER,
                    is_active INTEGER DEFAULT 1,
                    genres TEXT,          -- Comma-separated list of genres
                    popularity INTEGER,   -- Artist popularity (0-100)
                    image_url TEXT        -- URL of the artist's image
                )
            """)
            # Ensure schema
            if _ensure_table_schema(
                cursor,
                "watched_artists",
                EXPECTED_WATCHED_ARTISTS_COLUMNS,
                "watched artists",
            ):
                conn.commit()
            logger.info(
                f"Artists database initialized/updated successfully at {ARTISTS_DB_PATH}"
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error initializing watched_artists table in {ARTISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        raise


def _create_artist_albums_table(artist_spotify_id: str):
    """Creates or updates a table for a specific artist to store their albums in artists.db."""
    table_name = f"artist_{artist_spotify_id.replace('-', '_').replace(' ', '_')}"  # Sanitize table name
    try:
        with _get_artists_db_connection() as conn:  # Use artists connection
            cursor = conn.cursor()
            # Note: Several columns including artist_spotify_id, release_date_precision, image_url,
            # last_seen_on_spotify, download_task_id, download_status, is_fully_downloaded_managed_by_app
            # are part of EXPECTED_ARTIST_ALBUMS_COLUMNS and will be added by _ensure_table_schema.
            cursor.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    album_spotify_id TEXT PRIMARY KEY,
                    artist_spotify_id TEXT,
                    name TEXT,
                    album_group TEXT,
                    album_type TEXT,
                    release_date TEXT,
                    release_date_precision TEXT,
                    total_tracks INTEGER,
                    link TEXT,
                    image_url TEXT,
                    added_to_db INTEGER,
                    last_seen_on_spotify INTEGER,
                    download_task_id TEXT,
                    download_status INTEGER DEFAULT 0,
                    is_fully_downloaded_managed_by_app INTEGER DEFAULT 0
                )
            """)
            # Ensure schema for the specific artist's album table
            if _ensure_table_schema(
                cursor,
                table_name,
                EXPECTED_ARTIST_ALBUMS_COLUMNS,
                f"artist albums ({artist_spotify_id})",
            ):
                conn.commit()
            logger.info(
                f"Albums table '{table_name}' created/updated or already exists in {ARTISTS_DB_PATH}."
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error creating artist albums table {table_name} in {ARTISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        raise


def add_artist_to_watch(artist_data: dict):
    """Adds an artist to the watched_artists table and creates its albums table in artists.db."""
    artist_id = artist_data.get("id")
    if not artist_id:
        logger.error("Cannot add artist to watch: Missing 'id' in artist_data.")
        return

    try:
        _create_artist_albums_table(artist_id)
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT OR REPLACE INTO watched_artists
                (spotify_id, name, total_albums_on_spotify, last_checked, added_at, is_active)
                VALUES (?, ?, ?, ?, ?, 1)
            """,
                (
                    artist_id,
                    artist_data.get("name", "N/A"),
                    artist_data.get("albums", {}).get("total", 0),
                    int(time.time()),
                    int(time.time()),
                ),
            )
            conn.commit()
            logger.info(
                f"Artist '{artist_data.get('name')}' ({artist_id}) added to watchlist in {ARTISTS_DB_PATH}."
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error adding artist {artist_id} to watchlist in {ARTISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        raise
    except KeyError as e:
        logger.error(
            f"Missing key in artist_data for artist {artist_id}: {e}. Data: {artist_data}",
            exc_info=True,
        )
        raise


def remove_artist_from_watch(artist_spotify_id: str):
    """Removes an artist from watched_artists and drops its albums table in artists.db."""
    table_name = f"artist_{artist_spotify_id.replace('-', '_')}_albums"
    try:
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM watched_artists WHERE spotify_id = ?", (artist_spotify_id,)
            )
            cursor.execute(f"DROP TABLE IF EXISTS {table_name}")
            conn.commit()
            logger.info(
                f"Artist {artist_spotify_id} removed from watchlist and its table '{table_name}' dropped from {ARTISTS_DB_PATH}."
            )
    except sqlite3.Error as e:
        logger.error(
            f"Error removing artist {artist_spotify_id} from watchlist in {ARTISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        raise


def get_watched_artists():
    """Retrieves all active artists from the watched_artists table in artists.db."""
    try:
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM watched_artists WHERE is_active = 1")
            artists = [dict(row) for row in cursor.fetchall()]
            return artists
    except sqlite3.Error as e:
        logger.error(
            f"Error retrieving watched artists from {ARTISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        return []


def get_watched_artist(artist_spotify_id: str):
    """Retrieves a specific artist from the watched_artists table in artists.db."""
    try:
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM watched_artists WHERE spotify_id = ?",
                (artist_spotify_id,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    except sqlite3.Error as e:
        logger.error(
            f"Error retrieving artist {artist_spotify_id} from {ARTISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        return None


def update_artist_metadata_after_check(
    artist_spotify_id: str, total_albums_from_api: int
):
    """Updates the total_albums_on_spotify and last_checked for an artist in artists.db."""
    try:
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE watched_artists
                SET total_albums_on_spotify = ?, last_checked = ?
                WHERE spotify_id = ?
            """,
                (total_albums_from_api, int(time.time()), artist_spotify_id),
            )
            conn.commit()
    except sqlite3.Error as e:
        logger.error(
            f"Error updating metadata for artist {artist_spotify_id} in {ARTISTS_DB_PATH}: {e}",
            exc_info=True,
        )


def get_artist_album_ids_from_db(artist_spotify_id: str):
    """Retrieves all album Spotify IDs from a specific artist's albums table in artists.db."""
    table_name = f"artist_{artist_spotify_id.replace('-', '_')}_albums"
    album_ids: set[str] = set()
    try:
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}';"
            )
            if cursor.fetchone() is None:
                logger.warning(
                    f"Album table {table_name} for artist {artist_spotify_id} does not exist in {ARTISTS_DB_PATH}. Cannot fetch album IDs."
                )
                return album_ids
            cursor.execute(f"SELECT album_spotify_id FROM {table_name}")
            rows = cursor.fetchall()
            for row in rows:
                album_ids.add(row["album_spotify_id"])
        return album_ids
    except sqlite3.Error as e:
        logger.error(
            f"Error retrieving album IDs for artist {artist_spotify_id} from {ARTISTS_DB_PATH}: {e}",
            exc_info=True,
        )
        return album_ids


def add_or_update_album_for_artist(
    artist_spotify_id: str,
    album_data: dict,
    task_id: str = None,
    is_download_complete: bool = False,
):
    """Adds or updates an album in the specified artist's albums table in artists.db."""
    table_name = f"artist_{artist_spotify_id.replace('-', '_')}_albums"
    album_id = album_data.get("id")
    if not album_id:
        logger.warning(
            f"Skipping album for artist {artist_spotify_id} due to missing album ID: {album_data}"
        )
        return

    download_status = 0
    if task_id and not is_download_complete:
        download_status = 1
    elif is_download_complete:
        download_status = 2

    current_time = int(time.time())
    album_tuple = (
        album_id,
        album_data.get("name", "N/A"),
        album_data.get("album_group", "N/A"),
        album_data.get("album_type", "N/A"),
        album_data.get("release_date"),
        album_data.get("total_tracks"),
        current_time,
        download_status,
        task_id,
    )
    try:
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            _create_artist_albums_table(artist_spotify_id)

            cursor.execute(
                f"SELECT added_to_db_at FROM {table_name} WHERE album_spotify_id = ?",
                (album_id,),
            )
            existing_row = cursor.fetchone()

            if existing_row:
                update_tuple = (
                    album_data.get("name", "N/A"),
                    album_data.get("album_group", "N/A"),
                    album_data.get("album_type", "N/A"),
                    album_data.get("release_date"),
                    album_data.get("total_tracks"),
                    download_status,
                    task_id,
                    album_id,
                )
                cursor.execute(
                    f"""
                    UPDATE {table_name} SET
                    name = ?, album_group = ?, album_type = ?, release_date = ?, total_tracks = ?,
                    is_download_initiated = ?, task_id = ?
                    WHERE album_spotify_id = ?
                """,
                    update_tuple,
                )
                logger.info(
                    f"Updated album '{album_data.get('name')}' in DB for artist {artist_spotify_id} in {ARTISTS_DB_PATH}."
                )
            else:
                cursor.execute(
                    f"""
                    INSERT INTO {table_name}
                    (album_spotify_id, name, album_group, album_type, release_date, total_tracks, added_to_db_at, is_download_initiated, task_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    album_tuple,
                )
                logger.info(
                    f"Added album '{album_data.get('name')}' to DB for artist {artist_spotify_id} in {ARTISTS_DB_PATH}."
                )
            conn.commit()
    except sqlite3.Error as e:
        logger.error(
            f"Error adding/updating album {album_id} for artist {artist_spotify_id} in {ARTISTS_DB_PATH}: {e}",
            exc_info=True,
        )


def update_album_download_status_for_artist(
    artist_spotify_id: str, album_spotify_id: str, task_id: str, status: int
):
    """Updates the download status (is_download_initiated) and task_id for a specific album of an artist in artists.db."""
    table_name = f"artist_{artist_spotify_id.replace('-', '_')}_albums"
    try:
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                f"""
                UPDATE {table_name}
                SET is_download_initiated = ?, task_id = ?
                WHERE album_spotify_id = ?
            """,
                (status, task_id, album_spotify_id),
            )
            if cursor.rowcount == 0:
                logger.warning(
                    f"Attempted to update download status for non-existent album {album_spotify_id} for artist {artist_spotify_id} in {ARTISTS_DB_PATH}."
                )
            else:
                logger.info(
                    f"Updated download status to {status} for album {album_spotify_id} (task: {task_id}) for artist {artist_spotify_id} in {ARTISTS_DB_PATH}."
                )
            conn.commit()
    except sqlite3.Error as e:
        logger.error(
            f"Error updating album download status for album {album_spotify_id}, artist {artist_spotify_id} in {ARTISTS_DB_PATH}: {e}",
            exc_info=True,
        )


def add_specific_albums_to_artist_table(
    artist_spotify_id: str, album_details_list: list
):
    """
    Adds specific albums (with full details fetched separately) to the artist's album table.
    This can be used when a user manually marks albums as "known" or "processed".
    Albums added this way are marked with is_download_initiated = 3 (Manually Added/Known).
    """
    if not album_details_list:
        logger.info(
            f"No album details provided to add specifically for artist {artist_spotify_id}."
        )
        return 0

    processed_count = 0
    for album_data in album_details_list:
        if not album_data or not album_data.get("id"):
            logger.warning(
                f"Skipping album due to missing data or ID (manual add) for artist {artist_spotify_id}: {album_data}"
            )
            continue

        # Use existing function to add/update, ensuring it handles manual state
        # Set task_id to None and is_download_initiated to a specific state for manually added known albums
        # The add_or_update_album_for_artist expects `is_download_complete` not `is_download_initiated` directly.
        # We can adapt `add_or_update_album_for_artist` or pass status directly if it's modified to handle it.
        # For now, let's pass task_id=None and a flag that implies manual addition (e.g. is_download_complete=True, and then modify add_or_update_album_for_artist status logic)
        # Or, more directly, update the `is_download_initiated` field as part of the album_tuple for INSERT and in UPDATE.
        # Let's stick to calling `add_or_update_album_for_artist` and adjust its status handling if needed.
        # Setting `is_download_complete=True` and `task_id=None` should set `is_download_initiated = 2` (completed)
        # We might need a new status like 3 for "Manually Marked as Known"
        # For simplicity, we'll use `add_or_update_album_for_artist` and the status will be 'download_complete'.
        # If a more distinct status is needed, `add_or_update_album_for_artist` would need adjustment.

        # Simplification: we'll call add_or_update_album_for_artist which will mark it based on task_id presence or completion.
        # For a truly "manual" state distinct from "downloaded", `add_or_update_album_for_artist` would need a new status value.
        # Let's assume for now that adding it via this function means it's "known" and doesn't need downloading.
        # The `add_or_update_album_for_artist` function sets is_download_initiated based on task_id and is_download_complete.
        # If task_id is None and is_download_complete is True, it implies it's processed.
        try:
            add_or_update_album_for_artist(
                artist_spotify_id, album_data, task_id=None, is_download_complete=True
            )
            processed_count += 1
        except Exception as e:
            logger.error(
                f"Error manually adding album {album_data.get('id')} for artist {artist_spotify_id}: {e}",
                exc_info=True,
            )

    logger.info(
        f"Manually added/updated {processed_count} albums in DB for artist {artist_spotify_id} in {ARTISTS_DB_PATH}."
    )
    return processed_count


def remove_specific_albums_from_artist_table(
    artist_spotify_id: str, album_spotify_ids: list
):
    """Removes specific albums from the artist's local album table."""
    table_name = f"artist_{artist_spotify_id.replace('-', '_')}_albums"
    if not album_spotify_ids:
        return 0

    try:
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            placeholders = ",".join("?" for _ in album_spotify_ids)
            # Check if table exists first
            cursor.execute(
                f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}';"
            )
            if cursor.fetchone() is None:
                logger.warning(
                    f"Album table {table_name} for artist {artist_spotify_id} does not exist. Cannot remove albums."
                )
                return 0

            cursor.execute(
                f"DELETE FROM {table_name} WHERE album_spotify_id IN ({placeholders})",
                album_spotify_ids,
            )
            conn.commit()
            deleted_count = cursor.rowcount
            logger.info(
                f"Manually removed {deleted_count} albums from DB for artist {artist_spotify_id}."
            )
            return deleted_count
    except sqlite3.Error as e:
        logger.error(
            f"Error manually removing albums for artist {artist_spotify_id} from table {table_name}: {e}",
            exc_info=True,
        )
        return 0


def is_track_in_playlist_db(playlist_spotify_id: str, track_spotify_id: str) -> bool:
    """Checks if a specific track Spotify ID exists in the given playlist's tracks table."""
    table_name = f"playlist_{playlist_spotify_id.replace('-', '_')}"
    try:
        with _get_playlists_db_connection() as conn:
            cursor = conn.cursor()
            # First, check if the table exists to prevent errors on non-watched or new playlists
            cursor.execute(
                f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}';"
            )
            if cursor.fetchone() is None:
                return False  # Table doesn't exist, so track cannot be in it

            cursor.execute(
                f"SELECT 1 FROM {table_name} WHERE spotify_track_id = ?",
                (track_spotify_id,),
            )
            return cursor.fetchone() is not None
    except sqlite3.Error as e:
        logger.error(
            f"Error checking if track {track_spotify_id} is in playlist {playlist_spotify_id} DB: {e}",
            exc_info=True,
        )
        return False  # Assume not present on error


def is_album_in_artist_db(artist_spotify_id: str, album_spotify_id: str) -> bool:
    """Checks if a specific album Spotify ID exists in the given artist's albums table."""
    table_name = f"artist_{artist_spotify_id.replace('-', '_')}_albums"
    try:
        with _get_artists_db_connection() as conn:
            cursor = conn.cursor()
            # First, check if the table exists
            cursor.execute(
                f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}';"
            )
            if cursor.fetchone() is None:
                return False  # Table doesn't exist

            cursor.execute(
                f"SELECT 1 FROM {table_name} WHERE album_spotify_id = ?",
                (album_spotify_id,),
            )
            return cursor.fetchone() is not None
    except sqlite3.Error as e:
        logger.error(
            f"Error checking if album {album_spotify_id} is in artist {artist_spotify_id} DB: {e}",
            exc_info=True,
        )
        return False  # Assume not present on error
