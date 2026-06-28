from flask import Blueprint, jsonify, redirect, render_template, request, session, url_for, flash

from utils.db import get_db
from utils.schema import ensure_alliance_schema

tasks = Blueprint('tasks', __name__)


TASK_DIRECTIONS = ['Карта', 'Алстанции', 'Помощь игрокам', 'Разведка', 'Атака', 'Развитие', 'Дипломатия']
TASK_TYPES = ['build_alstation', 'move_alstation', 'check_network', 'scout_point', 'support_player', 'other']
TASK_STATUSES = ['Новая', 'В работе', 'Ожидает', 'Выполнена', 'Отменена']
TASK_PRIORITIES = ['Критический', 'Высокий', 'Средний', 'Низкий']


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
               deadline, comment, coordinates, map_object_id, map_object_type, task_type, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
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
            ),
        )
        db.commit()
        db.close()
        flash('Задача создана', 'success')
        return redirect(url_for('tasks.list'))
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
    db.close()
    return render_template('tasks/detail.html', task=task, comments=comments)


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
    db.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
    db.commit()
    db.close()
    flash('Задача удалена', 'success')
    return redirect(url_for('tasks.list'))
