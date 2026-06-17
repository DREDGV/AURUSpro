from flask import Blueprint, render_template, session, redirect, url_for, request, flash
from utils.db import get_db

accounts = Blueprint('accounts', __name__)


@accounts.route('/accounts')
def list():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    all_accounts = db.execute(
        'SELECT a.*, p.nick as player_nick, p.name as player_name, p.country as player_country FROM accounts a '
        'JOIN players p ON a.player_id = p.id ORDER BY p.nick, a.account_type DESC, a.points DESC'
    ).fetchall()
    db.close()
    return render_template('accounts/list.html', accounts=all_accounts)


@accounts.route('/accounts/create', methods=['GET', 'POST'])
def create():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        data['points'] = int(data.get('points', 0) or 0)
        db = get_db()
        db.execute(
            '''INSERT INTO accounts (player_id, nick, race, account_type, points, coordinates, purpose, activity, confirmed, comment)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (data['player_id'], data['nick'], data.get('race'), data.get('account_type', 'Основной'),
             data.get('points', 0), data.get('coordinates'), data.get('purpose'),
             data.get('activity', 'Неизвестно'), 1 if data.get('confirmed') else 0,
             data.get('comment'))
        )
        db.commit()
        db.close()
        flash('Аккаунт добавлен', 'success')
        return redirect(url_for('accounts.list'))
    return render_template('accounts/form.html', account=None)


@accounts.route('/accounts/<int:account_id>/edit', methods=['GET', 'POST'])
def edit(account_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    account = db.execute('SELECT * FROM accounts WHERE id = ?', (account_id,)).fetchone()
    if not account:
        flash('Аккаунт не найден', 'danger')
        db.close()
        return redirect(url_for('accounts.list'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        data['points'] = int(data.get('points', 0) or 0)
        fields = []
        values = []
        for key, value in data.items():
            fields.append(f'{key} = ?')
            values.append(value)
        values.append(account_id)
        db.execute(
            f"UPDATE accounts SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            values
        )
        db.commit()
        db.close()
        flash('Аккаунт обновлён', 'success')
        return redirect(url_for('accounts.list'))
    db.close()
    return render_template('accounts/form.html', account=account)
