import re


COORD_RE = re.compile(r"\[?(\d{1,4})\s*[:：]\s*(\d{1,4})\s*[:：]\s*(\d{1,2})\]?")

ROUTES = {
    "attack": {
        "label": "Угроза / защита",
        "direction": "Атака",
        "task_type": "defense_response",
        "keywords": (
            "атака", "атакуют", "напали", "летит", "вылет", "деф", "защита",
            "угроза", "враг", "фармят", "прилет", "бьют", "сносят", "подкреп",
        ),
        "task_title": "Организовать защиту",
        "request_title": "Срочная помощь с защитой",
        "request_type": "Защита",
    },
    "alstation": {
        "label": "Алстанции / сеть",
        "direction": "Алстанции",
        "task_type": "check_network",
        "keywords": (
            "алстан", "альстан", "алка", "сеть", "сигнал", "радиус", "станция",
            "построить ал", "перенести ал", "связь", "главная ал", "граница сигнала",
        ),
        "task_title": "Проверить или спланировать алстанцию",
        "request_title": "Вопрос по алстанции",
        "request_type": "Алстанции",
    },
    "support": {
        "label": "Помощь игроку",
        "direction": "Помощь игрокам",
        "task_type": "support_player",
        "keywords": (
            "помоги", "помогите", "помощь", "нужна помощь", "нужны рес", "ресы",
            "ресурс", "ресурсы", "не могу", "застрял", "нужна поддержка", "помочь",
        ),
        "task_title": "Помочь игроку",
        "request_title": "Помощь игроку",
        "request_type": "Помощь",
    },
    "scout": {
        "label": "Разведка / координаты",
        "direction": "Разведка",
        "task_type": "scout_point",
        "keywords": (
            "развед", "проверь", "проверить", "посмотри", "коорд", "точк",
            "нашел", "нашёл", "обнаруж", "скан", "разведданные", "цель",
        ),
        "task_title": "Проверить точку",
        "request_title": "Проверка координат",
        "request_type": "Разведка",
    },
    "development": {
        "label": "Развитие игрока",
        "direction": "Развитие",
        "task_type": "support_player",
        "keywords": (
            "развитие", "развиться", "план развития", "что строить", "куда качать",
            "совет", "экономика", "планеты", "аккаунт",
        ),
        "task_title": "Помочь с развитием",
        "request_title": "Вопрос по развитию",
        "request_type": "Развитие",
    },
    "question": {
        "label": "Вопрос",
        "direction": "Развитие",
        "task_type": "answer_question",
        "keywords": ("?", "вопрос", "как", "почему", "что делать", "можно ли", "подскаж"),
        "task_title": "Ответить на вопрос",
        "request_title": "Вопрос игрока",
        "request_type": "Вопрос",
    },
    "diplomacy": {
        "label": "Дипломатия",
        "direction": "Дипломатия",
        "task_type": "diplomacy",
        "keywords": (
            "союз", "диплом", "переговор", "договор", "мир", "конфликт",
            "нейтрал", "альянс", "пакт", "война",
        ),
        "task_title": "Разобрать дипломатический вопрос",
        "request_title": "Дипломатическое обращение",
        "request_type": "Дипломатия",
    },
    "general": {
        "label": "Общее",
        "direction": "Карта",
        "task_type": "other",
        "keywords": (),
        "task_title": "Разобрать входящее",
        "request_title": "Обращение",
        "request_type": "Обращение",
    },
}

