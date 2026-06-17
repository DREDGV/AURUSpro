from flask import Blueprint, render_template, session, redirect, url_for
from utils.db import get_db
from config import ACCESS_LEVELS

dashboard = Blueprint('dashboard', __name__)


@dashboard.route('/dashboard')
def index():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    total_players = db.execute('SELECT COUNT(*) FROM players').fetchone()[0]
    total_accounts = db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]
    active_today = db.execute("SELECT COUNT(*) FROM players WHERE activity LIKE '%Активен%'").fetchone()[0]
    inactive_count = total_players - active_today
    open_tasks = db.execute("SELECT COUNT(*) FROM tasks WHERE status IN ('Новая', 'В работе')").fetchone()[0]
    critical_tasks = db.execute("SELECT COUNT(*) FROM tasks WHERE priority = 'Критический' AND status != 'Выполнена'").fetchone()[0]

    top_players = db.execute(
        'SELECT p.id, p.nick, p.rank_in_game, p.role, p.activity, '
        '(SELECT GROUP_CONCAT(DISTINCT a.race) FROM accounts a WHERE a.player_id = p.id) as races '
        'FROM players p ORDER BY p.points DESC LIMIT 8'
    ).fetchall()

    recent_tasks = db.execute(
        'SELECT t.*, p.nick as assignee_nick FROM tasks t '
        'LEFT JOIN players p ON t.assignee_id = p.id '
        'ORDER BY CASE t.priority WHEN "Критический" THEN 0 WHEN "Высокий" THEN 1 ELSE 2 END '
        'LIMIT 6'
    ).fetchall()

    access_levels = [
        {'id': lid, 'level_name': info['name'], 'description': info['description']}
        for lid, info in ACCESS_LEVELS.items()
    ]

    db.close()
    return render_template('dashboard.html',
                           total_players=total_players,
                           total_accounts=total_accounts,
                           active_today=active_today,
                           inactive_count=inactive_count,
                           open_tasks=open_tasks,
                           critical_tasks=critical_tasks,
                           top_players=top_players,
                           recent_tasks=recent_tasks,
                           access_levels=access_levels)
