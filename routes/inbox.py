import json
import re
from datetime import datetime, timedelta

from flask import Blueprint, flash, jsonify, redirect, render_template, request, session, url_for

from utils.db import get_db
from utils.intake_engine import analyze_intake
from utils.schema import ensure_alliance_schema

inbox = Blueprint('inbox', __name__)

INBOX_STATUSES = ['Новое', 'Разобрано', 'Требует подтверждения', 'В работе', 'Обработано', 'Отклонено']
SOURCE_TYPES = ['message', 'note', 'intel', 'problem', 'manual']
CHAT_LINE_RE = re.compile(r'^(\[[^\]]{1,16}\]\s*)?[\wА-Яа-яЁё ._-]{2,32}\s*[:>–-]')

ASSIGNMENT_HINTS = {
    'Разведка': ('развед', 'скан', 'коорд', 'цель', 'провер'),
    'Алстанции': ('алстан', 'сеть', 'сигнал', 'радиус', 'станц'),
    'Дипломатия': ('диплом', 'переговор', 'союз', 'конфликт', 'пакт'),
    'Помощь игрокам': ('помощ', 'рес', 'поддерж', 'развит'),
    'Атака': ('атака', 'деф', 'защит', 'враг', 'подкреп'),
    'Развитие': ('развит', 'эконом', 'совет', 'планет', 'аккаунт'),
}

SLA_HOURS = {
    'Критический': 2,
    'Высокий': 8,
    'Средний': 24,
    'Низкий': 72,
}


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


def _due_at_for_priority(priority):
    hours = SLA_HOURS.get(priority or 'Средний', 24)
    return (datetime.now() + timedelta(hours=hours)).strftime('%Y-%m-%d %H:%M')


def _suggest_assignee(db, direction, task_type=None):
    if not direction:
        return None
    hints = ASSIGNMENT_HINTS.get(direction, ())
    players = db.execute(
        '''SELECT p.id, p.nick, p.role, p.direction, p.current_activity, p.can_help_with,
                  p.willing_to_help, p.needs_help, p.access_level,
                  COUNT(t.id) AS open_tasks
           FROM players p
           LEFT JOIN tasks t ON t.assignee_id = p.id
                AND t.status NOT IN ('Выполнена', 'Отменена')
           GROUP BY p.id
           ORDER BY p.nick'''
    ).fetchall()
    best = None
    best_score = 0
    for player in players:
        haystack = ' '.join(
            str(player[field] or '').lower()
            for field in ('role', 'direction', 'current_activity', 'can_help_with')
        )
        score = 0
        reasons = []
        if direction.lower() in str(player['direction'] or '').lower():
            score += 8
            reasons.append('направление')
        if direction.lower() in str(player['role'] or '').lower():
            score += 5
            reasons.append('роль')
        matched_hints = [hint for hint in hints if hint in haystack]
        if matched_hints:
            score += min(6, len(matched_hints) * 2)
            reasons.append('навыки: ' + ', '.join(matched_hints[:3]))
        if task_type and task_type.replace('_', ' ') in haystack:
            score += 2
            reasons.append('тип задачи')
        if player['willing_to_help']:
            score += 3
            reasons.append('готов помогать')
        if player['needs_help']:
            score -= 3
        score += min(int(player['access_level'] or 0), 7) * 0.25
        score -= int(player['open_tasks'] or 0) * 0.4
        if score > best_score:
            best_score = score
            best = {
                'id': player['id'],
                'nick': player['nick'],
                'score': round(score, 2),
                'reason': '; '.join(reasons) or direction,
                'open_tasks': int(player['open_tasks'] or 0),
            }
    return best if best and best_score >= 2 else None


