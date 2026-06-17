import urllib.request
import re
import sqlite3
from datetime import datetime


def parse_profile(nick):
    url = f'https://xcraft.ru/user/{nick}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='ignore')

        data = {}

        m = re.search(r'Очков\s+([\d\s\xa0]+)', html)
        if m:
            val = m.group(1).replace(' ', '').replace('\xa0', '').strip()
            if val:
                data['points'] = int(val)

        m = re.search(r'ТОП\s*<a[^>]*>(\d+)</a>', html)
        if m:
            data['top'] = int(m.group(1))
        else:
            m = re.search(r'ТОП\s+(\d+)', html)
            if m:
                data['top'] = int(m.group(1))

        m = re.search(r'Посл\.\s+посещ\.\s+игры\s*</td>\s*<td[^>]*>([^<]+)', html)
        if m:
            data['last_visit_game'] = m.group(1).strip().replace('\xa0', ' ')
        else:
            m = re.search(r'Посл\.\s+посещ\.\s+файла\s*</td>\s*<td[^>]*>([^<]+)', html)
            if m:
                data['last_visit_game'] = m.group(1).strip().replace('\xa0', ' ')

        m = re.search(r'Посл\.\s+посещ\.\s+форума\s*</td>\s*<td[^>]*>([^<]+)', html)
        if m:
            data['last_visit_forum'] = m.group(1).strip().replace('\xa0', ' ')

        m = re.search(r'Дата\s+регистрации\s*</td>\s*<td[^>]*>([^<]+)', html)
        if m:
            data['registration_date'] = m.group(1).strip().replace('\xa0', ' ')

        m = re.search(r'Полное\s+имя\s*</td>\s*<td[^>]*>([^<]+)', html)
        if m:
            data['real_name'] = m.group(1).strip().replace('\xa0', ' ')

        m = re.search(r'Место\s+жительства\s*</td>\s*<td[^>]*>([^<]+)', html)
        if m:
            data['location'] = m.group(1).strip().replace('\xa0', ' ')

        title = ''
        m = re.search(r'<title>([^<]+)</title>', html)
        if m:
            title = m.group(1).upper()
        if 'XERJ' in title or 'ZERG' in title:
            data['race'] = 'Жук'
        elif 'HUMANS' in title or 'TERRAN' in title:
            data['race'] = 'Терран'
        elif 'TOSS' in title or 'PROTOSS' in title:
            data['race'] = 'Тосс'

        if 'last_visit_game' in data:
            data['activity'] = classify_activity(data['last_visit_game'])

        return data
    except Exception as e:
        return {'error': str(e)}


def classify_activity(last_visit_str):
    now = datetime.now()
    try:
        for fmt in ['%d %B %Y', '%d %b %Y', '%d.%m.%Y', '%Y-%m-%d %H:%M']:
            try:
                dt = datetime.strptime(last_visit_str.split()[0] + ' ' + ' '.join(last_visit_str.split()[1:3]), fmt)
                diff = (now - dt).total_seconds() / 3600
                if diff < 2:
                    return 'Активен сегодня'
                elif diff < 24:
                    return 'Активен сегодня'
                elif diff < 72:
                    return 'Недавно был'
                elif diff < 168:
                    return 'Редкий онлайн'
                else:
                    return 'Давно не был'
            except ValueError:
                continue

        if any(w in last_visit_str.lower() for w in ['час', 'hour', 'минут', 'мин']):
            return 'Активен сегодня'
        elif any(w in last_visit_str.lower() for w in ['дн', 'day', 'вчера']):
            return 'Недавно был'
    except Exception:
        pass
    return 'Неизвестно'


def update_player_from_profile(player_id, nick):
    data = parse_profile(nick)
    if 'error' in data:
        return data

    conn = sqlite3.connect('data/aurus.db')
    c = conn.cursor()

    updates = []
    params = []

    if 'points' in data:
        updates.append("points = ?")
        params.append(data['points'])
    if 'top' in data:
        updates.append("rank_in_game = ?")
        params.append(f"ТОП {data['top']}")
    if 'last_visit_game' in data:
        updates.append("last_online = ?")
        params.append(data['last_visit_game'])
    if 'activity' in data:
        updates.append("activity = ?")
        params.append(data['activity'])
    if 'real_name' in data and data['real_name']:
        updates.append("name = ?")
        params.append(data['real_name'])

    if updates:
        params.append(player_id)
        c.execute(f"UPDATE players SET {', '.join(updates)} WHERE id = ?", params)

    conn.commit()
    conn.close()
    return data


def scan_all_players():
    conn = sqlite3.connect('data/aurus.db')
    c = conn.cursor()
    c.execute("SELECT id, nick FROM players WHERE nick NOT LIKE '% %'")
    players = c.fetchall()
    conn.close()

    results = []
    for pid, nick in players:
        result = update_player_from_profile(pid, nick)
        results.append({'nick': nick, 'data': result})

    return results
