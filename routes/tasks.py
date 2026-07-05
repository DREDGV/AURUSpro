from flask import Blueprint, jsonify, redirect, render_template, request, session, url_for, flash

from utils.db import get_db
from utils.schema import ensure_alliance_schema
from utils.work_context import build_work_context

tasks = Blueprint('tasks', __name__)


TASK_DIRECTIONS = ['Карта', 'Алстанции', 'Помощь игрокам', 'Разведка', 'Атака', 'Развитие', 'Дипломатия']
TASK_TYPES = [
    'build_alstation', 'move_alstation', 'check_network', 'scout_point',
    'support_player', 'defense_response', 'answer_question', 'diplomacy', 'other'
]
TASK_STATUSES = ['Новая', 'В работе', 'Ожидает', 'Выполнена', 'Отменена']
TASK_PRIORITIES = ['Критический', 'Высокий', 'Средний', 'Низкий']


def _link_intake(db, source_intake_id, target_type, target_id, relation):
    if not source_intake_id:
        return
    db.execute(
        '''INSERT INTO work_links (source_type, source_id, target_type, target_id, relation)
           VALUES ('intake', ?, ?, ?, ?)''',
        (source_intake_id, target_type, target_id, relation),
    )


def _log_task_event(db, task, title, description, event_type='Задача'):
    db.execute(
        '''INSERT INTO alliance_log (event_type, title, description, related_player, author, event_date,
           coordinates, source_intake_id, related_task_id)
           VALUES (?, ?, ?, ?, ?, date('now'), ?, ?, ?)''',
        (
            event_type,
            title,
            description,
            task['assignee_nick'] if 'assignee_nick' in task.keys() else None,
            session.get('username'),
            task['coordinates'] if 'coordinates' in task.keys() else None,
            task['source_intake_id'] if 'source_intake_id' in task.keys() else None,
            task['id'],
        ),
    )
    log_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
    _link_intake(
        db,
        task['source_intake_id'] if 'source_intake_id' in task.keys() else None,
        'log',
        log_id,
        'task_event',
    )


def _status_order_sql(alias='t'):
    return (
        f"CASE {alias}.status "
        "WHEN 'Критический' THEN 0 "
        "WHEN 'Новая' THEN 0 "
        "WHEN 'В работе' THEN 1 "
        "WHEN 'Ожидает' THEN 2 "
        "WHEN 'Выполнена' THEN 4 "
        "WHEN 'Отменена' THEN 5 "
        "ELSE 3 END"
    )


def _priority_order_sql(alias='t'):
    return (
        f"CASE {alias}.priority "
        "WHEN 'Критический' THEN 0 "
        "WHEN 'Высокий' THEN 1 "
        "WHEN 'Средний' THEN 2 "
        "ELSE 3 END"
    )


def _task_payload(row):
    return {
        'id': row['id'],
        'title': row['title'],
        'direction': row['direction'],
        'description': row['description'],
        'assignee_id': row['assignee_id'],
        'assignee_nick': row['assignee_nick'] if 'assignee_nick' in row.keys() else None,
        'participants': row['participants'],
        'priority': row['priority'],
        'status': row['status'],
        'deadline': row['deadline'],
        'comment': row['comment'],
        'coordinates': row['coordinates'],
        'map_object_id': row['map_object_id'],
        'map_object_type': row['map_object_type'],
        'task_type': row['task_type'] or 'other',
        'url': url_for('tasks.detail', task_id=row['id']),
    }