def _update_item_analysis(db, item_id, raw_text):
    analysis = _analyze_for_db(raw_text, _players(db))
    routing = analysis.get('routing') or {}
    due_at = _due_at_for_priority(analysis.get('priority'))
    assignee = _suggest_assignee(db, routing.get('direction'), routing.get('task_type'))
    map_alert = 1 if analysis.get('coordinates') and analysis.get('priority') in ('Критический', 'Высокий') else 0
    if assignee:
        analysis['assignment'] = assignee
        for proposal in analysis.get('proposals') or []:
            if proposal.get('kind') == 'task' and not proposal.get('assignee_id'):
                proposal['assignee_id'] = assignee['id']
                proposal['assignee_nick'] = assignee['nick']
            if proposal.get('kind') == 'request' and not proposal.get('assignee'):
                proposal['assignee'] = assignee['nick']
    analysis['sla'] = {'due_at': due_at, 'hours': SLA_HOURS.get(analysis.get('priority') or 'Средний', 24)}
    db.execute(
        '''UPDATE intake_items
           SET category=?, priority=?, summary=?, analysis_json=?, proposals_json=?,
               due_at=?, auto_assignee_id=?, auto_assignee_reason=?, map_alert=?,
               status='Требует подтверждения', updated_at=CURRENT_TIMESTAMP
           WHERE id=?''',
        (
            analysis['category_label'],
            analysis['priority'],
            analysis['summary'],
            json.dumps(analysis, ensure_ascii=False),
            json.dumps(analysis['proposals'], ensure_ascii=False),
            due_at,
            assignee['id'] if assignee else None,
            assignee['reason'] if assignee else None,
            map_alert,
            item_id,
        ),
    )
    return analysis


