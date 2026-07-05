from flask import Blueprint, render_template, session, redirect, url_for, request, flash, jsonify
from utils.db import get_db
from utils.schema import ensure_alliance_schema
from routes.map import _existing_alstations, _network_issue_payload, _intake_alerts, _work_markers
import json

center = Blueprint('center', __name__)


def _link_intake(db, source_intake_id, target_type, target_id, relation):
    if not source_intake_id:
        return
    db.execute(
        '''INSERT INTO work_links (source_type, source_id, target_type, target_id, relation)
           VALUES ('intake', ?, ?, ?, ?)''',
        (source_intake_id, target_type, target_id, relation),
    )


def _log_request_event(db, req, title, description, event_type='Заявка'):
    db.execute(
        '''INSERT INTO alliance_log (event_type, title, description, related_player, author, event_date,
           coordinates, source_intake_id, related_request_id)
           VALUES (?, ?, ?, ?, ?, date('now'), ?, ?, ?)''',
        (
            event_type,
            title,
            description,
            req['player_nick'] if 'player_nick' in req.keys() else None,
            session.get('username'),
            req['coordinates'] if 'coordinates' in req.keys() else None,
            req['source_intake_id'] if 'source_intake_id' in req.keys() else None,
            req['id'],
        ),
    )
    log_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
    _link_intake(
        db,
        req['source_intake_id'] if 'source_intake_id' in req.keys() else None,
        'log',
        log_id,
        'request_event',
    )


def _log_decision_event(db, decision, title, description, event_type='Решение'):
    db.execute(
        '''INSERT INTO alliance_log (event_type, title, description, related_player, author, event_date,
           coordinates, source_intake_id, related_decision_id)
           VALUES (?, ?, ?, ?, ?, date('now'), ?, ?, ?)''',
        (
            event_type,
            title,
            description,
            decision['proposer'] if 'proposer' in decision.keys() else None,
            session.get('username'),
            decision['coordinates'] if 'coordinates' in decision.keys() else None,
            decision['source_intake_id'] if 'source_intake_id' in decision.keys() else None,
            decision['id'],
        ),
    )
    log_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
    _link_intake(
        db,
        decision['source_intake_id'] if 'source_intake_id' in decision.keys() else None,
        'log',
        log_id,
        'decision_event',
    )


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
    inbox_new = db.execute("SELECT COUNT(*) FROM intake_items WHERE status = 'Новое'").fetchone()[0]
    inbox_pending = db.execute(
        "SELECT COUNT(*) FROM intake_items WHERE status IN ('Разобрано', 'Требует подтверждения')"
    ).fetchone()[0]
    overdue_inbox = db.execute(
        """SELECT COUNT(*) FROM intake_items
           WHERE due_at IS NOT NULL AND due_at < strftime('%Y-%m-%d %H:%M', 'now', 'localtime')
             AND status NOT IN ('Обработано', 'Отклонено')"""
    ).fetchone()[0]
    overdue_tasks = db.execute(
        """SELECT COUNT(*) FROM tasks
           WHERE deadline IS NOT NULL AND deadline != ''
             AND deadline < strftime('%Y-%m-%d %H:%M', 'now', 'localtime')
             AND (status IS NULL OR status NOT IN ('Выполнена', 'Отменена'))"""
    ).fetchone()[0]
    urgent_inbox = db.execute(
        """SELECT i.*, p.nick AS player_nick, ap.nick AS auto_assignee_nick
           FROM intake_items i
           LEFT JOIN players p ON p.id = i.source_player_id
           LEFT JOIN players ap ON ap.id = i.auto_assignee_id
           WHERE i.status NOT IN ('Обработано', 'Отклонено')
           ORDER BY
             CASE WHEN i.due_at IS NOT NULL AND i.due_at < strftime('%Y-%m-%d %H:%M', 'now', 'localtime') THEN 0 ELSE 1 END,
             CASE i.priority WHEN 'Критический' THEN 0 WHEN 'Высокий' THEN 1 WHEN 'Средний' THEN 2 ELSE 3 END,
             i.due_at ASC,
             i.created_at DESC
           LIMIT 6"""
    ).fetchall()

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
    map_intake_alerts = _intake_alerts(db, limit=50)[:6]
    map_work_markers = _work_markers(db, limit=50)[:6]

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
        inbox_new=inbox_new,
        inbox_pending=inbox_pending,
        overdue_inbox=overdue_inbox,
        overdue_tasks=overdue_tasks,
        urgent_inbox=urgent_inbox,
        help_needed=help_needed,
        open_tasks=open_tasks,
        map_tasks=map_tasks,
        map_intake_alerts=map_intake_alerts,
        map_work_markers=map_work_markers,
        network_issues=network_issues)


