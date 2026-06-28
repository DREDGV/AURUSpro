def _table_columns(db, table_name):
    return {row["name"] for row in db.execute(f"PRAGMA table_info({table_name})").fetchall()}


def _add_column_if_missing(db, table_name, column_name, definition):
    if column_name not in _table_columns(db, table_name):
        db.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def ensure_alliance_schema(db):
    db.execute(
        """CREATE TABLE IF NOT EXISTS task_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            author TEXT,
            comment_text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS alliance_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT,
            title TEXT NOT NULL,
            description TEXT,
            related_player TEXT,
            author TEXT,
            event_date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS alliance_topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'Открыто',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER,
            request_type TEXT,
            title TEXT NOT NULL,
            description TEXT,
            priority TEXT,
            status TEXT,
            assignee TEXT,
            resolution TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
        )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS request_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id INTEGER NOT NULL,
            author TEXT,
            comment_text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
        )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            proposer TEXT,
            description TEXT,
            status TEXT,
            priority TEXT,
            deadline TEXT,
            result TEXT,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )"""
    )

    _add_column_if_missing(db, "tasks", "coordinates", "TEXT")
    _add_column_if_missing(db, "tasks", "map_object_id", "INTEGER")
    _add_column_if_missing(db, "tasks", "map_object_type", "TEXT")
    _add_column_if_missing(db, "tasks", "task_type", "TEXT")
    _add_column_if_missing(db, "tasks", "updated_at", "TIMESTAMP")
    db.commit()
