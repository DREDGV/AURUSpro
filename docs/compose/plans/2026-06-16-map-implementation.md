# Карта XCraft — План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать интерактивную карту XCraft с отображением объектов альянса, планировщиком алстанций и инструментами навигации.

**Architecture:** HTML5 Canvas для рендеринга, Flask API для данных, JavaScript класс GameMap для управления картой. Данные из БД (accounts, game_objects, fleet) конвертируются в JSON и отрисовываются на canvas.

**Tech Stack:** Python Flask, SQLite, HTML5 Canvas, Vanilla JavaScript, Bootstrap 5 (UI панели)

---

### Task 1: Роутер и API

**Covers:** [S4]

**Files:**
- Create: `routes/map.py`
- Modify: `routes/__init__.py`

- [ ] **Step 1: Создать роутер routes/map.py**

```python
from flask import Blueprint, render_template, session, redirect, url_for, jsonify
from utils.db import get_db

map_bp = Blueprint('map', __name__)


def parse_coordinates(coord_str):
    """Конвертирует координаты из строки в (x, y, z)"""
    if not coord_str:
        return None
    coord_str = coord_str.strip()
    # Формат [2500:2504:9]
    if coord_str.startswith('[') and coord_str.endswith(']'):
        parts = coord_str[1:-1].split(':')
        if len(parts) == 3:
            return int(parts[0]), int(parts[1]), int(parts[2])
    # Формат 109/22/78
    if '/' in coord_str:
        parts = coord_str.split('/')
        if len(parts) == 3:
            return int(parts[0]), int(parts[1]), int(parts[2])
    return None


@map_bp.route('/map')
def index():
    if 'user_id' not in session:
        return redirect(url_for('auth.login'))
    return render_template('map/index.html')


@map_bp.route('/map/api/data')
def api_data():
    if 'user_id' not in session:
        return jsonify({'error': 'Auth required'}), 401
    db = get_db()
    objects = []

    # Игроки (столицы)
    players = db.execute(
        'SELECT p.id, p.nick, p.name, p.coordinates, '
        '(SELECT GROUP_CONCAT(DISTINCT a.race) FROM accounts a WHERE a.player_id = p.id) as races '
        'FROM players p WHERE p.coordinates IS NOT NULL AND p.coordinates != ""'
    ).fetchall()
    for p in players:
        coords = parse_coordinates(p['coordinates'])
        if coords:
            # Определяем основную расу
            race = (p['races'] or '').split(',')[0] if p['races'] else None
            objects.append({
                'type': 'player',
                'subtype': 'capital',
                'nick': p['nick'],
                'name': p['name'] or p['nick'],
                'race': race,
                'x': coords[0], 'y': coords[1], 'z': coords[2],
                'player_id': p['id'],
                'url': f'/players/{p["id"]}'
            })

    # Аккаунты (дополнительные планеты)
    accounts = db.execute(
        'SELECT a.id, a.nick, a.race, a.coordinates, a.player_id, p.nick as player_nick '
        'FROM accounts a JOIN players p ON a.player_id = p.id '
        'WHERE a.coordinates IS NOT NULL AND a.coordinates != ""'
    ).fetchall()
    for a in accounts:
        coords = parse_coordinates(a['coordinates'])
        if coords:
            objects.append({
                'type': 'player',
                'subtype': 'account',
                'nick': a['nick'],
                'name': a['nick'],
                'race': a['race'],
                'x': coords[0], 'y': coords[1], 'z': coords[2],
                'player_id': a['player_id'],
                'url': f'/players/{a["player_id"]}'
            })

    # Объекты (ОПС, алстанции и т.д.)
    game_objects = db.execute(
        'SELECT o.id, o.object_type, o.name, o.coordinates, o.level, o.player_id, '
        'o.controlled, o.needs_protection, o.needs_development '
        'FROM game_objects o WHERE o.coordinates IS NOT NULL AND o.coordinates != ""'
    ).fetchall()
    for o in game_objects:
        coords = parse_coordinates(o['coordinates'])
        if coords:
            objects.append({
                'type': o['object_type'].lower(),
                'subtype': o['object_type'],
                'name': o['name'] or o['object_type'],
                'x': coords[0], 'y': coords[1], 'z': coords[2],
                'level': o['level'],
                'controlled': o['controlled'],
                'player_id': o['player_id']
            })

    # Границы
    xs = [o['x'] for o in objects]
    ys = [o['y'] for o in objects]
    bounds = {
        'min_x': min(xs) - 200 if xs else 2400,
        'max_x': max(xs) + 200 if xs else 2600,
        'min_y': min(ys) - 200 if ys else 2400,
        'max_y': max(ys) + 200 if ys else 2600
    }

    db.close()
    return jsonify({'objects': objects, 'bounds': bounds})
```

