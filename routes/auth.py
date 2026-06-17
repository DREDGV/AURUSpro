from flask import Blueprint, render_template, request, redirect, url_for, session, flash
from werkzeug.security import generate_password_hash, check_password_hash
from utils.db import get_db

auth = Blueprint('auth', __name__)


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
        db.close()

        if user and check_password_hash(user['password_hash'], password):
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['access_level'] = user['access_level']
            session['role_name'] = user['role_name']
            session['player_id'] = user['player_id']
            flash('Добро пожаловать!', 'success')
            return redirect(url_for('dashboard.index'))

        flash('Неверный логин или пароль', 'danger')

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

        db = get_db()
        existing = db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
        if existing:
            flash('Пользователь уже существует', 'danger')
            db.close()
            return render_template('login.html', register=True)

        db.execute(
            'INSERT INTO users (username, password_hash, access_level) VALUES (?, ?, 1)',
            (username, generate_password_hash(password))
        )
        db.commit()
        db.close()
        flash('Регистрация успешна. Войдите.', 'success')
        return redirect(url_for('auth.login'))

    return render_template('login.html', register=True)
