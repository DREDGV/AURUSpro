from flask import Blueprint, render_template, session, redirect, url_for, jsonify, request
from utils.db import get_db
from utils.map_engine import (
    ALLIANCE_CENTER_X,
    ALLIANCE_CENTER_Y,
    ALLIANCE_MAX_X,
    ALLIANCE_MAX_Y,
    ALLIANCE_MIN_X,
    ALLIANCE_MIN_Y,
    alstation_radius,
    build_alstation_suggestions,
    corridor_gap_analysis,
    coverage_analysis,
    in_alliance_area,
    is_map_ready,
    normalize_map_object,
    parse_coordinates,
)

map_bp = Blueprint('map', __name__)


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
    skipped_legacy = []
    skipped_out_of_area = []

    players = db.execute(
        'SELECT id, nick, name, coordinates FROM players WHERE coordinates IS NOT NULL AND coordinates != ""'
    ).fetchall()
    for p in players:
        coords = parse_coordinates(p['coordinates'])
        if not coords:
            continue
        if not coords.get('normalized'):
            skipped_legacy.append({'source': 'players', 'id': p['id'], 'name': p['nick'], 'coordinates': p['coordinates']})
            continue
        if not in_alliance_area(coords):
            skipped_out_of_area.append({'source': 'players', 'id': p['id'], 'name': p['nick'], 'coordinates': p['coordinates']})
            continue
        objects.append(normalize_map_object({
                'type': 'capital',
                'subtype': None,
                'nick': p['nick'],
                'name': p['name'],
                'race': None,
                'player_id': p['id'],
                'url': url_for('players.card', player_id=p['id'])
            }, coords))

    accounts = db.execute(
        'SELECT a.id, a.nick, a.race, a.player_id, a.coordinates '
        'FROM accounts a WHERE a.coordinates IS NOT NULL AND a.coordinates != ""'
    ).fetchall()
    for a in accounts:
        coords = parse_coordinates(a['coordinates'])
        if not coords:
            continue
        if not coords.get('normalized'):
            skipped_legacy.append({'source': 'accounts', 'id': a['id'], 'name': a['nick'], 'coordinates': a['coordinates']})
            continue
        if not in_alliance_area(coords):
            skipped_out_of_area.append({'source': 'accounts', 'id': a['id'], 'name': a['nick'], 'coordinates': a['coordinates']})
            continue
        objects.append(normalize_map_object({
                'type': 'account',
                'subtype': None,
                'nick': a['nick'],
                'name': None,
                'race': a['race'],
                'player_id': a['player_id'],
                'url': url_for('players.card', player_id=a['player_id'])
            }, coords))

    gos = db.execute(
        'SELECT g.id, g.object_type, g.name, g.player_id, g.coordinates, g.level '
        'FROM game_objects g WHERE g.coordinates IS NOT NULL AND g.coordinates != ""'
    ).fetchall()
    for g in gos:
        coords = parse_coordinates(g['coordinates'])
        if not coords:
            continue
        if not coords.get('normalized'):
            skipped_legacy.append({'source': 'game_objects', 'id': g['id'], 'name': g['name'], 'coordinates': g['coordinates']})
            continue
        if not in_alliance_area(coords):
            skipped_out_of_area.append({'source': 'game_objects', 'id': g['id'], 'name': g['name'], 'coordinates': g['coordinates']})
            continue
        item = normalize_map_object({
                'id': g['id'],
                'type': 'object',
                'subtype': g['object_type'],
                'nick': None,
                'name': g['name'],
                'race': None,
                'level': g['level'] or 1,
                'player_id': g['player_id'],
                'url': None
            }, coords)
        if 'Алстанц' in (g['object_type'] or ''):
            item['radius'] = alstation_radius(g['level'])
        objects.append(item)

    db.close()

    if objects:
        xs = [o['x'] for o in objects]
        ys = [o['y'] for o in objects]
        bounds = {'min_x': min(xs), 'max_x': max(xs), 'min_y': min(ys), 'max_y': max(ys)}
    else:
        bounds = {'min_x': 0, 'max_x': 0, 'min_y': 0, 'max_y': 0}

    return jsonify({
        'objects': objects,
        'bounds': bounds,
        'meta': {
            'objects_count': len(objects),
            'legacy_coordinates_count': len(skipped_legacy),
            'legacy_coordinates': skipped_legacy[:50],
            'out_of_area_count': len(skipped_out_of_area),
            'out_of_area': skipped_out_of_area[:50],
            'area': {
                'min_x': ALLIANCE_MIN_X,
                'max_x': ALLIANCE_MAX_X,
                'min_y': ALLIANCE_MIN_Y,
                'max_y': ALLIANCE_MAX_Y,
                'center_x': ALLIANCE_CENTER_X,
                'center_y': ALLIANCE_CENTER_Y,
            }
        }
    })


