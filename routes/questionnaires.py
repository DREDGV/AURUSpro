from flask import Blueprint, render_template, session, redirect, url_for, request, flash
from utils.db import get_db

questionnaires = Blueprint('questionnaires', __name__)


@questionnaires.route('/questionnaires')
def list():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    items = db.execute(
        'SELECT q.*, p.nick as player_nick FROM questionnaires q '
        'LEFT JOIN players p ON q.player_id = p.id '
        'ORDER BY q.created_at DESC'
    ).fetchall()
    db.close()
    return render_template('questionnaires/list.html', items=items)
