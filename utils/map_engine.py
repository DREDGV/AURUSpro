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
MAIN_ALSTATION_X = 2500
MAIN_ALSTATION_Y = 2500
NETWORK_TOUCH_TOLERANCE = SYSTEM_SPACING * 0.5

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


def is_network_touch(point, station, tolerance=NETWORK_TOUCH_TOLERANCE):
    return abs(distance(point, station) - station["radius"]) <= tolerance


def classify_alstation_network(stations, fallback_level=10):
    ready = [dict(s) for s in stations if s.get("map_ready")]
    root = next(
        (
            s
            for s in ready
            if s.get("x") == MAIN_ALSTATION_X
            and s.get("y") == MAIN_ALSTATION_Y
            and int(s.get("z", 0) or 0) == 0
        ),
        None,
    )
    if root is None:
        root = normalize_map_object(
            {
                "id": "main",
                "name": "Главная алстанция",
                "level": fallback_level,
                "radius": alstation_radius(fallback_level),
                "virtual": True,
            },
            {
                "x": MAIN_ALSTATION_X,
                "y": MAIN_ALSTATION_Y,
                "z": 0,
                "format": "colon",
                "normalized": True,
            },
        )
        ready.append(root)
    else:
        if not root.get("radius"):
            root["radius"] = alstation_radius(root.get("level") or fallback_level)

    remaining = []
    connected = []
    for station in ready:
        if not station.get("radius"):
            station["radius"] = alstation_radius(station.get("level") or fallback_level)
        station["network_connected"] = False
        station["network_status"] = "isolated"
        station["network_parent"] = None
        station["network_touch_delta"] = None
        if (
            station.get("x") == MAIN_ALSTATION_X
            and station.get("y") == MAIN_ALSTATION_Y
            and int(station.get("z", 0) or 0) == 0
        ):
            station["network_connected"] = True
            station["network_status"] = "main"
            station["network_touch_delta"] = 0
            connected.append(station)
        else:
            remaining.append(station)

    changed = True
    while changed:
        changed = False
        next_remaining = []
        for station in remaining:
            parent = _best_touching_parent(station, connected)
            if parent:
                station["network_connected"] = True
                station["network_status"] = "network"
                station["network_parent"] = parent.get("name") or parent.get("id") or "Главная алстанция"
                station["network_touch_delta"] = int(abs(distance(station, parent) - parent["radius"]))
                connected.append(station)
                changed = True
            else:
                next_remaining.append(station)
        remaining = next_remaining

    for station in remaining:
        covered_by_network = [
            parent for parent in connected if distance(station, parent) <= parent["radius"]
        ]
        if covered_by_network:
            parent = min(covered_by_network, key=lambda item: distance(station, item))
            station["network_status"] = "signal_only"
            station["network_parent"] = parent.get("name") or parent.get("id") or "сеть"
            station["network_touch_delta"] = int(abs(distance(station, parent) - parent["radius"]))
        else:
            station["network_status"] = "isolated"

    return ready


def _best_touching_parent(point, connected):
    touching = [station for station in connected if is_network_touch(point, station)]
    if not touching:
        return None
    return min(touching, key=lambda station: abs(distance(point, station) - station["radius"]))


def coverage_count(point, points, radius):
    return sum(1 for item in points if distance(point, item) <= radius)


def point_weight(point):
    try:
        return max(0, int(point.get("weight", 1)))
    except (TypeError, ValueError):
        return 1


def coverage_weight(point, points, radius):
    return sum(point_weight(item) for item in points if distance(point, item) <= radius)


def coverage_items(point, points, radius):
    return [item for item in points if distance(point, item) <= radius]


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


def _boundary_candidates(parents):
    coords = set()
    for parent in parents:
        radius_systems = max(parent.get("radius", 0) / SYSTEM_SPACING, 0.1)
        samples = max(48, int(math.ceil(2 * math.pi * radius_systems * 8)))
        for idx in range(samples):
            angle = (math.pi * 2 * idx) / samples
            x = int(round(parent["x"] + math.sin(angle) * radius_systems))
            y = int(round(parent["y"] + math.cos(angle) * radius_systems))
            if ALLIANCE_MIN_X <= x <= ALLIANCE_MAX_X and ALLIANCE_MIN_Y <= y <= ALLIANCE_MAX_Y:
                candidate = {"x": x, "y": y, "wx": world_x(y), "wy": world_y(x)}
                if is_network_touch(candidate, parent):
                    coords.add((x, y))
        for dx, dy in ((radius_systems, 0), (-radius_systems, 0), (0, radius_systems), (0, -radius_systems)):
            x = int(round(parent["x"] + dx))
            y = int(round(parent["y"] + dy))
            if ALLIANCE_MIN_X <= x <= ALLIANCE_MAX_X and ALLIANCE_MIN_Y <= y <= ALLIANCE_MAX_Y:
                candidate = {"x": x, "y": y, "wx": world_x(y), "wy": world_y(x)}
                if is_network_touch(candidate, parent):
                    coords.add((x, y))
    return coords