PRIORITY_WORDS = {
    "Критический": (
        "срочно", "критично", "прямо сейчас", "горит", "атакуют", "напали",
        "летит атака", "сносят", "нужен деф", "под атакой",
    ),
    "Высокий": ("важно", "быстро", "сегодня", "угроза", "защита", "проблема", "опасно"),
    "Низкий": ("когда будет время", "не срочно", "потом", "без спешки"),
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
    for category, route in ROUTES.items():
        if category == "general":
            continue
        score = 0
        for word in route["keywords"]:
            if word in lower:
                score += 2 if " " in word else 1
        scores[category] = score
    return scores


def detect_category(text, coords=None):
    scores = _score_categories(text)
    if coords:
        scores["scout"] = scores.get("scout", 0) + 1
    category, score = max(scores.items(), key=lambda item: item[1])
    return category if score else "general"


def detect_priority(text, category):
    lower = (text or "").lower()
    for priority, words in PRIORITY_WORDS.items():
        if any(word in lower for word in words):
            return priority
    if category == "attack":
        return "Высокий"
    if category in ("alstation", "support", "scout", "diplomacy"):
        return "Средний"
    return "Средний"


def category_label(category):
    return ROUTES.get(category, ROUTES["general"])["label"]


def task_type_for(category):
    return ROUTES.get(category, ROUTES["general"])["task_type"]


def direction_for(category):
    return ROUTES.get(category, ROUTES["general"])["direction"]


def _route_reason(category, coords, players, priority):
    reason = [category_label(category), f"приоритет: {priority}"]
    if players:
        reason.append("есть игрок")
    if coords:
        reason.append("есть координаты")
    return ", ".join(reason)


def build_summary(text, category, coords, players):
    parts = [category_label(category)]
    if players:
        parts.append("игрок: " + players[0]["nick"])
    if coords:
        parts.append("коорд.: " + ", ".join(item["text"] for item in coords[:3]))
    excerpt = " ".join((text or "").split())[:120]
    return " · ".join(parts) + (f" — {excerpt}" if excerpt else "")


def _base_proposal(kind, title, text, priority, category, coords, players):
    route = ROUTES.get(category, ROUTES["general"])
    coord_text = coords[0]["text"] if coords else None
    player_id = players[0]["id"] if players else None
    player_nick = players[0]["nick"] if players else None
    proposal = {
        "kind": kind,
        "title": title,
        "description": text,
        "priority": priority,
        "route_reason": _route_reason(category, coords, players, priority),
    }
    if kind == "task":
        proposal.update({
            "direction": route["direction"],
            "task_type": route["task_type"],
            "coordinates": coord_text,
            "assignee_id": None,
            "map_object_type": "point" if coord_text else None,
        })
    elif kind == "request":
        proposal.update({
            "player_id": player_id,
            "request_type": route["request_type"],
        })
    elif kind == "note":
        proposal.update({
            "player_id": player_id,
            "content": text,
            "note_type": route["label"],
        })
    elif kind == "log":
        proposal.update({
            "event_type": "Проблема" if priority in ("Критический", "Высокий") else "Прочее",
            "related_player": player_nick,
        })
    return proposal


def build_proposals(text, category, priority, coords, players):
    route = ROUTES.get(category, ROUTES["general"])
    player_nick = players[0]["nick"] if players else None
    proposals = []

    should_make_task = category in {
        "attack", "alstation", "support", "scout", "development", "diplomacy"
    } or bool(coords)
    should_make_request = category in {
        "attack", "support", "development", "question", "diplomacy"
    } or bool(players)

    if should_make_task:
        title = route["task_title"]
        if player_nick and category in ("attack", "support", "development"):
            title = f"{title}: {player_nick}"
        proposals.append(_base_proposal("task", title, text, priority, category, coords, players))

    if should_make_request:
        proposals.append(_base_proposal("request", route["request_title"], text, priority, category, coords, players))

    if players:
        proposals.append(_base_proposal("note", "Добавить заметку игроку", text, priority, category, coords, players))

    proposals.append(_base_proposal("log", category_label(category), text, priority, category, coords, players))
    return proposals


def analyze_intake(text, players):
    coords = extract_coordinates(text)
    matched_players = detect_players(text, players)
    category = detect_category(text, coords)
    priority = detect_priority(text, category)
    return {
        "category": category,
        "category_label": category_label(category),
        "priority": priority,
        "coordinates": coords,
        "players": matched_players,
        "routing": {
            "direction": direction_for(category),
            "task_type": task_type_for(category),
            "reason": _route_reason(category, coords, matched_players, priority),
        },
        "summary": build_summary(text, category, coords, matched_players),
        "proposals": build_proposals(text, category, priority, coords, matched_players),
    }
