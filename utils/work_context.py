from flask import url_for


def _table_exists(db, table_name):
    row = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return bool(row)


def _unique_rows(rows):
    seen = set()
    result = []
    for row in rows:
        key = row.get("key") or (row.get("kind"), row.get("id"))
        if key in seen:
            continue
        seen.add(key)
        result.append(row)
    return result


def _in_clause(values):
    values = [value for value in values if value is not None]
    if not values:
        return None, []
    return ",".join("?" for _ in values), values


def _add_linked_ids(db, linked, source_type, source_id):
    if not source_id or not _table_exists(db, "work_links"):
        return
    rows = db.execute(
        """SELECT target_type, target_id, relation
           FROM work_links
           WHERE source_type = ? AND source_id = ?""",
        (source_type, source_id),
    ).fetchall()
    for row in rows:
        linked.setdefault(row["target_type"], set()).add(row["target_id"])

    rows = db.execute(
        """SELECT source_type, source_id, relation
           FROM work_links
           WHERE target_type = ? AND target_id = ?""",
        (source_type, source_id),
    ).fetchall()
    for row in rows:
        linked.setdefault(row["source_type"], set()).add(row["source_id"])


def _task_item(row):
    return {
        "key": "task:%s" % row["id"],
        "kind": "task",
        "label": "Задача",
        "id": row["id"],
        "title": row["title"],
        "status": row["status"],
        "priority": row["priority"],
        "meta": row["assignee_nick"] or row["direction"] or "",
        "coordinates": row["coordinates"],
        "url": url_for("tasks.detail", task_id=row["id"]),
    }


def _request_item(row):
    return {
        "key": "request:%s" % row["id"],
        "kind": "request",
        "label": "Заявка",
        "id": row["id"],
        "title": row["title"],
        "status": row["status"],
        "priority": row["priority"],
        "meta": row["player_nick"] or row["assignee"] or row["request_type"] or "",
        "coordinates": row["coordinates"],
        "url": url_for("center.request_detail", request_id=row["id"]),
    }


def _decision_item(row):
    return {
        "key": "decision:%s" % row["id"],
        "kind": "decision",
        "label": "Решение",
        "id": row["id"],
        "title": row["title"],
        "status": row["status"],
        "priority": row["priority"],
        "meta": row["proposer"] or row["created_by"] or "",
        "coordinates": row["coordinates"],
        "url": url_for("center.decision_detail", decision_id=row["id"]),
    }


def _intake_item(row):
    return {
        "key": "intake:%s" % row["id"],
        "kind": "intake",
        "label": "Входящее",
        "id": row["id"],
        "title": row["summary"] or (row["raw_text"] or "")[:90],
        "status": row["status"],
        "priority": row["priority"],
        "meta": row["player_nick"] or row["category"] or "",
        "coordinates": None,
        "url": url_for("inbox.detail", item_id=row["id"]),
    }


def _log_item(row):
    return {
        "key": "log:%s" % row["id"],
        "kind": "log",
        "label": "Журнал",
        "id": row["id"],
        "title": row["title"],
        "status": row["event_type"],
        "priority": None,
        "meta": row["event_date"] or (row["created_at"] or "")[:10],
        "coordinates": row["coordinates"],
        "url": url_for("center.log"),
        "description": row["description"],
    }


def _note_item(row):
    return {
        "key": "note:%s" % row["id"],
        "kind": "note",
        "label": "Заметка",
        "id": row["id"],
        "title": (row["content"] or "")[:90],
        "status": row["note_type"],
        "priority": None,
        "meta": row["player_nick"] or "",
        "coordinates": None,
        "url": url_for("players.card", player_id=row["player_id"]),
    }