def _network_parents(stations, fallback_level=10):
    classified = classify_alstation_network(stations, fallback_level=fallback_level)
    return [s for s in classified if s.get("network_connected")]


def _nearest_network_parent(candidate, parents):
    touched = [parent for parent in parents if is_network_touch(candidate, parent)]
    if touched:
        parent = min(touched, key=lambda item: abs(distance(candidate, item) - item["radius"]))
        return parent, int(abs(distance(candidate, parent) - parent["radius"]))
    if not parents:
        return None, None
    parent = min(parents, key=lambda item: distance(candidate, item))
    return parent, int(abs(distance(candidate, parent) - parent["radius"]))


def _network_progress(candidate, targets, parents):
    if not targets or not parents:
        return 0
    base = sum(
        point_weight(target) * min(distance(target, parent) for parent in parents)
        for target in targets
    )
    after = sum(
        point_weight(target)
        * min(distance(target, candidate), min(distance(target, parent) for parent in parents))
        for target in targets
    )
    return max(0, base - after) / SYSTEM_SPACING


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
        return {
            "covered": [],
            "uncovered": [],
            "total_players": 0,
            "coverage_pct": 0,
            "total_weight": 0,
            "covered_weight": 0,
            "weight_pct": 0,
        }
    covered = []
    uncovered = []
    for p in ready_points:
        if is_covered(p, ready_stations):
            covered.append(p)
        else:
            uncovered.append(p)
    pct = round(len(covered) / len(ready_points) * 100, 1) if ready_points else 0
    total_weight = sum(point_weight(p) for p in ready_points)
    covered_weight = sum(point_weight(p) for p in covered)
    weight_pct = round(covered_weight / total_weight * 100, 1) if total_weight else 0
    return {
        "covered": covered,
        "uncovered": uncovered,
        "total_players": len(ready_points),
        "coverage_pct": pct,
        "total_weight": total_weight,
        "covered_weight": covered_weight,
        "weight_pct": weight_pct,
    }


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
        covered_weight = coverage_weight(candidate, ready_points, radius)
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
        uncovered_weight = sum(point_weight(p) for p in uncovered_points if distance(candidate, p) <= radius)

        score = covered_weight * 100 - overlap_penalty * 25 + uncovered_weight * 55 + covered * 12
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
            "covered_weight": covered_weight,
            "uncovered_weight": uncovered_weight,
            "already_covered": already_covered,
            "nearest_station": int(nearest_station) if nearest_station is not None else None,
            "score": round(score, 2),
        })

    suggestions.sort(key=lambda item: (item["score"], item["uncovered_weight"], item["covered_players"]), reverse=True)
    return suggestions[:limit]


def compare_alstation_levels(player_points, stations, levels, limit=8):
    result = []
    for level in levels:
        suggestions = build_alstation_suggestions(player_points, stations, level=level, limit=limit)
        result.append({
            "level": level,
            "radius": alstation_radius(level),
            "suggestions": suggestions,
        })
    return result


def evaluate_alstation_at(point, player_points, stations, levels):
    ready_points = [p for p in player_points if p.get("map_ready")]
    ready_stations = [s for s in stations if s.get("map_ready")]
    base_uncovered = [p for p in ready_points if not is_covered(p, ready_stations)]
    result = []

    for level in levels:
        radius = alstation_radius(level)
        in_radius = coverage_items(point, ready_points, radius)
        new_items = [p for p in base_uncovered if distance(point, p) <= radius]
        covered_weight = sum(point_weight(p) for p in in_radius)
        new_weight = sum(point_weight(p) for p in new_items)
        nearest_station = min((distance(point, station) for station in ready_stations), default=None)
        overlap = 0
        if nearest_station is not None:
            overlap = max(0, (radius * 2) - nearest_station) / max(radius, 1)
        efficiency = round(new_weight / max(level, 1), 2)
        score = round(new_weight * 120 + covered_weight * 25 - overlap * 35 - level * 4, 2)

        result.append({
            "level": level,
            "radius": radius,
            "covered_targets": len(in_radius),
            "new_targets": len(new_items),
            "covered_weight": covered_weight,
            "new_weight": new_weight,
            "efficiency": efficiency,
            "nearest_station": int(nearest_station) if nearest_station is not None else None,
            "overlap": round(overlap, 2),
            "score": score,
            "targets": [
                {
                    "name": item.get("name") or item.get("nick") or item.get("label") or "?",
                    "kind": item.get("target_type") or item.get("source") or "target",
                    "weight": point_weight(item),
                    "x": item.get("x"),
                    "y": item.get("y"),
                    "z": item.get("z", 0),
                }
                for item in sorted(in_radius, key=lambda p: (-point_weight(p), p.get("name") or ""))[:12]
            ],
        })

    result.sort(key=lambda item: (item["score"], item["new_weight"], item["covered_weight"]), reverse=True)
    return result