def _split_bulk_messages(raw_text, mode='smart'):
    text = (raw_text or '').replace('\r\n', '\n').replace('\r', '\n').strip()
    if not text:
        return []
    if mode == 'single':
        return [text]

    if mode in ('blank', 'smart'):
        chunks = [chunk.strip() for chunk in re.split(r'\n\s*\n+', text) if chunk.strip()]
        if mode == 'blank' or len(chunks) > 1:
            return chunks or [text]

    if mode in ('line', 'smart'):
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        chat_like_lines = sum(1 for line in lines if CHAT_LINE_RE.match(line))
        should_split_lines = len(lines) > 1 and chat_like_lines >= max(2, len(lines) // 2)
        if mode == 'line' or should_split_lines:
            return lines or [text]

    return [text]


def _first_detected_player_id(analysis):
    for player in analysis.get('players') or []:
        player_id = player.get('id')
        if player_id:
            return player_id
    return None


@inbox.route('/inbox')
def list_items():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
    status = request.args.get('status', '')
    q = '''SELECT i.*, p.nick as player_nick, ap.nick as auto_assignee_nick
           FROM intake_items i
           LEFT JOIN players p ON p.id = i.source_player_id
           LEFT JOIN players ap ON ap.id = i.auto_assignee_id
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
        now_ts=datetime.now().strftime('%Y-%m-%d %H:%M'),
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
    source_type = request.form.get('source_type') or 'message'
    split_mode = request.form.get('split_mode') or 'smart'
    chunks = _split_bulk_messages(raw_text, split_mode)
    item_ids = []
    for chunk in chunks:
        db.execute(
            '''INSERT INTO intake_items (source_type, source_player_id, raw_text, status, author)
               VALUES (?, ?, ?, 'Новое', ?)''',
            (
                source_type,
                source_player_id,
                chunk,
                session.get('username'),
            ),
        )
        item_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
        analysis = _update_item_analysis(db, item_id, chunk)
        detected_player_id = None if source_player_id else _first_detected_player_id(analysis)
        if detected_player_id:
            db.execute(
                'UPDATE intake_items SET source_player_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
                (detected_player_id, item_id),
            )
        item_ids.append(item_id)
    db.commit()
    db.close()
    if len(item_ids) == 1:
        return redirect(url_for('inbox.detail', item_id=item_ids[0]))
    flash(f'Добавлено входящих: {len(item_ids)}. Они ждут подтверждения.', 'success')
    return redirect(url_for('inbox.list_items', status='Требует подтверждения'))


@inbox.route('/inbox/<int:item_id>')
def detail(item_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    ensure_alliance_schema(db)
    item = db.execute(
        '''SELECT i.*, p.nick as player_nick, ap.nick as auto_assignee_nick
           FROM intake_items i
           LEFT JOIN players p ON p.id = i.source_player_id
           LEFT JOIN players ap ON ap.id = i.auto_assignee_id
           WHERE i.id = ?''',
        (item_id,),
    ).fetchone()
    if not item:
        flash('Входящее не найдено', 'danger')
        db.close()
        return redirect(url_for('inbox.list_items'))
    players = _players(db)
    next_item = db.execute(
        """SELECT id FROM intake_items
           WHERE id != ? AND status IN ('Новое', 'Разобрано', 'Требует подтверждения', 'В работе')
           ORDER BY CASE status
               WHEN 'Новое' THEN 0
               WHEN 'Требует подтверждения' THEN 1
               WHEN 'Разобрано' THEN 2
               WHEN 'В работе' THEN 3
               ELSE 4
           END, created_at ASC
           LIMIT 1""",
        (item_id,),
    ).fetchone()
    db.close()
    return render_template(
        'inbox/detail.html',
        item=item,
        analysis=_load_analysis(item),
        proposals=_load_proposals(item),
        players=players,
        next_item=next_item,
        statuses=INBOX_STATUSES,
        now_ts=datetime.now().strftime('%Y-%m-%d %H:%M'),
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
    next_item = None
    if request.form.get('redirect_next') == '1':
        next_item = db.execute(
            """SELECT id FROM intake_items
               WHERE id != ? AND status IN ('Новое', 'Разобрано', 'Требует подтверждения', 'В работе')
               ORDER BY CASE status
                   WHEN 'Новое' THEN 0
                   WHEN 'Требует подтверждения' THEN 1
                   WHEN 'Разобрано' THEN 2
                   WHEN 'В работе' THEN 3
                   ELSE 4
               END, created_at ASC
               LIMIT 1""",
            (item_id,),
        ).fetchone()
    db.commit()
    db.close()
    if next_item:
        return redirect(url_for('inbox.detail', item_id=next_item['id']))
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
    item = db.execute(
        '''SELECT i.*, p.nick as player_nick, ap.nick as auto_assignee_nick
           FROM intake_items i
           LEFT JOIN players p ON p.id = i.source_player_id
           LEFT JOIN players ap ON ap.id = i.auto_assignee_id
           WHERE i.id = ?''',
        (item_id,),
    ).fetchone()
    if not item:
        flash('Входящее не найдено', 'danger')
        db.close()
        return redirect(url_for('inbox.list_items'))

    proposal = _proposal_by_index(item, int(request.form.get('proposal_idx') or -1))
    action = request.form.get('action') or proposal.get('kind')
    created_id = None
    default_assignee_id = request.form.get('assignee_id') or proposal.get('assignee_id') or item['auto_assignee_id']
    default_deadline = request.form.get('deadline') or proposal.get('deadline') or item['due_at']

    if action == 'task':
        db.execute(
            '''INSERT INTO tasks (title, direction, description, assignee_id, priority, status,
               deadline, coordinates, map_object_type, task_type, comment, updated_at)
               VALUES (?, ?, ?, ?, ?, 'Новая', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
            (
                request.form.get('title') or proposal.get('title') or item['summary'] or 'Задача из входящего',
                request.form.get('direction') or proposal.get('direction') or 'Карта',
                request.form.get('description') or proposal.get('description') or item['raw_text'],
                default_assignee_id or None,
                request.form.get('priority') or proposal.get('priority') or item['priority'] or 'Средний',
                default_deadline,
                request.form.get('coordinates') or proposal.get('coordinates'),
                proposal.get('map_object_type'),
                proposal.get('task_type') or 'other',
                'Создано из входящего #%d%s' % (
                    item_id,
                    '; источник: %s' % item['player_nick'] if item['player_nick'] else '',
                ),
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
                request.form.get('assignee') or proposal.get('assignee') or item['auto_assignee_nick'],
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
