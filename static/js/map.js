class GameMap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.objects = [];
        this.meta = {};
        this.area = {
            min_x: 2000, max_x: 3000,
            min_y: 2000, max_y: 3000,
            center_x: 2500, center_y: 2500
        };
        this.systemSpacing = 1000;
        this.scale = 0.001;
        this.offsetX = 0;
        this.offsetY = 0;
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this._dragMoved = false;
        this.highlightedObj = null;
        this.tooltip = document.getElementById('map-tooltip');

        this.placementMode = false;
        this.ghostPos = null;
        this.placementLevel = 10;
        this.planningMode = false;
        this.planLevel = 10;
        this.planStations = [];
        this.planSuggestions = [];
        this.intelFacts = [];
        this.nextPlanId = 1;
        this.selectedPlanId = null;
        this.hasLoadedData = false;
        this.draggingPlanId = null;
        this.planDragMoved = false;

        this.contextMenu = null;
        this.pendingMoveObj = null;
        this.pendingPlanMoveId = null;
        this.cursorPoint = null;

        this.filters = {
            'filter-terran': true, 'filter-zerg': true, 'filter-toss': true,
            'filter-ops': true, 'filter-alstation': true,
            'filter-dunya': true, 'filter-luna': true, 'filter-vrata': true,
            'filter-grid': true, 'filter-coverage': true
        };

        this._resizeCanvas();
        window.addEventListener('resize', () => { this._resizeCanvas(); this.render(); });
        this._bindEvents();
        this.loadData();
    }

    _resizeCanvas() {
        const p = this.canvas.parentElement;
        if (p) { this.canvas.width = p.clientWidth; this.canvas.height = p.clientHeight; }
    }

    _bindEvents() {
        this.canvas.addEventListener('wheel', e => this._onWheel(e), { passive: false });
        this.canvas.addEventListener('mousedown', e => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', e => this._onMouseMove(e));
        this.canvas.addEventListener('mouseup', e => this._onMouseUp(e));
        this.canvas.addEventListener('mouseleave', () => { this._cancelDrag(); this.hideTooltip(); if (!this.pendingMoveObj && !this.pendingPlanMoveId) this._clearCoordHud(); });
        this.canvas.addEventListener('contextmenu', e => this._onContextMenu(e));
        document.addEventListener('mousedown', e => {
            const menu = document.getElementById('map-context-menu');
            if (menu && menu.style.display === 'block' && !menu.contains(e.target)) {
                this.hideContextMenu();
            }
        });
        const si = document.getElementById('map-search');
        if (si) si.addEventListener('input', e => this._onSearch(e));
        for (const id of Object.keys(this.filters)) {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', e => {
                    this.filters[id] = e.target.checked;
                    this.render();
                });
            }
        }
        const home = document.getElementById('btn-home');
        if (home) home.addEventListener('click', () => this.centerAlliance());
        const zin = document.getElementById('btn-zoom-in');
        if (zin) zin.addEventListener('click', () => this.zoomIn());
        const zout = document.getElementById('btn-zoom-out');
        if (zout) zout.addEventListener('click', () => this.zoomOut());
        const exp = document.getElementById('btn-export');
        if (exp) exp.addEventListener('click', () => this.exportPNG());
        const planBtn = document.getElementById('btn-planning');
        if (planBtn) planBtn.addEventListener('click', () => this.togglePlanningMode());
        const planLevel = document.getElementById('plan-level');
        if (planLevel) planLevel.addEventListener('input', e => this.setPlanLevel(parseInt(e.target.value) || 10));
        const planClear = document.getElementById('btn-plan-clear');
        if (planClear) planClear.addEventListener('click', () => this.clearPlan());
        const planCopy = document.getElementById('btn-plan-copy');
        if (planCopy) planCopy.addEventListener('click', () => this.copyPlan());
        const planSave = document.getElementById('btn-plan-save');
        if (planSave) planSave.addEventListener('click', () => this.savePlanStations());
        const planSuggest = document.getElementById('btn-plan-suggest');
        if (planSuggest) planSuggest.addEventListener('click', () => this.loadPlanSuggestions());
        const intelBtn = document.getElementById('btn-intel-load');
        if (intelBtn) intelBtn.addEventListener('click', () => this.loadIntelFacts());
        ['st-x', 'st-y', 'st-z'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => this._updateStationCoordInfo(
                    document.getElementById('st-x').value,
                    document.getElementById('st-y').value,
                    document.getElementById('st-z').value
                ));
            }
        });
    }

    worldToScreen(wx, wy) {
        // World: X right, Y UP. Screen: X right, Y DOWN.
        return {
            x: wx * this.scale + this.offsetX,
            y: -wy * this.scale + this.offsetY
        };
    }

    screenToWorld(sx, sy) {
        return {
            x: (sx - this.offsetX) / this.scale,
            y: -(sy - this.offsetY) / this.scale
        };
    }

    centerOn(wx, wy) {
        this.offsetX = this.canvas.width / 2 - wx * this.scale;
        this.offsetY = this.canvas.height / 2 + wy * this.scale;
        this.render();
    }

    centerAlliance() { this.centerOn(0, 0); }

    fitAllianceArea() {
        const widthSystems = this.area.max_x - this.area.min_x;
        const heightSystems = this.area.max_y - this.area.min_y;
        const worldWidth = Math.max(widthSystems * this.systemSpacing, 1);
        const worldHeight = Math.max(heightSystems * this.systemSpacing, 1);
        const fitScale = Math.min(this.canvas.width / worldWidth, this.canvas.height / worldHeight) * 0.9;
        this.scale = Math.max(0.0002, fitScale);
        this.centerAlliance();
    }

    async loadData(options = {}) {
        try {
            const preserveViewport = options.preserveViewport ?? this.hasLoadedData;
            const resp = await fetch('/map/api/data');
            const data = await resp.json();
            this.objects = data.objects || [];
            this.meta = data.meta || {};
            if (this.meta.area) this.area = this.meta.area;
            this._updateStatus();

            const params = new URLSearchParams(window.location.search);
            const focus = params.get('focus');
            if (focus && !preserveViewport) {
                const m = focus.match(/\[(\d+):(\d+)(?::(\d+))?\]/);
                if (m) {
                    const fx = parseInt(m[1]), fy = parseInt(m[2]);
                    const wx = (fx - this.area.center_y) * this.systemSpacing;
                    const wy = (fy - this.area.center_x) * this.systemSpacing;
                    this.scale = 0.003;
                    this.centerOn(wx, wy);
                    const found = this.objects.find(o => o.x === fx && o.y === fy);
                    if (found) { this.highlightedObj = found; }
                    this.hasLoadedData = true;
                    return;
                }
            }
            if (preserveViewport) {
                this.render();
            } else {
                this.fitAllianceArea();
            }
            this.hasLoadedData = true;
        } catch (e) { console.error('Map data error:', e); }
    }

    render() {
        const c = this.ctx;
        c.clearRect(0, 0, this.canvas.width, this.canvas.height);
        c.fillStyle = '#0a0e14';
        c.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.filters['filter-grid']) this.drawGrid();
        if (this.filters['filter-coverage']) this.drawCoverage();
        if (this.filters['filter-coverage']) this.drawPlanCoverage();
        this.drawSystems();
        this.drawObjects();
        this.drawPlanSuggestions();
        this.drawIntelFacts();
        this.drawPlanStations();
        this.drawCursorPreview();
        if (this.placementMode && this.ghostPos) this.drawGhost();
    }

    drawGrid() {
        const c = this.ctx;
        const topLeft = this.screenToWorld(0, 0);
        const bottomRight = this.screenToWorld(this.canvas.width, this.canvas.height);
        const minWx = Math.min(topLeft.x, bottomRight.x);
        const maxWx = Math.max(topLeft.x, bottomRight.x);
        const minWy = Math.min(topLeft.y, bottomRight.y);
        const maxWy = Math.max(topLeft.y, bottomRight.y);
        const systemPx = this.systemSpacing * this.scale;
        const stepSystems = systemPx < 4 ? 100 : systemPx < 10 ? 50 : systemPx < 25 ? 10 : 1;
        const stepWorld = stepSystems * this.systemSpacing;

        const startX = this._snapDown(minWx, stepWorld);
        const startY = this._snapDown(minWy, stepWorld);

        c.save();
        c.lineWidth = 1;
        c.font = '11px sans-serif';
        c.textAlign = 'left';
        c.textBaseline = 'top';

        for (let wx = startX; wx <= maxWx; wx += stepWorld) {
            const sx = this.worldToScreen(wx, 0).x;
            const coord = Math.round(this.worldToSystemX(wx));
            const isCenter = coord === this.area.center_y;
            c.strokeStyle = isCenter ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)';
            c.beginPath(); c.moveTo(sx, 0); c.lineTo(sx, this.canvas.height); c.stroke();
            if (stepSystems >= 10 || systemPx >= 25) {
                c.fillStyle = isCenter ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
                c.fillText(String(coord), sx + 4, 4);
            }
        }

        for (let wy = startY; wy <= maxWy; wy += stepWorld) {
            const sy = this.worldToScreen(0, wy).y;
            const coord = Math.round(this.worldToSystemY(wy));
            const isCenter = coord === this.area.center_x;
            c.strokeStyle = isCenter ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)';
            c.beginPath(); c.moveTo(0, sy); c.lineTo(this.canvas.width, sy); c.stroke();
            if (stepSystems >= 10 || systemPx >= 25) {
                c.fillStyle = isCenter ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
                c.fillText(String(coord), 4, sy + 4);
            }
        }

        c.restore();
    }

    drawSystems() {
        const systemPx = this.systemSpacing * this.scale;
        if (systemPx < 18) return;

        const c = this.ctx;
        const topLeft = this.screenToWorld(0, 0);
        const bottomRight = this.screenToWorld(this.canvas.width, this.canvas.height);
        const minHorizontal = Math.max(this.area.min_y, Math.floor(this.worldToSystemX(Math.min(topLeft.x, bottomRight.x))) - 1);
        const maxHorizontal = Math.min(this.area.max_y, Math.ceil(this.worldToSystemX(Math.max(topLeft.x, bottomRight.x))) + 1);
        const minVertical = Math.max(this.area.min_x, Math.floor(this.worldToSystemY(Math.min(topLeft.y, bottomRight.y))) - 1);
        const maxVertical = Math.min(this.area.max_x, Math.ceil(this.worldToSystemY(Math.max(topLeft.y, bottomRight.y))) + 1);

        c.save();
        c.fillStyle = 'rgba(255,255,255,0.22)';
        for (let vertical = minVertical; vertical <= maxVertical; vertical++) {
            for (let horizontal = minHorizontal; horizontal <= maxHorizontal; horizontal++) {
                const sp = this.worldToScreen(this.systemToWorldX(horizontal), this.systemToWorldY(vertical));
                c.beginPath(); c.arc(sp.x, sp.y, 1.5, 0, Math.PI * 2); c.fill();
            }
        }
        c.restore();
    }
    drawCoverage() {
        const c = this.ctx;
        const alstations = this.objects.filter(o => o.type === 'object' && this._isAlstation(o));
        if (!alstations.length) return;

        for (const obj of alstations) {
            const sp = this._objectToScreen(obj, false);
            const level = obj.level || 1;
            const r = (obj.radius || level * 900) * this.scale;
            if (r < 5) continue;

            const g = c.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
            g.addColorStop(0, 'rgba(52,152,219,0.25)');
            g.addColorStop(0.5, 'rgba(52,152,219,0.12)');
            g.addColorStop(1, 'rgba(52,152,219,0.01)');
            c.fillStyle = g;
            c.beginPath(); c.arc(sp.x, sp.y, r, 0, Math.PI * 2); c.fill();

            c.strokeStyle = 'rgba(52,152,219,0.3)';
            c.lineWidth = 1.5;
            c.setLineDash([5, 3]);
            c.beginPath(); c.arc(sp.x, sp.y, r, 0, Math.PI * 2); c.stroke();
            c.setLineDash([]);

            // WiFi icon
            c.fillStyle = '#f1c40f';
            c.beginPath();
            c.moveTo(sp.x, sp.y - 8); c.lineTo(sp.x - 6, sp.y + 4); c.lineTo(sp.x + 6, sp.y + 4);
            c.closePath(); c.fill();
            c.strokeStyle = '#f1c40f'; c.lineWidth = 1.5;
            for (let w = 1; w <= 3; w++) {
                c.beginPath(); c.arc(sp.x, sp.y - 2, 4 + w * 3, -0.8 * Math.PI, -0.2 * Math.PI); c.stroke();
            }

            c.fillStyle = '#fff'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center';
            c.fillText(`${obj.name || 'Алстанция'} (${level}ур)`, sp.x, sp.y + 18);
            c.textAlign = 'left';
        }
    }

    _isAlstation(obj) {
        const s = obj.subtype || obj.object_type || '';
        return s.includes('\u0410\u043b\u0441\u0442\u0430\u043d\u0446')
            || s.includes('РђР»СЃС‚Р°РЅС†')
            || s.includes('Р С’Р В»РЎРѓРЎвЂљР В°Р Р…РЎвЂ ');
    }
    drawPlanCoverage() {
        if (!this.planStations.length) return;
        const c = this.ctx;
        c.save();
        for (const item of this.planStations) {
            const sp = this.worldToScreen(item.wx, item.wy);
            const r = item.radius * this.scale;
            if (r < 3) continue;

            const grad = c.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
            grad.addColorStop(0, 'rgba(46,204,113,0.2)');
            grad.addColorStop(0.65, 'rgba(46,204,113,0.08)');
            grad.addColorStop(1, 'rgba(46,204,113,0.01)');
            c.fillStyle = grad;
            c.beginPath(); c.arc(sp.x, sp.y, r, 0, Math.PI * 2); c.fill();

            c.strokeStyle = item.id === this.selectedPlanId ? 'rgba(255,255,255,0.9)' : 'rgba(46,204,113,0.75)';
            c.lineWidth = item.id === this.selectedPlanId ? 2.5 : 1.5;
            c.setLineDash([8, 5]);
            c.beginPath(); c.arc(sp.x, sp.y, r, 0, Math.PI * 2); c.stroke();
            c.setLineDash([]);
        }
        c.restore();
    }

    drawPlanStations() {
        if (!this.planStations.length) return;
        const c = this.ctx;
        c.save();
        for (const item of this.planStations) {
            const sp = this.worldToScreen(item.wx, item.wy);
            const selected = item.id === this.selectedPlanId;
            const sz = selected ? 12 : 9;
            c.shadowColor = selected ? '#fff' : 'rgba(46,204,113,0.8)';
            c.shadowBlur = selected ? 14 : 8;
            c.fillStyle = '#2ecc71';
            c.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.55)';
            c.lineWidth = selected ? 2 : 1;
            c.beginPath();
            c.moveTo(sp.x, sp.y - sz);
            c.lineTo(sp.x + sz, sp.y);
            c.lineTo(sp.x, sp.y + sz);
            c.lineTo(sp.x - sz, sp.y);
            c.closePath();
            c.fill(); c.stroke();

            c.shadowBlur = 0;
            c.fillStyle = '#fff';
            c.font = 'bold 11px sans-serif';
            c.textAlign = 'center';
            c.fillText('П' + item.id + ' ' + item.level + 'ур', sp.x, sp.y - sz - 6);
        }
        c.restore();
    }

    drawCursorPreview() {
        const point = this.cursorPoint || this.ghostPos;
        if (!point) return;
        const active = this.planningMode || this.placementMode || this.pendingMoveObj || this.pendingPlanMoveId;
        if (!active) return;

        const c = this.ctx;
        const sp = this.worldToScreen(point.wx, point.wy);
        const planItem = this.pendingPlanMoveId ? this.planStations.find(st => st.id === this.pendingPlanMoveId) : null;
        const level = planItem ? planItem.level : this.pendingMoveObj ? (this.pendingMoveObj.level || this.placementLevel) : this.planningMode ? this.planLevel : this.placementLevel;
        const radius = this._planRadius(level);
        const r = radius * this.scale;

        c.save();
        c.strokeStyle = this.pendingMoveObj ? '#ff7675' : '#2ecc71';
        c.fillStyle = this.pendingMoveObj ? 'rgba(255,118,117,0.12)' : 'rgba(46,204,113,0.12)';
        if (r >= 4) {
            c.setLineDash([6, 4]);
            c.beginPath(); c.arc(sp.x, sp.y, r, 0, Math.PI * 2); c.fill(); c.stroke();
            c.setLineDash([]);
        }

        c.strokeStyle = 'rgba(255,255,255,0.8)';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(sp.x - 12, sp.y); c.lineTo(sp.x + 12, sp.y); c.stroke();
        c.beginPath(); c.moveTo(sp.x, sp.y - 12); c.lineTo(sp.x, sp.y + 12); c.stroke();

        c.fillStyle = '#fff';
        c.font = 'bold 12px sans-serif';
        c.textAlign = 'center';
        c.fillText('[' + point.sx + ':' + point.sy + ':0]', sp.x, sp.y - 18);
        c.font = '11px sans-serif';
        c.fillText(level + ' ур / ' + radius + ' укм', sp.x, sp.y + 24);
        c.restore();
    }

    _updateCoordHud(point, modeText) {
        const el = document.getElementById('map-coord-hud');
        if (!el || !point) return;
        const parts = ['[' + point.sx + ':' + point.sy + ':0]'];
        if (modeText) parts.push(modeText);
        parts.push('привязка к системе');
        el.textContent = parts.join(' · ');
        el.style.display = 'block';
    }

    _clearCoordHud() {
        const el = document.getElementById('map-coord-hud');
        if (el) el.style.display = 'none';
    }

    drawPlanSuggestions() {
        if (!this.planSuggestions.length) return;
        const c = this.ctx;
        c.save();
        for (const item of this.planSuggestions) {
            const sp = this.worldToScreen(item.wx, item.wy);
            if (sp.x < -40 || sp.x > this.canvas.width + 40 || sp.y < -40 || sp.y > this.canvas.height + 40) continue;
            const radius = item.radius || this._planRadius(item.level || this.planLevel);
            const r = radius * this.scale;
            if (r >= 4) {
                c.strokeStyle = 'rgba(241,196,15,0.45)';
                c.lineWidth = 1;
                c.setLineDash([3, 4]);
                c.beginPath(); c.arc(sp.x, sp.y, r, 0, Math.PI * 2); c.stroke();
                c.setLineDash([]);
            }
            c.fillStyle = '#f1c40f';
            c.strokeStyle = 'rgba(0,0,0,0.7)';
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(sp.x, sp.y - 8);
            c.lineTo(sp.x + 8, sp.y);
            c.lineTo(sp.x, sp.y + 8);
            c.lineTo(sp.x - 8, sp.y);
            c.closePath();
            c.fill(); c.stroke();
            c.fillStyle = '#fff';
            c.font = '10px sans-serif';
            c.textAlign = 'center';
            c.fillText('+' + (item.uncovered_players || item.covered_players || 0), sp.x, sp.y - 12);
        }
        c.restore();
    }

    findSuggestionAt(sx, sy) {
        let best = null, bestDist = 16;
        for (const item of this.planSuggestions) {
            const sp = this.worldToScreen(item.wx, item.wy);
            const d = Math.hypot(sp.x - sx, sp.y - sy);
            if (d < bestDist) { bestDist = d; best = item; }
        }
        return best;
    }

    async loadPlanSuggestions() {
        const level = this.planLevel || 10;
        const resp = await fetch('/map/api/plan?level=' + encodeURIComponent(level));
        if (!resp.ok) {
            alert('Не удалось загрузить предложения планировщика');
            return;
        }
        const data = await resp.json();
        this.planSuggestions = (data.suggestions || []).slice(0, 30);
        this._updateSuggestionsPanel();
        this.render();
    }

    clearPlanSuggestions() {
        this.planSuggestions = [];
        this._updateSuggestionsPanel();
        this.render();
    }

    addSuggestionToPlan(item) {
        if (!item) return;
        this.addPlanStation({ sx: item.x, sy: item.y, wx: item.wx, wy: item.wy });
    }

    _updateSuggestionsPanel() {
        const el = document.getElementById('suggestions-list');
        if (!el) return;
        if (!this.planSuggestions.length) {
            el.innerHTML = '<div class="text-muted small">Нет загруженных предложений</div>';
            return;
        }
        el.innerHTML = this.planSuggestions.slice(0, 12).map((item, idx) => {
            const gain = item.uncovered_players || item.covered_players || 0;
            return '<div class="suggestion-row border-bottom border-secondary py-1" data-idx="' + idx + '" style="cursor:pointer;">'
                + '<div><strong>#' + (idx + 1) + '</strong> [' + item.x + ':' + item.y + ':0] ' + item.level + ' ур</div>'
                + '<div class="text-muted">новых ' + gain + ', всего ' + (item.covered_players || 0) + ', score ' + item.score + '</div>'
                + '</div>';
        }).join('');
        el.querySelectorAll('.suggestion-row').forEach(row => {
            row.addEventListener('click', () => {
                const item = this.planSuggestions[parseInt(row.dataset.idx)];
                if (!item) return;
                this.centerOn(item.wx, item.wy);
                this.addSuggestionToPlan(item);
            });
        });
    }

    async loadIntelFacts() {
        const resp = await fetch('/map/api/intel');
        if (!resp.ok) {
            alert('Не удалось загрузить данные из заметок');
            return;
        }
        const data = await resp.json();
        this.intelFacts = data.facts || [];
        this._updateIntelPanel(data.summary || {});
        this.render();
    }

    drawIntelFacts() {
        if (!this.intelFacts.length) return;
        const c = this.ctx;
        c.save();
        for (const item of this.intelFacts) {
            if (item.status === 'found') continue;
            const sp = this._intelToScreen(item);
            if (sp.x < -30 || sp.x > this.canvas.width + 30 || sp.y < -30 || sp.y > this.canvas.height + 30) continue;
            const color = item.kind === 'alstation' ? '#2ecc71' : item.kind === 'ops' ? '#f39c12' : '#74b9ff';
            c.strokeStyle = color;
            c.fillStyle = color;
            c.lineWidth = 2;
            c.setLineDash([5, 4]);
            c.beginPath();
            c.arc(sp.x, sp.y, item.kind === 'alstation' ? 13 : 10, 0, Math.PI * 2);
            c.stroke();
            c.setLineDash([]);
            c.beginPath();
            c.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
            c.fill();
        }
        c.restore();
    }

    _intelToScreen(item) {
        const sp = this.worldToScreen(item.wx, item.wy);
        const z = Number(item.z || 0);
        if (z > 0 && z <= 9) {
            const angle = ((z - 1) / 9) * Math.PI * 2 - Math.PI / 2;
            const r = z * 8;
            return { x: sp.x + Math.cos(angle) * r, y: sp.y + Math.sin(angle) * r };
        }
        return sp;
    }

    _updateIntelPanel(summary = {}) {
        const el = document.getElementById('intel-list');
        const sum = document.getElementById('intel-summary');
        if (sum) {
            sum.textContent = 'Найдено: ' + (summary.total || this.intelFacts.length)
                + ', отсутствует: ' + (summary.missing || 0)
                + ', уже есть: ' + (summary.found || 0);
        }
        if (!el) return;
        if (!this.intelFacts.length) {
            el.innerHTML = '<div class="text-muted small">Нет загруженных данных</div>';
            return;
        }
        const labels = {
            alstation: 'Алстанция',
            ops: 'ОПС',
            gate: 'Врата',
            dunya: 'Дуня',
            moon: 'Луна'
        };
        el.innerHTML = this.intelFacts.slice(0, 24).map((item, idx) => {
            const found = item.status === 'found';
            const level = item.level ? ' · ' + item.level + ' ур' : '';
            const action = item.kind === 'alstation' && !found
                ? '<button class="btn btn-sm btn-outline-success intel-plan-btn" data-idx="' + idx + '" title="Добавить в план"><i class="bi bi-plus-lg"></i></button>'
                : '';
            return '<div class="intel-row border-bottom border-secondary py-1" data-idx="' + idx + '" style="cursor:pointer;">'
                + '<div class="d-flex align-items-center gap-1">'
                + '<span class="' + (found ? 'text-success' : 'text-warning') + '">' + (found ? '✓' : '!') + '</span>'
                + '<strong>' + (labels[item.kind] || item.kind) + '</strong>'
                + '<span>[' + item.x + ':' + item.y + ':' + (item.z || 0) + ']' + level + '</span>'
                + '<span class="ms-auto">' + action + '</span>'
                + '</div>'
                + '<div class="text-muted">' + this._escapeHtml(item.player || '') + ' · ' + this._escapeHtml(item.snippet || '') + '</div>'
                + '</div>';
        }).join('');
        el.querySelectorAll('.intel-row').forEach(row => {
            row.addEventListener('click', (ev) => {
                const item = this.intelFacts[parseInt(row.dataset.idx)];
                if (!item) return;
                if (ev.target.closest('.intel-plan-btn')) {
                    this.addIntelFactToPlan(item);
                    return;
                }
                this.centerOn(item.wx, item.wy);
            });
        });
    }

    addIntelFactToPlan(item) {
        if (!item || item.kind !== 'alstation') return;
        if (item.level) {
            this.planLevel = item.level;
            const input = document.getElementById('plan-level');
            if (input) input.value = item.level;
            const val = document.getElementById('plan-level-val');
            const radius = document.getElementById('plan-radius-val');
            if (val) val.textContent = item.level;
            if (radius) radius.textContent = this._planRadius(item.level);
        }
        this.addPlanStation({
            sx: item.x,
            sy: item.y,
            wx: item.wx,
            wy: item.wy,
            level: item.level || this.planLevel
        });
    }
    _objectToScreen(obj, visualOffset = true) {
        const sp = this.worldToScreen(obj.wx, obj.wy);
        const z = Number(obj.z || 0);
        if (z > 0 && z <= 9) {
            const angle = ((z - 1) / 9) * Math.PI * 2 - Math.PI / 2;
            const r = z * 8;
            const planetPoint = {
                x: sp.x + Math.cos(angle) * r,
                y: sp.y + Math.sin(angle) * r
            };
            return visualOffset ? this._applyStackOffset(obj, planetPoint) : planetPoint;
        }
        return visualOffset ? this._applyStackOffset(obj, sp) : sp;
    }

    _applyStackOffset(obj, sp) {
        if (!obj || obj.type !== 'object') return sp;
        const group = this.objects
            .filter(o => o.type === 'object' && this._isVisible(o)
                && o.x === obj.x && o.y === obj.y && Number(o.z || 0) === Number(obj.z || 0))
            .sort((a, b) => {
                const at = (a.subtype || '') + ':' + (a.id || 0) + ':' + (a.name || '');
                const bt = (b.subtype || '') + ':' + (b.id || 0) + ':' + (b.name || '');
                return at.localeCompare(bt);
            });
        if (group.length <= 1) return sp;
        const idx = group.findIndex(o => o === obj || (o.id && obj.id && o.id === obj.id));
        if (idx < 0) return sp;
        const ring = Math.min(16, 9 + group.length * 1.5);
        const angle = -Math.PI / 2 + (Math.PI * 2 * idx / group.length);
        return {
            x: sp.x + Math.cos(angle) * ring,
            y: sp.y + Math.sin(angle) * ring
        };
    }

    _updateStatus() {
        const el = document.getElementById('map-status');
        if (!el) return;
        const count = this.meta.objects_count || this.objects.length;
        const legacy = this.meta.legacy_coordinates_count || 0;
        const outside = this.meta.out_of_area_count || 0;
        el.textContent = 'Objects: ' + count + '. Legacy skipped: ' + legacy + '. Outside area: ' + outside + '.';
    }

    drawObjects() {
        const c = this.ctx;
        for (const obj of this.objects) {
            if (!this._isVisible(obj)) continue;
            const sp = this._objectToScreen(obj);
            if (sp.x < -20 || sp.x > this.canvas.width + 20 ||
                sp.y < -20 || sp.y > this.canvas.height + 20) continue;

            const style = this._getStyle(obj);
            const hl = this.highlightedObj === obj;
            const sz = style.size * (hl ? 1.5 : 1);

            c.save();
            if (hl) { c.shadowColor = '#fff'; c.shadowBlur = 10; }
            c.fillStyle = style.color;
            c.strokeStyle = hl ? '#fff' : 'rgba(0,0,0,0.3)';
            c.lineWidth = hl ? 2 : 1;

            if (style.shape === 'circle') {
                c.beginPath(); c.arc(sp.x, sp.y, sz, 0, Math.PI * 2); c.fill(); c.stroke();
            } else if (style.shape === 'diamond') {
                c.beginPath(); c.moveTo(sp.x, sp.y - sz); c.lineTo(sp.x + sz, sp.y);
                c.lineTo(sp.x, sp.y + sz); c.lineTo(sp.x - sz, sp.y); c.closePath(); c.fill(); c.stroke();
            } else if (style.shape === 'square') {
                c.fillRect(sp.x - sz / 2, sp.y - sz / 2, sz, sz); c.strokeRect(sp.x - sz / 2, sp.y - sz / 2, sz, sz);
            } else if (style.shape === 'triangle') {
                c.beginPath(); c.moveTo(sp.x, sp.y - sz); c.lineTo(sp.x + sz, sp.y + sz);
                c.lineTo(sp.x - sz, sp.y + sz); c.closePath(); c.fill(); c.stroke();
            } else if (style.shape === 'star') {
                this._drawStar(sp.x, sp.y, 5, sz, sz / 2); c.fill(); c.stroke();
            }

            // Label
            if (this.scale > 0.4 && obj.name) {
                c.fillStyle = 'rgba(255,255,255,0.8)';
                c.font = '9px sans-serif';
                c.textAlign = 'center';
                c.fillText(obj.name, sp.x, sp.y + sz + 12);
                c.textAlign = 'left';
            }
            c.restore();
        }
    }

    _drawStar(cx, cy, spikes, outer, inner) {
        const c = this.ctx;
        let rot = -Math.PI / 2, step = Math.PI / spikes;
        c.beginPath(); c.moveTo(cx, cy - outer);
        for (let i = 0; i < spikes; i++) {
            c.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer); rot += step;
            c.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner); rot += step;
        }
        c.closePath();
    }

    _getStyle(obj) {
        const sz = 8;
        if (obj.type === 'capital') return { shape: 'circle', color: '#ecf0f1', size: 10 };
        if (obj.type === 'account') {
            if (obj.race === 'Жук') return { shape: 'circle', color: '#27ae60', size: sz };
            if (obj.race === 'Терран') return { shape: 'circle', color: '#2980b9', size: sz };
            if (obj.race === 'Тосс') return { shape: 'circle', color: '#8e44ad', size: sz };
            return { shape: 'circle', color: '#95a5a6', size: sz };
        }
        if (obj.type === 'object') {
            const s = obj.subtype || '';
            if (s.includes('ОПС')) return { shape: 'square', color: '#e67e22', size: 6 };
            if (s.includes('Алстанц')) return { shape: 'diamond', color: '#e74c3c', size: 10 };
            if (s.includes('Дуня')) return { shape: 'triangle', color: '#f39c12', size: 6 };
            if (s.includes('Луна')) return { shape: 'circle', color: '#95a5a6', size: 6 };
            if (s.includes('Врата')) return { shape: 'star', color: '#9b59b6', size: 8 };
        }
        return { shape: 'circle', color: '#bdc3c7', size: 6 };
    }

    _isVisible(obj) {
        if (obj.type === 'capital' || obj.type === 'account') {
            if (obj.race === 'Терран' && !this.filters['filter-terran']) return false;
            if (obj.race === 'Жук' && !this.filters['filter-zerg']) return false;
            if (obj.race === 'Тосс' && !this.filters['filter-toss']) return false;
        }
        if (obj.type === 'object') {
            const s = obj.subtype || '';
            if (s.includes('ОПС') && !this.filters['filter-ops']) return false;
            if (s.includes('Алстанц') && !this.filters['filter-alstation']) return false;
            if (s.includes('Дуня') && !this.filters['filter-dunya']) return false;
            if (s.includes('Луна') && !this.filters['filter-luna']) return false;
            if (s.includes('Врата') && !this.filters['filter-vrata']) return false;
        }
        return true;
    }

    findObjectAt(sx, sy) {
        let best = null, bestDist = 20;
        for (const obj of this.objects) {
            if (!this._isVisible(obj)) continue;
            const sp = this._objectToScreen(obj);
            const d = Math.hypot(sp.x - sx, sp.y - sy);
            if (d < bestDist) { bestDist = d; best = obj; }
        }
        return best;
    }

    showTooltip(obj, sx, sy) {
        if (!this.tooltip) return;
        let html = `<div class="tooltip-title">${obj.name || obj.nick || 'Объект'}</div>`;
        if (obj.race) html += `<span class="tooltip-race" style="background:${this._getStyle(obj).color}">${obj.race}</span>`;
        html += `<div style="margin-top:4px;font-size:11px;">Координаты: ${obj.x}:${obj.y}:${obj.z || 0}</div>`;
        if (obj.points) html += `<div>Очки: ${obj.points.toLocaleString()}</div>`;
        if (obj.level) html += `<div>Уровень: ${obj.level}</div>`;
        if (obj.radius) html += `<div>Радиус: ${obj.radius.toLocaleString()} ед.</div>`;
        if (obj.url) html += `<div><a href="${obj.url}" style="color:#6c5ce7;">Открыть →</a></div>`;
        this.tooltip.innerHTML = html;
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = (sx + 15) + 'px';
        this.tooltip.style.top = (sy - 10) + 'px';
    }

    hideTooltip() { if (this.tooltip) this.tooltip.style.display = 'none'; }

    _onWheel(e) {
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const wb = this.screenToWorld(mx, my);
        this.scale *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.scale = Math.max(0.0002, Math.min(20, this.scale));
        const wa = this.screenToWorld(mx, my);
        this.offsetX += (wa.x - wb.x) * this.scale;
        this.offsetY += -(wa.y - wb.y) * this.scale;
        this.render();
    }

    _onMouseDown(e) {
        if (e.button === 2) return;
        this.hideContextMenu();
        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const planObj = this.findPlanStationAt(mx, my);
        if (planObj) {
            this.draggingPlanId = planObj.id;
            this.selectedPlanId = planObj.id;
            this.planDragMoved = false;
            this.pendingPlanMoveId = planObj.id;
            this.ghostPos = { sx: planObj.x, sy: planObj.y, wx: planObj.wx, wy: planObj.wy };
            this.cursorPoint = this.ghostPos;
            this._updateCoordHud(this.cursorPoint, this._moveModeLabel());
            this.canvas.style.cursor = 'grabbing';
            this._updatePlanPanel();
            this.render();
            return;
        }
        if (this.planningMode || this.pendingMoveObj || this.pendingPlanMoveId) return;
        this.isDragging = true;
        this._dragMoved = false;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.canvas.style.cursor = 'grabbing';
    }

    _onMouseMove(e) {
        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;

        if (this.draggingPlanId) {
            const item = this.planStations.find(st => st.id === this.draggingPlanId);
            if (!item) return;
            const point = this._systemPointFromScreen(mx, my);
            this.planDragMoved = true;
            item.x = point.sx;
            item.y = point.sy;
            item.z = 0;
            item.wx = point.wx;
            item.wy = point.wy;
            Object.assign(item, this._estimatePlanStation(item));
            this.ghostPos = point;
            this.cursorPoint = point;
            this._updateCoordHud(point, this._moveModeLabel());
            this.render();
            return;
        }

        if (this.isDragging) {
            const dx = e.clientX - this.lastMouseX, dy = e.clientY - this.lastMouseY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._dragMoved = true;
            this.offsetX += dx; this.offsetY += dy;
            this.lastMouseX = e.clientX; this.lastMouseY = e.clientY;
            this.render();
            return;
        }
        if (this.planningMode || this.placementMode || this.pendingMoveObj || this.pendingPlanMoveId) {
            const p = this._systemPointFromScreen(mx, my);
            this.ghostPos = p;
            this.cursorPoint = p;
            let modeText = '';
            if (this.pendingMoveObj) modeText = 'перемещение объекта';
            else if (this.pendingPlanMoveId) modeText = 'перемещение плана';
            else if (this.planningMode) modeText = 'плановая алстанция';
            else if (this.placementMode) modeText = 'новый объект';
            this._updateCoordHud(p, modeText);
            this.canvas.style.cursor = 'crosshair';
            this.render();
            return;
        }
        this.ghostPos = null;
        this.cursorPoint = this._systemPointFromScreen(mx, my);
        this._updateCoordHud(this.cursorPoint, '');
        const obj = this.findObjectAt(mx, my);
        const suggestionObj = this.findSuggestionAt(mx, my);
        if (obj) {
            this.highlightedObj = obj;
            this.showTooltip(obj, mx, my);
            this.canvas.style.cursor = 'pointer';
        } else if (suggestionObj) {
            this.highlightedObj = null;
            this.hideTooltip();
            this.canvas.style.cursor = 'copy';
        } else {
            this.highlightedObj = null;
            this.hideTooltip();
            this.canvas.style.cursor = 'grab';
        }
    }

    _onMouseUp(e) {
        if (e.button === 2) return;

        if (this.draggingPlanId) {
            const item = this.planStations.find(st => st.id === this.draggingPlanId);
            this.selectedPlanId = this.draggingPlanId;
            this.draggingPlanId = null;
            this.pendingPlanMoveId = null;
            this.ghostPos = null;
            this.cursorPoint = null;
            this._clearCoordHud();
            this._refreshPlanEstimates();
            this._updatePlanPanel();
            this.render();
            if (item && !this.planDragMoved) this.centerOn(item.wx, item.wy);
            this.planDragMoved = false;
            return;
        }

        const wasDrag = this._dragMoved;
        this.isDragging = false;
        this._dragMoved = false;
        this.canvas.style.cursor = 'grab';

        if (wasDrag) return;

        const r = this.canvas.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;

        if (this.pendingMoveObj) {
            this.moveSelectedObjectToPoint(this._systemPointFromScreen(sx, sy));
            return;
        }

        if (this.pendingPlanMoveId) {
            this.moveSelectedPlanToPoint(this._systemPointFromScreen(sx, sy));
            return;
        }

        if (this.planningMode) {
            const suggestion = this.findSuggestionAt(sx, sy);
            if (suggestion) {
                this.addSuggestionToPlan(suggestion);
                return;
            }
            this.addPlanStationFromScreen(sx, sy);
            return;
        }

        if (this.placementMode) {
            this._onPlacementClick(sx, sy);
            return;
        }

        const obj = this.findObjectAt(sx, sy);
        if (obj && obj.type === 'object' && this._isAlstation(obj)) {
            this._showStationEditor(obj);
        } else if (obj && obj.url) {
            window.location.href = obj.url;
        } else if (obj) {
            this.centerOn(obj.wx || 0, obj.wy || 0);
        }
    }

    _cancelDrag() {
        this.isDragging = false;
        this._dragMoved = false;
        this.canvas.style.cursor = 'grab';
    }

    _onSearch(e) {
        const q = e.target.value.toLowerCase();
        if (!q) { this.highlightedObj = null; this.render(); return; }
        const found = this.objects.find(o => (o.name || '').toLowerCase().includes(q) || (o.nick || '').toLowerCase().includes(q));
        if (found) { this.centerOn(found.wx || 0, found.wy || 0); this.highlightedObj = found; this.render(); }
    }

    zoomIn() { this.scale = Math.min(20, this.scale * 1.5); this.render(); }
    zoomOut() { this.scale = Math.max(0.0002, this.scale / 1.5); this.render(); }

    systemToWorldX(horizontalCoord) { return (horizontalCoord - this.area.center_y) * this.systemSpacing; }
    systemToWorldY(verticalCoord) { return (verticalCoord - this.area.center_x) * this.systemSpacing; }
    worldToSystemX(wx) { return wx / this.systemSpacing + this.area.center_y; }
    worldToSystemY(wy) { return wy / this.systemSpacing + this.area.center_x; }
    _snapDown(value, step) { return Math.floor(value / step) * step; }
    _clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

    _systemPointFromScreen(sx, sy) {
        const w = this.screenToWorld(sx, sy);
        const systemX = this._clamp(Math.round(this.worldToSystemY(w.y)), this.area.min_x, this.area.max_x);
        const systemY = this._clamp(Math.round(this.worldToSystemX(w.x)), this.area.min_y, this.area.max_y);
        return {
            sx: systemX,
            sy: systemY,
            x: systemX,
            y: systemY,
            z: 0,
            wx: this.systemToWorldX(systemY),
            wy: this.systemToWorldY(systemX)
        };
    }


    _planRadius(level) { return Math.max(1, parseInt(level) || 1) * 900; }

    _targetObjects() {
        return this.objects.filter(o => o.type === 'capital' || o.type === 'account');
    }

    _existingAlstations() {
        return this.objects
            .filter(o => o.type === 'object' && this._isAlstation(o))
            .map(o => ({ wx: o.wx, wy: o.wy, radius: o.radius || this._planRadius(o.level || 1) }));
    }

    _distance(a, b) {
        return Math.hypot((a.wx || 0) - (b.wx || 0), (a.wy || 0) - (b.wy || 0));
    }

    _coveredBy(point, stations) {
        return stations.some(st => this._distance(point, st) <= st.radius);
    }

    _estimatePlanStation(station) {
        const targets = this._targetObjects();
        const existing = this._existingAlstations();
        let covered = 0;
        let newCovered = 0;
        for (const target of targets) {
            const inRadius = this._distance(target, station) <= station.radius;
            if (!inRadius) continue;
            covered += 1;
            if (!this._coveredBy(target, existing)) newCovered += 1;
        }
        const overlaps = existing.filter(st => this._distance(station, st) < station.radius + st.radius).length;
        return { covered, newCovered, overlaps };
    }

    _planCoverageSummary() {
        const targets = this._targetObjects();
        const existing = this._existingAlstations();
        const planned = this.planStations.map(st => ({ wx: st.wx, wy: st.wy, radius: st.radius }));
        const existingCovered = targets.filter(t => this._coveredBy(t, existing)).length;
        const totalCovered = targets.filter(t => this._coveredBy(t, existing) || this._coveredBy(t, planned)).length;
        return {
            targets: targets.length,
            existingCovered,
            totalCovered,
            newCovered: Math.max(0, totalCovered - existingCovered),
            pct: targets.length ? Math.round(totalCovered / targets.length * 1000) / 10 : 0
        };
    }

    _makePlanStation(point, level) {
        const cleanLevel = Math.max(1, Math.min(20, parseInt(level) || 10));
        const item = {
            id: this.nextPlanId++,
            name: 'План ' + (this.nextPlanId - 1),
            x: point.sx,
            y: point.sy,
            z: 0,
            wx: point.wx,
            wy: point.wy,
            level: cleanLevel,
            radius: this._planRadius(cleanLevel)
        };
        Object.assign(item, this._estimatePlanStation(item));
        return item;
    }

    addPlanStationFromScreen(sx, sy) {
        const point = this._systemPointFromScreen(sx, sy);
        this.addPlanStation(point);
    }

    addPlanStation(point) {
        if (!this._isSystemInArea(point.sx, point.sy)) {
            alert('Координаты вне зоны альянса 2000:2000 - 3000:3000');
            return;
        }
        const exists = this.planStations.find(st => st.x === point.sx && st.y === point.sy && st.z === 0);
        if (exists) {
            this.selectedPlanId = exists.id;
            this.render();
            this._updatePlanPanel();
            return;
        }
        const item = this._makePlanStation(point, point.level || this.planLevel);
        this.planStations.push(item);
        this.selectedPlanId = item.id;
        this._refreshPlanEstimates();
        this._updatePlanPanel();
        this.render();
    }

    _refreshPlanEstimates() {
        this.planStations = this.planStations.map(item => Object.assign(item, this._estimatePlanStation(item)));
    }

    findPlanStationAt(sx, sy) {
        let best = null, bestDist = 18;
        for (const item of this.planStations) {
            const sp = this.worldToScreen(item.wx, item.wy);
            const d = Math.hypot(sp.x - sx, sp.y - sy);
            if (d < bestDist) { bestDist = d; best = item; }
        }
        return best;
    }

    togglePlanningMode() {
        this.planningMode = !this.planningMode;
        if (this.planningMode && this.placementMode) this.togglePlacementMode();
        this.ghostPos = null;
        const btn = document.getElementById('btn-planning');
        if (btn) {
            btn.classList.toggle('btn-success', this.planningMode);
            btn.classList.toggle('btn-outline-success', !this.planningMode);
            btn.innerHTML = this.planningMode
                ? '<i class="bi bi-check2-circle"></i> Планирование включено'
                : '<i class="bi bi-broadcast-pin"></i> План алстанций';
        }
        const panel = document.getElementById('planning-panel');
        if (panel) panel.style.display = this.planningMode || this.planStations.length ? 'block' : 'none';
        this.canvas.style.cursor = this.planningMode ? 'crosshair' : 'grab';
        this._updatePlanPanel();
        this.render();
    }

    setPlanLevel(level) {
        this.planLevel = Math.max(1, Math.min(20, parseInt(level) || 10));
        const val = document.getElementById('plan-level-val');
        const radius = document.getElementById('plan-radius-val');
        if (val) val.textContent = this.planLevel;
        if (radius) radius.textContent = this._planRadius(this.planLevel);
        if (this.selectedPlanId) {
            const item = this.planStations.find(st => st.id === this.selectedPlanId);
            if (item) {
                item.level = this.planLevel;
                item.radius = this._planRadius(this.planLevel);
                Object.assign(item, this._estimatePlanStation(item));
            }
        }
        this._refreshPlanEstimates();
        this._updatePlanPanel();
        this.render();
    }

    removeSelectedPlanStation() {
        if (!this.selectedPlanId) return;
        if (this.pendingPlanMoveId === this.selectedPlanId) this.pendingPlanMoveId = null;
        if (this.draggingPlanId === this.selectedPlanId) this.draggingPlanId = null;
        this.planStations = this.planStations.filter(st => st.id !== this.selectedPlanId);
        this.selectedPlanId = this.planStations.length ? this.planStations[this.planStations.length - 1].id : null;
        this.ghostPos = null;
        this.cursorPoint = null;
        this._clearCoordHud();
        this._updatePlanPanel();
        this.render();
    }

    clearPlan() {
        this.planStations = [];
        this.selectedPlanId = null;
        this.pendingPlanMoveId = null;
        this.draggingPlanId = null;
        this.ghostPos = null;
        this.cursorPoint = null;
        this._clearCoordHud();
        this._updatePlanPanel();
        this.render();
    }

    copyPlan() {
        const text = this.planStations.map(st =>
            'Алстанция ' + st.level + ' ур: [' + st.x + ':' + st.y + ':0], радиус ' + st.radius + ', новых целей ' + st.newCovered
        ).join('\n');
        if (!text) return;
        if (navigator.clipboard) navigator.clipboard.writeText(text);
    }

    async savePlanStations() {
        if (!this.planStations.length) return;
        if (!confirm('Сохранить плановые алстанции как объекты?')) return;
        for (const st of this.planStations) {
            const payload = {
                name: st.name || ('Алстанция ' + st.level + ' ур'),
                subtype: 'Алстанция',
                level: st.level,
                x: st.x,
                y: st.y,
                z: 0,
                status: 'Строится',
                comment: 'Создано из планировщика карты'
            };
            const resp = await fetch('/map/api/stations', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            if (!resp.ok) {
                const data = await resp.json().catch(() => ({}));
                alert(data.error || 'Ошибка сохранения плана');
                return;
            }
        }
        this.clearPlan();
        await this.loadData();
        this._updateStationsList();
    }

    _updatePlanPanel() {
        const panel = document.getElementById('planning-panel');
        if (panel) panel.style.display = this.planningMode || this.planStations.length ? 'block' : 'none';
        const summaryEl = document.getElementById('plan-summary');
        const listEl = document.getElementById('plan-list');
        const summary = this._planCoverageSummary();
        if (summaryEl) {
            summaryEl.innerHTML = 'План: ' + this.planStations.length
                + '<br>Новых целей: ' + summary.newCovered
                + '<br>Покрытие целей: ' + summary.totalCovered + '/' + summary.targets + ' (' + summary.pct + '%)';
        }
        if (!listEl) return;
        if (!this.planStations.length) {
            listEl.innerHTML = '<div class="text-muted small">Плановых алстанций пока нет</div>';
            return;
        }
        listEl.innerHTML = this.planStations.map(st => {
            const active = st.id === this.selectedPlanId ? 'border-success' : 'border-secondary';
            return '<div class="plan-row border-bottom ' + active + ' py-1" data-id="' + st.id + '" style="cursor:pointer;">'
                + '<div class="d-flex justify-content-between align-items-center gap-1">'
                + '<span><strong>П' + st.id + '</strong> [' + st.x + ':' + st.y + ':0] ' + st.level + ' ур</span>'
                + '<span class="btn-group btn-group-sm">'
                + '<button class="btn btn-outline-secondary py-0 px-1 plan-move-btn" title="Переместить"><i class="bi bi-arrows-move"></i></button>'
                + '<button class="btn btn-outline-danger py-0 px-1 plan-remove-btn" title="Удалить"><i class="bi bi-x-lg"></i></button>'
                + '</span></div>'
                + '<div class="text-muted">радиус ' + st.radius + ', новых ' + st.newCovered + ', всего ' + st.covered + ', пересечений ' + st.overlaps + '</div>'
                + '</div>';
        }).join('');
        listEl.querySelectorAll('.plan-row').forEach(row => {
            row.addEventListener('click', (ev) => {
                const id = parseInt(row.dataset.id);
                const st = this.planStations.find(item => item.id === id);
                if (!st) return;
                if (ev.target.closest('.plan-move-btn')) {
                    this.startPlanMove(st);
                    return;
                }
                if (ev.target.closest('.plan-remove-btn')) {
                    this.selectedPlanId = id;
                    this.removeSelectedPlanStation();
                    return;
                }
                this.selectedPlanId = id;
                this.planLevel = st.level;
                const levelInput = document.getElementById('plan-level');
                if (levelInput) levelInput.value = st.level;
                this.setPlanLevel(st.level);
                this.centerOn(st.wx, st.wy);
            });
        });
    }
    _moveModeLabel() {
        if (this.pendingMoveObj) return 'Перемещение: ' + (this.pendingMoveObj.name || 'объект');
        if (this.pendingPlanMoveId) return 'Перемещение плановой алстанции';
        return '';
    }

    startObjectMove(obj) {
        if (!obj) return;
        this.pendingMoveObj = obj;
        this.pendingPlanMoveId = null;
        this.highlightedObj = obj;
        this.placementMode = false;
        this.planningMode = false;
        this.ghostPos = { sx: obj.x, sy: obj.y, wx: obj.wx, wy: obj.wy };
        this.cursorPoint = this.ghostPos;
        this._updateCoordHud(this.cursorPoint, this._moveModeLabel());
        this.render();
    }

    startPlanMove(item) {
        if (!item) return;
        this.pendingPlanMoveId = item.id;
        this.pendingMoveObj = null;
        this.selectedPlanId = item.id;
        this.ghostPos = { sx: item.x, sy: item.y, wx: item.wx, wy: item.wy };
        this.cursorPoint = this.ghostPos;
        this._updateCoordHud(this.cursorPoint, this._moveModeLabel());
        this._updatePlanPanel();
        this.render();
    }

    cancelMoveMode() {
        this.pendingMoveObj = null;
        this.pendingPlanMoveId = null;
        this.ghostPos = null;
        this.cursorPoint = null;
        this.canvas.style.cursor = 'grab';
        this._clearCoordHud();
        this.render();
    }

    async moveSelectedObjectToPoint(point) {
        if (!this.pendingMoveObj || !point) return;
        if (!this._isSystemInArea(point.sx, point.sy)) {
            alert('Координаты вне зоны альянса 2000:2000 - 3000:3000');
            return;
        }
        const obj = this.pendingMoveObj;
        const resp = await fetch('/map/api/stations/' + obj.id, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ x: point.sx, y: point.sy, z: obj.z || 0 })
        });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            alert(data.error || 'Ошибка перемещения объекта');
            return;
        }
        this.pendingMoveObj = null;
        this.ghostPos = null;
        this.cursorPoint = null;
        this._clearCoordHud();
        await this.loadData();
        this._updateStationsList();
    }

    moveSelectedPlanToPoint(point) {
        if (!this.pendingPlanMoveId || !point) return;
        if (!this._isSystemInArea(point.sx, point.sy)) {
            alert('Координаты вне зоны альянса 2000:2000 - 3000:3000');
            return;
        }
        const item = this.planStations.find(st => st.id === this.pendingPlanMoveId);
        if (!item) return;
        item.x = point.sx;
        item.y = point.sy;
        item.z = 0;
        item.wx = point.wx;
        item.wy = point.wy;
        Object.assign(item, this._estimatePlanStation(item));
        this.pendingPlanMoveId = null;
        this.selectedPlanId = item.id;
        this.ghostPos = null;
        this.cursorPoint = null;
        this._clearCoordHud();
        this._refreshPlanEstimates();
        this._updatePlanPanel();
        this.render();
    }
    exportPNG() {
        const link = document.createElement('a');
        link.download = 'aurus-map.png';
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }

    togglePlacementMode() {
        this.placementMode = !this.placementMode;
        this.ghostPos = null;
        const btn = document.getElementById('btn-placement');
        if (btn) {
            btn.classList.toggle('btn-danger', this.placementMode);
            btn.classList.toggle('btn-outline-danger', !this.placementMode);
            btn.innerHTML = this.placementMode
                ? '<i class="bi bi-x-lg"></i> Отменить размещение'
                : '<i class="bi bi-geo-alt"></i> Разместить объект';
        }
        const panel = document.getElementById('placement-panel');
        if (panel) panel.style.display = this.placementMode ? 'block' : 'none';
        this.canvas.style.cursor = this.placementMode ? 'crosshair' : 'grab';
        this.render();
    }

    drawGhost() {
        const c = this.ctx;
        const g = this.ghostPos;
        const sp = this.worldToScreen(g.wx, g.wy);
        const radius = this.placementLevel * 900;
        const r = radius * this.scale;

        c.save();
        c.globalAlpha = 0.5;
        const grad = c.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
        grad.addColorStop(0, 'rgba(46,204,113,0.2)');
        grad.addColorStop(1, 'rgba(46,204,113,0.02)');
        c.fillStyle = grad;
        c.beginPath(); c.arc(sp.x, sp.y, r, 0, Math.PI * 2); c.fill();

        c.strokeStyle = '#2ecc71';
        c.lineWidth = 2;
        c.setLineDash([8, 4]);
        c.beginPath(); c.arc(sp.x, sp.y, r, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);

        c.fillStyle = '#2ecc71';
        c.beginPath();
        c.moveTo(sp.x, sp.y - 12); c.lineTo(sp.x + 12, sp.y);
        c.lineTo(sp.x, sp.y + 12); c.lineTo(sp.x - 12, sp.y);
        c.closePath(); c.fill();

        c.fillStyle = '#fff';
        c.font = 'bold 11px sans-serif';
        c.textAlign = 'center';
        c.fillText('[' + g.sx + ':' + g.sy + ':0] ур.' + this.placementLevel, sp.x, sp.y - 18);
        c.textAlign = 'left';
        c.restore();
    }

    _onContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const w = this.screenToWorld(mx, my);
        const sx = Math.round(w.y / 1000 + this.area.center_x);
        const sy = Math.round(w.x / 1000 + this.area.center_y);

        const obj = this.findObjectAt(mx, my);
        const planObj = this.findPlanStationAt(mx, my);
        const suggestionObj = this.findSuggestionAt(mx, my);
        const point = this._systemPointFromScreen(mx, my);
        this._contextPos = { sx: point.sx, sy: point.sy, wx: point.wx, wy: point.wy, obj: obj, planObj: planObj, suggestionObj: suggestionObj };

        const menu = document.getElementById('map-context-menu');
        if (!menu) return;

        let html = '';
        if (planObj) {
            html += '<div class="ctx-item" data-action="select_plan"><i class="bi bi-check2-square"></i> Выбрать плановую алстанцию</div>';
            html += '<div class="ctx-item" data-action="move_plan"><i class="bi bi-arrows-move"></i> Переместить плановую</div>';
            html += '<div class="ctx-item ctx-danger" data-action="remove_plan"><i class="bi bi-trash"></i> Удалить из плана</div>';
            html += '<div class="ctx-divider"></div>';
        }
        if (suggestionObj) {
            html += '<div class="ctx-item" data-action="add_suggestion"><i class="bi bi-plus-circle"></i> Добавить предложение в план</div>';
            html += '<div class="ctx-divider"></div>';
        }
        if (this.pendingMoveObj) {
            html += '<div class="ctx-item" data-action="move_selected_here"><i class="bi bi-arrows-move"></i> Переместить "' + this._escapeHtml(this.pendingMoveObj.name || 'объект') + '" сюда [' + point.sx + ':' + point.sy + ':0]</div>';
            html += '<div class="ctx-item" data-action="cancel_move"><i class="bi bi-x-lg"></i> Отменить перемещение</div>';
            html += '<div class="ctx-divider"></div>';
        }
        if (this.pendingPlanMoveId) {
            html += '<div class="ctx-item" data-action="move_plan_here"><i class="bi bi-arrows-move"></i> Переместить план сюда [' + point.sx + ':' + point.sy + ':0]</div>';
            html += '<div class="ctx-item" data-action="cancel_move"><i class="bi bi-x-lg"></i> Отменить перемещение</div>';
            html += '<div class="ctx-divider"></div>';
        }
        if (obj && obj.type === 'object') {
            html += '<div class="ctx-item" data-action="edit"><i class="bi bi-pencil"></i> Редактировать</div>';
            html += '<div class="ctx-item" data-action="select_move"><i class="bi bi-crosshair"></i> Выбрать для перемещения</div>';
            html += '<div class="ctx-item ctx-danger" data-action="delete"><i class="bi bi-trash"></i> Удалить</div>';
            html += '<div class="ctx-divider"></div>';
        }
        if (obj && obj.url) {
            html += '<div class="ctx-item" data-action="opencard"><i class="bi bi-box-arrow-up-right"></i> Открыть карточку</div>';
            html += '<div class="ctx-divider"></div>';
        }
        html += '<div class="ctx-item" data-action="plan_station"><i class="bi bi-broadcast-pin"></i> Плановая алстанция</div>';
        html += '<div class="ctx-item" data-action="create_station"><i class="bi bi-geo-alt"></i> Новая алстанция</div>';
        html += '<div class="ctx-item" data-action="create_ops"><i class="bi bi-shield"></i> Новый ОПС</div>';
        html += '<div class="ctx-item" data-action="create_dunya"><i class="bi bi-moon"></i> Новая Дуня</div>';

        menu.innerHTML = html;

        let left = e.clientX;
        let top = e.clientY;
        if (left + 210 > window.innerWidth) left = window.innerWidth - 215;
        if (top + 200 > window.innerHeight) top = window.innerHeight - 205;
        left = Math.max(5, left);
        top = Math.max(5, top);

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.display = 'block';

        const self = this;
        menu.querySelectorAll('.ctx-item').forEach(function(item) {
            let handled = false;
            const runAction = function(ev) {
                if (handled) return;
                handled = true;
                ev.preventDefault();
                ev.stopPropagation();
                const action = item.dataset.action;
                if (action && typeof self['_ctx_' + action] === 'function') {
                    self['_ctx_' + action]();
                }
                setTimeout(() => { handled = false; }, 250);
            };
            item.addEventListener('mousedown', runAction);
            item.addEventListener('click', runAction);
        });
    }

    hideContextMenu() {
        const menu = document.getElementById('map-context-menu');
        if (menu) menu.style.display = 'none';
    }

    _escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function(ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    }

    _isSystemInArea(x, y) {
        return x >= this.area.min_x && x <= this.area.max_x && y >= this.area.min_y && y <= this.area.max_y;
    }

    _ctx_edit() {
        this.hideContextMenu();
        if (this._contextPos && this._contextPos.obj) this._showStationEditor(this._contextPos.obj);
    }

    _ctx_select_move() {
        this.hideContextMenu();
        if (!this._contextPos || !this._contextPos.obj) return;
        this.startObjectMove(this._contextPos.obj);
    }

    _ctx_cancel_move() {
        this.hideContextMenu();
        this.cancelMoveMode();
    }

    _ctx_move_selected_here() {
        this.hideContextMenu();
        if (!this.pendingMoveObj || !this._contextPos) return;
        this.moveSelectedObjectToPoint({ sx: this._contextPos.sx, sy: this._contextPos.sy, wx: this._contextPos.wx, wy: this._contextPos.wy });
    }

    _ctx_move() {
        this._ctx_select_move();
    }
    _ctx_delete() {
        this.hideContextMenu();
        if (!this._contextPos || !this._contextPos.obj) return;
        const obj = this._contextPos.obj;
        if (!confirm('Удалить "' + (obj.name || 'Объект') + '"?')) return;
        fetch('/map/api/stations/' + obj.id, { method: 'DELETE' })
            .then(r => r.json())
            .then(() => { this.loadData().then(() => { this.render(); this._updateStationsList(); }); })
            .catch(e => alert('Ошибка: ' + e.message));
    }

    _ctx_opencard() {
        this.hideContextMenu();
        if (this._contextPos && this._contextPos.obj && this._contextPos.obj.url) {
            window.location.href = this._contextPos.obj.url;
        }
    }

    _ctx_plan_station() {
        this.hideContextMenu();
        if (!this._contextPos) return;
        this.addPlanStation({ sx: this._contextPos.sx, sy: this._contextPos.sy, wx: this._contextPos.wx, wy: this._contextPos.wy });
    }

    _ctx_add_suggestion() {
        this.hideContextMenu();
        if (!this._contextPos || !this._contextPos.suggestionObj) return;
        this.addSuggestionToPlan(this._contextPos.suggestionObj);
    }

    _ctx_select_plan() {
        this.hideContextMenu();
        if (!this._contextPos || !this._contextPos.planObj) return;
        this.selectedPlanId = this._contextPos.planObj.id;
        this.planLevel = this._contextPos.planObj.level;
        const input = document.getElementById('plan-level');
        if (input) input.value = this.planLevel;
        this.setPlanLevel(this.planLevel);
    }

    _ctx_move_plan() {
        this.hideContextMenu();
        if (!this._contextPos || !this._contextPos.planObj) return;
        this.startPlanMove(this._contextPos.planObj);
    }

    _ctx_move_plan_here() {
        this.hideContextMenu();
        if (!this._contextPos) return;
        this.moveSelectedPlanToPoint({ sx: this._contextPos.sx, sy: this._contextPos.sy, wx: this._contextPos.wx, wy: this._contextPos.wy });
    }

    _ctx_remove_plan() {
        this.hideContextMenu();
        if (!this._contextPos || !this._contextPos.planObj) return;
        this.selectedPlanId = this._contextPos.planObj.id;
        this.removeSelectedPlanStation();
    }

    _ctx_create_station() {
        this.hideContextMenu();
        this._openCreateModal('Алстанция', 'Алстанция');
    }

    _ctx_create_ops() {
        this.hideContextMenu();
        this._openCreateModal('ОПС', 'ОПС');
    }

    _ctx_create_dunya() {
        this.hideContextMenu();
        this._openCreateModal('Дуня', 'Дуня');
    }

    _openCreateModal(typeName, subtype) {
        const p = this._contextPos || { sx: 2500, sy: 2500 };
        document.getElementById('st-id').value = '';
        document.getElementById('st-name').value = typeName;
        document.getElementById('st-x').value = p.sx;
        document.getElementById('st-y').value = p.sy;
        document.getElementById('st-z').value = 0;
        const lvl = this.placementLevel;
        document.getElementById('st-level').value = lvl;
        document.getElementById('st-level-val').textContent = lvl;
        document.getElementById('st-radius-info').textContent = (lvl * 900) + ' ед.';
        this._updateStationCoordInfo(p.sx, p.sy, 0);
        document.getElementById('st-status').value = 'Активен';
        document.getElementById('st-comment').value = '';
        document.getElementById('st-modal-title').textContent = 'Новая: ' + typeName;
        document.getElementById('st-delete-btn').style.display = 'none';
        const moveBtn = document.getElementById('st-move-btn');
        if (moveBtn) moveBtn.style.display = 'none';
        document.getElementById('st-drag-hint').style.display = 'none';
        this._createSubtype = subtype;
        new bootstrap.Modal(document.getElementById('stationModal')).show();
    }

    _onPlacementClick(sx, sy) {
        if (!this.ghostPos) return;
        const g = this.ghostPos;
        document.getElementById('st-x').value = g.sx;
        document.getElementById('st-y').value = g.sy;
        document.getElementById('st-z').value = 0;
        const lvl = this.placementLevel;
        document.getElementById('st-level').value = lvl;
        document.getElementById('st-level-val').textContent = lvl;
        document.getElementById('st-radius-info').textContent = (lvl * 900) + ' ед.';
        this._updateStationCoordInfo(g.sx, g.sy, 0);
        document.getElementById('st-name').value = '';
        document.getElementById('st-id').value = '';
        document.getElementById('st-status').value = 'Активен';
        document.getElementById('st-comment').value = '';
        document.getElementById('st-modal-title').textContent = 'Новая алстанция';
        document.getElementById('st-delete-btn').style.display = 'none';
        const moveBtn = document.getElementById('st-move-btn');
        if (moveBtn) moveBtn.style.display = 'none';
        document.getElementById('st-drag-hint').style.display = 'none';
        new bootstrap.Modal(document.getElementById('stationModal')).show();
    }

    async _showStationEditor(obj) {
        let data = { id: obj.id, name: obj.name, x: obj.x, y: obj.y, z: obj.z, level: obj.level, status: 'Активен', comment: '', object_type: obj.subtype || 'Алстанция' };
        try {
            const resp = await fetch('/map/api/stations/' + obj.id);
            if (resp.ok) data = await resp.json();
        } catch (e) {}
        document.getElementById('st-id').value = data.id || '';
        document.getElementById('st-name').value = data.name || '';
        document.getElementById('st-x').value = data.x || '';
        document.getElementById('st-y').value = data.y || '';
        document.getElementById('st-z').value = data.z || 0;
        this._updateStationCoordInfo(data.x, data.y, data.z || 0);
        const lvl = data.level || 1;
        document.getElementById('st-level').value = lvl;
        document.getElementById('st-level-val').textContent = lvl;
        document.getElementById('st-radius-info').textContent = (lvl * 900) + ' ед.';
        document.getElementById('st-status').value = data.status || 'Активен';
        document.getElementById('st-comment').value = data.comment || '';
        document.getElementById('st-modal-title').textContent = 'Редактировать: ' + (data.name || 'Алстанция');
        document.getElementById('st-delete-btn').style.display = 'inline-block';
        const moveBtn = document.getElementById('st-move-btn');
        if (moveBtn) moveBtn.style.display = 'inline-block';
        document.getElementById('st-drag-hint').style.display = 'block';
        new bootstrap.Modal(document.getElementById('stationModal')).show();
    }


    _updateStationCoordInfo(x, y, z) {
        const el = document.getElementById('st-coord-info');
        if (!el) return;
        const cx = parseInt(x);
        const cy = parseInt(y);
        const cz = parseInt(z || 0);
        if (Number.isNaN(cx) || Number.isNaN(cy)) {
            el.textContent = 'Координаты не заданы';
            return;
        }
        const inArea = this._isSystemInArea(cx, cy);
        el.textContent = 'Координаты: [' + cx + ':' + cy + ':' + cz + '] · привязка к системе' + (inArea ? '' : ' · вне зоны альянса');
        el.classList.toggle('text-danger', !inArea);
        el.classList.toggle('text-muted', inArea);
    }
    async saveStation() {
        const id = document.getElementById('st-id').value;
        const payload = {
            name: document.getElementById('st-name').value || 'Алстанция',
            level: parseInt(document.getElementById('st-level').value) || 10,
            x: parseInt(document.getElementById('st-x').value),
            y: parseInt(document.getElementById('st-y').value),
            z: parseInt(document.getElementById('st-z').value) || 0,
            status: document.getElementById('st-status').value,
            comment: document.getElementById('st-comment').value,
        };
        if (this._createSubtype && !id) {
            payload.subtype = this._createSubtype;
        }
        if (isNaN(payload.x) || isNaN(payload.y)) {
            alert('Укажите координаты X и Y');
            return;
        }
        try {
            let resp;
            if (id) {
                resp = await fetch('/map/api/stations/' + id, {
                    method: 'PUT', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
            } else {
                resp = await fetch('/map/api/stations', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
            }
            const data = await resp.json();
            if (!resp.ok) { alert(data.error || 'Ошибка'); return; }
            this._createSubtype = null;
            bootstrap.Modal.getInstance(document.getElementById('stationModal')).hide();
            await this.loadData();
            this.render();
            this._updateStationsList();
        } catch (e) { alert('Ошибка сети: ' + e.message); }
    }


    moveStationFromModal() {
        const id = parseInt(document.getElementById('st-id').value);
        if (!id) return;
        const obj = this.objects.find(o => o.id === id && o.type === 'object');
        if (!obj) return;
        const modalEl = document.getElementById('stationModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
        this.startObjectMove(obj);
    }
    async deleteStation() {
        const id = document.getElementById('st-id').value;
        if (!id) return;
        if (!confirm('Удалить алстанцию?')) return;
        try {
            const resp = await fetch('/map/api/stations/' + id, { method: 'DELETE' });
            if (!resp.ok) { const d = await resp.json(); alert(d.error || 'Ошибка'); return; }
            bootstrap.Modal.getInstance(document.getElementById('stationModal')).hide();
            await this.loadData();
            this.render();
            this._updateStationsList();
        } catch (e) { alert('Ошибка сети: ' + e.message); }
    }

    _updateStationsList() {
        const el = document.getElementById('stations-list');
        if (!el) return;
        const stations = this.objects.filter(o => o.type === 'object');
        if (!stations.length) {
            el.innerHTML = '<div class="text-muted small">Нет объектов</div>';
            return;
        }
        const icons = { 'Алстанция': '◆', 'ОПС': '■', 'Дуня': '▲', 'Луна': '●', 'Врата': '★' };
        const colors = { 'Алстанция': '#e74c3c', 'ОПС': '#e67e22', 'Дуня': '#f39c12', 'Луна': '#95a5a6', 'Врата': '#9b59b6' };
        el.innerHTML = stations.map(s => {
            const subtype = s.subtype || 'Объект';
            const icon = icons[subtype] || '●';
            const color = colors[subtype] || '#bdc3c7';
            return '<div class="d-flex justify-content-between align-items-center mb-1 py-1 border-bottom border-secondary obj-row" data-id="' + s.id + '" style="font-size:12px;cursor:pointer;">'
            + '<span><span style="color:' + color + ';">' + icon + '</span> <strong>' + (s.name || '?') + '</strong> [' + s.x + ':' + s.y + ':' + (s.z||0) + '] ур.' + s.level + '</span>'
            + '<button class="btn btn-sm btn-outline-secondary py-0 px-1 obj-edit-btn" data-id="' + s.id + '"><i class="bi bi-pencil"></i></button>'
            + '</div>';
        }).join('');
        const self = this;
        el.querySelectorAll('.obj-row').forEach(function(row) {
            row.addEventListener('click', function(ev) {
                if (ev.target.closest('.obj-edit-btn')) {
                    const id = parseInt(row.dataset.id);
                    const obj = self.objects.find(o => o.id === id);
                    if (obj) self._showStationEditor(obj);
                    return;
                }
                const id = parseInt(row.dataset.id);
                const obj = self.objects.find(o => o.id === id);
                if (obj) {
                    self.centerOn(obj.wx || 0, obj.wy || 0);
                    self.highlightedObj = obj;
                    self.render();
                }
            });
        });
    }
}

class GameMinimap {
    constructor(minimapCanvas, gameMap) {
        this.canvas = minimapCanvas;
        this.ctx = minimapCanvas.getContext('2d');
        this.gameMap = gameMap;
        this.padding = 6;
        this.isDragging = false;
        this._bindEvents();
    }

    _getMiniScale() {
        const areaW = this.gameMap.area.max_x - this.gameMap.area.min_x;
        const areaH = this.gameMap.area.max_y - this.gameMap.area.min_y;
        const worldW = Math.max(areaW * this.gameMap.systemSpacing, 1);
        const worldH = Math.max(areaH * this.gameMap.systemSpacing, 1);
        return (this.canvas.width - this.padding * 2) / Math.max(worldW, worldH);
    }

    worldToMini(wx, wy) {
        const s = this._getMiniScale();
        const halfWorld = 500000;
        return {
            x: this.padding + (wx + halfWorld) * s,
            y: this.padding + (halfWorld - wy) * s
        };
    }

    miniToWorld(mx, my) {
        const s = this._getMiniScale();
        const halfWorld = 500000;
        return {
            x: (mx - this.padding) / s - halfWorld,
            y: halfWorld - (my - this.padding) / s
        };
    }

    render() {
        const c = this.ctx;
        const w = this.canvas.width, h = this.canvas.height;
        c.clearRect(0, 0, w, h);
        c.fillStyle = '#0a0e14';
        c.fillRect(0, 0, w, h);

        const gm = this.gameMap;
        const objects = gm.objects || [];

        for (const obj of objects) {
            if (!gm._isVisible(obj)) continue;
            const mp = this.worldToMini(obj.wx || 0, obj.wy || 0);
            if (mp.x < 0 || mp.x > w || mp.y < 0 || mp.y > h) continue;
            const style = gm._getStyle(obj);
            c.fillStyle = style.color;
            c.beginPath();
            c.arc(mp.x, mp.y, 2, 0, Math.PI * 2);
            c.fill();
        }

        const tl = gm.screenToWorld(0, 0);
        const br = gm.screenToWorld(gm.canvas.width, gm.canvas.height);
        const vpTL = this.worldToMini(Math.min(tl.x, br.x), Math.max(tl.y, br.y));
        const vpBR = this.worldToMini(Math.max(tl.x, br.x), Math.min(tl.y, br.y));
        const vpW = vpBR.x - vpTL.x;
        const vpH = vpBR.y - vpTL.y;

        c.strokeStyle = '#6c5ce7';
        c.lineWidth = 1.5;
        c.strokeRect(vpTL.x, vpTL.y, vpW, vpH);
        c.fillStyle = 'rgba(108, 92, 231, 0.12)';
        c.fillRect(vpTL.x, vpTL.y, vpW, vpH);
    }

    _bindEvents() {
        let dragging = false;
        this.canvas.addEventListener('mousedown', (e) => {
            dragging = true;
            this._navigate(e);
        });
        this.canvas.addEventListener('mousemove', (e) => {
            if (dragging) this._navigate(e);
        });
        this.canvas.addEventListener('mouseup', () => { dragging = false; });
        this.canvas.addEventListener('mouseleave', () => { dragging = false; });
    }

    _navigate(e) {
        const r = this.canvas.getBoundingClientRect();
        const mx = (e.clientX - r.left) * (this.canvas.width / r.width);
        const my = (e.clientY - r.top) * (this.canvas.height / r.height);
        const world = this.miniToWorld(mx, my);
        this.gameMap.centerOn(world.x, world.y);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const canvas = document.getElementById('map-canvas');
    if (canvas) {
        window.map = new GameMap(canvas);
        const miniCanvas = document.getElementById('minimap-canvas');
        if (miniCanvas) {
            window.minimap = new GameMinimap(miniCanvas, window.map);
            const origRender = window.map.render.bind(window.map);
            window.map.render = function() {
                origRender();
                window.minimap.render();
            };
        }
    }
});
