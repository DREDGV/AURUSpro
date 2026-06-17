from flask import Blueprint, render_template, session, redirect, url_for, request, flash
from utils.db import get_db

alliance = Blueprint('alliance', __name__)


@alliance.route('/alliance')
def topics():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    all_topics = db.execute(
        'SELECT * FROM alliance_topics ORDER BY '
        "CASE priority WHEN 'Критический' THEN 0 WHEN 'Высокий' THEN 1 WHEN 'Средний' THEN 2 ELSE 3 END, "
        "created_at DESC"
    ).fetchall()
    db.close()
    return render_template('alliance/topics.html', topics=all_topics)


@alliance.route('/alliance/<int:topic_id>')
def topic(topic_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    topic_data = db.execute('SELECT * FROM alliance_topics WHERE id = ?', (topic_id,)).fetchone()
    if not topic_data:
        flash('Тема не найдена', 'danger')
        db.close()
        return redirect(url_for('alliance.topics'))
    messages = db.execute(
        'SELECT * FROM alliance_messages WHERE topic_id = ? ORDER BY created_at ASC', (topic_id,)
    ).fetchall()
    db.close()
    return render_template('alliance/topic.html', topic=topic_data, messages=messages)


@alliance.route('/alliance/create', methods=['GET', 'POST'])
def create():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    if request.method == 'POST':
        data = {k: v for k, v in request.form.items()}
        db = get_db()
        db.execute(
            '''INSERT INTO alliance_topics (title, category, status, priority, description, participants, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (data['title'], data.get('category', 'Обсуждение'), data.get('status', 'Открыто'),
             data.get('priority', 'Средний'), data.get('description'), data.get('participants'),
             session.get('username'))
        )
        db.commit()
        db.close()
        flash('Тема создана', 'success')
        return redirect(url_for('alliance.topics'))
    return render_template('alliance/topic_form.html')


@alliance.route('/alliance/<int:topic_id>/message', methods=['POST'])
def add_message(topic_id):
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    text = request.form.get('message_text', '').strip()
    if not text:
        flash('Введите сообщение', 'warning')
        return redirect(url_for('alliance.topic', topic_id=topic_id))
    db = get_db()
    db.execute(
        'INSERT INTO alliance_messages (topic_id, author, message_text, message_date) VALUES (?, ?, ?, datetime("now"))',
        (topic_id, session.get('username'), text)
    )
    db.commit()
    db.close()
    return redirect(url_for('alliance.topic', topic_id=topic_id))