@tasks.route('/tasks')
def list():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)

    status_filter = request.args.get('status', '')
    priority_filter = request.args.get('priority', '')
    direction_filter = request.args.get('direction', '')
    type_filter = request.args.get('type', '')

    q = 'SELECT t.*, p.nick as assignee_nick FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE 1=1'
    params = []
    if status_filter:
        q += ' AND t.status = ?'
        params.append(status_filter)
    if priority_filter:
        q += ' AND t.priority = ?'
        params.append(priority_filter)
    if direction_filter:
        q += ' AND t.direction = ?'
        params.append(direction_filter)
    if type_filter:
        q += ' AND t.task_type = ?'
        params.append(type_filter)
    q += f' ORDER BY {_priority_order_sql()}, {_status_order_sql()}, t.created_at DESC'
    all_tasks = db.execute(q, params).fetchall()

    stats = {
        'total': db.execute('SELECT COUNT(*) FROM tasks').fetchone()[0],
        'new': db.execute("SELECT COUNT(*) FROM tasks WHERE status = 'Новая'").fetchone()[0],
        'in_work': db.execute("SELECT COUNT(*) FROM tasks WHERE status = 'В работе'").fetchone()[0],
        'waiting': db.execute("SELECT COUNT(*) FROM tasks WHERE status = 'Ожидает'").fetchone()[0],
        'done': db.execute("SELECT COUNT(*) FROM tasks WHERE status = 'Выполнена'").fetchone()[0],
    }
    dynamic_directions = [
        row['direction'] for row in db.execute(
            'SELECT DISTINCT direction FROM tasks WHERE direction IS NOT NULL AND direction != "" ORDER BY direction'
        ).fetchall()
    ]
    directions = [*dict.fromkeys(TASK_DIRECTIONS + dynamic_directions)]
    db.close()
    return render_template(
        'tasks/list.html',
        tasks=all_tasks,
        stats=stats,
        priorities=TASK_PRIORITIES,
        directions=directions,
        task_types=TASK_TYPES,
        statuses=TASK_STATUSES,
        current_status=status_filter,
        current_priority=priority_filter,
        current_direction=direction_filter,
        current_type=type_filter,
    )


