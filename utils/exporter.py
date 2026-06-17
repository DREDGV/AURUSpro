import csv
import io
from openpyxl import Workbook
from utils.db import get_db


def export_players_excel():
    db = get_db()
    players = db.execute('SELECT * FROM players ORDER BY points DESC').fetchall()
    db.close()

    wb = Workbook()
    ws = wb.active
    ws.title = 'Игроки'

    headers = ['№', 'Ник', 'Имя', 'Обращение', 'Страна', 'Город', 'Часовой пояс',
               'Звание', 'Очки', 'Рейтинг 1', 'Рейтинг 2', 'Рейтинг 3',
               'Планеты', 'Координаты', 'Активность', 'Статус', 'Роль',
               'Доверие', 'Помощь', 'Дата вступления', 'Комментарий']
    ws.append(headers)

    for i, p in enumerate(players, 1):
        ws.append([
            i, p['nick'], p['name'] or '', p['how_to_address'] or '',
            p['country'] or '', p['city'] or '', p['timezone'] or '',
            p['rank_in_game'] or '', p['points'] or 0,
            p['rating1'] or '', p['rating2'] or '', p['rating3'] or '',
            p['planets'] or '', p['coordinates'] or '',
            p['activity'] or '', p['player_status'] or '',
            p['role'] or '', p['trust_level'] or '',
            'Да' if p['willing_to_help'] else 'Нет',
            p['registration_date'] or '', p['comment'] or ''
        ])

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output


def export_players_csv():
    db = get_db()
    players = db.execute('SELECT * FROM players ORDER BY points DESC').fetchall()
    db.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['№', 'Ник', 'Имя', 'Страна', 'Город', 'Звание', 'Очки',
                      'Активность', 'Статус', 'Роль', 'Доверие'])

    for i, p in enumerate(players, 1):
        writer.writerow([
            i, p['nick'], p['name'] or '', p['country'] or '',
            p['city'] or '', p['rank_in_game'] or '', p['points'] or 0,
            p['activity'] or '', p['player_status'] or '',
            p['role'] or '', p['trust_level'] or ''
        ])

    return io.BytesIO(output.getvalue().encode('utf-8-sig'))


def export_players_html():
    db = get_db()
    players = db.execute('SELECT * FROM players ORDER BY points DESC').fetchall()
    db.close()

    html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'
    html += '<title>AURUS — Игроки</title>'
    html += '<style>body{font-family:sans-serif;margin:20px}table{border-collapse:collapse;width:100%}'
    html += 'th,td{border:1px solid #ddd;padding:8px;text-align:left}'
    html += 'th{background:#333;color:white}tr:nth-child(even){background:#f2f2f2}</style></head><body>'
    html += '<h1>AURUS [SILA] — Список игроков</h1>'
    html += '<table><tr><th>№</th><th>Ник</th><th>Звание</th><th>Очки</th>'
    html += '<th>Активность</th><th>Статус</th><th>Роль</th></tr>'

    for i, p in enumerate(players, 1):
        html += f'<tr><td>{i}</td><td>{p["nick"]}</td><td>{p["rank_in_game"] or "—"}</td>'
        html += f'<td>{p["points"] or 0:,}</td><td>{p["activity"] or "—"}</td>'
        html += f'<td>{p["player_status"] or "—"}</td><td>{p["role"] or "—"}</td></tr>'

    html += '</table></body></html>'
    return io.BytesIO(html.encode('utf-8'))
