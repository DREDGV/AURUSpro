from flask import Blueprint, render_template, session, redirect, url_for, request, flash
from utils.db import get_db

game_objects = Blueprint('game_objects', __name__)


@game_objects.route('/objects')
def list():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    obj_type = request.args.get('type', '')
    query_str = request.args.get('q', '')
    q = 'SELECT o.id, o.player_id, o.object_type, o.name, o.coordinates, o.sector, o.level, o.value, o.status, o.controlled, o.needs_protection, o.needs_development, o.comment, p.nick as player_nick FROM game_objects o LEFT JOIN players p ON o.player_id = p.id WHERE 1=1'
    params = []
    if obj_type:
        q += ' AND o.object_type = ?'
        params.append(obj_type)
    if query_str:
        q += ' AND (o.name LIKE ? OR o.coordinates LIKE ?)'
        params.extend([f'%{query_str}%', f'%{query_str}%'])
    q += ' ORDER BY o.name'
    objects = db.execute(q, params).fetchall()

    total = db.execute('SELECT COUNT(*) FROM game_objects').fetchone()[0]
    by_type = {}
    for row in db.execute('SELECT object_type, COUNT(*) as cnt FROM game_objects GROUP BY object_type').fetchall():
        by_type[row['object_type']] = row['cnt']

    db.close()
    return render_template('objects/list.html', objects=objects, total=total,
        by_type=by_type, current_type=obj_type, current_q=query_str)


@game_objects.route('/objects/create', methods=['GET', 'POST'])
def create():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db.execute(
            '''INSERT INTO game_objects (player_id, object_type, name, coordinates, sector, level, value, status, controlled, needs_protection, needs_development, comment)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (data.get('player_id') or None, data['object_type'], data.get('name'),
             data.get('coordinates'), data.get('sector'), int(data.get('level', 1) or 1),
             data.get('value'), data.get('status', 'Активен'),
             1 if data.get('controlled') else 0,
             1 if data.get('needs_protection') else 0,
             1 if data.get('needs_development') else 0,
             data.get('comment'))
        )
        db.commit()
        db.close()
        flash('Объект добавлен', 'success')
        return redirect(url_for('game_objects.list'))
    players = db.execute('SELECT id, nick FROM players ORDER BY nick').fetchall()
    db.close()
    return render_template('objects/form.html', obj=None, players=players)


@game_objects.route('/objects/<int:obj_id>/edit', methods=['GET', 'POST'])
def edit(obj_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    obj = db.execute('SELECT * FROM game_objects WHERE id = ?', (obj_id,)).fetchone()
    if not obj:
        flash('Объект не найден', 'danger')
        db.close()
        return redirect(url_for('game_objects.list'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db.execute(
            '''UPDATE game_objects SET player_id=?, object_type=?, name=?, coordinates=?, sector=?, level=?,
               value=?, status=?, controlled=?, needs_protection=?, needs_development=?, comment=?,
               updated_at=CURRENT_TIMESTAMP WHERE id=?''',
            (data.get('player_id') or None, data['object_type'], data.get('name'),
             data.get('coordinates'), data.get('sector'), int(data.get('level', 1) or 1),
             data.get('value'), data.get('status', 'Активен'),
             1 if data.get('controlled') else 0,
             1 if data.get('needs_protection') else 0,
             1 if data.get('needs_development') else 0,
             data.get('comment'), obj_id)
        )
        db.commit()
        db.close()
        flash('Объект обновлён', 'success')
        return redirect(url_for('game_objects.list'))
    players = db.execute('SELECT id, nick FROM players ORDER BY nick').fetchall()
    db.close()
    return render_template('objects/form.html', obj=obj, players=players)


@game_objects.route('/objects/<int:obj_id>/delete', methods=['POST'])
def delete(obj_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    db.execute('DELETE FROM game_objects WHERE id = ?', (obj_id,))
    db.commit()
    db.close()
    flash('Объект удалён', 'success')
    return redirect(url_for('game_objects.list'))
