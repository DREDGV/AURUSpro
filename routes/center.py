from flask import Blueprint, render_template, session, redirect, url_for, request, flash, jsonify
from utils.db import get_db
from utils.schema import ensure_alliance_schema
from routes.map import _existing_alstations, _network_issue_payload
import json

center = Blueprint('center', __name__)


@center.route('/center')
def index():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)

    pending_requests = db.execute(
        "SELECT r.*, p.nick as player_nick FROM requests r "
        "LEFT JOIN players p ON r.player_id = p.id "
        "WHERE r.status = 'Новый' ORDER BY "
        "CASE r.priority WHEN 'Критический' THEN 0 WHEN 'Высокий' THEN 1 WHEN 'Средний' THEN 2 ELSE 3 END"
    ).fetchall()

    recent_decisions = db.execute(
        "SELECT * FROM decisions ORDER BY "
        "CASE status WHEN 'Предложено' THEN 0 WHEN 'Согласовано' THEN 1 ELSE 2 END, "
        "created_at DESC LIMIT 5"
    ).fetchall()

    recent_log = db.execute(
        "SELECT * FROM alliance_log ORDER BY created_at DESC LIMIT 8"
    ).fetchall()

    open_topics = db.execute(
        "SELECT * FROM alliance_topics WHERE status = 'Открыто'"
    ).fetchall()

    unanswered_count = db.execute(
        "SELECT COUNT(*) FROM players WHERE name IS NULL OR name = ''"
    ).fetchone()[0]

    total_players = db.execute("SELECT COUNT(*) FROM players").fetchone()[0]
    active_players = db.execute(
        "SELECT COUNT(*) FROM players WHERE activity LIKE '%Активен%'"
    ).fetchone()[0]

    total_requests = db.execute("SELECT COUNT(*) FROM requests").fetchone()[0]
    resolved_requests = db.execute(
        "SELECT COUNT(*) FROM requests WHERE status IN ('Выполнен', 'Отклонён')"
    ).fetchone()[0]

    help_needed = db.execute(
        "SELECT id, nick, needs_help_with FROM players "
        "WHERE needs_help_with IS NOT NULL AND needs_help_with != ''"
    ).fetchall()

    open_tasks = db.execute(
        """SELECT t.*, p.nick as assignee_nick
           FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id
           WHERE t.status IS NULL OR t.status NOT IN ('Выполнена', 'Отменена')
           ORDER BY CASE t.priority WHEN 'Критический' THEN 0 WHEN 'Высокий' THEN 1 WHEN 'Средний' THEN 2 ELSE 3 END,
                    t.created_at DESC
           LIMIT 8"""
    ).fetchall()
    map_tasks = db.execute(
        """SELECT t.*, p.nick as assignee_nick
           FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id
           WHERE t.coordinates IS NOT NULL AND t.coordinates != ''
             AND (t.status IS NULL OR t.status NOT IN ('Выполнена', 'Отменена'))
           ORDER BY t.created_at DESC
           LIMIT 6"""
    ).fetchall()
    network_issues = [
        _network_issue_payload(station)
        for station in _existing_alstations(db)
        if station.get('network_status') in ('signal_only', 'isolated')
    ]

    db.close()
    return render_template('center/index.html',
        pending_requests=pending_requests,
        recent_decisions=recent_decisions,
        recent_log=recent_log,
        open_topics=open_topics,
        unanswered_count=unanswered_count,
        total_players=total_players,
        active_players=active_players,
        total_requests=total_requests,
        resolved_requests=resolved_requests,
        help_needed=help_needed,
        open_tasks=open_tasks,
        map_tasks=map_tasks,
        network_issues=network_issues)


@center.route('/center/decisions')
def decisions():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    all_decisions = db.execute(
        "SELECT * FROM decisions ORDER BY "
        "CASE status WHEN 'Предложено' THEN 0 WHEN 'Согласовано' THEN 1 WHEN 'Выполнено' THEN 2 ELSE 3 END, "
        "created_at DESC"
    ).fetchall()
    db.close()
    return render_template('center/decisions.html', decisions=all_decisions)


