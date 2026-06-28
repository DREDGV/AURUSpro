import re


COORD_RE = re.compile(r"\[?(\d{1,4})\s*[:：]\s*(\d{1,4})\s*[:：]\s*(\d{1,2})\]?")

KEYWORDS = {
    "attack": ("атака", "атакуют", "напали", "деф", "защита", "угроза", "враг", "срочно"),
    "alstation": ("алстан", "альстан", "алка", "сеть", "сигнал", "радиус", "построить ал", "перенести ал"),
    "support": ("помог", "нужн", "рес", "ресурс", "помощь", "поддерж", "не могу"),
    "scout": ("развед", "проверь", "посмотри", "коорд", "точк", "нашел", "обнаруж"),
    "question": ("?", "вопрос", "как", "почему", "что делать", "можно ли"),
    "diplomacy": ("союз", "диплом", "переговор", "договор", "мир", "конфликт"),
}

PRIORITY_WORDS = {
    "Критический": ("срочно", "критично", "прямо сейчас", "горит", "атакуют", "напали"),
    "Высокий": ("важно", "быстро", "сегодня", "угроза", "защита"),
    "Низкий": ("когда будет время", "не срочно", "потом"),
}


def extract_coordinates(text):
    coords = []
    seen = set()
    for match in COORD_RE.finditer(text or ""):
        x, y, z = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        key = (x, y, z)
        if key in seen:
            continue
        seen.add(key)
        coords.append({
            "x": x,
            "y": y,
            "z": z,
            "text": f"[{x}:{y}:{z}]",
        })
    return coords


def detect_players(text, players):
    lower = (text or "").lower()
    matches = []
    for player in players:
        nick = player["nick"] if isinstance(player, dict) else player["nick"]
        if not nick:
            continue
        nick_lower = nick.lower()
        if nick_lower in lower:
            matches.append({"id": player["id"], "nick": nick})
    return matches


def _score_categories(text):
    lower = (text or "").lower()
    scores = {}
    for category, words in KEYWORDS.items():
        scores[category] = sum(1 for word in words if word in lower)
    return scores


def detect_category(text):
    scores = _score_categories(text)
    category, score = max(scores.items(), key=lambda item: item[1])
    return category if score else "general"


def detect_priority(text, category):
    lower = (text or "").lower()
    for priority, words in PRIORITY_WORDS.items():
        if any(word in lower for word in words):
            return priority
    if category == "attack":
        return "Высокий"
    if category in ("alstation", "support"):
        return "Средний"
    return "Средний"


def category_label(category):
    return {
        "attack": "Угроза / защита",
        "alstation": "Алстанции / сеть",
        "support": "Помощь игроку",
        "scout": "Разведка / координаты",
        "question": "Вопрос",
        "diplomacy": "Дипломатия",
        "general": "Общее",
    }.get(category, "Общее")


def task_type_for(category):
    return {
        "attack": "other",
        "alstation": "check_network",
        "support": "support_player",
        "scout": "scout_point",
        "question": "other",
        "diplomacy": "other",
    }.get(category, "other")


def direction_for(category):
    return {
        "attack": "Атака",
        "alstation": "Алстанции",
        "support": "Помощь игрокам",
        "scout": "Разведка",
        "question": "Развитие",
        "diplomacy": "Дипломатия",
    }.get(category, "Карта")


def build_summary(text, category, coords, players):
    parts = [category_label(category)]
    if players:
        parts.append("игрок: " + players[0]["nick"])
    if coords:
        parts.append("коорд.: " + ", ".join(item["text"] for item in coords[:3]))
    excerpt = " ".join((text or "").split())[:120]
    return " · ".join(parts) + (f" — {excerpt}" if excerpt else "")


def build_proposals(text, category, priority, coords, players):
    coord_text = coords[0]["text"] if coords else None
    player_id = players[0]["id"] if players else None
    player_nick = players[0]["nick"] if players else None
    title_base = category_label(category)
    proposals = []

    proposals.append({
        "kind": "request",
        "title": title_base,
        "description": text,
        "priority": priority,
        "player_id": player_id,
        "request_type": title_base,
    })

    if category in ("attack", "alstation", "support", "scout") or coord_text:
        proposals.append({
            "kind": "task",
            "title": title_base if not player_nick else f"{title_base}: {player_nick}",
            "description": text,
            "priority": priority,
            "direction": direction_for(category),
            "task_type": task_type_for(category),
            "coordinates": coord_text,
            "assignee_id": None,
            "map_object_type": "point" if coord_text else None,
        })

    if player_id:
        proposals.append({
            "kind": "note",
            "title": "Добавить заметку игроку",
            "player_id": player_id,
            "content": text,
            "note_type": category_label(category),
        })

    proposals.append({
        "kind": "log",
        "title": title_base,
        "description": text,
        "event_type": "Проблема" if priority in ("Критический", "Высокий") else "Прочее",
        "related_player": player_nick,
    })
    return proposals


def analyze_intake(text, players):
    coords = extract_coordinates(text)
    matched_players = detect_players(text, players)
    category = detect_category(text)
    priority = detect_priority(text, category)
    return {
        "category": category,
        "category_label": category_label(category),
        "priority": priority,
        "coordinates": coords,
        "players": matched_players,
        "summary": build_summary(text, category, coords, matched_players),
        "proposals": build_proposals(text, category, priority, coords, matched_players),
    }
