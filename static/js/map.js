class GameMap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.objects = [];
        this.bounds = { min_x: 0, max_x: 5000, min_y: 0, max_y: 5000 };

        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.centerX = 2500;
        this.centerY = 2500;

        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this._dragMoved = false;

        this.filters = {
            'filter-terran': true,
            'filter-zerg': true,
            'filter-toss': true,
            'filter-ops': true,
            'filter-alstation': true,
            'filter-dunya': true,
            'filter-luna': true,
            'filter-vrata': true,
            'filter-grid': true,
            'filter-coverage': true
        };

        this.highlightedObj = null;
        this.tooltip = document.getElementById('map-tooltip');

        this._resizeCanvas();
        window.addEventListener('resize', () => {
            this._resizeCanvas();
            this.render();
        });

        this._bindEvents();
        this._centerView();
        this.loadData();
    }

    _resizeCanvas() {
        const parent = this.canvas.parentElement;
        if (parent) {
            this.canvas.width = parent.clientWidth;
            this.canvas.height = parent.clientHeight;
        }
    }

    _bindEvents() {
        this.canvas.addEventListener('wheel', (e) => this._onWheel(e));
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => {
            if (!this._dragMoved) {
                const rect = this.canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                const obj = this.findObjectAt(mx, my);
                if (obj) {
                    const sp = this.worldToScreen(obj.x, obj.y);
                    this.offsetX += this.canvas.width / 2 - sp.x;
                    this.offsetY += this.canvas.height / 2 - sp.y;
                    this.render();
                }
            }
            this._onMouseUp();
        });
        this.canvas.addEventListener('mouseleave', () => {
            this._onMouseUp();
            this.hideTooltip();
        });

        const searchInput = document.getElementById('map-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this._onSearch(e));
        }
    }

    _centerView() {
        this.scale = this.canvas.width / 2000;
        this.centerX = 2500;
        this.centerY = 2500;
        this.offsetX = this.canvas.width / 2 - this.centerX * this.scale;
        this.offsetY = this.canvas.height / 2 + this.centerY * this.scale;
    }

    worldToScreen(wx, wy) {
        // X increases right, Y increases UP (invert Y for screen)
        const sx = wx * this.scale + this.offsetX;
        const sy = this.centerY * this.scale + this.offsetY - wy * this.scale;
        return { x: sx, y: sy };
    }

    screenToWorld(sx, sy) {
        const wx = (sx - this.offsetX) / this.scale;
        const wy = (this.centerY * this.scale + this.offsetY - sy) / this.scale;
        return { x: wx, y: wy };
    }

    async loadData() {
        try {
            const resp = await fetch('/map/api/data');
            const data = await resp.json();
            this.objects = data.objects || [];
            this.bounds = data.bounds || { min_x: 0, max_x: 5000, min_y: 0, max_y: 5000 };
            this.render();
        } catch (e) {
            console.error('Failed to load map data:', e);
        }
    }

    render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = '#0a0e14';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.filters['filter-grid']) {
            this.drawGrid();
        }
        this.drawCoverageZones();
        this.drawSystems();
        this.drawObjects();
    }

    drawGrid() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        const topLeft = this.screenToWorld(0, 0);
        const bottomRight = this.screenToWorld(w, h);

        // Ensure correct bounds
        const minX = Math.min(topLeft.x, bottomRight.x);
        const maxX = Math.max(topLeft.x, bottomRight.x);
        const minY = Math.min(topLeft.y, bottomRight.y);
        const maxY = Math.max(topLeft.y, bottomRight.y);

        // Thin lines for planet grid (100 unit steps)
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        for (let x = Math.floor(minX / 100) * 100; x <= maxX; x += 100) {
            if (x % 1000 === 0) continue;
            const sp = this.worldToScreen(x, 0);
            ctx.beginPath();
            ctx.moveTo(sp.x, 0);
            ctx.lineTo(sp.x, h);
            ctx.stroke();
        }
        for (let y = Math.floor(minY / 100) * 100; y <= maxY; y += 100) {
            if (y % 1000 === 0) continue;
            const sp = this.worldToScreen(0, y);
            ctx.beginPath();
            ctx.moveTo(0, sp.y);
            ctx.lineTo(w, sp.y);
            ctx.stroke();
        }

        // Thicker lines for system grid (1000 unit steps)
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        for (let x = Math.floor(minX / 1000) * 1000; x <= maxX; x += 1000) {
            const sp = this.worldToScreen(x, 0);
            ctx.beginPath();
            ctx.moveTo(sp.x, 0);
            ctx.lineTo(sp.x, h);
            ctx.stroke();
        }
        for (let y = Math.floor(minY / 1000) * 1000; y <= maxY; y += 1000) {
            const sp = this.worldToScreen(0, y);
            ctx.beginPath();
            ctx.moveTo(0, sp.y);
            ctx.lineTo(w, sp.y);
            ctx.stroke();
        }

        // Coordinate labels at intersections
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '9px monospace';
        for (let x = Math.floor(minX / 1000) * 1000; x <= maxX; x += 1000) {
            for (let y = Math.floor(minY / 1000) * 1000; y <= maxY; y += 1000) {
                const sp = this.worldToScreen(x, y);
                if (sp.x > 30 && sp.x < w - 50 && sp.y > 15 && sp.y < h - 10) {
                    ctx.fillText(`${x}:${y}`, sp.x + 4, sp.y - 4);
                }
            }
        }
    }

    drawSystems() {
        const ctx = this.ctx;
        const systemCoords = new Set();

        for (const obj of this.objects) {
            systemCoords.add(`${obj.x}:${obj.y}`);
        }

        for (const key of systemCoords) {
            const [sx, sy] = key.split(':').map(Number);
            const sp = this.worldToScreen(sx, sy);

            if (sp.x < -200 || sp.x > this.canvas.width + 200 ||
                sp.y < -200 || sp.y > this.canvas.height + 200) continue;

            // Draw sun
            const sunSize = Math.max(2, 3 * this.scale);
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, sunSize, 0, Math.PI * 2);
            ctx.fill();

            // Draw orbits (very subtle)
            for (let z = 1; z <= 9; z++) {
                const orbitR = z * 5 * this.scale;
                if (orbitR < 1) continue;
                ctx.strokeStyle = 'rgba(255,255,255,0.04)';
                ctx.lineWidth = 0.3;
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, orbitR, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Draw planets on orbits
            const planets = this.objects.filter(
                o => o.x === sx && o.y === sy && o.z > 0 && o.z <= 9
            );

            for (const planet of planets) {
                const angle = ((planet.z - 1) / 9) * Math.PI * 2 - Math.PI / 2;
                const orbitR = planet.z * 5 * this.scale;
                const px = sp.x + Math.cos(angle) * orbitR;
                const py = sp.y + Math.sin(angle) * orbitR;
                const pSize = Math.max(2, 3 * this.scale);

                let color = '#bdc3c7';
                if (planet.race === 'Терран') color = '#3498db';
                else if (planet.race === 'Жук') color = '#27ae60';
                else if (planet.race === 'Тосс') color = '#9b59b6';

                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(px, py, pSize, 0, Math.PI * 2);
                ctx.fill();
            }

            // System label
            if (this.scale > 0.3) {
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.font = '9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`${sx}:${sy}`, sp.x, sp.y + 14);

                if (sx === 2500 && sy === 2500) {
                    ctx.fillStyle = 'rgba(108, 92, 231, 0.8)';
                    ctx.font = 'bold 10px sans-serif';
                    ctx.fillText('===AURUS-SILA===', sp.x, sp.y + 26);
                }
                ctx.textAlign = 'left';
            }
        }
    }

    drawObjects() {
        const ctx = this.ctx;

        for (const obj of this.objects) {
            if (!this._isVisible(obj)) continue;
            if (obj.z === 0 && this._hasPlanetsAt(obj.x, obj.y)) continue;

            const sp = this.worldToScreen(obj.x, obj.y);
            if (sp.x < -20 || sp.x > this.canvas.width + 20 ||
                sp.y < -20 || sp.y > this.canvas.height + 20) continue;

            const isHighlighted = this.highlightedObj === obj;
            const style = this._getObjectStyle(obj);

            ctx.save();
            if (isHighlighted) {
                ctx.shadowColor = '#fff';
                ctx.shadowBlur = 12;
            }

            ctx.fillStyle = style.color;
            ctx.strokeStyle = isHighlighted ? '#fff' : 'rgba(0,0,0,0.3)';
            ctx.lineWidth = isHighlighted ? 2 : 1;

            const size = style.size * (isHighlighted ? 1.5 : 1);

            switch (style.shape) {
                case 'circle':
                    ctx.beginPath();
                    ctx.arc(sp.x, sp.y, size, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    break;
                case 'square':
                    ctx.fillRect(sp.x - size / 2, sp.y - size / 2, size, size);
                    ctx.strokeRect(sp.x - size / 2, sp.y - size / 2, size, size);
                    break;
                case 'diamond':
                    ctx.beginPath();
                    ctx.moveTo(sp.x, sp.y - size);
                    ctx.lineTo(sp.x + size, sp.y);
                    ctx.lineTo(sp.x, sp.y + size);
                    ctx.lineTo(sp.x - size, sp.y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    break;
                case 'triangle':
                    ctx.beginPath();
                    ctx.moveTo(sp.x, sp.y - size);
                    ctx.lineTo(sp.x + size, sp.y + size);
                    ctx.lineTo(sp.x - size, sp.y + size);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    break;
                case 'semicircle':
                    ctx.beginPath();
                    ctx.arc(sp.x, sp.y, size, 0, Math.PI);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    break;
                case 'star':
                    this._drawStar(sp.x, sp.y, 5, size, size / 2);
                    ctx.fill();
                    ctx.stroke();
                    break;
            }

            // Draw label if zoomed in enough
            if (this.scale > 0.5 && obj.name) {
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                ctx.font = `${Math.max(8, 9)}px sans-serif`;
                ctx.textAlign = 'center';
                const labelY = sp.y + size + 12;
                ctx.fillText(obj.name, sp.x, labelY);
                ctx.textAlign = 'left';
            }

            ctx.restore();
        }
    }

    _drawStar(cx, cy, spikes, outerR, innerR) {
        const ctx = this.ctx;
        let rot = Math.PI / 2 * 3;
        const step = Math.PI / spikes;

        ctx.beginPath();
        ctx.moveTo(cx, cy - outerR);

        for (let i = 0; i < spikes; i++) {
            ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
            rot += step;
            ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
            rot += step;
        }

        ctx.lineTo(cx, cy - outerR);
        ctx.closePath();
    }

    _getObjectStyle(obj) {
        const size = 8;
        if (obj.type === 'capital') return { shape: 'circle', color: '#ecf0f1', size: 10 };
        if (obj.type === 'account') {
            if (obj.race === 'Жук' || obj.race === 'zerg') return { shape: 'circle', color: '#27ae60', size };
            if (obj.race === 'Терран' || obj.race === 'terran') return { shape: 'circle', color: '#2980b9', size };
            if (obj.race === 'Тосс' || obj.race === 'toss') return { shape: 'circle', color: '#8e44ad', size };
            return { shape: 'circle', color: '#95a5a6', size };
        }
        if (obj.type === 'object') {
            const sub = obj.subtype;
            if (sub === 'ops' || sub === 'ОПС') return { shape: 'square', color: '#2c3e50', size: 6 };
            if (sub === 'alstation' || sub === 'Алстанция') return { shape: 'diamond', color: '#e74c3c', size: 10 };
            if (sub === 'dunya' || sub === 'Дуня') return { shape: 'triangle', color: '#f39c12', size: 6 };
            if (sub === 'luna' || sub === 'Луна') return { shape: 'semicircle', color: '#95a5a6', size: 6 };
            if (sub === 'vrata' || sub === 'Врата') return { shape: 'star', color: '#9b59b6', size: 8 };
        }
        return { shape: 'circle', color: '#bdc3c7', size: 6 };
    }

    _isVisible(obj) {
        if (obj.type === 'capital' || obj.type === 'account') {
            if ((obj.race === 'Терран' || obj.race === 'terran') && !this.filters['filter-terran']) return false;
            if ((obj.race === 'Жук' || obj.race === 'zerg') && !this.filters['filter-zerg']) return false;
            if ((obj.race === 'Тосс' || obj.race === 'toss') && !this.filters['filter-toss']) return false;
        }
        if (obj.type === 'object') {
            if ((obj.subtype === 'ops' || obj.subtype === 'ОПС') && !this.filters['filter-ops']) return false;
            if ((obj.subtype === 'alstation' || obj.subtype === 'Алстанция') && !this.filters['filter-alstation']) return false;
            if ((obj.subtype === 'dunya' || obj.subtype === 'Дуня') && !this.filters['filter-dunya']) return false;
            if ((obj.subtype === 'luna' || obj.subtype === 'Луна') && !this.filters['filter-luna']) return false;
            if ((obj.subtype === 'vrata' || obj.subtype === 'Врата') && !this.filters['filter-vrata']) return false;
        }
        return true;
    }

    _hasPlanetsAt(x, y) {
        return this.objects.some(o => o.x === x && o.y === y && o.z > 0);
    }

    drawCoverageZones() {
        if (!this.filters['filter-coverage']) return;
        const ctx = this.ctx;

        const alstations = this.objects.filter(o => {
            if (o.type !== 'object') return false;
            const sub = (o.subtype || '');
            return sub.includes('алстанц') || sub.includes('Алстанц') || sub.includes('alstation') || sub.includes('Alstation');
        });

        if (alstations.length === 0) return;

        for (const obj of alstations) {
            const sp = this.worldToScreen(obj.x, obj.y);
            const level = obj.level || 1;
            // Coverage: each level covers ~5 systems = 500 units
            const coverageWorldRadius = level * 500;
            const r = coverageWorldRadius * this.scale;

            if (r < 5) continue;

            // Gradient fill
            const gradient = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
            gradient.addColorStop(0, 'rgba(52, 152, 219, 0.25)');
            gradient.addColorStop(0.5, 'rgba(52, 152, 219, 0.12)');
            gradient.addColorStop(0.8, 'rgba(52, 152, 219, 0.05)');
            gradient.addColorStop(1, 'rgba(52, 152, 219, 0.01)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
            ctx.fill();

            // Border
            ctx.strokeStyle = 'rgba(52, 152, 219, 0.3)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // WiFi icon
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath();
            ctx.moveTo(sp.x, sp.y - 8);
            ctx.lineTo(sp.x - 6, sp.y + 4);
            ctx.lineTo(sp.x + 6, sp.y + 4);
            ctx.closePath();
            ctx.fill();

            // Signal waves
            ctx.strokeStyle = '#f1c40f';
            ctx.lineWidth = 1.5;
            for (let w = 1; w <= 3; w++) {
                ctx.beginPath();
                ctx.arc(sp.x, sp.y - 2, 4 + w * 3, -Math.PI * 0.8, -Math.PI * 0.2);
                ctx.stroke();
            }

            // Label
            const owner = obj.name || 'Алстанция';
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${owner} (${level}ур)`, sp.x, sp.y + 18);
            ctx.textAlign = 'left';
        }
    }

    _onWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const worldBefore = this.screenToWorld(mx, my);
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.scale *= factor;
        this.scale = Math.max(0.01, Math.min(100, this.scale));
        const worldAfter = this.screenToWorld(mx, my);

        this.offsetX += (worldAfter.x - worldBefore.x) * this.scale;
        this.offsetY += (worldAfter.y - worldBefore.y) * this.scale;

        this.render();
    }

    _onMouseDown(e) {
        this.isDragging = true;
        this._dragMoved = false;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.canvas.style.cursor = 'grabbing';
    }

    _onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (this.isDragging) {
            const dx = e.clientX - this.lastMouseX;
            const dy = e.clientY - this.lastMouseY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._dragMoved = true;
            this.offsetX += dx;
            this.offsetY += dy;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            this.hideTooltip();
            this.render();
        } else {
            const obj = this.findObjectAt(mx, my);
            if (obj) {
                this.canvas.style.cursor = 'pointer';
                this.showTooltip(obj, mx, my);
            } else {
                this.canvas.style.cursor = 'grab';
                this.hideTooltip();
            }
        }
    }

    _onMouseUp() {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
    }

    _onSearch(e) {
        const query = e.target.value.trim().toLowerCase();
        if (!query) {
            this.highlightedObj = null;
            this.render();
            return;
        }
        const found = this.objects.find(o =>
            (o.nick && o.nick.toLowerCase().includes(query)) ||
            (o.name && o.name.toLowerCase().includes(query))
        );
        if (found) {
            this.highlightedObj = found;
            const sp = this.worldToScreen(found.x, found.y);
            this.offsetX += this.canvas.width / 2 - sp.x;
            this.offsetY += this.canvas.height / 2 - sp.y;
            this.render();
        }
    }

    findObjectAt(sx, sy) {
        const world = this.screenToWorld(sx, sy);
        let nearest = null;
        let minDist = 15 / this.scale;

        for (const obj of this.objects) {
            if (!this._isVisible(obj)) continue;
            const dx = world.x - obj.x;
            const dy = world.y - obj.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) {
                minDist = dist;
                nearest = obj;
            }
        }
        return nearest;
    }

    showTooltip(obj, sx, sy) {
        if (!this.tooltip) return;
        this.tooltip.innerHTML = `
            <div><strong>${obj.nick || 'Unknown'}</strong></div>
            <div>${obj.name || ''}</div>
            <div>Type: ${obj.type}${obj.subtype ? ' (' + obj.subtype + ')' : ''}</div>
            <div>Pos: ${obj.x}:${obj.y}:${obj.z}</div>
            ${obj.race ? '<div>Race: ' + obj.race + '</div>' : ''}
            ${obj.url ? '<div><a href="' + obj.url + '" target="_blank">Profile</a></div>' : ''}
        `;
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = (sx + 15) + 'px';
        this.tooltip.style.top = (sy + 15) + 'px';
    }

    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
    }

    applyFilters() {
        const ids = ['filter-terran', 'filter-zerg', 'filter-toss', 'filter-ops', 'filter-alstation', 'filter-dunya', 'filter-luna', 'filter-vrata', 'filter-grid', 'filter-coverage'];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el) {
                this.filters[id] = el.checked;
            }
        }
        this.render();
    }

    centerAlliance() {
        this.centerX = 2500;
        this.centerY = 2500;
        this._centerView();
        this.render();
    }

    zoomIn() {
        this.scale *= 1.5;
        this.scale = Math.min(100, this.scale);
        this.render();
    }

    zoomOut() {
        this.scale /= 1.5;
        this.scale = Math.max(0.01, this.scale);
        this.render();
    }

    exportPNG() {
        const link = document.createElement('a');
        link.download = 'xcraft-map.png';
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const canvas = document.getElementById('map-canvas');
    if (canvas) {
        window.map = new GameMap(canvas);

        const homeBtn = document.getElementById('btn-home');
        if (homeBtn) homeBtn.addEventListener('click', () => window.map.centerAlliance());

        const zoomInBtn = document.getElementById('btn-zoom-in');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => window.map.zoomIn());

        const zoomOutBtn = document.getElementById('btn-zoom-out');
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => window.map.zoomOut());

        const exportBtn = document.getElementById('btn-export');
        if (exportBtn) exportBtn.addEventListener('click', () => window.map.exportPNG());
    }

    const filterIds = ['filter-terran', 'filter-zerg', 'filter-toss', 'filter-ops', 'filter-alstation', 'filter-dunya', 'filter-luna', 'filter-vrata', 'filter-grid', 'filter-coverage'];
    for (const id of filterIds) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => window.map.applyFilters());
        }
    }
});