@center.route('/center/control')
def control():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)

    overdue_inbox = db.execute(
        """SELECT i.*, p.nick AS player_nick, ap.nick AS auto_assignee_nick
           FROM intake_items i
           LEFT JOIN players p ON p.id = i.source_player_id
           LEFT JOIN players ap ON ap.id = i.auto_assignee_id
           WHERE i.due_at IS NOT NULL
             AND i.due_at < strftime('%Y-%m-%d %H:%M', 'now', 'localtime')
             AND i.status NOT IN ('Обработано', 'Отклонено')
           ORDER BY i.due_at ASC, i.created_at DESC
           LIMIT 20"""
    ).fetchall()
    active_inbox = db.execute(
        """SELECT i.*, p.nick AS player_nick, ap.nick AS auto_assignee_nick
           FROM intake_items i
           LEFT JOIN players p ON p.id = i.source_player_id
           LEFT JOIN players ap ON ap.id = i.auto_assignee_id
           WHERE i.status NOT IN ('Обработано', 'Отклонено')
           ORDER BY
             CASE i.priority WHEN 'Критический' THEN 0 WHEN 'Высокий' THEN 1 WHEN 'Средний' THEN 2 ELSE 3 END,
             CASE WHEN i.due_at IS NULL OR i.due_at = '' THEN 1 ELSE 0 END,
             i.due_at ASC,
             i.created_at DESC
           LIMIT 20"""
    ).fetchall()
    overdue_tasks = db.execute(
        """SELECT t.*, p.nick AS assignee_nick
           FROM tasks t
           LEFT JOIN players p ON p.id = t.assignee_id
           WHERE t.deadline IS NOT NULL AND t.deadline != ''
             AND t.deadline < strftime('%Y-%m-%d %H:%M', 'now', 'localtime')
             AND (t.status IS NULL OR t.status NOT IN ('Выполнена', 'Отменена'))
           ORDER BY t.deadline ASC, t.created_at DESC
           LIMIT 20"""
    ).fetchall()
    unassigned_tasks = db.execute(
        """SELECT t.*, p.nick AS assignee_nick
           FROM tasks t
           LEFT JOIN players p ON p.id = t.assignee_id
           WHERE (t.assignee_id IS NULL OR t.assignee_id = '')
             AND (t.status IS NULL OR t.status NOT IN ('Выполнена', 'Отменена'))
           ORDER BY
             CASE t.priority WHEN 'Критический' THEN 0 WHEN 'Высокий' THEN 1 WHEN 'Средний' THEN 2 ELSE 3 END,
             t.created_at DESC
           LIMIT 20"""
    ).fetchall()
    open_requests = db.execute(
        """SELECT r.*, p.nick AS player_nick
           FROM requests r
           LEFT JOIN players p ON p.id = r.player_id
           WHERE r.status IS NULL OR r.status NOT IN ('Выполнен', 'Отклонён')
           ORDER BY
             CASE r.priority WHEN 'Критический' THEN 0 WHEN 'Высокий' THEN 1 WHEN 'Средний' THEN 2 ELSE 3 END,
             CASE r.status WHEN 'Новый' THEN 0 WHEN 'В работе' THEN 1 WHEN 'На паузе' THEN 2 WHEN 'Ожидает' THEN 3 ELSE 4 END,
             r.created_at DESC
           LIMIT 20"""
    ).fetchall()
    pending_decisions = db.execute(
        """SELECT *
           FROM decisions
           WHERE status IS NULL OR status NOT IN ('Выполнено', 'Отменено')
           ORDER BY
             CASE priority WHEN 'Критический' THEN 0 WHEN 'Высокий' THEN 1 WHEN 'Средний' THEN 2 ELSE 3 END,
             CASE status WHEN 'Предложено' THEN 0 WHEN 'Согласовано' THEN 1 ELSE 2 END,
             created_at DESC
           LIMIT 20"""
    ).fetchall()
    help_players = db.execute(
        """SELECT id, nick, role, direction, activity, needs_help, needs_help_with, current_activity
           FROM players
           WHERE needs_help = 1 OR (needs_help_with IS NOT NULL AND needs_help_with != '')
           ORDER BY updated_at DESC, nick ASC
           LIMIT 20"""
    ).fetchall()

    network_issues = [
        _network_issue_payload(station)
        for station in _existing_alstations(db)
        if station.get('network_status') in ('signal_only', 'isolated')
    ]
    map_intake_alerts = _intake_alerts(db, limit=120)
    map_work_markers = _work_markers(db, limit=120)

    attention_rows = []

    def add_attention(source, severity, title, reason, url, meta='', coordinates=None, map_url=None):
        attention_rows.append({
            'source': source,
            'severity': severity,
            'title': title,
            'reason': reason,
            'url': url,
            'meta': meta,
            'coordinates': coordinates,
            'map_url': map_url or (url_for('map.index') + '?focus=' + coordinates if coordinates else None),
        })

    for item in overdue_inbox[:6]:
        add_attention(
            'Входящее',
            'danger',
            item['summary'] or (item['raw_text'] or '')[:90],
            'Просрочено: входящее требует решения',
            url_for('inbox.detail', item_id=item['id']),
            '%s · %s' % (item['priority'] or '-', item['player_nick'] or 'игрок не указан'),
        )
    for task in overdue_tasks[:6]:
        add_attention(
            'Задача',
            'danger',
            task['title'],
            'Просрочен срок выполнения',
            url_for('tasks.detail', task_id=task['id']),
            '%s · %s' % (task['priority'] or '-', task['assignee_nick'] or 'не назначена'),
            task['coordinates'],
        )
    for issue in network_issues[:6]:
        coordinates = '[%s:%s:%s]' % (issue['x'], issue['y'], issue.get('z') or 0)
        add_attention(
            'Карта',
            'warning' if issue['severity'] == 'medium' else 'danger',
            issue['name'],
            issue['title'],
            url_for('map.index') + '?focus=' + coordinates,
            'ур. %s · %s' % (issue.get('level') or '-', issue.get('network_status') or '-'),
            coordinates,
        )
    for req in open_requests[:5]:
        if req['priority'] not in ('Критический', 'Высокий') and req['status'] != 'Новый':
            continue
        add_attention(
            'Заявка',
            'warning' if req['priority'] == 'Высокий' else 'danger',
            req['title'],
            'Заявка без закрытого решения',
            url_for('center.request_detail', request_id=req['id']),
            '%s · %s · %s' % (req['priority'] or '-', req['status'] or '-', req['player_nick'] or 'игрок не указан'),
            req['coordinates'],
        )
    for task in unassigned_tasks[:4]:
        add_attention(
            'Назначение',
            'info',
            task['title'],
            'Задача без исполнителя',
            url_for('tasks.detail', task_id=task['id']),
            '%s · %s' % (task['priority'] or '-', task['direction'] or 'направление не указано'),
            task['coordinates'],
        )
    for alert in map_intake_alerts[:4]:
        add_attention(
            'Координаты',
            'info',
            alert['title'],
            'Входящее с координатами видно на карте',
            alert['url'],
            '%s · %s' % (alert.get('priority') or '-', alert.get('player_nick') or 'игрок не указан'),
            alert['coordinates'],
        )

    queue_stats = {
        'active_inbox': db.execute(
            "SELECT COUNT(*) FROM intake_items WHERE status NOT IN ('Обработано', 'Отклонено')"
        ).fetchone()[0],
        'overdue_inbox': db.execute(
            """SELECT COUNT(*) FROM intake_items
               WHERE due_at IS NOT NULL
                 AND due_at < strftime('%Y-%m-%d %H:%M', 'now', 'localtime')
                 AND status NOT IN ('Обработано', 'Отклонено')"""
        ).fetchone()[0],
        'overdue_tasks': db.execute(
            """SELECT COUNT(*) FROM tasks
               WHERE deadline IS NOT NULL AND deadline != ''
                 AND deadline < strftime('%Y-%m-%d %H:%M', 'now', 'localtime')
                 AND (status IS NULL OR status NOT IN ('Выполнена', 'Отменена'))"""
        ).fetchone()[0],
        'unassigned_tasks': db.execute(
            """SELECT COUNT(*) FROM tasks
               WHERE (assignee_id IS NULL OR assignee_id = '')
                 AND (status IS NULL OR status NOT IN ('Выполнена', 'Отменена'))"""
        ).fetchone()[0],
        'open_requests': db.execute(
            "SELECT COUNT(*) FROM requests WHERE status IS NULL OR status NOT IN ('Выполнен', 'Отклонён')"
        ).fetchone()[0],
        'pending_decisions': db.execute(
            "SELECT COUNT(*) FROM decisions WHERE status IS NULL OR status NOT IN ('Выполнено', 'Отменено')"
        ).fetchone()[0],
        'help_players': db.execute(
            """SELECT COUNT(*) FROM players
               WHERE needs_help = 1 OR (needs_help_with IS NOT NULL AND needs_help_with != '')"""
        ).fetchone()[0],
        'network_issues': len(network_issues),
        'map_alerts': len(map_intake_alerts),
        'work_markers': len(map_work_markers),
        'attention': len(attention_rows),
    }

    db.close()
    return render_template(
        'center/control.html',
        queue_stats=queue_stats,
        attention_rows=attention_rows,
        active_inbox=active_inbox,
        overdue_inbox=overdue_inbox,
        overdue_tasks=overdue_tasks,
        unassigned_tasks=unassigned_tasks,
        open_requests=open_requests,
        pending_decisions=pending_decisions,
        help_players=help_players,
        network_issues=network_issues,
        map_intake_alerts=map_intake_alerts,
        map_work_markers=map_work_markers,
    )


