#!/usr/bin/env python3
"""
CLI-утилита для управления пользователями AURUS Control Panel

Использование:
    python manage_users.py create_admin <username> [password]  # Создать супер-админа
    python manage_users.py list                               # Список всех пользователей
    python manage_users.py unlock <username>                  # Разблокировать пользователя
    python manage_users.py set_level <username> <level>       # Установить уровень доступа
"""

import sys
import os
import sqlite3
from werkzeug.security import generate_password_hash
from config import DB_PATH, ACCESS_LEVELS


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def create_admin(username, password=None):
    """Создать супер-администратора"""
    if not password:
        password = input(f"Введите пароль для пользователя '{username}': ")
    
    if len(password) < 8:
        print("❌ Ошибка: Пароль должен быть не менее 8 символов")
        return False
    
    db = get_db()
    
    # Проверка существования пользователя
    existing = db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
    if existing:
        print(f"⚠️  Пользователь '{username}' уже существует. Повышаю до супер-админа...")
        db.execute(
            'UPDATE users SET is_super_admin = 1, access_level = 7 WHERE username = ?',
            (username,)
        )
        db.commit()
        db.close()
        print(f"✅ Пользователь '{username}' теперь супер-администратор")
        return True
    
    # Создание нового супер-админа
    password_hash = generate_password_hash(password)
    db.execute(
        'INSERT INTO users (username, password_hash, access_level, is_super_admin) VALUES (?, ?, 7, 1)',
        (username, password_hash)
    )
    db.commit()
    db.close()
    
    print(f"✅ Супер-администратор '{username}' успешно создан")
    return True


def list_users():
    """Вывести список всех пользователей"""
    db = get_db()
    users = db.execute(
        '''SELECT u.id, u.username, u.email, a.level_name as role, 
           u.is_super_admin, u.failed_login_attempts, u.locked_until, u.last_login, u.created_at
           FROM users u
           JOIN access_levels a ON u.access_level = a.id
           ORDER BY u.is_super_admin DESC, u.access_level DESC, u.created_at'''
    ).fetchall()
    db.close()
    
    print(f"\n{'ID':<4} {'Username':<20} {'Email':<25} {'Роль':<20} {'Админ':<6} {'Попытки':<8} {'Блок до':<20} {'Посл. вход':<20}")
    print("-" * 140)
    
    for user in users:
        admin = "✅" if user['is_super_admin'] else ""
        locked = user['locked_until'] if user['locked_until'] else ""
        last_login = user['last_login'] if user['last_login'] else "Никогда"
        email = user['email'] if user['email'] else "-"
        print(f"{user['id']:<4} {user['username']:<20} {email:<25} {user['role']:<20} {admin:<6} {user['failed_login_attempts']:<8} {locked:<20} {last_login:<20}")
    
    print(f"\nВсего пользователей: {len(users)}")


def unlock_user(username):
    """Разблокировать пользователя"""
    db = get_db()
    
    user = db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        print(f"❌ Пользователь '{username}' не найден")
        db.close()
        return False
    
    db.execute(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE username = ?',
        (username,)
    )
    db.commit()
    db.close()
    
    print(f"✅ Пользователь '{username}' разблокирован")
    return True


def set_access_level(username, level):
    """Установить уровень доступа пользователю"""
    level = int(level)
    
    if level not in ACCESS_LEVELS:
        print(f"❌ Неверный уровень доступа. Доступные уровни: {list(ACCESS_LEVELS.keys())}")
        return False
    
    db = get_db()
    
    user = db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        print(f"❌ Пользователь '{username}' не найден")
        db.close()
        return False
    
    db.execute(
        'UPDATE users SET access_level = ? WHERE username = ?',
        (level, username)
    )
    db.commit()
    db.close()
    
    role_name = ACCESS_LEVELS[level]['name']
    print(f"✅ Пользователю '{username}' установлен уровень доступа {level} ({role_name})")
    return True


def reset_password(username, new_password=None):
    """Сбросить пароль пользователя"""
    db = get_db()
    
    user = db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        print(f"❌ Пользователь '{username}' не найден")
        db.close()
        return False
    
    if not new_password:
        new_password = input(f"Введите новый пароль для '{username}': ")
    
    if len(new_password) < 8:
        print("❌ Ошибка: Пароль должен быть не менее 8 символов")
        db.close()
        return False
    
    password_hash = generate_password_hash(new_password)
    db.execute(
        'UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE username = ?',
        (password_hash, username)
    )
    db.commit()
    db.close()
    
    print(f"✅ Пароль для пользователя '{username}' успешно изменён")
    return True


def print_help():
    """Вывести справку"""
    print(__doc__)
    print("\nДоступные команды:")
    print("  create_admin <username> [password]  - Создать супер-администратора")
    print("  list                                - Список всех пользователей")
    print("  unlock <username>                   - Разблокировать пользователя")
    print("  set_level <username> <level>        - Установить уровень доступа")
    print("  reset_password <username> [password]- Сбросить пароль")
    print("\nУровни доступа:")
    for level_id, level in ACCESS_LEVELS.items():
        print(f"  {level_id}: {level['name']}")


def main():
    if len(sys.argv) < 2:
        print_help()
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == 'create_admin':
        if len(sys.argv) < 3:
            print("❌ Ошибка: укажите имя пользователя")
            print("Использование: python manage_users.py create_admin <username> [password]")
            sys.exit(1)
        username = sys.argv[2]
        password = sys.argv[3] if len(sys.argv) > 3 else None
        create_admin(username, password)
    
    elif command == 'list':
        list_users()
    
    elif command == 'unlock':
        if len(sys.argv) < 3:
            print("❌ Ошибка: укажите имя пользователя")
            sys.exit(1)
        unlock_user(sys.argv[2])
    
    elif command == 'set_level':
        if len(sys.argv) < 4:
            print("❌ Ошибка: укажите имя пользователя и уровень")
            sys.exit(1)
        set_access_level(sys.argv[2], sys.argv[3])
    
    elif command == 'reset_password':
        if len(sys.argv) < 3:
            print("❌ Ошибка: укажите имя пользователя")
            sys.exit(1)
        password = sys.argv[3] if len(sys.argv) > 3 else None
        reset_password(sys.argv[2], password)
    
    elif command in ['help', '-h', '--help']:
        print_help()
    
    else:
        print(f"❌ Неизвестная команда: {command}")
        print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
