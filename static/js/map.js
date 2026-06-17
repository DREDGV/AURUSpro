class GameMap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.objects = [];
        this.scale = 0.5;
        this.offsetX = 0;
        this.offsetY = 0;
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this._dragMoved = false;
        this.highlightedObj = null;
        this.tooltip = document.getElementById('map-tooltip');

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
        this.canvas.addEventListener('mouseup', e => {
            if (!this._dragMoved) {
                const r = this.canvas.getBoundingClientRect();
                const obj = this.findObjectAt(e.clientX - r.left, e.clientY - r.top);
                if (obj) { this.centerOn(obj.x, obj.y); }
            }
            this._onMouseUp();
        });
        this.canvas.addEventListener('mouseleave', () => { this._onMouseUp(); this.hideTooltip(); });
        const si = document.getElementById('map-search');
        if (si) si.addEventListener('input', e => this._onSearch(e));
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

    centerAlliance() { this.centerOn(2500, 2500); }

    async loadData() {
        try {
            const resp = await fetch('/map/api/data');
            const data = await resp.json();
            this.objects = data.objects || [];
            this.centerAlliance();
        } catch (e) { console.error('Map data error:', e); }
    }

    render() {
        const c = this.ctx;
        c.clearRect(0, 0, this.canvas.width, this.canvas.height);
        c.fillStyle = '#0a0e14';
        c.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.filters['filter-grid']) this.drawGrid();
        if (this.filters['filter-coverage']) this.drawCoverage();
        this.drawSystems();
        this.drawObjects();
    }

    drawGrid() {
        const c = this.ctx;
        const w = this.canvas.width, h = this.canvas.height;
        const tl = this.screenToWorld(0, h);
        const br = this.screenToWorld(w, 0);
        const minX = Math.floor(Math.min(tl.x, br.x) / 100) * 100;
        const maxX = Math.ceil(Math.max(tl.x, br.x) / 100) * 100;
        const minY = Math.floor(Math.min(tl.y, br.y) / 100) * 100;
        const maxY = Math.ceil(Math.max(tl.y, br.y) / 100) * 100;

        // System lines (1000 steps)
        c.strokeStyle = 'rgba(255,255,255,0.08)';
        c.lineWidth = 1;
        for (let x = Math.floor(minX / 1000) * 1000; x <= maxX; x += 1000) {
            const s = this.worldToScreen(x, 0);
            c.beginPath(); c.moveTo(s.x, 0); c.lineTo(s.x, h); c.stroke();
        }
        for (let y = Math.floor(minY / 1000) * 1000; y <= maxY; y += 1000) {
            const s = this.worldToScreen(0, y);
            c.beginPath(); c.moveTo(0, s.y); c.lineTo(w, s.y); c.stroke();
        }

        // Planet lines (100 steps)
        c.strokeStyle = 'rgba(255,255,255,0.03)';
        c.lineWidth = 0.5;
        for (let x = minX; x <= maxX; x += 100) {
            if (x % 1000 === 0) continue;
            const s = this.worldToScreen(x, 0);
            c.beginPath(); c.moveTo(s.x, 0); c.lineTo(s.x, h); c.stroke();
        }
        for (let y = minY; y <= maxY; y += 100) {
            if (y % 1000 === 0) continue;
            const s = this.worldToScreen(0, y);
            c.beginPath(); c.moveTo(0, s.y); c.lineTo(w, s.y); c.stroke();
        }

        // Labels at system intersections
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.font = '9px monospace';
        for (let x = Math.floor(minX / 1000) * 1000; x <= maxX; x += 1000) {
            for (let y = Math.floor(minY / 1000) * 1000; y <= maxY; y += 1000) {
                const s = this.worldToScreen(x, y);
                if (s.x > 30 && s.x < w - 60 && s.y > 15 && s.y < h - 5) {
                    c.fillText(`${x}:${y}`, s.x + 3, s.y - 3);
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
            const sp = this.worldToScreen(sx, sy);
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
            const sp = this.worldToScreen(obj.x, obj.y);
            const level = obj.level || 1;
            const r = level * 500 * this.scale;
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

    drawObjects() {
        const c = this.ctx;
        for (const obj of this.objects) {
            if (!this._isVisible(obj)) continue;
            const sp = this.worldToScreen(obj.x, obj.y);
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
            const sp = this.worldToScreen(obj.x, obj.y);
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
        this.scale = Math.max(0.05, Math.min(20, this.scale));
        const wa = this.screenToWorld(mx, my);
        this.offsetX += (wa.x - wb.x) * this.scale;
        this.offsetY += -(wa.y - wb.y) * this.scale;
        this.render();
    }

    _onMouseDown(e) {
        this.isDragging = true; this._dragMoved = false;
        this.lastMouseX = e.clientX; this.lastMouseY = e.clientY;
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
        }
        const obj = this.findObjectAt(mx, my);
        if (obj) {
            this.highlightedObj = obj;
            this.showTooltip(obj, mx, my);
            this.canvas.style.cursor = 'pointer';
        } else {
            this.highlightedObj = null;
            this.hideTooltip();
            this.canvas.style.cursor = this.isDragging ? 'grabbing' : 'grab';
        }
        if (this.isDragging) this.render();
    }

    _onMouseUp() { this.isDragging = false; this.canvas.style.cursor = 'grab'; }

    _onSearch(e) {
        const q = e.target.value.toLowerCase();
        if (!q) { this.highlightedObj = null; this.render(); return; }
        const found = this.objects.find(o => (o.name || '').toLowerCase().includes(q) || (o.nick || '').toLowerCase().includes(q));
        if (found) { this.centerOn(found.x, found.y); this.highlightedObj = found; this.render(); }
    }

    zoomIn() { this.scale = Math.min(20, this.scale * 1.5); this.render(); }
    zoomOut() { this.scale = Math.max(0.05, this.scale / 1.5); this.render(); }

    exportPNG() {
        const link = document.createElement('a');
        link.download = 'aurus-map.png';
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const canvas = document.getElementById('map-canvas');
    if (canvas) window.map = new GameMap(canvas);
});