@center.route('/center/decisions')
def decisions():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
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
    ensure_alliance_schema(db)
    decision = db.execute("SELECT * FROM decisions WHERE id = ?", (decision_id,)).fetchone()
    if not decision:
        flash('Решение не найдено', 'danger')
        db.close()
        return redirect(url_for('center.decisions'))
    related_log = db.execute(
        '''SELECT * FROM alliance_log
           WHERE related_decision_id = ? OR (source_intake_id IS NOT NULL AND source_intake_id = ?)
           ORDER BY created_at DESC LIMIT 12''',
        (decision_id, decision['source_intake_id'])
    ).fetchall()
    db.close()
    return render_template('center/decision_detail.html', decision=decision, related_log=related_log)


@center.route('/center/decisions/<int:decision_id>/update', methods=['POST'])
def update_decision(decision_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    data = {k: v for k, v in request.form.items()}
    db = get_db()
    ensure_alliance_schema(db)
    decision = db.execute("SELECT * FROM decisions WHERE id = ?", (decision_id,)).fetchone()
    if not decision:
        db.close()
        flash('Решение не найдено', 'danger')
        return redirect(url_for('center.decisions'))
    fields = []
    values = []
    for key in ['status', 'result', 'priority', 'deadline', 'coordinates']:
        if key in data:
            fields.append(f'{key} = ?')
            values.append(data[key])
    values.append(decision_id)
    db.execute(f"UPDATE decisions SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", values)
    updated = db.execute("SELECT * FROM decisions WHERE id = ?", (decision_id,)).fetchone()
    if decision['status'] != data.get('status'):
        _log_decision_event(
            db,
            updated,
            'Изменен статус решения',
            '%s: %s -> %s' % (updated['title'], decision['status'] or '-', data.get('status') or '-'),
        )
    elif decision['priority'] != data.get('priority') or decision['deadline'] != data.get('deadline'):
        _log_decision_event(db, updated, 'Обновлено решение', updated['title'])
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
        ensure_alliance_schema(db)
        db.execute(
            '''INSERT INTO decisions (title, proposer, description, status, priority, deadline, coordinates, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (data['title'], data.get('proposer'), data.get('description'),
             data.get('status', 'Предложено'), data.get('priority', 'Средний'),
             data.get('deadline'), data.get('coordinates'), session.get('username'))
        )
        decision_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
        decision = db.execute("SELECT * FROM decisions WHERE id = ?", (decision_id,)).fetchone()
        _log_decision_event(db, decision, 'Создано решение', decision['title'], event_type='Создание')
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
    ensure_alliance_schema(db)
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
    related_log = db.execute(
        '''SELECT * FROM alliance_log
           WHERE related_request_id = ? OR (source_intake_id IS NOT NULL AND source_intake_id = ?)
           ORDER BY created_at DESC LIMIT 12''',
        (request_id, req['source_intake_id']),
    ).fetchall()
    players = db.execute("SELECT id, nick FROM players ORDER BY nick").fetchall()
    db.close()
    return render_template('center/request_detail.html', req=req, comments=comments, players=players, related_log=related_log)


@center.route('/center/requests/<int:request_id>/update', methods=['POST'])
def update_request(request_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    data = {k: v for k, v in request.form.items()}
    db = get_db()
    ensure_alliance_schema(db)
    req = db.execute(
        "SELECT r.*, p.nick as player_nick FROM requests r LEFT JOIN players p ON r.player_id = p.id WHERE r.id = ?",
        (request_id,),
    ).fetchone()
    if not req:
        db.close()
        flash('Запрос не найден', 'danger')
        return redirect(url_for('center.requests_list'))
    fields = []
    values = []
    for key in ['status', 'assignee', 'resolution', 'priority', 'request_type', 'description', 'coordinates', 'due_at']:
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
    updated = db.execute(
        "SELECT r.*, p.nick as player_nick FROM requests r LEFT JOIN players p ON r.player_id = p.id WHERE r.id = ?",
        (request_id,),
    ).fetchone()
    if req['status'] != data.get('status'):
        _log_request_event(
            db,
            updated,
            'Изменен статус заявки',
            '%s: %s -> %s' % (updated['title'], req['status'] or '-', data.get('status') or '-'),
        )
    elif req['priority'] != data.get('priority') or req['assignee'] != data.get('assignee'):
        _log_request_event(db, updated, 'Обновлена заявка', updated['title'])

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
        ensure_alliance_schema(db)
        db.execute(
            '''INSERT INTO requests (player_id, request_type, title, description, priority, status, assignee, coordinates, due_at)
               VALUES (?, ?, ?, ?, ?, 'Новый', ?, ?, ?)''',
            (data.get('player_id') or None, data.get('request_type', 'Другое'),
             data['title'], data.get('description'), data.get('priority', 'Средний'),
             data.get('assignee'), data.get('coordinates'), data.get('due_at'))
        )
        request_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
        req = db.execute(
            "SELECT r.*, p.nick as player_nick FROM requests r LEFT JOIN players p ON r.player_id = p.id WHERE r.id = ?",
            (request_id,),
        ).fetchone()
        _log_request_event(db, req, 'Создана заявка', req['title'], event_type='Создание')
        db.commit()
        db.close()
        flash('Запрос создан', 'success')
        return redirect(url_for('center.requests_list'))
    db = get_db()
    ensure_alliance_schema(db)
    players = db.execute("SELECT id, nick FROM players ORDER BY nick").fetchall()
    db.close()
    return render_template('center/request_form.html', players=players)


@center.route('/center/log')
def log():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
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
        ensure_alliance_schema(db)
        db.execute(
            '''INSERT INTO alliance_log (event_type, title, description, related_player, author, event_date, coordinates)
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (data.get('event_type', 'Прочее'), data['title'], data.get('description'),
             data.get('related_player'), data.get('author', session.get('username')),
             data.get('event_date'), data.get('coordinates'))
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
    if new_status not in ('Новый', 'В работе', 'На паузе', 'Ожидает', 'Выполнен', 'Отклонён'):
        return jsonify({'error': 'Invalid status'}), 400
    db = get_db()
    ensure_alliance_schema(db)
    req = db.execute(
        "SELECT r.*, p.nick as player_nick FROM requests r LEFT JOIN players p ON r.player_id = p.id WHERE r.id = ?",
        (request_id,),
    ).fetchone()
    if not req:
        db.close()
        return jsonify({'error': 'Request not found'}), 404
    if new_status in ('Выполнен', 'Отклонён'):
        db.execute("UPDATE requests SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (new_status, request_id))
    else:
        db.execute("UPDATE requests SET status = ? WHERE id = ?", (new_status, request_id))
    updated = db.execute(
        "SELECT r.*, p.nick as player_nick FROM requests r LEFT JOIN players p ON r.player_id = p.id WHERE r.id = ?",
        (request_id,),
    ).fetchone()
    _log_request_event(
        db,
        updated,
        'Изменен статус заявки',
        '%s: %s -> %s' % (updated['title'], req['status'] or '-', new_status),
    )
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
    ensure_alliance_schema(db)
    decision = db.execute("SELECT * FROM decisions WHERE id = ?", (decision_id,)).fetchone()
    if not decision:
        db.close()
        return jsonify({'error': 'Decision not found'}), 404
    db.execute("UPDATE decisions SET status = ? WHERE id = ?", (new_status, decision_id))
    updated = db.execute("SELECT * FROM decisions WHERE id = ?", (decision_id,)).fetchone()
    _log_decision_event(
        db,
        updated,
        'Изменен статус решения',
        '%s: %s -> %s' % (updated['title'], decision['status'] or '-', new_status),
    )
    db.commit()
    db.close()
    return jsonify({'status': 'ok', 'new_status': new_status})


@center.route('/center/ajax/log/quick', methods=['POST'])
def ajax_quick_log():
    if 'user_id' not in session:
        return jsonify({'error': 'Auth required'}), 401
    data = request.get_json()
    db = get_db()
    ensure_alliance_schema(db)
    db.execute(
        '''INSERT INTO alliance_log (event_type, title, description, author, event_date, coordinates)
           VALUES (?, ?, ?, ?, date('now'), ?)''',
        (data.get('event_type', 'Прочее'), data['title'], data.get('description', ''),
         session.get('username'), data.get('coordinates'))
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
