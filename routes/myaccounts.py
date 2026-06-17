from flask import Blueprint, render_template, session, redirect, url_for, request, flash, jsonify
from utils.db import get_db

myaccounts = Blueprint('myaccounts', __name__)


@myaccounts.route('/my')
def index():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (session['user_id'],)).fetchone()
    my_accounts = []
    if user and user['player_id']:
        my_accounts = db.execute(
            "SELECT * FROM accounts WHERE player_id = ?", (user['player_id'],)
        ).fetchall()
    all_players = db.execute(
        "SELECT id, nick, name FROM players ORDER BY nick"
    ).fetchall()
    db.close()
    return render_template('myaccounts/index.html', accounts=my_accounts, players=all_players, user=user)


@myaccounts.route('/my/add', methods=['POST'])
def add_account():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    data = {k: v for k, v in request.form.items()}
    player_id = data.get('player_id')
    if not player_id:
        flash('Выберите игрока', 'warning')
        return redirect(url_for('myaccounts.index'))
    db = get_db()
    db.execute(
        '''INSERT INTO accounts (player_id, nick, race, account_type, points, coordinates, activity, confirmed)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)''',
        (player_id, data['nick'], data.get('race'), data.get('account_type', 'Основной'),
         data.get('points', 0), data.get('coordinates'), data.get('activity', 'Неизвестно'))
    )
    db.commit()
    db.close()
    flash(f'Аккаунт {data["nick"]} добавлен', 'success')
    return redirect(url_for('myaccounts.index'))


@myaccounts.route('/my/<int:account_id>/edit', methods=['POST'])
def edit_account(account_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    data = {k: v for k, v in request.form.items()}
    db = get_db()
    fields = []
    values = []
    for key in ['nick', 'race', 'account_type', 'points', 'coordinates', 'activity', 'purpose', 'comment']:
        if key in data:
            fields.append(f'{key} = ?')
            values.append(data[key])
    if fields:
        values.append(account_id)
        db.execute(f"UPDATE accounts SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", values)
    db.commit()
    db.close()
    flash('Аккаунт обновлён', 'success')
    return redirect(url_for('myaccounts.index'))


@myaccounts.route('/my/stats')
def stats():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (session['user_id'],)).fetchone()
    my_accounts = []
    player_data = None
    if user and user['player_id']:
        my_accounts = db.execute(
            "SELECT * FROM accounts WHERE player_id = ?", (user['player_id'],)
        ).fetchall()
        player_data = db.execute(
            "SELECT * FROM players WHERE id = ?", (user['player_id'],)
        ).fetchone()

    total_points = sum(a['points'] or 0 for a in my_accounts)
    races = {}
    for a in my_accounts:
        r = a['race'] or 'Неизвестно'
        races[r] = races.get(r, 0) + 1

    db.close()
    return render_template('myaccounts/stats.html',
        accounts=my_accounts, player=player_data,
        total_points=total_points, races=races)
