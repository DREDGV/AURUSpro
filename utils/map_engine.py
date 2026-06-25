import math
import re


ALLIANCE_CENTER_X = 2500
ALLIANCE_CENTER_Y = 2500
ALLIANCE_MIN_X = 2000
ALLIANCE_MAX_X = 3000
ALLIANCE_MIN_Y = 2000
ALLIANCE_MAX_Y = 3000
SYSTEM_SPACING = 1000
PLANET_SPACING = 100
ALSTATION_RADIUS_PER_LEVEL = 900
DEFAULT_ALSTATION_LEVEL = 1

COORD_PATTERN_COLON = re.compile(r"\[?\s*(-?\d+)\s*:\s*(-?\d+)\s*:\s*(-?\d+)\s*\]?")
COORD_PATTERN_SLASH = re.compile(r"\s*(-?\d+)\s*/\s*(-?\d+)\s*/\s*(-?\d+)\s*")


def parse_coordinates(coord_str):
    if not coord_str:
        return None

    text = str(coord_str).strip()
    match = COORD_PATTERN_COLON.search(text)
    if match:
        return {
            "x": int(match.group(1)),
            "y": int(match.group(2)),
            "z": int(match.group(3)),
            "format": "colon",
            "normalized": True,
        }

    match = COORD_PATTERN_SLASH.search(text)
    if match:
        return {
            "x": int(match.group(1)),
            "y": int(match.group(2)),
            "z": int(match.group(3)),
            "format": "slash",
            "normalized": False,
        }

    return None


def is_map_ready(coords):
    return bool(coords and coords.get("normalized") and in_alliance_area(coords))


def in_alliance_area(coords):
    if not coords:
        return False
    return (
        ALLIANCE_MIN_X <= coords["x"] <= ALLIANCE_MAX_X
        and ALLIANCE_MIN_Y <= coords["y"] <= ALLIANCE_MAX_Y
    )


def alstation_radius(level):
    try:
        clean_level = int(level or DEFAULT_ALSTATION_LEVEL)
    except (TypeError, ValueError):
        clean_level = DEFAULT_ALSTATION_LEVEL
    return max(clean_level, 1) * ALSTATION_RADIUS_PER_LEVEL


def world_x(system_x):
    return (system_x - ALLIANCE_CENTER_Y) * SYSTEM_SPACING


def world_y(system_y):
    return (system_y - ALLIANCE_CENTER_X) * SYSTEM_SPACING


def distance(a, b):
    return math.hypot(_point_wx(a) - _point_wx(b), _point_wy(a) - _point_wy(b))


def is_covered(point, stations):
    return any(distance(point, station) <= station["radius"] for station in stations)


def coverage_count(point, points, radius):
    return sum(1 for item in points if distance(point, item) <= radius)


def normalize_map_object(raw, coords):
    item = dict(raw)
    item.update({
        "x": coords["x"],
        "y": coords["y"],
        "z": coords["z"],
        "wx": world_x(coords["y"]),
        "wy": world_y(coords["x"]),
        "coord_format": coords["format"],
        "map_ready": coords["normalized"],
    })
    return item