@map_bp.route('/map/api/plan')
def api_plan():
    if 'user_id' not in session:
        return jsonify({'error': 'Auth required'}), 401
    try:
        planned_level = int(request.args.get('level', 10))
    except (TypeError, ValueError):
        planned_level = 10
    planned_level = max(1, min(planned_level, 20))

    corridor_x = request.args.get('corridor_x', type=int)
    corridor_y = request.args.get('corridor_y', type=int)
    corridor = (corridor_x, corridor_y) if corridor_x and corridor_y else None

    db = get_db()

    alstations = db.execute(
        'SELECT o.name, o.coordinates, o.level '
        'FROM game_objects o WHERE o.object_type = "Алстанция" AND o.coordinates != ""'
    ).fetchall()

    existing = []
    for a in alstations:
        coords = parse_coordinates(a['coordinates'])
        if coords and is_map_ready(coords):
            level = a['level'] or 1
            existing.append(normalize_map_object({
                'level': level,
                'radius': alstation_radius(level),
            }, coords))

    players = db.execute(
        'SELECT coordinates FROM players WHERE coordinates != ""'
    ).fetchall()
    player_points = []
    for p in players:
        coords = parse_coordinates(p['coordinates'])
        if coords and is_map_ready(coords):
            player_points.append(normalize_map_object({}, coords))

    analysis = coverage_analysis(player_points, existing)
    suggestions = build_alstation_suggestions(player_points, existing, level=planned_level,
                                               limit=30, corridor=corridor)
    corridor_info = corridor_gap_analysis(existing, level=planned_level, end_y=2560)

    db.close()
    return jsonify({
        'existing': existing,
        'suggestions': suggestions,
        'corridor': corridor_info,
        'coverage': {
            'total': analysis['total_players'],
            'covered': len(analysis['covered']),
            'uncovered': len(analysis['uncovered']),
            'coverage_pct': analysis['coverage_pct'],
            'uncovered_points': [
                {'x': p['x'], 'y': p['y'], 'wx': p['wx'], 'wy': p['wy']}
                for p in analysis['uncovered']
            ],
        },
        'meta': {
            'players_used': len(player_points),
            'stations_used': len(existing),
            'radius_per_level': alstation_radius(1),
            'planned_level': planned_level,
            'planned_radius': alstation_radius(planned_level),
            'corridor': corridor,
            'area': {
                'min_x': ALLIANCE_MIN_X,
                'max_x': ALLIANCE_MAX_X,
                'min_y': ALLIANCE_MIN_Y,
                'max_y': ALLIANCE_MAX_Y,
                'center_x': ALLIANCE_CENTER_X,
                'center_y': ALLIANCE_CENTER_Y,
            }
        }
    })


@map_bp.route('/map/api/stations', methods=['POST'])
def api_create_station():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400

    name = (data.get('name') or 'Алстанция').strip()
    level = max(1, min(int(data.get('level') or 1), 20))
    x = data.get('x')
    y = data.get('y')
    z = int(data.get('z') or 0)
    status = (data.get('status') or 'Активен').strip()
    comment = (data.get('comment') or '').strip()
    subtype = (data.get('subtype') or 'Алстанция').strip()

    if x is None or y is None:
        return jsonify({'error': 'x и y обязательны'}), 400
    x, y = int(x), int(y)
    if not (ALLIANCE_MIN_X <= x <= ALLIANCE_MAX_X and ALLIANCE_MIN_Y <= y <= ALLIANCE_MAX_Y):
        return jsonify({'error': 'Координаты вне зоны альянса'}), 400

    coord_str = '[%d:%d:%d]' % (x, y, z)
    db = get_db()
    cursor = db.execute(
        'INSERT INTO game_objects (object_type, name, coordinates, level, status, controlled, comment) '
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        (subtype, name, coord_str, level, status, 1, comment or None)
    )
    db.commit()
    new_id = cursor.lastrowid
    db.close()

    return jsonify({
        'id': new_id,
        'name': name,
        'level': level,
        'x': x, 'y': y, 'z': z,
        'coordinates': coord_str,
        'radius': alstation_radius(level),
    }), 201


