from flask import Blueprint, render_template, session, redirect, url_for, request, flash
from utils.db import get_db
from config import ACCESS_LEVELS

admin = Blueprint('admin', __name__)


@admin.route('/admin/roles')
def roles():
    if 'user_id' not in session or session.get('access_level', 0) < 7:
        flash('Нет прав', 'danger')
        return redirect(url_for('dashboard.index'))
    db = get_db()
    levels = []
    for level_id, level_info in ACCESS_LEVELS.items():
        count = db.execute(
            'SELECT COUNT(*) FROM players WHERE access_level = ?', (level_id,)
        ).fetchone()[0]
        levels.append({
            'id': level_id,
            'level_name': level_info['name'],
            'description': level_info['description'],
            'player_count': count
        })
    players_list = db.execute('SELECT id, nick, role FROM players ORDER BY nick').fetchall()
    db.close()
    return render_template('admin/roles.html', levels=levels, players=players_list)


@admin.route('/admin/roles/assign', methods=['POST'])
def assign_role():
    if 'user_id' not in session or session.get('access_level', 0) < 7:
        flash('Нет прав', 'danger')
        return redirect(url_for('dashboard.index'))
    player_id = request.form.get('player_id')
    access_level = request.form.get('access_level')
    if player_id and access_level:
        db = get_db()
        db.execute('UPDATE players SET access_level = ? WHERE id = ?', (access_level, player_id))
        db.commit()
        db.close()
        flash('Роль назначена', 'success')
    return redirect(url_for('admin.roles'))