- [ ] **Step 2: Зарегистрировать blueprint в routes/__init__.py**

Добавить в `routes/__init__.py`:
```python
from routes.map import map_bp
```

И в `register_blueprints`:
```python
app.register_blueprint(map_bp)
```

- [ ] **Step 3: Проверить API**

Запустить `python aurus.py`, открыть `http://127.0.0.1:5000/map/api/data`
Ожидаемый результат: JSON с массивом объектов и границами

---

### Task 2: Шаблон страницы карты

**Covers:** [S2, S3]

**Files:**
- Create: `templates/map/index.html`

- [ ] **Step 1: Создать шаблон templates/map/index.html**

```html
{% extends "base.html" %}
{% block title %}Карта — AURUS{% endblock %}
{% block page_title %}Карта XCraft{% endblock %}
{% block content %}
<div class="row" style="height:calc(100vh - 120px);">
    <!-- Боковая панель -->
    <div class="col-md-2" style="overflow-y:auto;">
        <div class="panel mb-2">
            <div class="panel-header"><h6>Поиск</h6></div>
            <div class="panel-body">
                <input type="text" id="map-search" class="form-control form-control-sm" placeholder="Ник игрока...">
            </div>
        </div>
        <div class="panel mb-2">
            <div class="panel-header"><h6>Фильтры</h6></div>
            <div class="panel-body" style="font-size:12px;">
                <div class="form-check"><input type="checkbox" class="form-check-input" id="f-player" checked><label class="form-check-label">Игроки</label></div>
                <div class="form-check ms-3"><input type="checkbox" class="form-check-input" id="f-terran" checked><label class="form-check-label">Терран</label></div>
                <div class="form-check ms-3"><input type="checkbox" class="form-check-input" id="f-zerg" checked><label class="form-check-label">Жук</label></div>
                <div class="form-check ms-3"><input type="checkbox" class="form-check-input" id="f-toss" checked><label class="form-check-label">Тосс</label></div>
                <hr>
                <div class="form-check"><input type="checkbox" class="form-check-input" id="f-ops" checked><label class="form-check-label">ОПС</label></div>
                <div class="form-check"><input type="checkbox" class="form-check-input" id="f-alstation" checked><label class="form-check-label">Алстанции</label></div>
                <div class="form-check"><input type="checkbox" class="form-check-input" id="f-dunya" checked><label class="form-check-label">Дуни</label></div>
                <div class="form-check"><input type="checkbox" class="form-check-input" id="f-luna" checked><label class="form-check-label">Луны</label></div>
                <div class="form-check"><input type="checkbox" class="form-check-input" id="f-vrata" checked><label class="form-check-label">Врата</label></div>
                <hr>
                <div class="form-check"><input type="checkbox" class="form-check-input" id="f-grid" checked><label class="form-check-label">Сетка</label></div>
                <div class="form-check"><input type="checkbox" class="form-check-input" id="f-zones" checked><label class="form-check-label">Зоны покрытия</label></div>
            </div>
        </div>
        <div class="panel mb-2">
            <div class="panel-header"><h6>Действия</h6></div>
            <div class="panel-body d-grid gap-1">
                <button class="btn btn-sm btn-outline-primary" onclick="map.centerAlliance()">🏠 Альянс</button>
                <button class="btn btn-sm btn-outline-secondary" onclick="map.zoomIn()">+ Зум</button>
                <button class="btn btn-sm btn-outline-secondary" onclick="map.zoomOut()">- Зум</button>
                <button class="btn btn-sm btn-outline-success" onclick="map.exportPNG()">📷 Экспорт</button>
            </div>
        </div>
        <div class="panel">
            <div class="panel-header"><h6>Легенда</h6></div>
            <div class="panel-body" style="font-size:11px;">
                <div><span style="display:inline-block;width:10px;height:10px;background:#27ae60;border-radius:50%;"></span> Жук</div>
                <div><span style="display:inline-block;width:10px;height:10px;background:#2980b9;border-radius:50%;"></span> Терран</div>
                <div><span style="display:inline-block;width:10px;height:10px;background:#8e44ad;border-radius:50%;"></span> Тосс</div>
                <div><span style="display:inline-block;width:8px;height:8px;background:#2c3e50;"></span> ОПС</div>
                <div><span style="display:inline-block;width:10px;height:10px;background:#e74c3c;transform:rotate(45deg);"></span> Алстанция</div>
                <div><span style="display:inline-block;width:8px;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:8px solid #f39c12;"></span> Дуня</div>
            </div>
        </div>
    </div>
    <!-- Карта -->
    <div class="col-md-10 p-0">
        <canvas id="map-canvas" style="width:100%;height:100%;background:#0a0e14;cursor:grab;"></canvas>
        <div id="map-tooltip" style="display:none;position:absolute;background:rgba(0,0,0,0.9);color:#fff;padding:8px 12px;border-radius:6px;font-size:12px;pointer-events:none;z-index:100;"></div>
    </div>
</div>
<script src="{{ url_for('static', filename='js/map.js') }}"></script>
{% endblock %}
```