def _grid_candidates(player_points, step=50):
    bounds = {
        "min_x": ALLIANCE_MIN_X, "max_x": ALLIANCE_MAX_X,
        "min_y": ALLIANCE_MIN_Y, "max_y": ALLIANCE_MAX_Y,
    }
    if player_points:
        xs = [p["x"] for p in player_points if p.get("map_ready")]
        ys = [p["y"] for p in player_points if p.get("map_ready")]
        if xs and ys:
            pad = 3
            bounds["min_x"] = max(bounds["min_x"], (min(xs) // step - pad) * step)
            bounds["max_x"] = min(bounds["max_x"], (max(xs) // step + pad) * step)
            bounds["min_y"] = max(bounds["min_y"], (min(ys) // step - pad) * step)
            bounds["max_y"] = min(bounds["max_y"], (max(ys) // step + pad) * step)
    coords = set()
    for x in range(bounds["min_x"], bounds["max_x"] + 1, step):
        for y in range(bounds["min_y"], bounds["max_y"] + 1, step):
            coords.add((x, y))
    return coords


def corridor_gap_analysis(stations, level=10, end_y=2560):
    radius = alstation_radius(level) / 1000
    corridor_stations = []
    for s in stations:
        if s.get("map_ready") and s.get("x") == 2500:
            r = s["radius"] / 1000
            corridor_stations.append((s["y"] - r, s["y"] + r, s.get("name", "?"), s.get("level", 1)))
    corridor_stations.sort()

    uncovered_ranges = []
    cursor = 2500
    for start, end, name, lvl in corridor_stations:
        if cursor < start:
            uncovered_ranges.append((cursor, int(start) - 1))
        cursor = max(cursor, int(end) + 1)
    if cursor <= end_y:
        uncovered_ranges.append((cursor, end_y))

    recommendations = []
    for gap_start, gap_end in uncovered_ranges:
        y = gap_start
        while y <= gap_end:
            y = min(y, end_y)
            recommendations.append({"x": 2500, "y": y, "z": 0, "level": level})
            y += int(radius)

    return {
        "corridor_stations": [
            {"name": n, "y": int((s + e) / 2), "level": l, "from": int(s), "to": int(e)}
            for s, e, n, l in corridor_stations
        ],
        "gaps": [{"from": g[0], "to": g[1]} for g in uncovered_ranges],
        "recommendations": recommendations,
    }


def coverage_analysis(player_points, stations):
    ready_points = [p for p in player_points if p.get("map_ready")]
    ready_stations = [s for s in stations if s.get("map_ready")]
    if not ready_points:
        return {"covered": [], "uncovered": [], "total_players": 0, "coverage_pct": 0}
    covered = []
    uncovered = []
    for p in ready_points:
        if is_covered(p, ready_stations):
            covered.append(p)
        else:
            uncovered.append(p)
    pct = round(len(covered) / len(ready_points) * 100, 1) if ready_points else 0
    return {"covered": covered, "uncovered": uncovered, "total_players": len(ready_points), "coverage_pct": pct}


def build_alstation_suggestions(player_points, stations, level=DEFAULT_ALSTATION_LEVEL, limit=30,
                                corridor=None):
    radius = alstation_radius(level)
    ready_points = [p for p in player_points if p.get("map_ready")]
    ready_stations = [s for s in stations if s.get("map_ready")]

    if not ready_points:
        return []

    candidates = _grid_candidates(ready_points, step=50)
    uncovered_points = [p for p in ready_points if not is_covered(p, ready_stations)]

    suggestions = []
    seen = set()

    for x, y in sorted(candidates):
        candidate = {"x": x, "y": y, "wx": world_x(y), "wy": world_y(x)}
        covered = coverage_count(candidate, ready_points, radius)
        if covered == 0:
            continue

        already_covered = is_covered(candidate, ready_stations)
        nearest_station = min(
            (distance(candidate, station) for station in ready_stations),
            default=None,
        )
        overlap_penalty = 0
        if nearest_station is not None:
            overlap_penalty = max(0, (radius * 2) - nearest_station) / max(radius, 1)

        uncovered_hit = sum(1 for p in uncovered_points if distance(candidate, p) <= radius)

        score = covered * 100 - overlap_penalty * 25 + uncovered_hit * 50
        if already_covered:
            score -= 50

        if corridor:
            cx, cy = corridor
            corridor_dist = abs(x - cx) + abs(y - cy)
            corridor_bonus = max(0, 200 - corridor_dist) * 2
            score += corridor_bonus

        key = (x, y)
        if key in seen:
            continue
        seen.add(key)
        suggestions.append({
            "x": x,
            "y": y,
            "z": 0,
            "wx": candidate["wx"],
            "wy": candidate["wy"],
            "level": level,
            "radius": radius,
            "covered_players": covered,
            "uncovered_players": uncovered_hit,
            "already_covered": already_covered,
            "nearest_station": int(nearest_station) if nearest_station is not None else None,
            "score": round(score, 2),
        })

    suggestions.sort(key=lambda item: (item["score"], item["covered_players"]), reverse=True)
    return suggestions[:limit]


def _point_wx(point):
    return point.get("wx", world_x(point["y"]))


def _point_wy(point):
    return point.get("wy", world_y(point["x"]))
