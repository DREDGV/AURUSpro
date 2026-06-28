import json

from flask import Blueprint, flash, jsonify, redirect, render_template, request, session, url_for

from utils.db import get_db
from utils.intake_engine import analyze_intake
from utils.schema import ensure_alliance_schema

inbox = Blueprint('inbox', __name__)

INBOX_STATUSES = ['Новое', 'Разобрано', 'Требует подтверждения', 'В работе', 'Обработано', 'Отклонено']
SOURCE_TYPES = ['message', 'note', 'intel', 'problem', 'manual']


def _players(db):
    return db.execute('SELECT id, nick FROM players ORDER BY nick').fetchall()


def _load_analysis(row):
    try:
        return json.loads(row['analysis_json'] or '{}')
    except json.JSONDecodeError:
        return {}


def _load_proposals(row):
    try:
        return json.loads(row['proposals_json'] or '[]')
    except json.JSONDecodeError:
        return []


def _analyze_for_db(text, players):
    player_dicts = [{'id': row['id'], 'nick': row['nick']} for row in players]
    analysis = analyze_intake(text, player_dicts)
    return analysis


def _update_item_analysis(db, item_id, raw_text):
    analysis = _analyze_for_db(raw_text, _players(db))
    db.execute(
        '''UPDATE intake_items
           SET category=?, priority=?, summary=?, analysis_json=?, proposals_json=?,
               status='Требует подтверждения', updated_at=CURRENT_TIMESTAMP
           WHERE id=?''',
        (
            analysis['category_label'],
            analysis['priority'],
            analysis['summary'],
            json.dumps(analysis, ensure_ascii=False),
            json.dumps(analysis['proposals'], ensure_ascii=False),
            item_id,
        ),
    )
    return analysis


@inbox.route('/inbox')
def list_items():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
    status = request.args.get('status', '')
    q = '''SELECT i.*, p.nick as player_nick
           FROM intake_items i LEFT JOIN players p ON p.id = i.source_player_id
           WHERE 1=1'''
    params = []
    if status:
        q += ' AND i.status = ?'
        params.append(status)
    q += " ORDER BY CASE i.status WHEN 'Новое' THEN 0 WHEN 'Разобрано' THEN 1 WHEN 'Требует подтверждения' THEN 2 WHEN 'В работе' THEN 3 ELSE 4 END, i.created_at DESC"
    items = db.execute(q, params).fetchall()
    stats = {
        'total': db.execute('SELECT COUNT(*) FROM intake_items').fetchone()[0],
        'new': db.execute("SELECT COUNT(*) FROM intake_items WHERE status = 'Новое'").fetchone()[0],
        'parsed': db.execute("SELECT COUNT(*) FROM intake_items WHERE status IN ('Разобрано', 'Требует подтверждения')").fetchone()[0],
        'done': db.execute("SELECT COUNT(*) FROM intake_items WHERE status = 'Обработано'").fetchone()[0],
    }
    players = _players(db)
    db.close()
    return render_template(
        'inbox/list.html',
        items=items,
        players=players,
        stats=stats,
        statuses=INBOX_STATUSES,
        source_types=SOURCE_TYPES,
        current_status=status,
    )


@inbox.route('/inbox/create', methods=['POST'])
def create_item():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    raw_text = request.form.get('raw_text', '').strip()
    if not raw_text:
        flash('Введите текст сообщения', 'warning')
        return redirect(url_for('inbox.list_items'))
    db = get_db()
    ensure_alliance_schema(db)
    source_player_id = request.form.get('source_player_id') or None
    db.execute(
        '''INSERT INTO intake_items (source_type, source_player_id, raw_text, status, author)
           VALUES (?, ?, ?, 'Новое', ?)''',
        (
            request.form.get('source_type') or 'message',
            source_player_id,
            raw_text,
            session.get('username'),
        ),
    )
    item_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
    _update_item_analysis(db, item_id, raw_text)
    db.commit()
    db.close()
    return redirect(url_for('inbox.detail', item_id=item_id))