---

### Task 3: JavaScript рендерер карты

**Covers:** [S2, S3, S4]

**Files:**
- Create: `static/js/map.js`

- [ ] **Step 1: Создать static/js/map.js**

Основной класс `GameMap` с методами:
- `constructor(canvas)` — инициализация canvas, привязка событий
- `async loadData()` — загрузка данных с API
- `render()` — полная отрисовка
- `drawGrid()` — сетка координат
- `drawSystems()` — солнечные системы с планетами
- `drawObjects()` — объекты (игроки, ОПС, алстанции)
- `drawCoverageZones()` — зоны покрытия алстанций
- `zoom(delta, cx, cy)` — зум в точке
- `pan(dx, dy)` — панорамирование
- `worldToScreen(wx, wy)` — конвертация мировых координат в экранные
- `screenToWorld(sx, sy)` — обратная конвертация
- `findObjectAt(sx, sy)` — поиск объекта под курсором
- `showTooltip(obj, sx, sy)` — показ подсказки
- `hideTooltip()` — скрытие подсказки
- `centerAlliance()` — центрирование на 2500:2500
- `exportPNG()` — экспорт в PNG
- `applyFilters()` — применение фильтров

Файл будет ~400-500 строк. Ключевые моменты:

```javascript
class GameMap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.objects = [];
        this.bounds = {};
        this.offsetX = 0;
        this.offsetY = 0;
        this.scale = 1;
        this.isDragging = false;
        this.lastMouse = {x: 0, y: 0};
        this.filters = {player: true, terran: true, zerg: true, toss: true,
                        ops: true, alstation: true, dunya: true, luna: true, vrata: true,
                        grid: true, zones: true};
        this.initEvents();
        this.loadData();
    }

    async loadData() {
        const resp = await fetch('/map/api/data');
        const data = await resp.json();
        this.objects = data.objects;
        this.bounds = data.bounds;
        this.centerAlliance();
        this.render();
    }

    worldToScreen(wx, wy) {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        return {
            x: cx + (wx - this.centerX) * this.scale * 0.5 + this.offsetX,
            y: cy + (wy - this.centerY) * this.scale * 0.5 + this.offsetY
        };
    }

    screenToWorld(sx, sy) {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        return {
            x: (sx - cx - this.offsetX) / (this.scale * 0.5) + this.centerX,
            y: (sy - cy - this.offsetY) / (this.scale * 0.5) + this.centerY
        };
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.filters.grid) this.drawGrid();
        this.drawSystems();
        if (this.filters.zones) this.drawCoverageZones();
        this.drawObjects();
    }
    // ... остальные методы
}
```

