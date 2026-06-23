class GameMap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.objects = [];
        this.suggestions = [];
        this.meta = {};
        this.showPlanner = false;
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

        this.contextMenu = null;

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
        this.canvas.addEventListener('mouseleave', () => { this._cancelDrag(); this.hideTooltip(); this.hideContextMenu(); });
        this.canvas.addEventListener('contextmenu', e => this._onContextMenu(e));
        document.addEventListener('mousedown', e => {
            const menu = document.getElementById('map-context-menu');
            if (menu && menu.style.display === 'block' && !menu.contains(e.target)) {
                this.hideContextMenu();
            }
        }, true);
        const menuEl = document.getElementById('map-context-menu');
        if (menuEl) {
            menuEl.addEventListener('mousedown', e => {
                e.stopPropagation();
                const item = e.target.closest('.ctx-item');
                if (!item) return;
                const action = item.dataset.action;
                if (action && typeof this['_ctx_' + action] === 'function') {
                    this['_ctx_' + action]();
                }
            });
        }
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
        const plan = document.getElementById('btn-plan');
        if (plan) plan.addEventListener('click', () => this.loadPlan());
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

    async loadData() {
        try {
            const resp = await fetch('/map/api/data');
            const data = await resp.json();
            this.objects = data.objects || [];
            this.meta = data.meta || {};
            if (this.meta.area) this.area = this.meta.area;
            this._updateStatus();
            this.fitAllianceArea();
        } catch (e) { console.error('Map data error:', e); }
    }

    async loadPlan() {
        try {
            const corridorX = 2500;
            const corridorY = 2560;
            const resp = await fetch('/map/api/plan?level=10&corridor_x=' + corridorX + '&corridor_y=' + corridorY);
            const data = await resp.json();
            this.suggestions = data.suggestions || [];
            this.coverage = data.coverage || {};
            this.showPlanner = true;
            this._updateCoverageStatus();
            this.render();
        } catch (e) { console.error('Map plan error:', e); }
    }

    _updateCoverageStatus() {
        const el = document.getElementById('map-coverage-info');
        if (!el || !this.coverage) return;
        el.style.display = 'block';
        const c = this.coverage;
        el.innerHTML = `
            <div class="mb-1"><strong>Покрытие сети:</strong> ${c.coverage_pct || 0}%</div>
            <div class="mb-1">Игроков: ${c.total || 0} | Покрыто: ${c.covered || 0} | Без покрытия: ${c.uncovered || 0}</div>
            <div class="mb-1"><small class="text-muted">Приоритет: коридор 2500:2500 → 2500:2560</small></div>
            <div class="mb-1"><small class="text-muted">Расчётный уровень: 10 (радиус ${10 * 900} ед.)</small></div>
        `;
    }

    render() {
        const c = this.ctx;
        c.clearRect(0, 0, this.canvas.width, this.canvas.height);
        c.fillStyle = '#0a0e14';
        c.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.filters['filter-grid']) this.drawGrid();
        if (this.showPlanner) this.drawCorridor();
        if (this.filters['filter-coverage']) this.drawCoverage();
        if (this.showPlanner) this.drawUncoveredPlayers();
        this.drawSystems();
        if (this.showPlanner) this.drawPlannerSuggestions();
        this.drawObjects();
        if (this.placementMode && this.ghostPos) this.drawGhost();
    }

    drawCorridor() {
        const c = this.ctx;
        const from = this.worldToScreen(this.systemToWorldX(2500), this.systemToWorldY(2500));
        const to = this.worldToScreen(this.systemToWorldX(2560), this.systemToWorldY(2500));
        c.save();
        c.strokeStyle = 'rgba(241,196,15,0.5)';
        c.lineWidth = 3;
        c.setLineDash([12, 6]);
        c.beginPath();
        c.moveTo(from.x, from.y);
        c.lineTo(to.x, to.y);
        c.stroke();
        c.setLineDash([]);
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        c.fillStyle = 'rgba(241,196,15,0.9)';
        c.font = 'bold 11px sans-serif';
        c.textAlign = 'center';
        c.fillText('2500:2500 → 2500:2560', mid.x, mid.y - 10);
        c.fillText('КОРИДОР ПРИОРИТЕТА', mid.x, mid.y + 4);
        c.textAlign = 'left';
        c.restore();
    }

    drawUncoveredPlayers() {
        const c = this.ctx;
        if (!this.coverage || !this.coverage.uncovered_points) return;
        for (const p of this.coverage.uncovered_points) {
            const sp = this.worldToScreen(p.wx, p.wy);
            if (sp.x < -20 || sp.x > this.canvas.width + 20 ||
                sp.y < -20 || sp.y > this.canvas.height + 20) continue;
            c.save();
            c.strokeStyle = '#e74c3c';
            c.lineWidth = 2;
            c.beginPath(); c.arc(sp.x, sp.y, 10, 0, Math.PI * 2); c.stroke();
            c.strokeStyle = 'rgba(231,76,60,0.3)';
            c.lineWidth = 1;
            c.beginPath(); c.arc(sp.x, sp.y, 16, 0, Math.PI * 2); c.stroke();
            c.restore();
        }
    }

    drawGrid() {
        const c = this.ctx;
        const w = this.canvas.width, h = this.canvas.height;
        const tl = this.screenToWorld(0, h);
        const br = this.screenToWorld(w, 0);
        const visibleMinX = Math.max(Math.min(tl.x, br.x), this.systemToWorldX(this.area.min_x));
        const visibleMaxX = Math.min(Math.max(tl.x, br.x), this.systemToWorldX(this.area.max_x));
        const visibleMinY = Math.max(Math.min(tl.y, br.y), this.systemToWorldY(this.area.min_y));
        const visibleMaxY = Math.min(Math.max(tl.y, br.y), this.systemToWorldY(this.area.max_y));

        const minSystemX = Math.floor(this.worldToSystemX(visibleMinX));
        const maxSystemX = Math.ceil(this.worldToSystemX(visibleMaxX));
        const minSystemY = Math.floor(this.worldToSystemY(visibleMinY));
        const maxSystemY = Math.ceil(this.worldToSystemY(visibleMaxY));
        const systemStep = this.scale >= 0.02 ? 1 : (this.scale >= 0.005 ? 10 : 100);

        // Area border
        const areaA = this.worldToScreen(this.systemToWorldX(this.area.min_y), this.systemToWorldY(this.area.min_x));
        const areaB = this.worldToScreen(this.systemToWorldX(this.area.max_y), this.systemToWorldY(this.area.max_x));
        c.strokeStyle = 'rgba(108,92,231,0.35)';
        c.lineWidth = 2;
        c.strokeRect(
            Math.min(areaA.x, areaB.x),
            Math.min(areaA.y, areaB.y),
            Math.abs(areaB.x - areaA.x),
            Math.abs(areaB.y - areaA.y)
        );

        // System lines
        c.strokeStyle = 'rgba(255,255,255,0.08)';
        c.lineWidth = 1;
        for (let sx = this._snapDown(minSystemX, systemStep); sx <= maxSystemX; sx += systemStep) {
            const s = this.worldToScreen(this.systemToWorldX(sx), 0);
            c.beginPath(); c.moveTo(s.x, 0); c.lineTo(s.x, h); c.stroke();
        }
        for (let sy = this._snapDown(minSystemY, systemStep); sy <= maxSystemY; sy += systemStep) {
            const s = this.worldToScreen(0, this.systemToWorldY(sy));
            c.beginPath(); c.moveTo(0, s.y); c.lineTo(w, s.y); c.stroke();
        }

        // Labels
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.font = '9px monospace';
        const labelStep = Math.max(systemStep, 100);
        for (let sx = this._snapDown(minSystemX, labelStep); sx <= maxSystemX; sx += labelStep) {
            for (let sy = this._snapDown(minSystemY, labelStep); sy <= maxSystemY; sy += labelStep) {
                const s = this.worldToScreen(this.systemToWorldX(sx), this.systemToWorldY(sy));
                if (s.x > 30 && s.x < w - 60 && s.y > 15 && s.y < h - 5) {
                    c.fillText(`${sy}:${sx}`, s.x + 3, s.y - 3);
                }
            }
        }
    }

    drawSystems() {
        const c = this.ctx;
        const systems = new Map();
        for (const o of this.objects) {
            const key = `${o.x}:${o.y}`;
            if (!systems.has(key)) systems.set(key, []);
            systems.get(key).push(o);
        }

        for (const [key, objs] of systems) {
            const [sx, sy] = key.split(':').map(Number);
            const sp = this.worldToScreen(objs[0].wx, objs[0].wy);
            if (sp.x < -100 || sp.x > this.canvas.width + 100 ||
                sp.y < -100 || sp.y > this.canvas.height + 100) continue;

            // Sun
            c.fillStyle = '#f1c40f';
            c.beginPath(); c.arc(sp.x, sp.y, 3, 0, Math.PI * 2); c.fill();

            // Orbits
            for (let z = 1; z <= 9; z++) {
                const r = z * 8;
                c.strokeStyle = 'rgba(255,255,255,0.05)';
                c.lineWidth = 0.3;
                c.beginPath(); c.arc(sp.x, sp.y, r, 0, Math.PI * 2); c.stroke();
            }

            // Planets
            for (const obj of objs) {
                if (obj.z > 0 && obj.z <= 9) {
                    const angle = ((obj.z - 1) / 9) * Math.PI * 2 - Math.PI / 2;
                    const r = obj.z * 8;
                    const px = sp.x + Math.cos(angle) * r;
                    const py = sp.y + Math.sin(angle) * r;
                    let col = '#95a5a6';
                    if (obj.race === 'Терран') col = '#3498db';
                    else if (obj.race === 'Жук') col = '#27ae60';
                    else if (obj.race === 'Тосс') col = '#9b59b6';
                    c.fillStyle = col;
                    c.beginPath(); c.arc(px, py, 3, 0, Math.PI * 2); c.fill();
                }
            }

            // System label
            c.fillStyle = 'rgba(255,255,255,0.45)';
            c.font = '9px monospace';
            c.textAlign = 'center';
            c.fillText(`${sx}:${sy}`, sp.x, sp.y + 16);
            if (sx === 2500 && sy === 2500) {
                c.fillStyle = 'rgba(108,92,231,0.8)';
                c.font = 'bold 10px sans-serif';
                c.fillText('===AURUS-SILA===', sp.x, sp.y + 28);
            }
            c.textAlign = 'left';
        }
    }

    drawCoverage() {
        const c = this.ctx;
        const alstations = this.objects.filter(o =>
            o.type === 'object' && (o.subtype || '').includes('Алстанц')
        );
        if (!alstations.length) return;

        for (const obj of alstations) {
            const sp = this._objectToScreen(obj);
            const level = obj.level || 1;
            const r = (obj.radius || level * 100) * this.scale;
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

    drawPlannerSuggestions() {
        const c = this.ctx;
        for (const item of this.suggestions) {
            const sp = this.worldToScreen(item.wx, item.wy);
            if (sp.x < -80 || sp.x > this.canvas.width + 80 ||
                sp.y < -80 || sp.y > this.canvas.height + 80) continue;

            const r = (item.radius || 100) * this.scale;
            c.save();
            c.strokeStyle = item.already_covered ? 'rgba(241,196,15,0.85)' : 'rgba(46,204,113,0.85)';
            c.fillStyle = item.already_covered ? 'rgba(241,196,15,0.08)' : 'rgba(46,204,113,0.10)';
            c.lineWidth = 2;
            c.setLineDash([8, 4]);
            c.beginPath(); c.arc(sp.x, sp.y, r, 0, Math.PI * 2); c.fill(); c.stroke();
            c.setLineDash([]);

            c.fillStyle = item.already_covered ? '#f1c40f' : '#2ecc71';
            c.beginPath(); c.arc(sp.x, sp.y, 5, 0, Math.PI * 2); c.fill();

            c.fillStyle = '#fff';
            c.font = '10px sans-serif';
            c.textAlign = 'center';
            let label = item.x + ':' + item.y;
            if (item.uncovered_players > 0) {
                label += ' (+' + item.uncovered_players + ' без покрытия)';
                c.fillStyle = '#e74c3c';
            } else {
                label += ' (' + item.covered_players + ')';
            }
            c.fillText(label, sp.x, sp.y - 10);
            c.restore();
        }
    }

    _objectToScreen(obj) {
        const sp = this.worldToScreen(obj.wx, obj.wy);
        const z = Number(obj.z || 0);
        if (z > 0 && z <= 9) {
            const angle = ((z - 1) / 9) * Math.PI * 2 - Math.PI / 2;
            const r = z * 8;
            return {
                x: sp.x + Math.cos(angle) * r,
                y: sp.y + Math.sin(angle) * r
            };
        }
        return sp;
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
        this.isDragging = true;
        this._dragMoved = false;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.canvas.style.cursor = 'grabbing';
    }

    _onMouseMove(e) {
        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;

        if (this.isDragging) {
            const dx = e.clientX - this.lastMouseX, dy = e.clientY - this.lastMouseY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._dragMoved = true;
            this.offsetX += dx; this.offsetY += dy;
            this.lastMouseX = e.clientX; this.lastMouseY = e.clientY;
            this.render();
            return;
        }
        if (this.placementMode) {
            const w = this.screenToWorld(mx, my);
            const sx = Math.round(w.y / 1000 + this.area.center_x);
            const sy = Math.round(w.x / 1000 + this.area.center_y);
            this.ghostPos = { sx: sx, sy: sy, wx: w.x, wy: w.y };
            this.canvas.style.cursor = 'crosshair';
            this.render();
            return;
        }
        this.ghostPos = null;
        const obj = this.findObjectAt(mx, my);
        if (obj) {
            this.highlightedObj = obj;
            this.showTooltip(obj, mx, my);
            this.canvas.style.cursor = 'pointer';
        } else {
            this.highlightedObj = null;
            this.hideTooltip();
            this.canvas.style.cursor = 'grab';
        }
    }

    _onMouseUp(e) {
        const wasDrag = this._dragMoved;
        this.isDragging = false;
        this._dragMoved = false;
        this.canvas.style.cursor = 'grab';

        if (wasDrag) return;

        const r = this.canvas.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;

        if (this.placementMode) {
            this._onPlacementClick(sx, sy);
            return;
        }

        const obj = this.findObjectAt(sx, sy);
        if (obj && obj.type === 'object' && (obj.subtype || '').includes('Алстанц')) {
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
                : '<i class="bi bi-geo-alt"></i> Разместить алстанцию';
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
        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const w = this.screenToWorld(mx, my);
        const sx = Math.round(w.y / 1000 + this.area.center_x);
        const sy = Math.round(w.x / 1000 + this.area.center_y);

        const obj = this.findObjectAt(mx, my);
        this._contextPos = { sx: sx, sy: sy, wx: w.x, wy: w.y, obj: obj };

        const menu = document.getElementById('map-context-menu');
        if (!menu) return;

        let html = '';
        if (obj && obj.type === 'object') {
            html += '<div class="ctx-item" data-action="edit"><i class="bi bi-pencil"></i> Редактировать</div>';
            html += '<div class="ctx-item" data-action="move"><i class="bi bi-arrows-move"></i> Переместить сюда</div>';
            html += '<div class="ctx-item ctx-danger" data-action="delete"><i class="bi bi-trash"></i> Удалить</div>';
            html += '<div class="ctx-divider"></div>';
        }
        if (obj && obj.url) {
            html += '<div class="ctx-item" data-action="opencard"><i class="bi bi-box-arrow-up-right"></i> Открыть карточку</div>';
            html += '<div class="ctx-divider"></div>';
        }
        html += '<div class="ctx-item" data-action="create_station"><i class="bi bi-geo-alt"></i> Новая алстанция</div>';
        html += '<div class="ctx-item" data-action="create_ops"><i class="bi bi-shield"></i> Новый ОПС</div>';
        html += '<div class="ctx-item" data-action="create_dunya"><i class="bi bi-moon"></i> Новая Дуня</div>';

        menu.innerHTML = html;
        // Correct positioning using page coordinates
        const menuWidth = 200;
        const menuHeight = 200;
        let left = e.clientX;
        let top = e.clientY;
        
        // Check if menu would overflow right edge
        if (left + menuWidth > window.innerWidth) {
            left = window.innerWidth - menuWidth - 5;
        }
        // Check if menu would overflow bottom edge
        if (top + menuHeight > window.innerHeight) {
            top = window.innerHeight - menuHeight - 5;
        }
        // Ensure positive coordinates
        left = Math.max(5, left);
        top = Math.max(5, top);
        
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        
        // Сохраняем координаты контекстного меню
        this.contextMenuX = left;
        this.contextMenuY = top;
        menu.style.display = 'block';
    }

    hideContextMenu() {
        const menu = document.getElementById('map-context-menu');
        if (menu) menu.style.display = 'none';
    }

    _ctx_edit() {
        this.hideContextMenu();
        if (this._contextPos && this._contextPos.obj) this._showStationEditor(this._contextPos.obj);
    }

    _ctx_move() {
        this.hideContextMenu();
        if (!this._contextPos || !this._contextPos.obj) return;
        const obj = this._contextPos.obj;
        const nx = this._contextPos.sx, ny = this._contextPos.sy;
        fetch('/map/api/stations/' + obj.id, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ x: nx, y: ny })
        })
        .then(r => r.json())
        .then(() => { this.loadData().then(() => { this.render(); this._updateStationsList(); }); })
        .catch(e => alert('Ошибка: ' + e.message));
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

    _ctx_create_station() {
        this.hideContextMenu();
        this._openCreateModal('Алстанция', '');
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
        document.getElementById('st-status').value = 'Активен';
        document.getElementById('st-comment').value = '';
        document.getElementById('st-modal-title').textContent = 'Новая: ' + typeName;
        document.getElementById('st-delete-btn').style.display = 'none';
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
        document.getElementById('st-name').value = '';
        document.getElementById('st-id').value = '';
        document.getElementById('st-status').value = 'Активен';
        document.getElementById('st-comment').value = '';
        document.getElementById('st-modal-title').textContent = 'Новая алстанция';
        document.getElementById('st-delete-btn').style.display = 'none';
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
        const lvl = data.level || 1;
        document.getElementById('st-level').value = lvl;
        document.getElementById('st-level-val').textContent = lvl;
        document.getElementById('st-radius-info').textContent = (lvl * 900) + ' ед.';
        document.getElementById('st-status').value = data.status || 'Активен';
        document.getElementById('st-comment').value = data.comment || '';
        document.getElementById('st-modal-title').textContent = 'Редактировать: ' + (data.name || 'Алстанция');
        document.getElementById('st-delete-btn').style.display = 'inline-block';
        document.getElementById('st-drag-hint').style.display = 'block';
        new bootstrap.Modal(document.getElementById('stationModal')).show();
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
        const stations = this.objects.filter(o => o.type === 'object' && (o.subtype || '').includes('Алстанц'));
        if (!stations.length) {
            el.innerHTML = '<div class="text-muted small">Нет алстанций</div>';
            return;
        }
        const icons = { 'Алстанция': '◆', 'ОПС': '■', 'Дуня': '▲', 'Луна': '●', 'Врата': '★' };
        el.innerHTML = stations.map(s => {
            const icon = icons[s.subtype] || '◆';
            const color = s.subtype === 'Алстанция' ? '#e74c3c' : s.subtype === 'ОПС' ? '#e67e22' : s.subtype === 'Дуня' ? '#f39c12' : '#bdc3c7';
            return '<div class="d-flex justify-content-between align-items-center mb-1 py-1 border-bottom border-secondary" style="font-size:12px;">'
            + '<span><span style="color:' + color + ';">' + icon + '</span> <strong>' + (s.name || '?') + '</strong> [' + s.x + ':' + s.y + ':' + (s.z||0) + '] ур.' + s.level + '</span>'
            + '<button class="btn btn-sm btn-outline-secondary py-0 px-1" onclick="window.map._showStationEditor(window.map.objects.find(o=>o.id===' + s.id + '))"><i class="bi bi-pencil"></i></button>'
            + '</div>';
        }).join('');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const canvas = document.getElementById('map-canvas');
    if (canvas) window.map = new GameMap(canvas);
});