@map_bp.route('/map/api/stations/<int:station_id>', methods=['PUT'])
def api_update_station(station_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400

    db = get_db()
    row = db.execute(
        'SELECT id FROM game_objects WHERE id = ?', (station_id,)
    ).fetchone()
    if not row:
        db.close()
        return jsonify({'error': 'Не найдено'}), 404

    updates = []
    params = []
    if 'name' in data:
        updates.append('name = ?')
        params.append((data['name'] or '').strip() or None)
    if 'level' in data:
        level = max(1, min(int(data['level']), 20))
        updates.append('level = ?')
        params.append(level)
    if 'x' in data and 'y' in data:
        x, y = int(data['x']), int(data['y'])
        z = int(data.get('z') or 0)
        if ALLIANCE_MIN_X <= x <= ALLIANCE_MAX_X and ALLIANCE_MIN_Y <= y <= ALLIANCE_MAX_Y:
            updates.append('coordinates = ?')
            params.append('[%d:%d:%d]' % (x, y, z))
    if 'status' in data:
        updates.append('status = ?')
        params.append((data['status'] or 'Активен').strip())
    if 'comment' in data:
        updates.append('comment = ?')
        params.append(data['comment'] or None)
    if 'object_type' in data:
        updates.append('object_type = ?')
        params.append((data['object_type'] or 'Алстанция').strip())

    if updates:
        params.append(station_id)
        db.execute('UPDATE game_objects SET %s WHERE id = ?' % ', '.join(updates), params)
        db.commit()

    updated = db.execute(
        'SELECT id, name, coordinates, level, status, comment, object_type FROM game_objects WHERE id = ?', (station_id,)
    ).fetchone()
    db.close()

    coords = parse_coordinates(updated['coordinates']) if updated else None
    level = updated['level'] or 1
    return jsonify({
        'id': updated['id'],
        'name': updated['name'],
        'level': level,
        'x': coords['x'] if coords else None,
        'y': coords['y'] if coords else None,
        'z': coords['z'] if coords else 0,
        'coordinates': updated['coordinates'],
        'radius': alstation_radius(level),
        'status': updated['status'],
        'comment': updated['comment'] or '',
        'object_type': updated['object_type'],
    })


@map_bp.route('/map/api/stations/<int:station_id>', methods=['DELETE'])
def api_delete_station(station_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    db = get_db()
    row = db.execute(
        'SELECT id FROM game_objects WHERE id = ?', (station_id,)
    ).fetchone()
    if not row:
        db.close()
        return jsonify({'error': 'Не найдено'}), 404
    db.execute('DELETE FROM game_objects WHERE id = ?', (station_id,))
    db.commit()
    db.close()
    return jsonify({'ok': True})


@map_bp.route('/map/api/stations/<int:station_id>', methods=['GET'])
def api_get_station(station_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    db = get_db()
    row = db.execute(
        'SELECT id, name, coordinates, level, object_type FROM game_objects WHERE id = ?',
        (station_id,)
    ).fetchone()
    if not row:
        db.close()
        return jsonify({'error': 'Не найдена'}), 404

    status = 'Активен'
    comment = ''
    try:
        extra = db.execute('SELECT status, comment FROM game_objects WHERE id = ?', (station_id,)).fetchone()
        if extra:
            status = extra['status'] or 'Активен'
            comment = extra['comment'] or ''
    except Exception:
        pass
    db.close()

    coords = parse_coordinates(row['coordinates'])
    level = row['level'] or 1
    return jsonify({
        'id': row['id'],
        'name': row['name'],
        'level': level,
        'x': coords['x'] if coords else None,
        'y': coords['y'] if coords else None,
        'z': coords['z'] if coords else 0,
        'coordinates': row['coordinates'],
        'radius': alstation_radius(level),
        'status': status,
        'comment': comment,
        'object_type': row['object_type'],
    })
