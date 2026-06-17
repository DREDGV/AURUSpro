import sqlite3
import os
from config import DB_PATH, DATA_DIR, ACCESS_LEVELS


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)

    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute('''CREATE TABLE players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nick TEXT NOT NULL UNIQUE,
        name TEXT,
        how_to_address TEXT,
        country TEXT,
        city TEXT,
        timezone TEXT,
        status TEXT DEFAULT 'Новичок',
        role TEXT,
        access_level INTEGER DEFAULT 1,
        rank_in_game TEXT,
        points INTEGER DEFAULT 0,
        rating1 TEXT,
        rating2 TEXT,
        rating3 TEXT,
        planets TEXT,
        coordinates TEXT,
        registration_date TEXT,
        last_online TEXT,
        activity TEXT DEFAULT 'Неизвестно',
        player_status TEXT DEFAULT 'Новичок',
        willing_to_help INTEGER DEFAULT 0,
        needs_help INTEGER DEFAULT 0,
        trust_level TEXT DEFAULT 'Обычный',
        comment TEXT,
        direction TEXT,
        current_activity TEXT,
        desired_activity TEXT,
        can_help_with TEXT,
        needs_help_with TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        nick TEXT NOT NULL,
        race TEXT,
        account_type TEXT DEFAULT 'Основной',
        points INTEGER DEFAULT 0,
        coordinates TEXT,
        purpose TEXT,
        activity TEXT DEFAULT 'Неизвестно',
        confirmed INTEGER DEFAULT 0,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    )''')

    c.execute('''CREATE TABLE access_levels (
        id INTEGER PRIMARY KEY,
        level_name TEXT NOT NULL,
        description TEXT,
        can_see TEXT,
        can_edit TEXT,
        hidden_data TEXT
    )''')

    for level_id, level in ACCESS_LEVELS.items():
        c.execute(
            'INSERT INTO access_levels (id, level_name, description) VALUES (?, ?, ?)',
            (level_id, level['name'], level['description'])
        )

    c.execute('''CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        player_id INTEGER,
        access_level INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_id) REFERENCES players(id),
        FOREIGN KEY (access_level) REFERENCES access_levels(id)
    )''')

    c.execute('''CREATE TABLE fleet (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        account_nick TEXT,
        race TEXT,
        combat_power INTEGER DEFAULT 0,
        slave_fleet INTEGER DEFAULT 0,
        can_attack INTEGER DEFAULT 0,
        can_slaves INTEGER DEFAULT 0,
        can_lunar INTEGER DEFAULT 0,
        can_clean_worms INTEGER DEFAULT 0,
        data_reliability TEXT DEFAULT 'Приблизительно',
        comment TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    )''')

    c.execute('''CREATE TABLE game_objects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER,
        object_type TEXT NOT NULL,
        name TEXT,
        coordinates TEXT,
        sector TEXT,
        level INTEGER DEFAULT 1,
        value TEXT,
        status TEXT DEFAULT 'Активен',
        controlled INTEGER DEFAULT 0,
        needs_protection INTEGER DEFAULT 0,
        needs_development INTEGER DEFAULT 0,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
    )''')

    c.execute('''CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        direction TEXT,
        description TEXT,
        assignee_id INTEGER,
        participants TEXT,
        priority TEXT DEFAULT 'Средний',
        status TEXT DEFAULT 'Новая',
        deadline TEXT,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP,
        FOREIGN KEY (assignee_id) REFERENCES players(id) ON DELETE SET NULL
    )''')

    c.execute('''CREATE TABLE questionnaires (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER,
        raw_text TEXT,
        parsed_data TEXT,
        status TEXT DEFAULT 'Новая',
        processed INTEGER DEFAULT 0,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
    )''')

    c.execute('''CREATE TABLE player_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        note_type TEXT DEFAULT 'Доп. информация',
        content TEXT NOT NULL,
        source TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    )''')

    c.execute('''CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER,
        account_nick TEXT,
        direction TEXT,
        message_text TEXT NOT NULL,
        message_date TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
    )''')

    conn.commit()
    conn.close()
    print(f"Database initialized: {DB_PATH}")


if __name__ == '__main__':
    init_db()