def build_work_context(db, source_type, source_id, source_intake_id=None, coordinates=None):
    linked = {}
    intake_ids = set()
    if source_type == "intake":
        intake_ids.add(source_id)
    if source_intake_id:
        intake_ids.add(source_intake_id)

    _add_linked_ids(db, linked, source_type, source_id)
    for intake_id in list(intake_ids):
        _add_linked_ids(db, linked, "intake", intake_id)

    if source_type == "task":
        linked.setdefault("task", set()).add(source_id)
    elif source_type == "request":
        linked.setdefault("request", set()).add(source_id)
    elif source_type == "decision":
        linked.setdefault("decision", set()).add(source_id)

    if linked.get("intake"):
        intake_ids.update(linked["intake"])

    sections = {
        "intake": [],
        "tasks": [],
        "requests": [],
        "decisions": [],
        "notes": [],
        "log": [],
    }

    if intake_ids:
        placeholders, params = _in_clause(intake_ids)
        rows = db.execute(
            f"""SELECT i.*, p.nick AS player_nick
                FROM intake_items i
                LEFT JOIN players p ON p.id = i.source_player_id
                WHERE i.id IN ({placeholders})
                ORDER BY i.created_at DESC""",
            params,
        ).fetchall()
        sections["intake"].extend(_intake_item(row) for row in rows)

    task_conditions = []
    task_params = []
    task_ids = linked.get("task", set())
    if task_ids:
        placeholders, params = _in_clause(task_ids)
        task_conditions.append(f"t.id IN ({placeholders})")
        task_params.extend(params)
    if intake_ids:
        placeholders, params = _in_clause(intake_ids)
        task_conditions.append(f"t.source_intake_id IN ({placeholders})")
        task_params.extend(params)
    if coordinates:
        task_conditions.append("t.coordinates = ?")
        task_params.append(coordinates)
    if task_conditions:
        rows = db.execute(
            """SELECT t.*, p.nick AS assignee_nick
               FROM tasks t
               LEFT JOIN players p ON p.id = t.assignee_id
               WHERE """ + " OR ".join(task_conditions) + """
               ORDER BY t.created_at DESC
               LIMIT 20""",
            task_params,
        ).fetchall()
        sections["tasks"].extend(_task_item(row) for row in rows)

    request_conditions = []
    request_params = []
    request_ids = linked.get("request", set())
    if request_ids:
        placeholders, params = _in_clause(request_ids)
        request_conditions.append(f"r.id IN ({placeholders})")
        request_params.extend(params)
    if intake_ids:
        placeholders, params = _in_clause(intake_ids)
        request_conditions.append(f"r.source_intake_id IN ({placeholders})")
        request_params.extend(params)
    if coordinates:
        request_conditions.append("r.coordinates = ?")
        request_params.append(coordinates)
    if request_conditions:
        rows = db.execute(
            """SELECT r.*, p.nick AS player_nick
               FROM requests r
               LEFT JOIN players p ON p.id = r.player_id
               WHERE """ + " OR ".join(request_conditions) + """
               ORDER BY r.created_at DESC
               LIMIT 20""",
            request_params,
        ).fetchall()
        sections["requests"].extend(_request_item(row) for row in rows)

    decision_conditions = []
    decision_params = []
    decision_ids = linked.get("decision", set())
    if decision_ids:
        placeholders, params = _in_clause(decision_ids)
        decision_conditions.append(f"id IN ({placeholders})")
        decision_params.extend(params)
    if intake_ids:
        placeholders, params = _in_clause(intake_ids)
        decision_conditions.append(f"source_intake_id IN ({placeholders})")
        decision_params.extend(params)
    if coordinates:
        decision_conditions.append("coordinates = ?")
        decision_params.append(coordinates)
    if decision_conditions:
        rows = db.execute(
            "SELECT * FROM decisions WHERE " + " OR ".join(decision_conditions) + " ORDER BY created_at DESC LIMIT 20",
            decision_params,
        ).fetchall()
        sections["decisions"].extend(_decision_item(row) for row in rows)

    note_ids = linked.get("player_note", set()) or linked.get("note", set())
    if note_ids and _table_exists(db, "player_notes"):
        placeholders, params = _in_clause(note_ids)
        rows = db.execute(
            f"""SELECT n.*, p.nick AS player_nick
                FROM player_notes n
                LEFT JOIN players p ON p.id = n.player_id
                WHERE n.id IN ({placeholders})
                ORDER BY n.created_at DESC""",
            params,
        ).fetchall()
        sections["notes"].extend(_note_item(row) for row in rows)

    log_conditions = []
    log_params = []
    log_ids = linked.get("log", set())
    if log_ids:
        placeholders, params = _in_clause(log_ids)
        log_conditions.append(f"id IN ({placeholders})")
        log_params.extend(params)
    if intake_ids:
        placeholders, params = _in_clause(intake_ids)
        log_conditions.append(f"source_intake_id IN ({placeholders})")
        log_params.extend(params)
    if source_type == "task":
        log_conditions.append("related_task_id = ?")
        log_params.append(source_id)
    elif source_type == "request":
        log_conditions.append("related_request_id = ?")
        log_params.append(source_id)
    elif source_type == "decision":
        log_conditions.append("related_decision_id = ?")
        log_params.append(source_id)
    if coordinates:
        log_conditions.append("coordinates = ?")
        log_params.append(coordinates)
    if log_conditions:
        rows = db.execute(
            "SELECT * FROM alliance_log WHERE " + " OR ".join(log_conditions) + " ORDER BY created_at DESC LIMIT 30",
            log_params,
        ).fetchall()
        sections["log"].extend(_log_item(row) for row in rows)

    current_kind = {
        "intake": "intake",
        "task": "task",
        "request": "request",
        "decision": "decision",
    }.get(source_type)
    for key in sections:
        rows = _unique_rows(sections[key])
        if current_kind:
            rows = [
                item for item in rows
                if not (item.get("kind") == current_kind and item.get("id") == source_id)
            ]
        sections[key] = rows
    total = sum(len(items) for items in sections.values())
    return {
        "sections": sections,
        "total": total,
        "coordinates": coordinates,
        "intake_ids": sorted(intake_ids),
    }