---

### Task 4: Стили для страницы карты

**Covers:** [S3]

**Files:**
- Modify: `static/css/style.css` (добавить в конец)

- [ ] **Step 1: Добавить стили для карты**

```css
/* Map page */
#map-canvas {
    display: block;
    touch-action: none;
}

#map-tooltip {
    max-width: 250px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

#map-tooltip .tooltip-title {
    font-weight: 600;
    margin-bottom: 4px;
}

#map-tooltip .tooltip-race {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    margin-left: 4px;
}
```

---

### Task 5: Планировщик алстанций

**Covers:** [S5]

**Files:**
- Modify: `routes/map.py` (добавить endpoint)
- Modify: `static/js/map.js` (добавить метод)

- [ ] **Step 1: Добавить API планировщика в routes/map.py**

```python
@map_bp.route('/map/api/plan')
def api_plan():
    if 'user_id' not in session:
        return jsonify({'error': 'Auth required'}), 401
    db = get_db()

    # Получаем существующие алстанции
    alstations = db.execute(
        'SELECT o.name, o.coordinates, o.level '
        'FROM game_objects o WHERE o.object_type = "Алстанция" AND o.coordinates != ""'
    ).fetchall()

    # Конвертируем координаты
    existing = []
    for a in alstations:
        coords = parse_coordinates(a['coordinates'])
        if coords:
            existing.append({
                'x': coords[0], 'y': coords[1],
                'level': a['level'] or 1,
                'radius': (a['level'] or 1) * 100
            })

    # Получаем координаты игроков
    players = db.execute(
        'SELECT coordinates FROM players WHERE coordinates != ""'
    ).fetchall()
    player_coords = []
    for p in players:
        coords = parse_coordinates(p['coordinates'])
        if coords:
            player_coords.append((coords[0], coords[1]))

    # Границы альянса
    if player_coords:
        min_x = min(c[0] for c in player_coords) - 200
        max_x = max(c[0] for c in player_coords) + 200
        min_y = min(c[1] for c in player_coords) - 200
        max_y = max(c[1] for c in player_coords) + 200
    else:
        min_x, max_x, min_y, max_y = 2300, 2700, 2300, 2700

    # Сетка для поиска позиций
    step = 500
    suggestions = []
    for x in range(min_x, max_x + 1, step):
        for y in range(min_y, max_y + 1, step):
            # Проверяем расстояние до существующих алстанций
            min_dist = float('inf')
            for e in existing:
                dist = ((x - e['x'])**2 + (y - e['y'])**2)**0.5
                min_dist = min(min_dist, dist)
            # Считаем игроков в радиусе
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
```

- [ ] **Step 2: Добавить метод drawPlannerSuggestions в map.js**

Метод отрисовывает зелёные пометки для предложенных позиций и красные для существующих алстанций.

---

### Task 6: Экспорт в PNG

**Covers:** [S3]

**Files:**
- Modify: `static/js/map.js` (добавить метод)

- [ ] **Step 1: Добавить метод exportPNG**

```javascript
exportPNG() {
    const link = document.createElement('a');
    link.download = 'aurus-map.png';
    link.href = this.canvas.toDataURL('image/png');
    link.click();
}
```

---

### Task 7: Тестирование и отладка

**Covers:** [S2, S3, S4, S5]

- [ ] **Step 1: Запустить приложение**

```bash
python aurus.py
```

- [ ] **Step 2: Проверить страницу карты**

Открыть `http://127.0.0.1:5000/map`
Ожидаемый результат: тёмная карта с сеткой и точками игроков

- [ ] **Step 3: Проверить интерактивность**

- Зум колёсиком — работает
- Панорамирование — работает
- Клик по объекту — tooltip
- Фильтры — включение/выключение слоёв

- [ ] **Step 4: Проверить API**

- `/map/api/data` — JSON с объектами
- `/map/api/plan` — предложенные позиции

- [ ] **Step 5: Проверить экспорт**

Кнопка «Экспорт» — скачивается PNG файл
