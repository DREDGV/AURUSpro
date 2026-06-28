import re

from flask import Blueprint, render_template, session, redirect, url_for, jsonify, request
from utils.db import get_db
from utils.schema import ensure_alliance_schema
from utils.map_engine import (
    ALLIANCE_CENTER_X,
    ALLIANCE_CENTER_Y,
    ALLIANCE_MAX_X,
    ALLIANCE_MAX_Y,
    ALLIANCE_MIN_X,
    ALLIANCE_MIN_Y,
    alstation_radius,
    build_greedy_alstation_network,
    build_alstation_suggestions,
    classify_alstation_network,
    compare_alstation_levels,
    corridor_gap_analysis,
    coverage_analysis,
    evaluate_alstation_at,
    in_alliance_area,
    is_map_ready,
    normalize_map_object,
    parse_coordinates,
    world_x,
    world_y,
)

map_bp = Blueprint('map', __name__)


def _is_alstation_type(value):
    text = value or ''
    return 'Алстанц' in text or 'Альстанц' in text


_COORD_RE = re.compile(r'\[?(\d{1,4})\s*[:：]\s*(\d{1,4})\s*[:：]\s*(\d{1,2})\]?')
_AL_WORDS = ('алстанц', 'альстанц', 'алк', 'альянс')
_OPS_WORDS = ('опс', 'опорн')
_GATE_WORDS = ('врат',)
_MOON_WORDS = ('лун',)
_DUNYA_WORDS = ('дун',)
_PLAN_WORDS = ('план', 'стро', 'буду', 'хочу', 'кача', 'для ал', 'под ал')
_LEVEL_WORDS = ('уровен', 'ур', 'lvl', 'level')


def _coord_string(coords):
    return '[%d:%d:%d]' % (coords['x'], coords['y'], coords['z'])


def _has_any(text, words):
    return any(word in text for word in words)


def _number_tokens(text):
    tokens = []
    start = None
    for idx, ch in enumerate(text):
        if ch.isdigit():
            if start is None:
                start = idx
        elif start is not None:
            raw = text[start:idx]
            tokens.append({'value': int(raw), 'start': start, 'end': idx})
            start = None
    if start is not None:
        raw = text[start:]
        tokens.append({'value': int(raw), 'start': start, 'end': len(text)})
    return tokens


def _infer_level(segment):
    cleaned = _COORD_RE.sub(' ', segment.lower())
    numbers = [n for n in _number_tokens(cleaned) if 1 <= n['value'] <= 20]
    if not numbers:
        return None

    marker_positions = []
    for word in _LEVEL_WORDS:
        pos = cleaned.find(word)
        while pos >= 0:
            marker_positions.append(pos)
            pos = cleaned.find(word, pos + len(word))
    if marker_positions:
        best = None
        best_dist = 999
        for n in numbers:
            for pos in marker_positions:
                dist = min(abs(n['start'] - pos), abs(n['end'] - pos))
                if dist < best_dist:
                    best_dist = dist
                    best = n['value']
        if best_dist <= 20:
            return best

    if _has_any(cleaned, _AL_WORDS + _GATE_WORDS):
        suffixed = []
        for n in numbers:
            suffix = cleaned[n['end']:n['end'] + 2]
            if suffix.startswith('а') or suffix.startswith('го'):
                suffixed.append(n['value'])
        if suffixed:
            return max(suffixed)
    return None


def _kind_distance(segment, from_right=False):
    text = segment.lower()
    candidates = [
        ('gate', _GATE_WORDS),
        ('alstation', _AL_WORDS),
        ('ops', _OPS_WORDS),
        ('dunya', _DUNYA_WORDS),
        ('moon', _MOON_WORDS),
    ]
    best = None
    for kind, words in candidates:
        for word in words:
            pos = text.rfind(word) if from_right else text.find(word)
            if pos < 0:
                continue
            dist = (len(text) - pos - len(word)) if from_right else pos
            if best is None or dist < best[1]:
                best = (kind, dist)
    return best or ('unknown', 999)


