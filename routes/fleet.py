from flask import Blueprint, render_template, session, redirect, url_for, request, flash
from utils.db import get_db

fleet = Blueprint('fleet', __name__)


@fleet.route('/fleet')
def list():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    race_filter = request.args.get('race', '')
    query_str = request.args.get('q', '')
    query = ('SELECT f.*, p.nick as player_nick FROM fleet f '
             'JOIN players p ON f.player_id = p.id WHERE 1=1')
    params = []
    if race_filter:
        query += ' AND f.race = ?'
        params.append(race_filter)
    if query_str:
        query += ' AND (p.nick LIKE ? OR f.account_nick LIKE ?)'
        params.extend([f'%{query_str}%', f'%{query_str}%'])
    query += ' ORDER BY f.combat_power DESC'
    ships = db.execute(query, params).fetchall()

    total_combat = db.execute('SELECT COALESCE(SUM(combat_power), 0) FROM fleet').fetchone()[0]
    total_slave = db.execute('SELECT COALESCE(SUM(slave_fleet), 0) FROM fleet').fetchone()[0]
    ship_count = db.execute('SELECT COUNT(*) FROM fleet').fetchone()[0]
    players_count = db.execute('SELECT COUNT(DISTINCT player_id) FROM fleet').fetchone()[0]

    db.close()
    return render_template('fleet/list.html', ships=ships,
        total_combat=total_combat, total_slave=total_slave,
        ship_count=ship_count, players_count=players_count,
        current_race=race_filter, current_q=query_str)


@fleet.route('/fleet/create', methods=['GET', 'POST'])
def create():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db.execute(
            '''INSERT INTO fleet (player_id, account_nick, race, combat_power, slave_fleet,
               can_attack, can_slaves, can_lunar, can_clean_worms, data_reliability, comment)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (data['player_id'], data.get('account_nick'), data.get('race'),
             int(data.get('combat_power', 0) or 0), int(data.get('slave_fleet', 0) or 0),
             1 if data.get('can_attack') else 0, 1 if data.get('can_slaves') else 0,
             1 if data.get('can_lunar') else 0, 1 if data.get('can_clean_worms') else 0,
             data.get('data_reliability', 'Приблизительно'), data.get('comment'))
        )
        db.commit()
        db.close()
        flash('Запись флота создана', 'success')
        return redirect(url_for('fleet.list'))
    players = db.execute('SELECT id, nick FROM players ORDER BY nick').fetchall()
    db.close()
    return render_template('fleet/form.html', ship=None, players=players)


@fleet.route('/fleet/<int:ship_id>/edit', methods=['GET', 'POST'])
def edit(ship_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ship = db.execute('SELECT * FROM fleet WHERE id = ?', (ship_id,)).fetchone()
    if not ship:
        flash('Запись не найдена', 'danger')
        db.close()
        return redirect(url_for('fleet.list'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db.execute(
            '''UPDATE fleet SET player_id=?, account_nick=?, race=?, combat_power=?, slave_fleet=?,
               can_attack=?, can_slaves=?, can_lunar=?, can_clean_worms=?, data_reliability=?, comment=?,
               updated_at=CURRENT_TIMESTAMP WHERE id=?''',
            (data['player_id'], data.get('account_nick'), data.get('race'),
             int(data.get('combat_power', 0) or 0), int(data.get('slave_fleet', 0) or 0),
             1 if data.get('can_attack') else 0, 1 if data.get('can_slaves') else 0,
             1 if data.get('can_lunar') else 0, 1 if data.get('can_clean_worms') else 0,
             data.get('data_reliability', 'Приблизительно'), data.get('comment'), ship_id)
        )
        db.commit()
        db.close()
        flash('Запись обновлена', 'success')
        return redirect(url_for('fleet.list'))
    players = db.execute('SELECT id, nick FROM players ORDER BY nick').fetchall()
    db.close()
    return render_template('fleet/form.html', ship=ship, players=players)


@fleet.route('/fleet/<int:ship_id>/delete', methods=['POST'])
def delete(ship_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    db.execute('DELETE FROM fleet WHERE id = ?', (ship_id,))
    db.commit()
    db.close()
    flash('Запись удалена', 'success')
    return redirect(url_for('fleet.list'))