@center.route('/center/decisions/<int:decision_id>')
def decision_detail(decision_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    decision = db.execute("SELECT * FROM decisions WHERE id = ?", (decision_id,)).fetchone()
    if not decision:
        flash('Решение не найдено', 'danger')
        db.close()
        return redirect(url_for('center.decisions'))
    related_log = db.execute(
        "SELECT * FROM alliance_log WHERE title LIKE ? ORDER BY created_at DESC LIMIT 5",
        (f'%{decision["title"][:30]}%',)
    ).fetchall()
    db.close()
    return render_template('center/decision_detail.html', decision=decision, related_log=related_log)


@center.route('/center/decisions/<int:decision_id>/update', methods=['POST'])
def update_decision(decision_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    data = {k: v for k, v in request.form.items()}
    db = get_db()
    fields = []
    values = []
    for key in ['status', 'result', 'priority', 'deadline']:
        if key in data:
            fields.append(f'{key} = ?')
            values.append(data[key])
    values.append(decision_id)
    db.execute(f"UPDATE decisions SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", values)
    db.commit()
    db.close()
    flash('Решение обновлено', 'success')
    return redirect(url_for('center.decision_detail', decision_id=decision_id))


@center.route('/center/decisions/create', methods=['GET', 'POST'])
def create_decision():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db = get_db()
        db.execute(
            '''INSERT INTO decisions (title, proposer, description, status, priority, deadline, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (data['title'], data.get('proposer'), data.get('description'),
             data.get('status', 'Предложено'), data.get('priority', 'Средний'),
             data.get('deadline'), session.get('username'))
        )
        db.commit()
        db.close()
        flash('Решение создано', 'success')
        return redirect(url_for('center.decisions'))
    return render_template('center/decision_form.html')


@center.route('/center/requests')
def requests_list():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    status_filter = request.args.get('status', '')
    type_filter = request.args.get('type', '')
    db = get_db()
    query = "SELECT r.*, p.nick as player_nick FROM requests r LEFT JOIN players p ON r.player_id = p.id WHERE 1=1"
    params = []
    if status_filter:
        query += " AND r.status = ?"
        params.append(status_filter)
    if type_filter:
        query += " AND r.request_type = ?"
        params.append(type_filter)
    query += " ORDER BY CASE r.status WHEN 'Новый' THEN 0 WHEN 'В работе' THEN 1 WHEN 'На паузе' THEN 2 WHEN 'Ожидает' THEN 3 WHEN 'Выполнен' THEN 4 ELSE 5 END, CASE r.priority WHEN 'Критический' THEN 0 WHEN 'Высокий' THEN 1 WHEN 'Средний' THEN 2 ELSE 3 END, r.created_at DESC"
    all_requests = db.execute(query, params).fetchall()
    stats = {
        'total': db.execute("SELECT COUNT(*) FROM requests").fetchone()[0],
        'new': db.execute("SELECT COUNT(*) FROM requests WHERE status = 'Новый'").fetchone()[0],
        'in_work': db.execute("SELECT COUNT(*) FROM requests WHERE status = 'В работе'").fetchone()[0],
        'paused': db.execute("SELECT COUNT(*) FROM requests WHERE status = 'На паузе'").fetchone()[0],
        'resolved': db.execute("SELECT COUNT(*) FROM requests WHERE status IN ('Выполнен', 'Отклонён')").fetchone()[0],
    }
    db.close()
    return render_template('center/requests.html', requests=all_requests, stats=stats,
        current_status=status_filter, current_type=type_filter)


@center.route('/center/requests/<int:request_id>', methods=['GET'])
def request_detail(request_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    req = db.execute(
        "SELECT r.*, p.nick as player_nick, p.id as player_db_id FROM requests r "
        "LEFT JOIN players p ON r.player_id = p.id WHERE r.id = ?", (request_id,)
    ).fetchone()
    if not req:
        flash('Запрос не найден', 'danger')
        db.close()
        return redirect(url_for('center.requests_list'))
    comments = db.execute(
        "SELECT * FROM request_comments WHERE request_id = ? ORDER BY created_at ASC", (request_id,)
    ).fetchall()
    players = db.execute("SELECT id, nick FROM players ORDER BY nick").fetchall()
    db.close()
    return render_template('center/request_detail.html', req=req, comments=comments, players=players)


@center.route('/center/requests/<int:request_id>/update', methods=['POST'])
def update_request(request_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    data = {k: v for k, v in request.form.items()}
    db = get_db()
    fields = []
    values = []
    for key in ['status', 'assignee', 'resolution', 'priority', 'request_type', 'description']:
        if key in data:
            fields.append(f'{key} = ?')
            values.append(data[key])
    if data.get('status') in ('Выполнен', 'Отклонён'):
        fields.append("resolved_at = CURRENT_TIMESTAMP")
    values.append(request_id)
    db.execute(f"UPDATE requests SET {', '.join(fields)} WHERE id = ?", values)

    if data.get('new_comment', '').strip():
        db.execute(
            "INSERT INTO request_comments (request_id, author, comment_text) VALUES (?, ?, ?)",
            (request_id, session.get('username'), data['new_comment'].strip())
        )

    db.commit()
    db.close()
    flash('Запрос обновлён', 'success')
    return redirect(url_for('center.request_detail', request_id=request_id))


@center.route('/center/requests/<int:request_id>/comment', methods=['POST'])
def add_request_comment(request_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    text = request.form.get('comment_text', '').strip()
    if not text:
        flash('Введите комментарий', 'warning')
        return redirect(url_for('center.request_detail', request_id=request_id))
    db = get_db()
    db.execute(
        "INSERT INTO request_comments (request_id, author, comment_text) VALUES (?, ?, ?)",
        (request_id, session.get('username'), text)
    )
    db.commit()
    db.close()
    return redirect(url_for('center.request_detail', request_id=request_id))


@center.route('/center/requests/create', methods=['GET', 'POST'])
def create_request():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db = get_db()
        db.execute(
            '''INSERT INTO requests (player_id, request_type, title, description, priority, status, assignee)
               VALUES (?, ?, ?, ?, ?, 'Новый', ?)''',
            (data.get('player_id') or None, data.get('request_type', 'Другое'),
             data['title'], data.get('description'), data.get('priority', 'Средний'),
             data.get('assignee'))
        )
        db.commit()
        db.close()
        flash('Запрос создан', 'success')
        return redirect(url_for('center.requests_list'))
    db = get_db()
    players = db.execute("SELECT id, nick FROM players ORDER BY nick").fetchall()
    db.close()
    return render_template('center/request_form.html', players=players)


@center.route('/center/log')
def log():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    all_events = db.execute(
        "SELECT * FROM alliance_log ORDER BY created_at DESC"
    ).fetchall()
    db.close()
    return render_template('center/log.html', events=all_events)


@center.route('/center/log/create', methods=['GET', 'POST'])
def create_log():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db = get_db()
        db.execute(
            '''INSERT INTO alliance_log (event_type, title, description, related_player, author, event_date)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (data.get('event_type', 'Прочее'), data['title'], data.get('description'),
             data.get('related_player'), data.get('author', session.get('username')),
             data.get('event_date'))
        )
        db.commit()
        db.close()
        flash('Событие добавлено', 'success')
        return redirect(url_for('center.log'))
    return render_template('center/log_form.html')


@center.route('/center/scan', methods=['POST'])
def scan_profiles():
    return jsonify({'error': 'Автопарсинг отключён. Вводите данные вручную или через скриншоты.'}), 403


@center.route('/center/scan/<int:player_id>', methods=['POST'])
def scan_player(player_id):
    return jsonify({'error': 'Автопарсинг отключён. Вводите данные вручную.'}), 403


@center.route('/center/ajax/request/<int:request_id>/status', methods=['POST'])
def ajax_request_status(request_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Auth required'}), 401
    data = request.get_json()
    new_status = data.get('status')
    if new_status not in ('Новый', 'В работе', 'Выполнен', 'Отклонён'):
        return jsonify({'error': 'Invalid status'}), 400
    db = get_db()
    if new_status in ('Выполнен', 'Отклонён'):
        db.execute("UPDATE requests SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (new_status, request_id))
    else:
        db.execute("UPDATE requests SET status = ? WHERE id = ?", (new_status, request_id))
    db.commit()
    db.close()
    return jsonify({'status': 'ok', 'new_status': new_status})


@center.route('/center/ajax/decision/<int:decision_id>/status', methods=['POST'])
def ajax_decision_status(decision_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Auth required'}), 401
    data = request.get_json()
    new_status = data.get('status')
    if new_status not in ('Предложено', 'Согласовано', 'Выполнено', 'Отменено'):
        return jsonify({'error': 'Invalid status'}), 400
    db = get_db()
    db.execute("UPDATE decisions SET status = ? WHERE id = ?", (new_status, decision_id))
    db.commit()
    db.close()
    return jsonify({'status': 'ok', 'new_status': new_status})


@center.route('/center/ajax/log/quick', methods=['POST'])
def ajax_quick_log():
    if 'user_id' not in session:
        return jsonify({'error': 'Auth required'}), 401
    data = request.get_json()
    db = get_db()
    db.execute(
        '''INSERT INTO alliance_log (event_type, title, description, author, event_date)
           VALUES (?, ?, ?, ?, date('now'))''',
        (data.get('event_type', 'Прочее'), data['title'], data.get('description', ''),
         session.get('username'))
    )
    db.commit()
    db.close()
    return jsonify({'status': 'ok'})


@center.route('/center/ajax/player/<int:player_id>/requests')
def ajax_player_requests(player_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Auth required'}), 401
    db = get_db()
    reqs = db.execute(
        "SELECT id, title, status, priority, request_type, created_at FROM requests "
        "WHERE player_id = ? ORDER BY created_at DESC", (player_id,)
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in reqs])


@center.route('/center/ajax/player/<int:player_id>/log')
def ajax_player_log(player_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Auth required'}), 401
    db = get_db()
    player = db.execute("SELECT nick FROM players WHERE id = ?", (player_id,)).fetchone()
    if not player:
        return jsonify([])
    events = db.execute(
        "SELECT id, event_type, title, event_date, author FROM alliance_log "
        "WHERE related_player = ? ORDER BY created_at DESC", (player['nick'],)
    ).fetchall()
    db.close()
    return jsonify([dict(e) for e in events])