@tasks.route('/tasks/create', methods=['GET', 'POST'])
def create():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db.execute(
            '''INSERT INTO tasks (title, direction, description, assignee_id, participants, priority, status,
               deadline, comment, coordinates, map_object_id, map_object_type, task_type, source_intake_id, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
            (
                data['title'],
                data.get('direction'),
                data.get('description'),
                data.get('assignee_id') or None,
                data.get('participants'),
                data.get('priority', 'Средний'),
                data.get('status', 'Новая'),
                data.get('deadline'),
                data.get('comment'),
                data.get('coordinates'),
                data.get('map_object_id') or None,
                data.get('map_object_type'),
                data.get('task_type') or 'other',
                data.get('source_intake_id') or None,
            ),
        )
        task_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
        row = db.execute(
            '''SELECT t.*, p.nick as assignee_nick
               FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE t.id = ?''',
            (task_id,),
        ).fetchone()
        _link_intake(db, data.get('source_intake_id'), 'task', task_id, 'manual_created')
        _log_task_event(db, row, 'Создана задача', row['title'], event_type='Создание')
        db.commit()
        db.close()
        flash('Задача создана', 'success')
        return redirect(url_for('tasks.detail', task_id=task_id))
    players = db.execute('SELECT id, nick FROM players ORDER BY nick').fetchall()
    db.close()
    return render_template(
        'tasks/form.html',
        task=None,
        players=players,
        priorities=TASK_PRIORITIES,
        statuses=TASK_STATUSES,
        directions=TASK_DIRECTIONS,
        task_types=TASK_TYPES,
    )


@tasks.route('/tasks/<int:task_id>')
def detail(task_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
    task = db.execute(
        'SELECT t.*, p.nick as assignee_nick FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE t.id = ?',
        (task_id,),
    ).fetchone()
    if not task:
        flash('Задача не найдена', 'danger')
        db.close()
        return redirect(url_for('tasks.list'))
    comments = db.execute(
        'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC',
        (task_id,),
    ).fetchall()
    related_log = db.execute(
        '''SELECT * FROM alliance_log
           WHERE related_task_id = ? OR (source_intake_id IS NOT NULL AND source_intake_id = ?)
           ORDER BY created_at DESC LIMIT 12''',
        (task_id, task['source_intake_id']),
    ).fetchall()
    work_context = build_work_context(
        db,
        'task',
        task_id,
        source_intake_id=task['source_intake_id'],
        coordinates=task['coordinates'],
    )
    db.close()
    return render_template(
        'tasks/detail.html',
        task=task,
        comments=comments,
        related_log=related_log,
        work_context=work_context,
    )


@tasks.route('/tasks/<int:task_id>/edit', methods=['GET', 'POST'])
def edit(task_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
    task = db.execute(
        'SELECT t.*, p.nick as assignee_nick FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE t.id = ?',
        (task_id,),
    ).fetchone()
    if not task:
        flash('Задача не найдена', 'danger')
        db.close()
        return redirect(url_for('tasks.list'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        closed_at = None
        if data.get('status') == 'Выполнена':
            closed_at = db.execute("SELECT CURRENT_TIMESTAMP").fetchone()[0]
        db.execute(
            '''UPDATE tasks SET title=?, direction=?, description=?, assignee_id=?, participants=?,
               priority=?, status=?, deadline=?, comment=?, coordinates=?, map_object_id=?,
               map_object_type=?, task_type=?, closed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?''',
            (
                data['title'],
                data.get('direction'),
                data.get('description'),
                data.get('assignee_id') or None,
                data.get('participants'),
                data.get('priority', 'Средний'),
                data.get('status', 'Новая'),
                data.get('deadline'),
                data.get('comment'),
                data.get('coordinates'),
                data.get('map_object_id') or None,
                data.get('map_object_type'),
                data.get('task_type') or 'other',
                closed_at,
                task_id,
            ),
        )
        if data.get('new_comment', '').strip():
            db.execute(
                'INSERT INTO task_comments (task_id, author, comment_text) VALUES (?, ?, ?)',
                (task_id, session.get('username'), data['new_comment'].strip()),
            )
        updated = db.execute(
            '''SELECT t.*, p.nick as assignee_nick
               FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE t.id = ?''',
            (task_id,),
        ).fetchone()
        if task['status'] != data.get('status'):
            _log_task_event(
                db,
                updated,
                'Изменен статус задачи',
                '%s: %s -> %s' % (updated['title'], task['status'] or '-', data.get('status') or '-'),
            )
        elif task['priority'] != data.get('priority') or task['deadline'] != data.get('deadline'):
            _log_task_event(
                db,
                updated,
                'Обновлена задача',
                '%s: приоритет/срок обновлены' % updated['title'],
            )
        db.commit()
        db.close()
        flash('Задача обновлена', 'success')
        return redirect(url_for('tasks.detail', task_id=task_id))
    players = db.execute('SELECT id, nick FROM players ORDER BY nick').fetchall()
    db.close()
    return render_template(
        'tasks/form.html',
        task=task,
        players=players,
        priorities=TASK_PRIORITIES,
        statuses=TASK_STATUSES,
        directions=TASK_DIRECTIONS,
        task_types=TASK_TYPES,
    )


@tasks.route('/tasks/<int:task_id>/comment', methods=['POST'])
def add_comment(task_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    text = request.form.get('comment_text', '').strip()
    if not text:
        flash('Введите комментарий', 'warning')
        return redirect(url_for('tasks.detail', task_id=task_id))
    db = get_db()
    ensure_alliance_schema(db)
    db.execute(
        'INSERT INTO task_comments (task_id, author, comment_text) VALUES (?, ?, ?)',
        (task_id, session.get('username'), text),
    )
    db.commit()
    db.close()
    return redirect(url_for('tasks.detail', task_id=task_id))


@tasks.route('/tasks/<int:task_id>/status', methods=['POST'])
def change_status(task_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    data = request.get_json() if request.is_json else None
    new_status = data.get('status') if data else request.form.get('status')
    if new_status not in TASK_STATUSES:
        return jsonify({'error': 'Invalid status'}), 400
    db = get_db()
    ensure_alliance_schema(db)
    task = db.execute(
        '''SELECT t.*, p.nick as assignee_nick
           FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE t.id = ?''',
        (task_id,),
    ).fetchone()
    if not task:
        db.close()
        return jsonify({'error': 'Task not found'}), 404
    if new_status == 'Выполнена':
        db.execute(
            "UPDATE tasks SET status=?, closed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (new_status, task_id),
        )
    else:
        db.execute(
            "UPDATE tasks SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (new_status, task_id),
        )
    updated = db.execute(
        '''SELECT t.*, p.nick as assignee_nick
           FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE t.id = ?''',
        (task_id,),
    ).fetchone()
    _log_task_event(
        db,
        updated,
        'Изменен статус задачи',
        '%s: %s -> %s' % (updated['title'], task['status'] or '-', new_status),
    )
    db.commit()
    db.close()
    if request.is_json:
        return jsonify({'status': 'ok', 'new_status': new_status})
    return redirect(url_for('tasks.detail', task_id=task_id))


@tasks.route('/tasks/<int:task_id>/delete', methods=['POST'])
def delete(task_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
    task = db.execute(
        '''SELECT t.*, p.nick as assignee_nick
           FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE t.id = ?''',
        (task_id,),
    ).fetchone()
    if task:
        _log_task_event(db, task, 'Удалена задача', task['title'], event_type='Удаление')
    db.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
    db.commit()
    db.close()
    flash('Задача удалена', 'success')
    return redirect(url_for('tasks.list'))
