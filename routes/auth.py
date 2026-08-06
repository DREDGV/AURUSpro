from flask import Blueprint, render_template, request, redirect, url_for, session, flash
from werkzeug.security import generate_password_hash, check_password_hash
import secrets
from datetime import datetime, timedelta
from utils.db import get_db
import re

auth = Blueprint('auth', __name__)


def is_valid_password(password):
    """Проверка сложности пароля: минимум 8 символов, цифры и спецсимволы"""
    if len(password) < 8:
        return False
    if not re.search(r'\d', password):
        return False
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False
    return True


def is_user_locked(user):
    """Проверка, заблокирован ли пользователь"""
    if user['locked_until']:
        locked_until = datetime.fromisoformat(user['locked_until'])
        if datetime.now() < locked_until:
            return True
    return False


@auth.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        db = get_db()
        user = db.execute(
            'SELECT u.*, a.level_name as role_name FROM users u '
            'JOIN access_levels a ON u.access_level = a.id '
            'WHERE u.username = ?', (username,)
        ).fetchone()
        
        if not user:
            flash('Неверный логин или пароль', 'danger')
            db.close()
            return render_template('login.html')
        
        # Проверка блокировки
        if is_user_locked(user):
            flash(f'Аккаунт заблокирован до {user["locked_until"]}', 'danger')
            db.close()
            return render_template('login.html')
        
        # Проверка пароля
        if not check_password_hash(user['password_hash'], password):
            # Увеличение счётчика неудачных попыток
            failed_attempts = (user['failed_login_attempts'] or 0) + 1
            locked_until = None
            
            # Блокировка после 5 неудачных попыток на 15 минут
            if failed_attempts >= 5:
                locked_until = (datetime.now() + timedelta(minutes=15)).isoformat()
                flash('Аккаунт заблокирован на 15 минут из-за множественных неудачных попыток входа', 'danger')
            else:
                flash(f'Неверный пароль. Осталось попыток: {5 - failed_attempts}', 'danger')
            
            db.execute(
                'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
                (failed_attempts, locked_until, user['id'])
            )
            db.commit()
            db.close()
            return render_template('login.html')
        
        # Успешный вход - сброс счётчиков
        db.execute(
            'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP WHERE id = ?',
            (user['id'],)
        )
        db.commit()
        db.close()

        session['user_id'] = user['id']
        session['username'] = user['username']
        session['access_level'] = user['access_level']
        session['role_name'] = user['role_name']
        session['player_id'] = user['player_id']
        session['is_super_admin'] = bool(user['is_super_admin'])
        flash('Добро пожаловать!', 'success')
        return redirect(url_for('dashboard.index'))

    return render_template('login.html')


@auth.route('/logout')
def logout():
    session.clear()
    flash('Вы вышли из системы', 'info')
    return redirect(url_for('auth.login'))


@auth.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        email = request.form.get('email', '').strip()

        # Проверка сложности пароля
        if not is_valid_password(password):
            flash('Пароль должен быть не менее 8 символов, содержать цифры и спецсимволы (!@#$%^&*)', 'danger')
            return render_template('login.html', register=True)

        db = get_db()
        existing = db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
        if existing:
            flash('Пользователь уже существует', 'danger')
            db.close()
            return render_template('login.html', register=True)

        db.execute(
            'INSERT INTO users (username, password_hash, access_level, email) VALUES (?, ?, 1, ?)',
            (username, generate_password_hash(password), email if email else None)
        )
        db.commit()
        db.close()
        flash('Регистрация успешна. Войдите.', 'success')
        return redirect(url_for('auth.login'))

    return render_template('login.html', register=True)


@auth.route('/forgot_password', methods=['GET', 'POST'])
def forgot_password():
    """Запрос на восстановление пароля"""
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        
        db = get_db()
        user = db.execute(
            'SELECT id, username, email FROM users WHERE username = ? OR email = ?',
            (username, email if email else '')
        ).fetchone()
        
        if user:
            # Генерация токена восстановления
            reset_token = secrets.token_urlsafe(32)
            reset_expires = (datetime.now() + timedelta(hours=24)).isoformat()
            
            db.execute(
                'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
                (reset_token, reset_expires, user['id'])
            )
            db.commit()
            db.close()
            
            # В реальном проекте здесь была бы отправка email
            # Для демонстрации показываем ссылку в сообщении
            reset_link = url_for('auth.reset_password', token=reset_token, _external=True)
            flash(f'Ссылка для сброса пароля: {reset_link} (действует 24 часа)', 'info')
            return redirect(url_for('auth.login'))
        
        db.close()
        # Не показываем, существует ли пользователь (безопасность)
        flash('Если пользователь существует, ссылка для сброса отправлена', 'info')
    
    return render_template('forgot_password.html')


@auth.route('/reset_password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    """Сброс пароля по токену"""
    db = get_db()
    user = db.execute(
        'SELECT id, username, reset_token, reset_token_expires FROM users WHERE reset_token = ?',
        (token,)
    ).fetchone()
    
    if not user:
        flash('Неверный токен сброса', 'danger')
        db.close()
        return redirect(url_for('auth.forgot_password'))
    
    # Проверка времени действия токена
    if user['reset_token_expires']:
        expires = datetime.fromisoformat(user['reset_token_expires'])
        if datetime.now() > expires:
            flash('Срок действия токена истёк', 'danger')
            db.close()
            return redirect(url_for('auth.forgot_password'))
    
    if request.method == 'POST':
        new_password = request.form.get('password')
        confirm_password = request.form.get('confirm_password')
        
        if new_password != confirm_password:
            flash('Пароли не совпадают', 'danger')
            db.close()
            return render_template('reset_password.html', token=token)
        
        if not is_valid_password(new_password):
            flash('Пароль должен быть не менее 8 символов, содержать цифры и спецсимволы', 'danger')
            db.close()
            return render_template('reset_password.html', token=token)
        
        # Обновление пароля
        password_hash = generate_password_hash(new_password)
        db.execute(
            'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
            (password_hash, user['id'])
        )
        db.commit()
        db.close()
        
        flash('Пароль успешно изменён. Войдите с новым паролем', 'success')
        return redirect(url_for('auth.login'))
    
    db.close()
    return render_template('reset_password.html', token=token)
