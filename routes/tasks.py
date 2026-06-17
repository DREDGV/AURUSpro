from flask import Blueprint, render_template, session, redirect, url_for, request, flash
from utils.db import get_db

tasks = Blueprint('tasks', __name__)


@tasks.route('/tasks')
def list():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    status_filter = request.args.get('status', '')
    priority_filter = request.args.get('priority', '')
    q = 'SELECT t.*, p.nick as assignee_nick FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE 1=1'
    params = []
    if status_filter:
        q += ' AND t.status = ?'
        params.append(status_filter)
    if priority_filter:
        q += ' AND t.priority = ?'
        params.append(priority_filter)
    q += ' ORDER BY CASE t.priority WHEN "Критический" THEN 0 WHEN "Высокий" THEN 1 WHEN "Средний" THEN 2 ELSE 3 END, t.created_at DESC'
    all_tasks = db.execute(q, params).fetchall()

    stats = {
        'total': db.execute('SELECT COUNT(*) FROM tasks').fetchone()[0],
        'new': db.execute("SELECT COUNT(*) FROM tasks WHERE status = 'Новая'").fetchone()[0],
        'in_work': db.execute("SELECT COUNT(*) FROM tasks WHERE status = 'В работе'").fetchone()[0],
        'done': db.execute("SELECT COUNT(*) FROM tasks WHERE status = 'Выполнена'").fetchone()[0],
    }
    db.close()
    return render_template('tasks/list.html', tasks=all_tasks, stats=stats,
        current_status=status_filter, current_priority=priority_filter)


@tasks.route('/tasks/create', methods=['GET', 'POST'])
def create():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db.execute(
            '''INSERT INTO tasks (title, direction, description, assignee_id, participants, priority, status, deadline, comment)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (data['title'], data.get('direction'), data.get('description'),
             data.get('assignee_id') or None, data.get('participants'),
             data.get('priority', 'Средний'), data.get('status', 'Новая'),
             data.get('deadline'), data.get('comment'))
        )
        db.commit()
        db.close()
        flash('Задача создана', 'success')
        return redirect(url_for('tasks.list'))
    players = db.execute('SELECT id, nick FROM players ORDER BY nick').fetchall()
    db.close()
    return render_template('tasks/form.html', task=None, players=players)


@tasks.route('/tasks/<int:task_id>')
def detail(task_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    task = db.execute(
        'SELECT t.*, p.nick as assignee_nick FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE t.id = ?',
        (task_id,)
    ).fetchone()
    if not task:
        flash('Задача не найдена', 'danger')
        db.close()
        return redirect(url_for('tasks.list'))
    comments = db.execute(
        'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC', (task_id,)
    ).fetchall()
    db.close()
    return render_template('tasks/detail.html', task=task, comments=comments)


@tasks.route('/tasks/<int:task_id>/edit', methods=['GET', 'POST'])
def edit(task_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    task = db.execute('SELECT * FROM tasks WHERE id = ?', (task_id,)).fetchone()
    if not task:
        flash('Задача не найдена', 'danger')
        db.close()
        return redirect(url_for('tasks.list'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db.execute(
            '''UPDATE tasks SET title=?, direction=?, description=?, assignee_id=?, participants=?,
               priority=?, status=?, deadline=?, comment=?, closed_at=? WHERE id=?''',
            (data['title'], data.get('direction'), data.get('description'),
             data.get('assignee_id') or None, data.get('participants'),
             data.get('priority', 'Средний'), data.get('status', 'Новая'),
             data.get('deadline'), data.get('comment'),
             None if data.get('status') != 'Выполнена' else 'CURRENT_TIMESTAMP',
             task_id)
        )
        if data.get('new_comment', '').strip():
            db.execute(
                'INSERT INTO task_comments (task_id, author, comment_text) VALUES (?, ?, ?)',
                (task_id, session.get('username'), data['new_comment'].strip())
            )
        db.commit()
        db.close()
        flash('Задача обновлена', 'success')
        return redirect(url_for('tasks.detail', task_id=task_id))
    players = db.execute('SELECT id, nick FROM players ORDER BY nick').fetchall()
    db.close()
    return render_template('tasks/form.html', task=task, players=players)


@tasks.route('/tasks/<int:task_id>/comment', methods=['POST'])
def add_comment(task_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    text = request.form.get('comment_text', '').strip()
    if not text:
        flash('Введите комментарий', 'warning')
        return redirect(url_for('tasks.detail', task_id=task_id))
    db = get_db()
    db.execute(
        'INSERT INTO task_comments (task_id, author, comment_text) VALUES (?, ?, ?)',
        (task_id, session.get('username'), text)
    )
    db.commit()
    db.close()
    return redirect(url_for('tasks.detail', task_id=task_id))


@tasks.route('/tasks/<int:task_id>/status', methods=['POST'])
def change_status(task_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    data = request.get_json() if request.is_json else None
    if data:
        new_status = data.get('status')
    else:
        new_status = request.form.get('status')
    db = get_db()
    if new_status == 'Выполнена':
        db.execute("UPDATE tasks SET status=?, closed_at=CURRENT_TIMESTAMP WHERE id=?", (new_status, task_id))
    else:
        db.execute("UPDATE tasks SET status=? WHERE id=?", (new_status, task_id))
    db.commit()
    db.close()
    if request.is_json:
        return {'status': 'ok', 'new_status': new_status}
    return redirect(url_for('tasks.detail', task_id=task_id))


@tasks.route('/tasks/<int:task_id>/delete', methods=['POST'])
def delete(task_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    db.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
    db.commit()
    db.close()
    flash('Задача удалена', 'success')
    return redirect(url_for('tasks.list'))