def _infer_kind(segment):
    text = segment.lower()
    if _has_any(text, _GATE_WORDS):
        return 'gate'
    if _has_any(text, _AL_WORDS):
        return 'alstation'
    if _has_any(text, _OPS_WORDS):
        return 'ops'
    if _has_any(text, _DUNYA_WORDS):
        return 'dunya'
    if _has_any(text, _MOON_WORDS):
        return 'moon'
    return 'unknown'


def _object_kind(object_type):
    text = (object_type or '').lower()
    if _is_alstation_type(object_type):
        return 'alstation'
    if _has_any(text, _GATE_WORDS):
        return 'gate'
    if _has_any(text, _OPS_WORDS):
        return 'ops'
    if _has_any(text, _DUNYA_WORDS):
        return 'dunya'
    if _has_any(text, _MOON_WORDS):
        return 'moon'
    return 'object'


def _source_text_rows(db):
    rows = []
    for row in db.execute(
        'SELECT n.id, n.player_id, p.nick, n.content, n.created_at '
        'FROM player_notes n LEFT JOIN players p ON p.id = n.player_id'
    ).fetchall():
        rows.append({
            'source_type': 'note',
            'source_id': row['id'],
            'player_id': row['player_id'],
            'player': row['nick'],
            'text': row['content'] or '',
            'date': row['created_at'] or '',
        })
    for row in db.execute(
        'SELECT m.id, m.player_id, p.nick, m.account_nick, m.message_text, m.message_date '
        'FROM messages m LEFT JOIN players p ON p.id = m.player_id'
    ).fetchall():
        rows.append({
            'source_type': 'message',
            'source_id': row['id'],
            'player_id': row['player_id'],
            'player': row['nick'] or row['account_nick'],
            'text': row['message_text'] or '',
            'date': row['message_date'] or '',
        })
    for row in db.execute(
        'SELECT id, nick, comment, current_activity, desired_activity, can_help_with, needs_help_with FROM players'
    ).fetchall():
        for field in ('comment', 'current_activity', 'desired_activity', 'can_help_with', 'needs_help_with'):
            if row[field]:
                rows.append({
                    'source_type': 'player.%s' % field,
                    'source_id': row['id'],
                    'player_id': row['id'],
                    'player': row['nick'],
                    'text': row[field],
                    'date': '',
                })
    return rows


def _extract_intel_facts(db):
    facts = []
    for source in _source_text_rows(db):
        text = source['text']
        matches = list(_COORD_RE.finditer(text))
        for idx, match in enumerate(matches):
            coords = parse_coordinates(match.group(0))
            if not coords or not coords.get('normalized') or not in_alliance_area(coords):
                continue

            prev_end = matches[idx - 1].end() if idx > 0 else max(0, match.start() - 120)
            next_start = matches[idx + 1].start() if idx + 1 < len(matches) else min(len(text), match.end() + 120)
            before = text[prev_end:match.start()]
            after = text[match.end():next_start]
            before_kind, before_dist = _kind_distance(before, from_right=True)
            after_kind, after_dist = _kind_distance(after, from_right=False)
            after_starts_new_sentence = after.lstrip().startswith(('.', ';', '!', '?'))
            if before_kind != 'unknown' and (after_starts_new_sentence or before_dist <= after_dist):
                segment = before + match.group(0)
                kind = before_kind
            elif after_kind != 'unknown':
                segment = match.group(0) + after
                kind = after_kind
            else:
                segment = text[prev_end:next_start]
                kind = _infer_kind(segment)
            if kind == 'unknown':
                continue

            point = normalize_map_object({}, coords)
            level = _infer_level(segment) if kind in ('alstation', 'gate') else None
            facts.append({
                'source_type': source['source_type'],
                'source_id': source['source_id'],
                'player_id': source['player_id'],
                'player': source['player'],
                'date': source['date'],
                'kind': kind,
                'level': level,
                'planned': _has_any(segment.lower(), _PLAN_WORDS),
                'coordinates': _coord_string(coords),
                'x': coords['x'],
                'y': coords['y'],
                'z': coords['z'],
                'wx': point['wx'],
                'wy': point['wy'],
                'snippet': ' '.join(segment.split())[:260],
            })
    return facts