@inbox.route('/inbox/<int:item_id>')
def detail(item_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
    item = db.execute(
        '''SELECT i.*, p.nick as player_nick
           FROM intake_items i LEFT JOIN players p ON p.id = i.source_player_id
           WHERE i.id = ?''',
        (item_id,),
    ).fetchone()
    if not item:
        flash('Входящее не найдено', 'danger')
        db.close()
        return redirect(url_for('inbox.list_items'))
    players = _players(db)
    db.close()
    return render_template(
        'inbox/detail.html',
        item=item,
        analysis=_load_analysis(item),
        proposals=_load_proposals(item),
        players=players,
        statuses=INBOX_STATUSES,
    )


@inbox.route('/inbox/<int:item_id>/reparse', methods=['POST'])
def reparse(item_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
    item = db.execute('SELECT raw_text FROM intake_items WHERE id = ?', (item_id,)).fetchone()
    if item:
        _update_item_analysis(db, item_id, item['raw_text'])
        db.commit()
    db.close()
    return redirect(url_for('inbox.detail', item_id=item_id))


@inbox.route('/inbox/<int:item_id>/status', methods=['POST'])
def change_status(item_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    status = request.form.get('status')
    if status not in INBOX_STATUSES:
        flash('Некорректный статус', 'danger')
        return redirect(url_for('inbox.detail', item_id=item_id))
    db = get_db()
    ensure_alliance_schema(db)
    db.execute(
        'UPDATE intake_items SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        (status, item_id),
    )
    db.commit()
    db.close()
    return redirect(url_for('inbox.detail', item_id=item_id))


def _proposal_by_index(item, index):
    proposals = _load_proposals(item)
    if 0 <= index < len(proposals):
        return proposals[index]
    return {}


@inbox.route('/inbox/<int:item_id>/apply', methods=['POST'])
def apply_action(item_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
    item = db.execute('SELECT * FROM intake_items WHERE id = ?', (item_id,)).fetchone()
    if not item:
        flash('Входящее не найдено', 'danger')
        db.close()
        return redirect(url_for('inbox.list_items'))

    proposal = _proposal_by_index(item, int(request.form.get('proposal_idx') or -1))
    action = request.form.get('action') or proposal.get('kind')
    created_id = None

    if action == 'task':
        db.execute(
            '''INSERT INTO tasks (title, direction, description, assignee_id, priority, status,
               coordinates, map_object_type, task_type, comment, updated_at)
               VALUES (?, ?, ?, ?, ?, 'Новая', ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
            (
                request.form.get('title') or proposal.get('title') or item['summary'] or 'Задача из входящего',
                request.form.get('direction') or proposal.get('direction') or 'Карта',
                request.form.get('description') or proposal.get('description') or item['raw_text'],
                request.form.get('assignee_id') or proposal.get('assignee_id') or None,
                request.form.get('priority') or proposal.get('priority') or item['priority'] or 'Средний',
                request.form.get('coordinates') or proposal.get('coordinates'),
                proposal.get('map_object_type'),
                proposal.get('task_type') or 'other',
                'Создано из входящего #%d' % item_id,
            ),
        )
        created_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
        db.execute('UPDATE intake_items SET created_task_id=? WHERE id=?', (created_id, item_id))
    elif action == 'request':
        db.execute(
            '''INSERT INTO requests (player_id, request_type, title, description, priority, status, assignee)
               VALUES (?, ?, ?, ?, ?, 'Новый', ?)''',
            (
                request.form.get('player_id') or proposal.get('player_id') or item['source_player_id'],
                proposal.get('request_type') or item['category'] or 'Обращение',
                request.form.get('title') or proposal.get('title') or item['summary'] or 'Обращение игрока',
                request.form.get('description') or proposal.get('description') or item['raw_text'],
                request.form.get('priority') or proposal.get('priority') or item['priority'] or 'Средний',
                request.form.get('assignee'),
            ),
        )
        created_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
        db.execute('UPDATE intake_items SET created_request_id=? WHERE id=?', (created_id, item_id))
    elif action == 'note':
        player_id = request.form.get('player_id') or proposal.get('player_id') or item['source_player_id']
        if not player_id:
            flash('Для заметки нужен игрок', 'warning')
            db.close()
            return redirect(url_for('inbox.detail', item_id=item_id))
        db.execute(
            '''INSERT INTO player_notes (player_id, note_type, content, source)
               VALUES (?, ?, ?, ?)''',
            (
                player_id,
                proposal.get('note_type') or item['category'] or 'Входящее',
                request.form.get('content') or proposal.get('content') or item['raw_text'],
                'Входящее #%d' % item_id,
            ),
        )
        created_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
        db.execute('UPDATE intake_items SET created_note_id=? WHERE id=?', (created_id, item_id))
    elif action == 'log':
        db.execute(
            '''INSERT INTO alliance_log (event_type, title, description, related_player, author, event_date)
               VALUES (?, ?, ?, ?, ?, date('now'))''',
            (
                proposal.get('event_type') or 'Прочее',
                request.form.get('title') or proposal.get('title') or item['summary'] or 'Входящее',
                request.form.get('description') or proposal.get('description') or item['raw_text'],
                proposal.get('related_player'),
                session.get('username'),
            ),
        )
        created_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
        db.execute('UPDATE intake_items SET created_log_id=? WHERE id=?', (created_id, item_id))
    else:
        flash('Неизвестное действие', 'danger')
        db.close()
        return redirect(url_for('inbox.detail', item_id=item_id))

    db.execute(
        "UPDATE intake_items SET status='В работе', updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (item_id,),
    )
    db.commit()
    db.close()
    flash('Действие создано', 'success')
    return redirect(url_for('inbox.detail', item_id=item_id))


@inbox.route('/inbox/api/analyze', methods=['POST'])
def api_analyze():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    text = (request.get_json() or {}).get('text', '')
    db = get_db()
    ensure_alliance_schema(db)
    analysis = _analyze_for_db(text, _players(db))
    db.close()
    return jsonify(analysis)