def build_greedy_alstation_network(player_points, stations, levels, count=5):
    ready_points = [p for p in player_points if p.get("map_ready")]
    current = [s for s in stations if s.get("map_ready")]
    all_station_coverage = list(current)
    fallback_level = max(levels) if levels else 10
    selected = []
    if not ready_points:
        return selected

    for _ in range(max(1, count)):
        best = None
        connected_parents = _network_parents(current, fallback_level=fallback_level)
        base_uncovered = [p for p in ready_points if not is_covered(p, all_station_coverage)]
        boundary = _boundary_candidates(connected_parents)
        occupied = {(int(s["x"]), int(s["y"])) for s in current if s.get("map_ready")}
        if not boundary:
            break

        for level in levels:
            radius = alstation_radius(level)
            for x, y in sorted(boundary):
                if (x, y) in occupied:
                    continue
                candidate = {
                    "x": x,
                    "y": y,
                    "wx": world_x(y),
                    "wy": world_y(x),
                    "radius": radius,
                }
                covered = coverage_count(candidate, ready_points, radius)
                if covered == 0 and not base_uncovered:
                    continue
                new_hits = sum(1 for p in base_uncovered if distance(candidate, p) <= candidate["radius"])
                new_weight = sum(point_weight(p) for p in base_uncovered if distance(candidate, p) <= candidate["radius"])
                total_hits = covered
                total_weight = coverage_weight(candidate, ready_points, candidate["radius"])
                parent, touch_delta = _nearest_network_parent(candidate, connected_parents)
                nearest = min((distance(candidate, st) for st in all_station_coverage), default=None)
                overlap = 0
                if nearest is not None:
                    overlap = max(0, (candidate["radius"] * 2) - nearest) / max(candidate["radius"], 1)
                progress = _network_progress(candidate, base_uncovered or ready_points, connected_parents)
                score = (
                    new_weight * 150
                    + total_weight * 25
                    + new_hits * 20
                    + progress * 35
                    - overlap * 35
                    - level * 5
                    - (touch_delta or 0) / 100
                )
                reason = "граница %s" % (parent.get("name") or "сети") if parent else "граница сети"
                if new_hits:
                    reason += ", закрывает %d новых целей" % new_hits
                else:
                    reason += ", шаг сети к целям"
                enriched = {
                    "x": x,
                    "y": y,
                    "z": 0,
                    "wx": candidate["wx"],
                    "wy": candidate["wy"],
                    "level": level,
                    "radius": radius,
                    "covered_players": total_hits,
                    "uncovered_players": new_hits,
                    "covered_weight": total_weight,
                    "uncovered_weight": new_weight,
                    "already_covered": is_covered(candidate, all_station_coverage),
                    "nearest_station": int(nearest) if nearest is not None else None,
                    "new_uncovered_players": new_hits,
                    "new_weight": new_weight,
                    "total_weight": total_weight,
                    "score": round(score, 2),
                    "reason": reason,
                    "network_connected": True,
                    "network_parent": parent.get("name") if parent else None,
                    "network_touch_delta": touch_delta,
                }
                if best is None or enriched["score"] > best["score"]:
                    best = enriched

        if not best:
            break

        selected.append(best)
        added = {
            "x": best["x"],
            "y": best["y"],
            "wx": best["wx"],
            "wy": best["wy"],
            "radius": best["radius"],
            "map_ready": True,
            "level": best["level"],
            "name": "План %d" % len(selected),
        }
        current.append(added)
        all_station_coverage.append(added)

    return selected


def _point_wx(point):
    return point.get("wx", world_x(point["y"]))


def _point_wy(point):
    return point.get("wy", world_y(point["x"]))