def _ensure_plan_table(db):
    db.execute('''CREATE TABLE IF NOT EXISTS map_planned_alstations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        z INTEGER DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 10,
        status TEXT DEFAULT 'План',
        comment TEXT,
        locked INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')


def _task_type_label(value):
    labels = {
        'build_alstation': 'Построить алстанцию',
        'move_alstation': 'Перенести алстанцию',
        'check_network': 'Проверить сеть',
        'scout_point': 'Разведать точку',
        'support_player': 'Помочь игроку',
        'other': 'Другое',
    }
    return labels.get(value or 'other', value or 'Другое')


def _task_payload(row):
    coords = parse_coordinates(row['coordinates'] or '')
    payload = {
        'id': row['id'],
        'title': row['title'],
        'direction': row['direction'],
        'description': row['description'],
        'assignee_id': row['assignee_id'],
        'assignee_nick': row['assignee_nick'],
        'priority': row['priority'],
        'status': row['status'],
        'deadline': row['deadline'],
        'coordinates': row['coordinates'],
        'task_type': row['task_type'] or 'other',
        'task_type_label': _task_type_label(row['task_type']),
        'map_object_id': row['map_object_id'],
        'map_object_type': row['map_object_type'],
        'url': url_for('tasks.detail', task_id=row['id']),
    }
    if coords:
        payload.update({
            'x': coords['x'],
            'y': coords['y'],
            'z': coords['z'],
            'wx': world_x(coords['x']),
            'wy': world_y(coords['y']),
        })
    return payload


def _network_issue_payload(station):
    issue_type = 'isolated'
    title = 'Алстанция вне общей сети'
    severity = 'high'
    if station.get('network_status') == 'signal_only':
        issue_type = 'signal_only'
        title = 'Сигнал есть, но общей сети нет'
        severity = 'medium'
    elif station.get('network_status') == 'isolated':
        issue_type = 'isolated'
        title = 'Нет связи с сетью'
        severity = 'high'
    return {
        'id': station.get('id'),
        'name': station.get('name') or 'Алстанция',
        'title': title,
        'issue_type': issue_type,
        'severity': severity,
        'x': station.get('x'),
        'y': station.get('y'),
        'z': station.get('z', 0),
        'wx': station.get('wx'),
        'wy': station.get('wy'),
        'level': station.get('level'),
        'radius': station.get('radius'),
        'network_status': station.get('network_status'),
        'network_parent': station.get('network_parent'),
        'network_touch_delta': station.get('network_touch_delta'),
    }


def _existing_alstations(db):
    rows = db.execute(
        'SELECT o.id, o.name, o.object_type, o.coordinates, o.level '
        'FROM game_objects o WHERE o.coordinates != ""'
    ).fetchall()
    existing = []
    for row in rows:
        if not _is_alstation_type(row['object_type']):
            continue
        coords = parse_coordinates(row['coordinates'])
        if coords and is_map_ready(coords):
            level = row['level'] or 1
            existing.append(normalize_map_object({
                'id': row['id'],
                'name': row['name'],
                'level': level,
                'radius': alstation_radius(level),
            }, coords))
    return classify_alstation_network(existing, fallback_level=10)


def _target_weight(kind, source='object'):
    if kind == 'ops':
        return 6
    if kind == 'gate':
        return 5
    if source == 'players':
        return 4
    if source == 'accounts':
        return 3
    if kind in ('dunya', 'moon'):
        return 2
    return 1


def _target_points(db, target_filters=None):
    filters = set(target_filters or ('players', 'accounts', 'ops', 'gate', 'dunya', 'moon'))
    points = []

    rows = db.execute(
        'SELECT id, nick AS name, coordinates FROM players WHERE coordinates != ""'
    ).fetchall()
    if 'players' in filters:
        for row in rows:
            coords = parse_coordinates(row['coordinates'])
            if coords and is_map_ready(coords):
                points.append(normalize_map_object({
                    'id': row['id'],
                    'name': row['name'],
                    'source': 'players',
                    'target_type': 'player',
                    'weight': _target_weight('player', 'players'),
                }, coords))

    if 'accounts' in filters:
        rows = db.execute(
            'SELECT id, nick AS name, coordinates FROM accounts WHERE coordinates != ""'
        ).fetchall()
        for row in rows:
            coords = parse_coordinates(row['coordinates'])
            if coords and is_map_ready(coords):
                points.append(normalize_map_object({
                    'id': row['id'],
                    'name': row['name'],
                    'source': 'accounts',
                    'target_type': 'account',
                    'weight': _target_weight('account', 'accounts'),
                }, coords))

    object_filters = filters.intersection({'ops', 'gate', 'dunya', 'moon', 'object'})
    if object_filters:
        rows = db.execute(
            'SELECT id, object_type, name, coordinates FROM game_objects WHERE coordinates != ""'
        ).fetchall()
        for row in rows:
            kind = _object_kind(row['object_type'])
            if kind == 'alstation':
                continue
            if kind not in object_filters and not ('object' in object_filters and kind == 'object'):
                continue
            coords = parse_coordinates(row['coordinates'])
            if coords and is_map_ready(coords):
                points.append(normalize_map_object({
                    'id': row['id'],
                    'name': row['name'] or row['object_type'],
                    'source': 'game_objects',
                    'target_type': kind,
                    'weight': _target_weight(kind, 'objects'),
                }, coords))
    return points


def _clean_target_filters(value):
    allowed = {'players', 'accounts', 'ops', 'gate', 'dunya', 'moon', 'object'}
    filters = []
    for chunk in str(value or '').replace(';', ',').split(','):
        item = chunk.strip().lower()
        if item in allowed and item not in filters:
            filters.append(item)
    return filters or ['players', 'accounts', 'ops', 'gate', 'dunya', 'moon']


def _coverage_point_payload(point):
    return {
        'x': point['x'],
        'y': point['y'],
        'z': point.get('z', 0),
        'wx': point['wx'],
        'wy': point['wy'],
        'name': point.get('name'),
        'target_type': point.get('target_type'),
        'weight': point.get('weight', 1),
    }


def _clean_levels(value, fallback=(8, 10, 12)):
    levels = []
    for chunk in str(value or '').replace(';', ',').split(','):
        try:
            level = int(chunk.strip())
        except (TypeError, ValueError):
            continue
        if 1 <= level <= 20 and level not in levels:
            levels.append(level)
    return levels or list(fallback)


@map_bp.route('/map')
def index():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    db = get_db()
    players = db.execute('SELECT id, nick FROM players ORDER BY nick').fetchall()
    db.close()
    return render_template('map/index.html', players=players)



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
        'SELECT g.id, g.object_type, g.name, g.player_id, g.coordinates, g.level, g.status, g.comment '
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
                'status': g['status'] or '',
                'comment': g['comment'] or '',
                'player_id': g['player_id'],
                'url': None
            }, coords)
        if _is_alstation_type(g['object_type']):
            item['radius'] = alstation_radius(g['level'])
        objects.append(item)

    alstations = [
        item for item in objects
        if item.get('type') == 'object' and _is_alstation_type(item.get('subtype'))
    ]
    classified_stations = classify_alstation_network(alstations, fallback_level=10)
    by_key = {
        (station.get('id'), station.get('x'), station.get('y'), station.get('z', 0)): station
        for station in classified_stations
        if not station.get('virtual')
    }
    for item in alstations:
        classified = by_key.get((item.get('id'), item.get('x'), item.get('y'), item.get('z', 0)))
        if classified:
            item.update({
                'network_connected': classified.get('network_connected', False),
                'network_status': classified.get('network_status'),
                'network_parent': classified.get('network_parent'),
                'network_touch_delta': classified.get('network_touch_delta'),
            })
    for station in classified_stations:
        if station.get('virtual'):
            objects.append({
                'id': 'main',
                'type': 'object',
                'subtype': 'Алстанция',
                'nick': None,
                'name': station.get('name') or 'Главная алстанция',
                'race': None,
                'level': station.get('level') or 10,
                'player_id': None,
                'url': None,
                'x': station['x'],
                'y': station['y'],
                'z': station.get('z', 0),
                'wx': station['wx'],
                'wy': station['wy'],
                'coord_format': 'colon',
                'map_ready': True,
                'radius': station.get('radius') or alstation_radius(10),
                'network_connected': True,
                'network_status': 'main',
                'network_parent': None,
                'network_touch_delta': 0,
                'virtual': True,
            })

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
    target_filters = _clean_target_filters(request.args.get('targets'))
    scenario = (request.args.get('scenario') or 'max_coverage').strip()

    db = get_db()

    existing = _existing_alstations(db)
    player_points = _target_points(db, target_filters)

    analysis = coverage_analysis(player_points, existing)
    suggestions = build_greedy_alstation_network(
        player_points,
        existing,
        levels=[planned_level],
        count=30,
    )
    if corridor and not suggestions:
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
                _coverage_point_payload(p)
                for p in analysis['uncovered']
            ],
            'weight_total': analysis.get('total_weight', 0),
            'weight_covered': analysis.get('covered_weight', 0),
            'weight_pct': analysis.get('weight_pct', 0),
        },
        'meta': {
            'players_used': len(player_points),
            'target_filters': target_filters,
            'stations_used': len(existing),
            'radius_per_level': alstation_radius(1),
            'planned_level': planned_level,
            'planned_radius': alstation_radius(planned_level),
            'corridor': corridor,
            'scenario': scenario,
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


@map_bp.route('/map/api/intel')
def api_intel():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    db = get_db()
    facts = _extract_intel_facts(db)
    objects = db.execute(
        'SELECT g.id, g.player_id, p.nick AS player, g.object_type, g.name, g.coordinates, g.level, g.status '
        'FROM game_objects g LEFT JOIN players p ON p.id = g.player_id '
        'WHERE g.coordinates IS NOT NULL AND g.coordinates != ""'
    ).fetchall()

    by_coord = {}
    skipped = []
    for obj in objects:
        coords = parse_coordinates(obj['coordinates'])
        if not coords or not coords.get('normalized') or not in_alliance_area(coords):
            skipped.append({
                'id': obj['id'],
                'name': obj['name'],
                'object_type': obj['object_type'],
                'coordinates': obj['coordinates'],
                'level': obj['level'],
                'player': obj['player'],
            })
            continue
        key = _coord_string(coords)
        by_coord.setdefault(key, []).append({
            'id': obj['id'],
            'player_id': obj['player_id'],
            'player': obj['player'],
            'object_type': obj['object_type'],
            'kind': _object_kind(obj['object_type']),
            'name': obj['name'],
            'coordinates': key,
            'level': obj['level'],
            'status': obj['status'],
        })

    enriched = []
    for fact in facts:
        matches = by_coord.get(fact['coordinates'], [])
        same_kind = [obj for obj in matches if obj['kind'] == fact['kind']]
        relevant = same_kind
        status = 'missing'
        if same_kind:
            status = 'found'
            if fact['level'] and not any((obj.get('level') or 0) == fact['level'] for obj in same_kind):
                status = 'level_mismatch'
        item = dict(fact)
        item['matches'] = relevant
        item['same_coordinate_objects'] = matches
        item['status'] = status
        enriched.append(item)

    dedup = {}
    for item in enriched:
        key = (item['kind'], item['coordinates'], item.get('player_id'), item['status'])
        current = dedup.get(key)
        if not current or (item.get('level') and not current.get('level')) or len(item['snippet']) > len(current['snippet']):
            dedup[key] = item
    result = list(dedup.values())
    result.sort(key=lambda x: (x['status'] == 'found', x['kind'], x['coordinates'], x.get('player') or ''))

    db.close()
    return jsonify({
        'facts': result,
        'summary': {
            'total': len(result),
            'found': sum(1 for item in result if item['status'] == 'found'),
            'missing': sum(1 for item in result if item['status'] == 'missing'),
            'type_mismatch': sum(1 for item in result if item['status'] == 'type_mismatch'),
            'level_mismatch': sum(1 for item in result if item['status'] == 'level_mismatch'),
            'skipped_objects': len(skipped),
        },
        'skipped_objects': skipped[:50],
    })


@map_bp.route('/map/api/planned-stations', methods=['GET'])
def api_get_planned_stations():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    db = get_db()
    _ensure_plan_table(db)
    rows = db.execute(
        'SELECT id, name, x, y, z, level, status, comment, locked '
        'FROM map_planned_alstations ORDER BY id'
    ).fetchall()
    stations = []
    for row in rows:
        coords = {'x': row['x'], 'y': row['y'], 'z': row['z'] or 0, 'format': 'colon', 'normalized': True}
        item = normalize_map_object({
            'id': row['id'],
            'name': row['name'] or ('План %d' % row['id']),
            'level': row['level'] or 10,
            'radius': alstation_radius(row['level'] or 10),
            'status': row['status'] or 'План',
            'comment': row['comment'] or '',
            'locked': bool(row['locked']),
        }, coords)
        stations.append(item)
    db.close()
    return jsonify({'stations': stations})


@map_bp.route('/map/api/planned-stations', methods=['PUT'])
def api_save_planned_stations():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json() or {}
    stations = data.get('stations') or []

    db = get_db()
    _ensure_plan_table(db)
    db.execute('DELETE FROM map_planned_alstations')
    for item in stations:
        x = int(item.get('x') or item.get('sx') or 0)
        y = int(item.get('y') or item.get('sy') or 0)
        z = int(item.get('z') or 0)
        if not (ALLIANCE_MIN_X <= x <= ALLIANCE_MAX_X and ALLIANCE_MIN_Y <= y <= ALLIANCE_MAX_Y):
            continue
        level = max(1, min(int(item.get('level') or 10), 20))
        db.execute(
            'INSERT INTO map_planned_alstations (name, x, y, z, level, status, comment, locked) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (
                (item.get('name') or '').strip() or ('План %d' % level),
                x,
                y,
                z,
                level,
                (item.get('status') or 'План').strip(),
                (item.get('comment') or '').strip() or None,
                1 if item.get('locked') else 0,
            )
        )
    db.commit()
    db.close()
    return jsonify({'ok': True, 'count': len(stations)})


@map_bp.route('/map/api/tasks', methods=['GET'])
def api_map_tasks():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    db = get_db()
    ensure_alliance_schema(db)
    rows = db.execute(
        '''SELECT t.*, p.nick as assignee_nick
           FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id
           WHERE t.coordinates IS NOT NULL AND t.coordinates != ''
           ORDER BY
             CASE t.priority WHEN 'Критический' THEN 0 WHEN 'Высокий' THEN 1 WHEN 'Средний' THEN 2 ELSE 3 END,
             CASE t.status WHEN 'Новая' THEN 0 WHEN 'В работе' THEN 1 WHEN 'Ожидает' THEN 2 WHEN 'Выполнена' THEN 4 ELSE 3 END,
             t.created_at DESC'''
    ).fetchall()
    tasks = []
    for row in rows:
        item = _task_payload(row)
        if item.get('x') is not None and is_map_ready({'x': item['x'], 'y': item['y'], 'z': item.get('z', 0)}):
            tasks.append(item)
    db.close()
    return jsonify({'tasks': tasks})


@map_bp.route('/map/api/tasks', methods=['POST'])
def api_create_map_task():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json() or {}
    x = data.get('x')
    y = data.get('y')
    z = data.get('z', 0) or 0
    try:
        x = int(x)
        y = int(y)
        z = int(z)
    except (TypeError, ValueError):
        return jsonify({'error': 'Valid x, y, z are required'}), 400
    if not (ALLIANCE_MIN_X <= x <= ALLIANCE_MAX_X and ALLIANCE_MIN_Y <= y <= ALLIANCE_MAX_Y):
        return jsonify({'error': 'Coordinates outside alliance area'}), 400

    title = (data.get('title') or '').strip()
    task_type = (data.get('task_type') or 'other').strip()
    if not title:
        title = _task_type_label(task_type)
    coords = '[%d:%d:%d]' % (x, y, z)
    priority = (data.get('priority') or 'Средний').strip()
    status = (data.get('status') or 'Новая').strip()
    direction = (data.get('direction') or 'Карта').strip()

    db = get_db()
    ensure_alliance_schema(db)
    db.execute(
        '''INSERT INTO tasks (title, direction, description, assignee_id, participants, priority, status,
           deadline, comment, coordinates, map_object_id, map_object_type, task_type, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
        (
            title,
            direction,
            (data.get('description') or '').strip() or None,
            data.get('assignee_id') or None,
            data.get('participants'),
            priority,
            status,
            data.get('deadline'),
            data.get('comment'),
            coords,
            data.get('map_object_id') or None,
            data.get('map_object_type'),
            task_type,
        ),
    )
    task_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
    db.execute(
        '''INSERT INTO alliance_log (event_type, title, description, author, event_date)
           VALUES (?, ?, ?, ?, date('now'))''',
        ('Задача', 'Создана задача с карты', '%s %s' % (title, coords), session.get('username')),
    )
    db.commit()
    row = db.execute(
        '''SELECT t.*, p.nick as assignee_nick
           FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id WHERE t.id = ?''',
        (task_id,),
    ).fetchone()
    payload = _task_payload(row)
    db.close()
    return jsonify({'ok': True, 'task': payload})


@map_bp.route('/map/api/network-issues')
def api_network_issues():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    db = get_db()
    ensure_alliance_schema(db)
    existing = _existing_alstations(db)
    issues = [
        _network_issue_payload(station)
        for station in existing
        if station.get('network_status') in ('signal_only', 'isolated')
    ]
    open_tasks = db.execute(
        '''SELECT t.*, p.nick as assignee_nick
           FROM tasks t LEFT JOIN players p ON t.assignee_id = p.id
           WHERE t.task_type = 'check_network'
             AND (t.status IS NULL OR t.status NOT IN ('Выполнена', 'Отменена'))
           ORDER BY t.created_at DESC'''
    ).fetchall()
    tasks = [_task_payload(row) for row in open_tasks]
    db.close()
    return jsonify({
        'issues': issues,
        'tasks': tasks,
        'summary': {
            'total': len(issues),
            'signal_only': sum(1 for item in issues if item['issue_type'] == 'signal_only'),
            'isolated': sum(1 for item in issues if item['issue_type'] == 'isolated'),
        }
    })


@map_bp.route('/map/api/optimize')
def api_optimize():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    levels = _clean_levels(request.args.get('levels'), fallback=(6, 8, 10, 12))
    limit = max(1, min(request.args.get('limit', default=8, type=int) or 8, 30))
    count = max(1, min(request.args.get('count', default=5, type=int) or 5, 12))
    target_filters = _clean_target_filters(request.args.get('targets'))
    scenario = (request.args.get('scenario') or 'max_coverage').strip()
    if scenario == 'min_stations':
        levels = sorted(levels, reverse=True)
    if scenario == 'compare_levels':
        count = 1

    db = get_db()
    existing = _existing_alstations(db)
    targets = _target_points(db, target_filters)
    analysis = coverage_analysis(targets, existing)
    by_level = compare_alstation_levels(targets, existing, levels, limit=limit)
    network = build_greedy_alstation_network(targets, existing, levels, count=count)
    db.close()

    return jsonify({
        'levels': levels,
        'by_level': by_level,
        'network': network,
        'coverage': {
            'targets': analysis['total_players'],
            'covered': len(analysis['covered']),
            'uncovered': len(analysis['uncovered']),
            'coverage_pct': analysis['coverage_pct'],
            'uncovered_points': [
                _coverage_point_payload(p)
                for p in analysis['uncovered']
            ],
            'weight_total': analysis.get('total_weight', 0),
            'weight_covered': analysis.get('covered_weight', 0),
            'weight_pct': analysis.get('weight_pct', 0),
        },
        'meta': {
            'stations_used': len(existing),
            'target_filters': target_filters,
            'scenario': scenario,
            'radius_per_level': alstation_radius(1),
        }
    })


@map_bp.route('/map/api/evaluate')
def api_evaluate_point():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    x = request.args.get('x', type=int)
    y = request.args.get('y', type=int)
    z = request.args.get('z', default=0, type=int) or 0
    if x is None or y is None:
        return jsonify({'error': 'x and y are required'}), 400
    if not (ALLIANCE_MIN_X <= x <= ALLIANCE_MAX_X and ALLIANCE_MIN_Y <= y <= ALLIANCE_MAX_Y):
        return jsonify({'error': 'Coordinates outside alliance area'}), 400

    levels = _clean_levels(request.args.get('levels'), fallback=range(1, 13))
    target_filters = _clean_target_filters(request.args.get('targets'))
    coords = {'x': x, 'y': y, 'z': z, 'format': 'colon', 'normalized': True}
    point = normalize_map_object({'name': 'candidate'}, coords)

    db = get_db()
    existing = _existing_alstations(db)
    targets = _target_points(db, target_filters)
    evaluation = evaluate_alstation_at(point, targets, existing, levels)
    analysis = coverage_analysis(targets, existing)
    db.close()

    return jsonify({
        'point': {
            'x': x,
            'y': y,
            'z': z,
            'wx': point['wx'],
            'wy': point['wy'],
        },
        'levels': evaluation,
        'coverage': {
            'targets': analysis['total_players'],
            'covered': len(analysis['covered']),
            'uncovered': len(analysis['uncovered']),
            'coverage_pct': analysis['coverage_pct'],
            'weight_total': analysis.get('total_weight', 0),
            'weight_covered': analysis.get('covered_weight', 0),
            'weight_pct': analysis.get('weight_pct', 0),
        },
        'meta': {
            'target_filters': target_filters,
            'stations_used': len(existing),
            'radius_per_level': alstation_radius(1),
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
    player_id = data.get('player_id')
    try:
        player_id = int(player_id) if player_id else None
    except (TypeError, ValueError):
        player_id = None

    if x is None or y is None:
        return jsonify({'error': 'x и y обязательны'}), 400
    x, y = int(x), int(y)
    if not (ALLIANCE_MIN_X <= x <= ALLIANCE_MAX_X and ALLIANCE_MIN_Y <= y <= ALLIANCE_MAX_Y):
        return jsonify({'error': 'Координаты вне зоны альянса'}), 400

    coord_str = '[%d:%d:%d]' % (x, y, z)
    db = get_db()
    cursor = db.execute(
        'INSERT INTO game_objects (player_id, object_type, name, coordinates, level, status, controlled, comment) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (player_id, subtype, name, coord_str, level, status, 1, comment or None)
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
        'player_id': player_id,
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
    if 'player_id' in data:
        try:
            player_id = int(data.get('player_id')) if data.get('player_id') else None
        except (TypeError, ValueError):
            player_id = None
        updates.append('player_id = ?')
        params.append(player_id)
    if 'object_type' in data:
        updates.append('object_type = ?')
        params.append((data['object_type'] or 'Алстанция').strip())

    if updates:
        params.append(station_id)
        db.execute('UPDATE game_objects SET %s WHERE id = ?' % ', '.join(updates), params)
        db.commit()

    updated = db.execute(
        'SELECT id, player_id, name, coordinates, level, status, comment, object_type FROM game_objects WHERE id = ?', (station_id,)
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
        'player_id': updated['player_id'],
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
        'SELECT id, player_id, name, coordinates, level, object_type FROM game_objects WHERE id = ?',
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
        'player_id': row['player_id'],
        'object_type': row['object_type'],
    })
