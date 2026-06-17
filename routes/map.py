from flask import Blueprint, render_template, session, redirect, url_for, jsonify
from utils.db import get_db
import re

map_bp = Blueprint('map', __name__)

COORD_PATTERN_COLON = re.compile(r'\[?(\d+):(\d+):(\d+)\]?')
COORD_PATTERN_SLASH = re.compile(r'(\d+)/(\d+)/(\d+)')


def parse_coordinates(coord_str):
    if not coord_str:
        return None
    m = COORD_PATTERN_COLON.search(coord_str)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    m = COORD_PATTERN_SLASH.search(coord_str)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    return None


@map_bp.route('/map')
def index():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    return render_template('map/index.html')


@map_bp.route('/map/api/data')
def api_data():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    db = get_db()
    objects = []

    players = db.execute(
        'SELECT id, nick, name, coordinates FROM players WHERE coordinates IS NOT NULL AND coordinates != ""'
    ).fetchall()
    for p in players:
        coords = parse_coordinates(p['coordinates'])
        if coords:
            x, y, z = coords
            objects.append({
                'type': 'capital',
                'subtype': None,
                'nick': p['nick'],
                'name': p['name'],
                'race': None,
                'x': x, 'y': y, 'z': z,
                'player_id': p['id'],
                'url': url_for('players.card', player_id=p['id'])
            })

    accounts = db.execute(
        'SELECT a.id, a.nick, a.race, a.player_id, a.coordinates '
        'FROM accounts a WHERE a.coordinates IS NOT NULL AND a.coordinates != ""'
    ).fetchall()
    for a in accounts:
        coords = parse_coordinates(a['coordinates'])
        if coords:
            x, y, z = coords
            objects.append({
                'type': 'account',
                'subtype': None,
                'nick': a['nick'],
                'name': None,
                'race': a['race'],
                'x': x, 'y': y, 'z': z,
                'player_id': a['player_id'],
                'url': url_for('players.card', player_id=a['player_id'])
            })

    gos = db.execute(
        'SELECT g.id, g.object_type, g.name, g.player_id, g.coordinates, g.level '
        'FROM game_objects g WHERE g.coordinates IS NOT NULL AND g.coordinates != ""'
    ).fetchall()
    for g in gos:
        coords = parse_coordinates(g['coordinates'])
        if coords:
            x, y, z = coords
            objects.append({
                'type': 'object',
                'subtype': g['object_type'],
                'nick': None,
                'name': g['name'],
                'race': None,
                'x': x, 'y': y, 'z': z,
                'level': g['level'] or 1,
                'player_id': g['player_id'],
                'url': None
            })

    db.close()

    if objects:
        xs = [o['x'] for o in objects]
        ys = [o['y'] for o in objects]
        bounds = {'min_x': min(xs), 'max_x': max(xs), 'min_y': min(ys), 'max_y': max(ys)}
    else:
        bounds = {'min_x': 0, 'max_x': 0, 'min_y': 0, 'max_y': 0}

    return jsonify({'objects': objects, 'bounds': bounds})


@map_bp.route('/map/api/plan')
def api_plan():
    if 'user_id' not in session:
        return jsonify({'error': 'Auth required'}), 401
    db = get_db()

    alstations = db.execute(
        'SELECT o.name, o.coordinates, o.level '
        'FROM game_objects o WHERE o.object_type = "Алстанция" AND o.coordinates != ""'
    ).fetchall()

    existing = []
    for a in alstations:
        coords = parse_coordinates(a['coordinates'])
        if coords:
            existing.append({
                'x': coords[0], 'y': coords[1],
                'level': a['level'] or 1,
                'radius': (a['level'] or 1) * 100
            })

    players = db.execute(
        'SELECT coordinates FROM players WHERE coordinates != ""'
    ).fetchall()
    player_coords = []
    for p in players:
        coords = parse_coordinates(p['coordinates'])
        if coords:
            player_coords.append((coords[0], coords[1]))

    if player_coords:
        min_x = min(c[0] for c in player_coords) - 200
        max_x = max(c[0] for c in player_coords) + 200
        min_y = min(c[1] for c in player_coords) - 200
        max_y = max(c[1] for c in player_coords) + 200
    else:
        min_x, max_x, min_y, max_y = 2300, 2700, 2300, 2700

    step = 500
    suggestions = []
    for x in range(min_x, max_x + 1, step):
        for y in range(min_y, max_y + 1, step):
            min_dist = float('inf')
            for e in existing:
                dist = ((x - e['x'])**2 + (y - e['y'])**2)**0.5
                min_dist = min(min_dist, dist)
            nearby = sum(1 for px, py in player_coords
                        if ((x - px)**2 + (y - py)**2)**0.5 < 500)
            if nearby > 0 and min_dist > 200:
                suggestions.append({
                    'x': x, 'y': y,
                    'nearby_players': nearby,
                    'min_dist_to_existing': int(min_dist),
                    'score': nearby * 10 - int(min_dist) / 10
                })

    suggestions.sort(key=lambda s: s['score'], reverse=True)

    db.close()
    return jsonify({
        'existing': existing,
        'suggestions': suggestions[:20]
    })
