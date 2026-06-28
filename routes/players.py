from flask import Blueprint, render_template, session, redirect, url_for, request, flash
from utils.db import get_db
from utils.schema import ensure_alliance_schema

players = Blueprint('players', __name__)


@players.route('/players')
def list():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    query = request.args.get('q', '')
    status = request.args.get('status', '')
    db = get_db()
    ensure_alliance_schema(db)
    if query:
        all_players = db.execute(
            'SELECT p.*, (SELECT GROUP_CONCAT(DISTINCT a.race) FROM accounts a WHERE a.player_id = p.id) as races '
            'FROM players p WHERE p.nick LIKE ? OR p.name LIKE ? ORDER BY p.points DESC',
            (f'%{query}%', f'%{query}%')
        ).fetchall()
    else:
        all_players = db.execute(
            'SELECT p.*, (SELECT GROUP_CONCAT(DISTINCT a.race) FROM accounts a WHERE a.player_id = p.id) as races '
            'FROM players p ORDER BY p.points DESC'
        ).fetchall()
    total = len(all_players)
    if status:
        all_players = [p for p in all_players if p['player_status'] == status]
    db.close()
    return render_template('players/list.html', players=all_players, total=total)


@players.route('/players/<int:player_id>')
def card(player_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    player = db.execute('SELECT * FROM players WHERE id = ?', (player_id,)).fetchone()
    if not player:
        flash('Игрок не найден', 'danger')
        db.close()
        return redirect(url_for('players.list'))
    accounts = db.execute('SELECT * FROM accounts WHERE player_id = ?', (player_id,)).fetchall()
    notes = db.execute('SELECT * FROM player_notes WHERE player_id = ? ORDER BY created_at DESC', (player_id,)).fetchall()
    messages = db.execute('SELECT * FROM messages WHERE player_id = ? ORDER BY created_at DESC', (player_id,)).fetchall()
    player_fleet = db.execute('SELECT * FROM fleet WHERE player_id = ?', (player_id,)).fetchall()
    player_objects = db.execute('SELECT * FROM game_objects WHERE player_id = ?', (player_id,)).fetchall()
    player_tasks = db.execute(
        'SELECT * FROM tasks WHERE assignee_id = ? ORDER BY created_at DESC LIMIT 12',
        (player_id,)
    ).fetchall()
    db.close()
    return render_template('players/card.html', player=player, accounts=accounts, notes=notes, messages=messages,
        player_fleet=player_fleet, player_objects=player_objects, player_tasks=player_tasks)


@players.route('/players/create', methods=['GET', 'POST'])
def create():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        data['points'] = int(data.get('points', 0) or 0)
        data['willing_to_help'] = 1 if data.get('willing_to_help') else 0
        data['needs_help'] = 1 if data.get('needs_help') else 0
        db = get_db()
        try:
            db.execute(
                '''INSERT INTO players (nick, name, how_to_address, country, city, timezone,
                   status, role, access_level, rank_in_game, points, rating1, rating2, rating3,
                   planets, coordinates, registration_date, last_online, activity, player_status,
                   willing_to_help, needs_help, trust_level, comment, direction)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (data['nick'], data.get('name'), data.get('how_to_address'),
                 data.get('country'), data.get('city'), data.get('timezone'),
                 data.get('status', 'Новичок'), data.get('role'),
                 data.get('access_level', 1), data.get('rank_in_game'),
                 data.get('points', 0), data.get('rating1'), data.get('rating2'),
                 data.get('rating3'), data.get('planets'), data.get('coordinates'),
                 data.get('registration_date'), data.get('last_online'),
                 data.get('activity', 'Неизвестно'), data.get('player_status', 'Новичок'),
                 data.get('willing_to_help', 0), data.get('needs_help', 0),
                 data.get('trust_level', 'Обычный'), data.get('comment'),
                 data.get('direction'))
            )
            db.commit()
            player_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
            db.close()
            flash(f'Игрок {data["nick"]} создан', 'success')
            return redirect(url_for('players.card', player_id=player_id))
        except Exception as e:
            db.close()
            flash(f'Ошибка: {e}', 'danger')
    return render_template('players/card.html', player=None, accounts=[], notes=[], messages=[], edit_mode=True)


@players.route('/players/<int:player_id>/edit', methods=['GET', 'POST'])
def edit(player_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    player = db.execute('SELECT * FROM players WHERE id = ?', (player_id,)).fetchone()
    if not player:
        flash('Игрок не найден', 'danger')
        db.close()
        return redirect(url_for('players.list'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        data['points'] = int(data.get('points', 0) or 0)
        data['willing_to_help'] = 1 if data.get('willing_to_help') else 0
        data['needs_help'] = 1 if data.get('needs_help') else 0
        fields = []
        values = []
        for key, value in data.items():
            fields.append(f'{key} = ?')
            values.append(value)
        values.append(player_id)
        db.execute(
            f"UPDATE players SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            values
        )
        db.commit()
        flash('Данные обновлены', 'success')
        return redirect(url_for('players.card', player_id=player_id))
    accounts = db.execute('SELECT * FROM accounts WHERE player_id = ?', (player_id,)).fetchall()
    notes = db.execute('SELECT * FROM player_notes WHERE player_id = ? ORDER BY created_at DESC', (player_id,)).fetchall()
    messages = db.execute('SELECT * FROM messages WHERE player_id = ? ORDER BY created_at DESC', (player_id,)).fetchall()
    db.close()
    return render_template('players/card.html', player=player, accounts=accounts, notes=notes, messages=messages, edit_mode=True)
