class GameMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.objects = [];
    this.meta = {};
    this.area = {
      min_x: 2000,
      max_x: 3000,
      min_y: 2000,
      max_y: 3000,
      center_x: 2500,
      center_y: 2500,
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
    this.coordHitBoxes = [];
    this.tooltip = document.getElementById("map-tooltip");
    this.actionHud = document.getElementById("map-action-hud");

    this.placementMode = false;
    this.ghostPos = null;
    this.placementLevel = 10;
    this.planningMode = false;
    this.planLevel = 10;
    this.planStations = [];
    this.planSuggestions = [];
    this.chainMode = false;
    this.chainTarget = null;
    this.intelFacts = [];
    this.optimizeResults = { byLevel: [], network: [] };
    this.optimizerHint = "";
    this.uncoveredPoints = [];
    this.pointEvaluation = null;
    this.evaluatedPoint = null;
    this._planDraftSaveTimer = null;
    this.coverageSettings = {
      existingColor: "#3498db",
      independentColor: "#ff7675",
      planColor: "#2ecc71",
      opacity: 0.18,
      unified: true,
      rings: true,
    };
    this.displaySettings = {
      coordLabels: true,
      levelBadges: true,
      signalRadiusLabels: true,
      stationTypeBadges: true,
      cursorSnap: true,
      cursorSnapLabel: true,
      cursorSnapSize: 0.62,
      cursorSnapOpacity: 0.42,
    };
    this.nextPlanId = 1;
    this.selectedPlanId = null;
    this.hasLoadedData = false;
    this.draggingPlanId = null;
    this.planDragMoved = false;
    this.planDragOriginal = null;

    this.contextMenu = null;
    this.pendingMoveObj = null;
    this.moveClickArmed = false;
    this.pendingPlanMoveId = null;
    this.cursorPoint = null;
    this.lastPointerScreen = null;
    this.undoStack = [];
    this.maxUndoStack = 30;
    this.isUndoing = false;

    this.filters = {
      "filter-terran": true,
      "filter-zerg": true,
      "filter-toss": true,
      "filter-ops": true,
      "filter-alstation": true,
      "filter-dunya": true,
      "filter-luna": true,
      "filter-vrata": true,
      "filter-grid": true,
      "filter-coverage": true,
    };

    this._resizeCanvas();
    window.addEventListener("resize", () => {
      this._resizeCanvas();
      this.render();
    });
    this._bindEvents();
    this.loadData().then(() => this.loadPlanDraft());
  }

  _resizeCanvas() {
    const p = this.canvas.parentElement;
    if (p) {
      this.canvas.width = p.clientWidth;
      this.canvas.height = p.clientHeight;
    }
  }

  _bindEvents() {
    this.canvas.addEventListener("wheel", (e) => this._onWheel(e), {
      passive: false,
    });
    this.canvas.addEventListener("mousedown", (e) => this._onMouseDown(e));
    this.canvas.addEventListener("mousemove", (e) => this._onMouseMove(e));
    this.canvas.addEventListener("mouseup", (e) => this._onMouseUp(e));
    this.canvas.addEventListener("auxclick", (e) => this._onAuxClick(e));
    this.canvas.addEventListener("mouseleave", () => {
      this._cancelDrag();
      this.hideTooltip();
      if (!this.pendingMoveObj && !this.pendingPlanMoveId) {
        this.cursorPoint = null;
        this.lastPointerScreen = null;
        this._clearCoordHud();
        this.render();
      }
    });
    this.canvas.addEventListener("contextmenu", (e) => this._onContextMenu(e));
    document.addEventListener("keydown", (e) => this._onKeyDown(e));
    document.addEventListener("mousedown", (e) => {
      const menu = document.getElementById("map-context-menu");
      if (menu && menu.style.display === "block" && !menu.contains(e.target)) {
        this.hideContextMenu();
      }
    });
    const si = document.getElementById("map-search");
    if (si) si.addEventListener("input", (e) => this._onSearch(e));
    for (const id of Object.keys(this.filters)) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("change", (e) => {
          this.filters[id] = e.target.checked;
          this.render();
        });
      }
    }
    const home = document.getElementById("btn-home");
    if (home) home.addEventListener("click", () => this.centerAlliance());
    const zin = document.getElementById("btn-zoom-in");
    if (zin) zin.addEventListener("click", () => this.zoomIn());
    const zout = document.getElementById("btn-zoom-out");
    if (zout) zout.addEventListener("click", () => this.zoomOut());
    const undoBtn = document.getElementById("btn-undo");
    if (undoBtn) undoBtn.addEventListener("click", () => this.undoLastAction());
    const cancelCommand = document.getElementById("btn-cancel-command");
    if (cancelCommand)
      cancelCommand.addEventListener("click", () => this.cancelActiveCommand());
    const exp = document.getElementById("btn-export");
    if (exp) exp.addEventListener("click", () => this.exportPNG());
    const planBtn = document.getElementById("btn-planning");
    if (planBtn)
      planBtn.addEventListener("click", () => this.togglePlanningMode());
    const planLevel = document.getElementById("plan-level");
    if (planLevel)
      planLevel.addEventListener("input", (e) =>
        this.setPlanLevel(parseInt(e.target.value) || 10),
      );
    const planClear = document.getElementById("btn-plan-clear");
    if (planClear) planClear.addEventListener("click", () => this.clearPlan());
    const planCopy = document.getElementById("btn-plan-copy");
    if (planCopy) planCopy.addEventListener("click", () => this.copyPlan());
    const planSave = document.getElementById("btn-plan-save");
    if (planSave)
      planSave.addEventListener("click", () => this.savePlanStations());
    const planSuggest = document.getElementById("btn-plan-suggest");
    if (planSuggest)
      planSuggest.addEventListener("click", () => this.loadPlanSuggestions());
    const planChain = document.getElementById("btn-plan-chain-to-point");
    if (planChain)
      planChain.addEventListener("click", () => this.toggleChainMode());
    const planOptimize = document.getElementById("btn-plan-optimize");
    if (planOptimize)
      planOptimize.addEventListener("click", () => {
        this.optimizerHint = "";
        this.loadOptimizedPlan();
      });
    const ownedOptimize = document.getElementById("btn-owned-station-optimize");
    if (ownedOptimize)
      ownedOptimize.addEventListener("click", () =>
        this.optimizeOwnedStations(),
      );
    const planAddNetwork = document.getElementById("btn-plan-add-network");
    if (planAddNetwork)
      planAddNetwork.addEventListener("click", () =>
        this.addOptimizedNetworkToPlan(),
      );
    const planConfirmCursor = document.getElementById(
      "btn-plan-confirm-cursor",
    );
    if (planConfirmCursor)
      planConfirmCursor.addEventListener("click", () =>
        this._confirmCurrentMapAction(),
      );
    const planCheckCursor = document.getElementById("btn-plan-check-cursor");
    if (planCheckCursor)
      planCheckCursor.addEventListener("click", () =>
        this.evaluatePoint(this._currentActionPoint()),
      );
    const planCancelMode = document.getElementById("btn-plan-cancel-mode");
    if (planCancelMode)
      planCancelMode.addEventListener("click", () =>
        this.cancelActiveCommand(),
      );
    const evalAddBest = document.getElementById("btn-eval-add-best");
    if (evalAddBest)
      evalAddBest.addEventListener("click", () =>
        this.addBestEvaluationToPlan(),
      );
    document.querySelectorAll(".optimizer-target").forEach((el) => {
      el.addEventListener("change", () => {
        if (
          this.optimizeResults.byLevel.length ||
          this.optimizeResults.network.length
        ) {
          this.loadOptimizedPlan();
        }
      });
    });
    const intelBtn = document.getElementById("btn-intel-load");
    if (intelBtn)
      intelBtn.addEventListener("click", () => this.loadIntelFacts());
    const coverageExisting = document.getElementById("coverage-existing-color");
    if (coverageExisting)
      coverageExisting.addEventListener("input", (e) =>
        this.setCoverageSetting("existingColor", e.target.value),
      );
    const coveragePlan = document.getElementById("coverage-plan-color");
    if (coveragePlan)
      coveragePlan.addEventListener("input", (e) =>
        this.setCoverageSetting("planColor", e.target.value),
      );
    const coverageOpacity = document.getElementById("coverage-opacity");
    if (coverageOpacity)
      coverageOpacity.addEventListener("input", (e) =>
        this.setCoverageSetting(
          "opacity",
          (parseInt(e.target.value) || 18) / 100,
        ),
      );
    const coverageUnified = document.getElementById("coverage-unified");
    if (coverageUnified)
      coverageUnified.addEventListener("change", (e) =>
        this.setCoverageSetting("unified", e.target.checked),
      );
    const coverageRings = document.getElementById("coverage-rings");
    if (coverageRings)
      coverageRings.addEventListener("change", (e) =>
        this.setCoverageSetting("rings", e.target.checked),
      );
    const displayControls = {
      "display-coord-labels": "coordLabels",
      "display-level-badges": "levelBadges",
      "display-signal-radius": "signalRadiusLabels",
      "display-station-type": "stationTypeBadges",
      "display-cursor-snap": "cursorSnap",
      "display-cursor-snap-label": "cursorSnapLabel",
    };
    for (const [id, key] of Object.entries(displayControls)) {
      const el = document.getElementById(id);
      if (el) {
        this.displaySettings[key] = el.checked;
        el.addEventListener("change", (e) =>
          this.setDisplaySetting(key, e.target.checked),
        );
      }
    }
    const cursorSnapSize = document.getElementById("cursor-snap-size");
    if (cursorSnapSize)
      cursorSnapSize.addEventListener("input", (e) =>
        this.setDisplaySetting("cursorSnapSize", (parseInt(e.target.value) || 62) / 100),
      );
    const cursorSnapOpacity = document.getElementById("cursor-snap-opacity");
    if (cursorSnapOpacity)
      cursorSnapOpacity.addEventListener("input", (e) =>
        this.setDisplaySetting("cursorSnapOpacity", (parseInt(e.target.value) || 42) / 100),
      );
    const planEditName = document.getElementById("plan-edit-name");
    if (planEditName)
      planEditName.addEventListener("input", (e) =>
        this.updateSelectedPlan({ name: e.target.value }),
      );
    const planEditLevel = document.getElementById("plan-edit-level");
    if (planEditLevel)
      planEditLevel.addEventListener("input", (e) =>
        this.updateSelectedPlan({ level: parseInt(e.target.value) || 10 }),
      );
    const planEditStatus = document.getElementById("plan-edit-status");
    if (planEditStatus)
      planEditStatus.addEventListener("change", (e) =>
        this.updateSelectedPlan({ status: e.target.value }),
      );
    const planEditComment = document.getElementById("plan-edit-comment");
    if (planEditComment)
      planEditComment.addEventListener("input", (e) =>
        this.updateSelectedPlan({ comment: e.target.value }),
      );
    const planEditLocked = document.getElementById("plan-edit-locked");
    if (planEditLocked)
      planEditLocked.addEventListener("change", (e) =>
        this.updateSelectedPlan({ locked: e.target.checked }),
      );
    ["st-x", "st-y", "st-z"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", () =>
          this._updateStationCoordInfo(
            document.getElementById("st-x").value,
            document.getElementById("st-y").value,
            document.getElementById("st-z").value,
          ),
        );
      }
    });
    const playerSearch = document.getElementById("st-player-search");
    if (playerSearch) {
      playerSearch.addEventListener("input", () => this._syncStationOwnerFromSearch());
      playerSearch.addEventListener("change", () => this._syncStationOwnerFromSearch());
      playerSearch.addEventListener("blur", () => this._syncStationOwnerFromSearch());
    }
  }

  worldToScreen(wx, wy) {
    // World: X right, Y UP. Screen: X right, Y DOWN.
    return {
      x: wx * this.scale + this.offsetX,
      y: -wy * this.scale + this.offsetY,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: -(sy - this.offsetY) / this.scale,
    };
  }

  centerOn(wx, wy) {
    this.offsetX = this.canvas.width / 2 - wx * this.scale;
    this.offsetY = this.canvas.height / 2 + wy * this.scale;
    this.render();
  }

  centerAlliance() {
    this.centerOn(0, 0);
  }

  fitAllianceArea() {
    const widthSystems = this.area.max_x - this.area.min_x;
    const heightSystems = this.area.max_y - this.area.min_y;
    const worldWidth = Math.max(widthSystems * this.systemSpacing, 1);
    const worldHeight = Math.max(heightSystems * this.systemSpacing, 1);
    const fitScale =
      Math.min(
        this.canvas.width / worldWidth,
        this.canvas.height / worldHeight,
      ) * 0.9;
    this.scale = Math.max(0.0002, fitScale);
    this.centerAlliance();
  }

  async loadData(options = {}) {
    try {
      const preserveViewport = options.preserveViewport ?? this.hasLoadedData;
      const resp = await fetch("/map/api/data");
      const data = await resp.json();
      this.objects = data.objects || [];
      this.meta = data.meta || {};
      this._refreshExistingNetworkStatus();
      if (this.meta.area) this.area = this.meta.area;
      this._updateStatus();

      const params = new URLSearchParams(window.location.search);
      const focus = params.get("focus");
      if (focus && !preserveViewport) {
        const m = focus.match(/\[(\d+):(\d+)(?::(\d+))?\]/);
        if (m) {
          const fx = parseInt(m[1]),
            fy = parseInt(m[2]),
            fz = parseInt(m[3] || "0");
          this.focusCoordinate({ x: fx, y: fy, z: fz }, { updateUrl: false });
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
    } catch (e) {
      console.error("Map data error:", e);
    }
  }

  render() {
    const c = this.ctx;
    this.coordHitBoxes = [];
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.fillStyle = "#0a0e14";
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.filters["filter-grid"]) this.drawGrid();
    if (this.filters["filter-coverage"]) this.drawCoverage();
    if (this.filters["filter-coverage"]) this.drawPlanCoverage();
    this.drawSystems();
    this.drawObjects();
    this.drawUncoveredPoints();
    this.drawPlanSuggestions();
    this.drawEvaluatedPoint();
    this.drawChainTarget();
    this.drawIntelFacts();
    this.drawPlanStations();
    this.drawCursorSnap();
    this.drawCursorPreview();
    if (this.placementMode && this.ghostPos) this.drawGhost();
    this._updateActionHud();
  }

  _updateActionHud() {
    const el = this.actionHud || document.getElementById("map-action-hud");
    if (!el) return;
    this.actionHud = el;
    const active =
      this.planningMode ||
      this.chainMode ||
      this.placementMode ||
      this.pendingMoveObj ||
      this.pendingPlanMoveId ||
      this.draggingPlanId;
    if (!active) {
      el.style.display = "none";
      return;
    }
    const p = this._currentActionPoint();
    let title = "Режим карты";
    if (this.pendingMoveObj) title = "Перемещение объекта";
    else if (this.pendingPlanMoveId || this.draggingPlanId)
      title = "Перемещение плановой алстанции";
    else if (this.chainMode) title = "Цепь алстанций до точки";
    else if (this.planningMode) title = "Планирование алстанции";
    else if (this.placementMode) title = "Размещение объекта";

    const level = this.pendingPlanMoveId
      ? (this.planStations.find((st) => st.id === this.pendingPlanMoveId) || {})
          .level || this.planLevel
      : this.planLevel;
    const coord = p ? "[" + p.sx + ":" + p.sy + ":0]" : "[?:?:0]";
    const lines = [
      "<strong>" +
        this._escapeHtml(title) +
        "</strong> " +
        coord +
        (this.planningMode || this.chainMode ? " · " + level + " ур" : ""),
      "<span><kbd>Enter</kbd>/<kbd>Space</kbd> подтвердить · <kbd>Esc</kbd>/<kbd>СКМ</kbd> отмена</span>",
    ];
    if (this.planningMode || this.chainMode) {
      lines.push(
        this.chainMode
          ? "<span>Клик по карте построит цепь от общей сети до точки · <kbd>Esc</kbd> отмена</span>"
          : "<span><kbd>Shift</kbd>+клик проверить точку · <kbd>Alt</kbd>+клик поставить и закрепить · <kbd>+/-</kbd> уровень</span>",
      );
    }
    if (this.selectedPlanId) {
      lines.push(
        "<span><kbd>L</kbd> закрепить · <kbd>M</kbd> переместить · <kbd>Delete</kbd> удалить выбранную</span>",
      );
    }
    el.innerHTML = lines.join("<br>");
    el.style.display = "block";
  }

  drawGrid() {
    const c = this.ctx;
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(
      this.canvas.width,
      this.canvas.height,
    );
    const minWx = Math.min(topLeft.x, bottomRight.x);
    const maxWx = Math.max(topLeft.x, bottomRight.x);
    const minWy = Math.min(topLeft.y, bottomRight.y);
    const maxWy = Math.max(topLeft.y, bottomRight.y);
    const systemPx = this.systemSpacing * this.scale;
    const stepSystems =
      systemPx < 4 ? 100 : systemPx < 10 ? 50 : systemPx < 25 ? 10 : 1;
    const stepWorld = stepSystems * this.systemSpacing;

    const startX = this._snapDown(minWx, stepWorld);
    const startY = this._snapDown(minWy, stepWorld);

    c.save();
    c.lineWidth = 1;
    c.font = "11px sans-serif";
    c.textAlign = "left";
    c.textBaseline = "top";

    for (let wx = startX; wx <= maxWx; wx += stepWorld) {
      const sx = this.worldToScreen(wx, 0).x;
      const coord = Math.round(this.worldToSystemX(wx));
      const isCenter = coord === this.area.center_y;
      c.strokeStyle = isCenter
        ? "rgba(255,255,255,0.28)"
        : "rgba(255,255,255,0.08)";
      c.beginPath();
      c.moveTo(sx, 0);
      c.lineTo(sx, this.canvas.height);
      c.stroke();
      if (stepSystems >= 10 || systemPx >= 25) {
        c.fillStyle = isCenter
          ? "rgba(255,255,255,0.75)"
          : "rgba(255,255,255,0.35)";
        c.fillText(String(coord), sx + 4, 4);
      }
    }

    for (let wy = startY; wy <= maxWy; wy += stepWorld) {
      const sy = this.worldToScreen(0, wy).y;
      const coord = Math.round(this.worldToSystemY(wy));
      const isCenter = coord === this.area.center_x;
      c.strokeStyle = isCenter
        ? "rgba(255,255,255,0.28)"
        : "rgba(255,255,255,0.08)";
      c.beginPath();
      c.moveTo(0, sy);
      c.lineTo(this.canvas.width, sy);
      c.stroke();
      if (stepSystems >= 10 || systemPx >= 25) {
        c.fillStyle = isCenter
          ? "rgba(255,255,255,0.75)"
          : "rgba(255,255,255,0.35)";
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
    const bottomRight = this.screenToWorld(
      this.canvas.width,
      this.canvas.height,
    );
    const minHorizontal = Math.max(
      this.area.min_y,
      Math.floor(this.worldToSystemX(Math.min(topLeft.x, bottomRight.x))) - 1,
    );
    const maxHorizontal = Math.min(
      this.area.max_y,
      Math.ceil(this.worldToSystemX(Math.max(topLeft.x, bottomRight.x))) + 1,
    );
    const minVertical = Math.max(
      this.area.min_x,
      Math.floor(this.worldToSystemY(Math.min(topLeft.y, bottomRight.y))) - 1,
    );
    const maxVertical = Math.min(
      this.area.max_x,
      Math.ceil(this.worldToSystemY(Math.max(topLeft.y, bottomRight.y))) + 1,
    );

    c.save();
    c.fillStyle = "rgba(255,255,255,0.22)";
    for (let vertical = minVertical; vertical <= maxVertical; vertical++) {
      for (
        let horizontal = minHorizontal;
        horizontal <= maxHorizontal;
        horizontal++
      ) {
        const sp = this.worldToScreen(
          this.systemToWorldX(horizontal),
          this.systemToWorldY(vertical),
        );
        c.beginPath();
        c.arc(sp.x, sp.y, 1.5, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }
  drawCoverage() {
    const c = this.ctx;
    const alstations = this.objects.filter(
      (o) => o.type === "object" && this._isAlstation(o),
    );
    if (!alstations.length) return;
    const stations = alstations
      .map((obj) => {
        const sp = this._objectToScreen(obj, false);
        const level = obj.level || 1;
        return {
          x: sp.x,
          y: sp.y,
          r: (obj.radius || level * 900) * this.scale,
          obj,
          level,
          connected: obj.network_status === "main" || obj.network_connected !== false,
          signalOnly: obj.network_status === "signal_only" || obj.network_status === "isolated",
        };
      })
      .filter((item) => item.r >= 3);
    if (!stations.length) return;

    if (this.coverageSettings.unified) {
      const connectedStations = stations.filter((item) => item.connected);
      const independentStations = stations.filter((item) => !item.connected);
      if (connectedStations.length) {
        this._drawCoverageMask(
          connectedStations,
          this.coverageSettings.existingColor,
          this.coverageSettings.opacity,
        );
      }
      if (independentStations.length) {
        this._drawCoverageMask(
          independentStations,
          this.coverageSettings.independentColor,
          this.coverageSettings.opacity + 0.04,
        );
      }
    }

    for (const item of stations) {
      const sp = { x: item.x, y: item.y };
      const r = item.r;
      const obj = item.obj;
      const level = item.level;
      const coverageColor = item.connected
        ? this.coverageSettings.existingColor
        : this.coverageSettings.independentColor;
      if (!this.coverageSettings.unified) {
        const g = c.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
        g.addColorStop(
          0,
          this._hexToRgba(
            coverageColor,
            this.coverageSettings.opacity + 0.07,
          ),
        );
        g.addColorStop(
          0.65,
          this._hexToRgba(
            coverageColor,
            this.coverageSettings.opacity * 0.55,
          ),
        );
        g.addColorStop(1, this._hexToRgba(coverageColor, 0.01));
        c.fillStyle = g;
        c.beginPath();
        c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        c.fill();
      }

      if (this.coverageSettings.rings) {
        c.strokeStyle = this._hexToRgba(coverageColor, item.connected ? 0.42 : 0.72);
        c.lineWidth = item.connected ? 1.5 : 2;
        c.setLineDash(item.connected ? [5, 3] : [2, 5]);
        c.beginPath();
        c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      }

      c.fillStyle = item.connected ? "#f1c40f" : "#ff7675";
      c.beginPath();
      c.moveTo(sp.x, sp.y - 8);
      c.lineTo(sp.x - 6, sp.y + 4);
      c.lineTo(sp.x + 6, sp.y + 4);
      c.closePath();
      c.fill();
      c.strokeStyle = item.connected ? "#f1c40f" : "#ffb3ad";
      c.lineWidth = 1.5;
      for (let w = 1; w <= 3; w++) {
        c.beginPath();
        c.arc(sp.x, sp.y - 2, 4 + w * 3, -0.8 * Math.PI, -0.2 * Math.PI);
        c.stroke();
      }

      this._drawStationCoordLabel(sp.x, sp.y + 18, obj, level, false);
    }
  }

  _drawStationCoordLabel(x, y, item, level, isPlan) {
    if (!this.displaySettings.coordLabels) return;
    const c = this.ctx;
    const systemPx = this.systemSpacing * this.scale;
    const selected = isPlan && item.id === this.selectedPlanId;
    const focused = selected || this.highlightedObj === item;
    const isMain = item.network_status === "main";
    if (systemPx < 5 && !focused) return;
    if (systemPx < 8 && !focused && !isMain) return;
    const coord = "[" + item.x + ":" + item.y + ":" + (item.z || 0) + "]";
    const networkNote =
      item.network_status === "signal_only" || item.network_status === "isolated"
        ? "автономно"
        : item.network_status === "main"
          ? "главная"
          : "";
    const titleParts = [isPlan ? "План" : item.name || "Алстанция"];
    if (!this.displaySettings.levelBadges) {
      titleParts.push((level || item.level || 1) + " ур");
    }
    titleParts.push(networkNote);
    const title = titleParts.filter(Boolean).join(" · ");
    const fontSize = focused
      ? Math.max(8, Math.min(11, Math.round(systemPx / 1.8)))
      : systemPx < 12
        ? 7
        : systemPx < 22
          ? 9
          : 11;
    const lines = systemPx < 14 && !focused ? [coord] : [coord, title];

    c.save();
    c.font = "bold " + fontSize + "px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    const padX = systemPx < 14 && !focused ? 6 : 10;
    const padY = systemPx < 14 && !focused ? 4 : 7;
    const width =
      Math.max(...lines.map((line) => c.measureText(line).width)) + padX * 2;
    const lineHeight = fontSize + (fontSize <= 8 ? 2 : 4);
    const height = lineHeight * lines.length + padY * 2;
    const boxX = Math.round(x - width / 2);
    const boxY = Math.round(y);
    c.fillStyle = "rgba(5,9,14,0.82)";
    c.strokeStyle =
      item.network_status === "signal_only" || item.network_status === "isolated"
        ? this._hexToRgba(this.coverageSettings.independentColor, 0.95)
        : isPlan
          ? this._hexToRgba(this.coverageSettings.planColor, 0.9)
          : "rgba(116,185,255,0.85)";
    c.lineWidth = 1.5;
    c.beginPath();
    if (typeof c.roundRect === "function") {
      c.roundRect(boxX, boxY, width, height, 5);
    } else {
      this._roundedRectPath(c, boxX, boxY, width, height, 5);
    }
    c.fill();
    c.stroke();
    c.fillStyle = "#fff";
    c.fillText(lines[0], x, boxY + padY + lineHeight / 2);
    if (lines[1]) {
      c.font = Math.max(9, fontSize - 1) + "px sans-serif";
      c.fillStyle = "rgba(255,255,255,0.78)";
      c.fillText(lines[1], x, boxY + padY + lineHeight + lineHeight / 2);
    }
    c.restore();
    this._registerCoordHitBox(boxX, boxY, width, height, item);
  }

  _roundedRectPath(c, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    c.moveTo(x + r, y);
    c.lineTo(x + width - r, y);
    c.quadraticCurveTo(x + width, y, x + width, y + r);
    c.lineTo(x + width, y + height - r);
    c.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    c.lineTo(x + r, y + height);
    c.quadraticCurveTo(x, y + height, x, y + height - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
  }

  _registerCoordHitBox(x, y, width, height, item) {
    if (!item || typeof item.x === "undefined" || typeof item.y === "undefined")
      return;
    this.coordHitBoxes.push({
      x,
      y,
      width,
      height,
      coord: {
        x: item.x,
        y: item.y,
        z: item.z || 0,
        wx: item.wx,
        wy: item.wy,
      },
    });
  }

  findCoordHitAt(sx, sy) {
    for (let i = this.coordHitBoxes.length - 1; i >= 0; i--) {
      const box = this.coordHitBoxes[i];
      if (
        sx >= box.x &&
        sx <= box.x + box.width &&
        sy >= box.y &&
        sy <= box.y + box.height
      ) {
        return box.coord;
      }
    }
    return null;
  }

  _coordUrl(coord) {
    return "/map?focus=[" + coord.x + ":" + coord.y + ":" + (coord.z || 0) + "]";
  }

  _coordinateFocusScale() {
    const shortSide = Math.max(320, Math.min(this.canvas.width, this.canvas.height));
    const systemPx = Math.max(12, Math.min(22, shortSide / 34));
    return systemPx / this.systemSpacing;
  }

  focusCoordinate(coord, options = {}) {
    if (!coord) return;
    const wx =
      typeof coord.wx === "number" ? coord.wx : this.systemToWorldX(coord.y);
    const wy =
      typeof coord.wy === "number" ? coord.wy : this.systemToWorldY(coord.x);
    const found = this.objects.find(
      (o) =>
        o.x === coord.x &&
        o.y === coord.y &&
        Number(o.z || 0) === Number(coord.z || 0),
    );
    this.highlightedObj = found || null;
    if (options.updateUrl !== false) {
      window.history.pushState({}, "", this._coordUrl(coord));
    }
    this.scale = Math.max(this.scale, this._coordinateFocusScale());
    this.centerOn(wx, wy);
  }

  openCoordinate(coord) {
    if (!coord) return;
    const url = this._coordUrl(coord);
    if (window.location.pathname === "/map") {
      this.focusCoordinate(coord);
    } else {
      window.location.href = url;
    }
  }

  _drawCoverageMask(stations, color, alpha) {
    const mask = document.createElement("canvas");
    mask.width = this.canvas.width;
    mask.height = this.canvas.height;
    const m = mask.getContext("2d");
    m.fillStyle = "#fff";
    for (const item of stations) {
      m.beginPath();
      m.arc(item.x, item.y, item.r, 0, Math.PI * 2);
      m.fill();
    }
    m.globalCompositeOperation = "source-in";
    m.fillStyle = color;
    m.fillRect(0, 0, mask.width, mask.height);
    const c = this.ctx;
    c.save();
    c.globalAlpha = Math.max(0.03, Math.min(0.6, alpha));
    c.drawImage(mask, 0, 0);
    c.restore();
  }

  _hexToRgba(hex, alpha) {
    const clean = String(hex || "#3498db").replace("#", "");
    const full =
      clean.length === 3
        ? clean
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : clean;
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return "rgba(52,152,219," + alpha + ")";
    return (
      "rgba(" +
      ((n >> 16) & 255) +
      "," +
      ((n >> 8) & 255) +
      "," +
      (n & 255) +
      "," +
      alpha +
      ")"
    );
  }

  setCoverageSetting(key, value) {
    this.coverageSettings[key] = value;
    const opacityVal = document.getElementById("coverage-opacity-val");
    if (key === "opacity" && opacityVal)
      opacityVal.textContent = Math.round(value * 100) + "%";
    this.render();
  }

  setDisplaySetting(key, value) {
    this.displaySettings[key] = value;
    if (key === "cursorSnapSize") {
      const val = document.getElementById("cursor-snap-size-val");
      if (val) val.textContent = Math.round(value * 100) + "%";
    }
    if (key === "cursorSnapOpacity") {
      const val = document.getElementById("cursor-snap-opacity-val");
      if (val) val.textContent = Math.round(value * 100) + "%";
    }
    this.render();
  }

  _clonePlanStation(item) {
    return JSON.parse(JSON.stringify(item));
  }

  _pushUndo(action) {
    if (this.isUndoing || !action) return;
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxUndoStack) this.undoStack.shift();
    this._updateUndoButton();
  }

  _planSnapshot() {
    return {
      type: "plan-snapshot",
      stations: this.planStations.map((item) => this._clonePlanStation(item)),
      selectedId: this.selectedPlanId,
    };
  }

  _updateUndoButton() {
    const btn = document.getElementById("btn-undo");
    if (btn) btn.disabled = !this.undoStack.length;
  }

  _restorePlanSnapshot(stations, selectedId = null) {
    this.planStations = (stations || []).map((item) => this._clonePlanStation(item));
    this.selectedPlanId = selectedId;
    const maxId = this.planStations.reduce(
      (max, item) => Math.max(max, parseInt(item.id) || 0),
      0,
    );
    this.nextPlanId = Math.max(
      this.nextPlanId,
      maxId + 1,
    );
    this.pendingPlanMoveId = null;
    this.draggingPlanId = null;
    this.planDragMoved = false;
    this.planDragOriginal = null;
    this.ghostPos = null;
    this.cursorPoint = null;
    this._clearCoordHud();
    this._refreshPlanEstimates();
    this._updatePlanPanel();
    this.savePlanDraftDebounced();
    this.render();
  }

  async undoLastAction() {
    if (!this.undoStack.length) return;
    const action = this.undoStack.pop();
    this.isUndoing = true;
    try {
      if (action.type === "plan-snapshot") {
        this._restorePlanSnapshot(action.stations, action.selectedId);
      } else if (action.type === "object-move") {
        const before = action.before || {};
        const resp = await fetch("/map/api/stations/" + action.id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            x: before.x,
            y: before.y,
            z: before.z || 0,
          }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          alert(data.error || "Не удалось отменить перемещение объекта");
        } else {
          await this.loadData();
          this._updateStationsList();
        }
      }
    } finally {
      this.isUndoing = false;
      this._updateUndoButton();
    }
  }

  _formatSignalRadius(radius, compact = false) {
    const value = Math.max(0, parseInt(radius) || 0);
    if (compact && value >= 1000) return Math.round(value / 1000) + "k";
    return value.toLocaleString("ru-RU") + " укм";
  }

  _drawBadge(x, y, text, options = {}) {
    if (!text) return { width: 0, height: 0 };
    const c = this.ctx;
    const fontSize = options.fontSize || 9;
    const padX = options.padX || 5;
    const padY = options.padY || 3;
    c.save();
    c.font = (options.bold ? "bold " : "") + fontSize + "px sans-serif";
    const width = Math.ceil(c.measureText(text).width + padX * 2);
    const height = fontSize + padY * 2;
    c.fillStyle = options.fill || "rgba(5,9,14,0.88)";
    c.strokeStyle = options.stroke || "rgba(255,255,255,0.35)";
    c.lineWidth = 1;
    c.beginPath();
    if (typeof c.roundRect === "function") {
      c.roundRect(Math.round(x), Math.round(y), width, height, 4);
    } else {
      this._roundedRectPath(c, Math.round(x), Math.round(y), width, height, 4);
    }
    c.fill();
    c.stroke();
    c.fillStyle = options.color || "#fff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, Math.round(x) + width / 2, Math.round(y) + height / 2 + 0.5);
    c.restore();
    return { width, height };
  }

  _stationMobility(obj = {}) {
    const explicit = obj.station_mobility || obj.mobility;
    if (explicit === "mobile" || explicit === "stationary") return explicit;
    const comment = String(obj.comment || "");
    const marker = comment.match(/\[station_mobility:(mobile|stationary)\]/i);
    if (marker) return marker[1].toLowerCase();
    const text = [obj.name, obj.subtype, obj.object_type, comment]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (
      text.includes("перемещ") ||
      text.includes("мобил") ||
      text.includes("опс") ||
      text.includes("ops") ||
      text.includes("космо") ||
      text.includes("спутник")
    ) {
      return "mobile";
    }
    return "stationary";
  }

  _stationMobilityText(mobility, compact = false) {
    if (mobility === "mobile") return compact ? "МБ" : "моб.";
    return compact ? "СТ" : "стац.";
  }

  _commentWithoutMobility(comment) {
    return String(comment || "")
      .replace(/\s*\[station_mobility:(mobile|stationary)\]\s*/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  _commentWithMobility(comment, mobility) {
    const clean = this._commentWithoutMobility(comment);
    const type = mobility === "mobile" ? "mobile" : "stationary";
    return (clean ? clean + " " : "") + "[station_mobility:" + type + "]";
  }

  _setStationMobilityVisible(subtype) {
    const isStation = this._isAlstation({ subtype });
    const group = document.getElementById("st-mobility-group");
    if (group) group.style.display = isStation ? "" : "none";
    return isStation;
  }

  _stationOwnerOptions() {
    return Array.from(document.querySelectorAll("#st-player-options option"));
  }

  _findStationOwnerOption(valueOrId) {
    const value = String(valueOrId || "").trim().toLowerCase();
    if (!value) return null;
    return this._stationOwnerOptions().find((option) => {
      const id = String(option.dataset.id || "").trim();
      const nick = String(option.value || "").trim().toLowerCase();
      return id === value || nick === value;
    }) || null;
  }

  _setStationOwner(playerId) {
    const hidden = document.getElementById("st-player-id");
    const search = document.getElementById("st-player-search");
    const match = document.getElementById("st-player-match");
    const option = this._findStationOwnerOption(playerId);
    if (hidden) hidden.value = option ? option.dataset.id || "" : "";
    if (search) search.value = option ? option.value : "";
    if (match) {
      match.textContent = option ? "Выбран: " + option.value : "Не привязан";
      match.classList.toggle("text-success", !!option);
      match.classList.toggle("text-muted", !option);
      match.classList.toggle("text-warning", false);
    }
  }

  _syncStationOwnerFromSearch() {
    const hidden = document.getElementById("st-player-id");
    const search = document.getElementById("st-player-search");
    const match = document.getElementById("st-player-match");
    if (!search || !hidden) return null;
    const value = search.value.trim();
    if (!value || value === "— Не привязан —") {
      hidden.value = "";
      if (match) {
        match.textContent = "Не привязан";
        match.classList.toggle("text-success", false);
        match.classList.toggle("text-warning", false);
        match.classList.toggle("text-muted", true);
      }
      return null;
    }
    const option = this._findStationOwnerOption(value);
    hidden.value = option ? option.dataset.id || "" : "";
    if (match) {
      match.textContent = option
        ? "Выбран: " + option.value
        : "Игрок не выбран: выберите точный ник из подсказки";
      match.classList.toggle("text-success", !!option);
      match.classList.toggle("text-warning", !option);
      match.classList.toggle("text-muted", false);
    }
    return option ? parseInt(option.dataset.id) || null : null;
  }

  _selectedStationOwnerId() {
    this._syncStationOwnerFromSearch();
    const value = (document.getElementById("st-player-id")?.value || "").trim();
    return value ? parseInt(value) : null;
  }

  _drawObjectBadges(obj, sp, style = {}, sz = 8, options = {}) {
    const systemPx = this.systemSpacing * this.scale;
    const isPlan = !!options.isPlan;
    const focused =
      (isPlan && obj.id === this.selectedPlanId) || this.highlightedObj === obj;
    if (systemPx < 4 && !focused) return;
    const isAlstation = options.isAlstation || this._isAlstation(obj);
    const level = parseInt(obj.level) || 0;
    const radius = parseInt(obj.radius) || (level ? this._planRadius(level) : 0);
    const compact = systemPx < 16 && !focused;
    const fontSize = focused ? 10 : systemPx < 9 ? 7 : systemPx < 18 ? 8 : 9;
    const badges = [];

    if (this.displaySettings.levelBadges && level && (focused || systemPx >= 5)) {
      badges.push({
        text: compact ? "L" + level : level + " ур",
        fill: "rgba(5,9,14,0.9)",
        stroke: style.color || "#74b9ff",
        color: "#ffffff",
        bold: true,
      });
    }
    if (
      isAlstation &&
      this.displaySettings.signalRadiusLabels &&
      radius &&
      (focused || systemPx >= 7)
    ) {
      badges.push({
        text: this._formatSignalRadius(radius, compact),
        fill: "rgba(10,18,24,0.9)",
        stroke: isPlan ? this.coverageSettings.planColor : "#f1c40f",
        color: "#ffeaa7",
      });
    }
    if (
      isAlstation &&
      this.displaySettings.stationTypeBadges &&
      (focused || systemPx >= 6)
    ) {
      const mobility = this._stationMobility(obj);
      badges.push({
        text: this._stationMobilityText(mobility, compact),
        fill:
          mobility === "mobile"
            ? "rgba(45,52,85,0.92)"
            : "rgba(31,63,48,0.92)",
        stroke: mobility === "mobile" ? "#81ecec" : "#55efc4",
        color: mobility === "mobile" ? "#dff9fb" : "#d7fff1",
        bold: true,
      });
    }
    if (!badges.length) return;

    const c = this.ctx;
    c.save();
    const lineHeight = fontSize + 7;
    let y = sp.y - (badges.length * lineHeight) / 2;
    let x = sp.x + sz + 6;
    if (sp.x > this.canvas.width - 90) x = sp.x - sz - 60;
    for (const badge of badges) {
      const drawn = this._drawBadge(x, y, badge.text, {
        fontSize,
        fill: badge.fill,
        stroke: badge.stroke,
        color: badge.color,
        bold: badge.bold,
      });
      y += drawn.height + 3;
    }
    c.restore();
  }

  _drawStationSignalIcon(sp) {
    const c = this.ctx;
    c.fillStyle = "#f1c40f";
    c.beginPath();
    c.moveTo(sp.x, sp.y - 8);
    c.lineTo(sp.x - 6, sp.y + 4);
    c.lineTo(sp.x + 6, sp.y + 4);
    c.closePath();
    c.fill();
    c.strokeStyle = "#f1c40f";
    c.lineWidth = 1.5;
    for (let w = 1; w <= 3; w++) {
      c.beginPath();
      c.arc(sp.x, sp.y - 2, 4 + w * 3, -0.8 * Math.PI, -0.2 * Math.PI);
      c.stroke();
    }
  }

  _isAlstation(obj) {
    const s = obj.subtype || obj.object_type || "";
    return (
      s.includes("\u0410\u043b\u0441\u0442\u0430\u043d\u0446") ||
      s.includes("Алстанц") ||
      s.includes("Алстанц")
    );
  }

  _objectTargetKind(obj) {
    const s = obj.subtype || obj.object_type || "";
    if (this._isAlstation(obj)) return "alstation";
    if (s.includes("ОПС") || s.toLowerCase().includes("ops")) return "ops";
    if (s.includes("Врат") || s.toLowerCase().includes("gate")) return "gate";
    if (s.includes("Дун") || s.toLowerCase().includes("dunya")) return "dunya";
    if (s.includes("Лун") || s.toLowerCase().includes("moon")) return "moon";
    return "object";
  }

  drawPlanCoverage() {
    if (!this.planStations.length) return;
    const c = this.ctx;
    c.save();
    const stations = this.planStations
      .map((item) => {
        const sp = this.worldToScreen(item.wx, item.wy);
        return { x: sp.x, y: sp.y, r: item.radius * this.scale, item };
      })
      .filter((item) => item.r >= 3);
    if (!stations.length) {
      c.restore();
      return;
    }

    if (this.coverageSettings.unified) {
      const connectedStations = stations.filter((station) => station.item.networkConnected);
      const independentStations = stations.filter((station) => !station.item.networkConnected);
      if (connectedStations.length) {
        this._drawCoverageMask(
          connectedStations,
          this.coverageSettings.planColor,
          this.coverageSettings.opacity + 0.05,
        );
      }
      if (independentStations.length) {
        this._drawCoverageMask(
          independentStations,
          this.coverageSettings.independentColor,
          this.coverageSettings.opacity + 0.04,
        );
      }
    }

    for (const station of stations) {
      const item = station.item;
      const coverageColor = item.networkConnected
        ? this.coverageSettings.planColor
        : this.coverageSettings.independentColor;
      if (!this.coverageSettings.unified) {
        const grad = c.createRadialGradient(
          station.x,
          station.y,
          0,
          station.x,
          station.y,
          station.r,
        );
        grad.addColorStop(
          0,
          this._hexToRgba(coverageColor, this.coverageSettings.opacity + 0.08),
        );
        grad.addColorStop(
          0.65,
          this._hexToRgba(coverageColor, this.coverageSettings.opacity * 0.55),
        );
        grad.addColorStop(1, this._hexToRgba(coverageColor, 0.01));
        c.fillStyle = grad;
        c.beginPath();
        c.arc(station.x, station.y, station.r, 0, Math.PI * 2);
        c.fill();
      }
      if (this.coverageSettings.rings) {
        c.strokeStyle =
          item.id === this.selectedPlanId
            ? "rgba(255,255,255,0.9)"
            : this._hexToRgba(coverageColor, item.networkConnected ? 0.78 : 0.9);
        c.lineWidth = item.id === this.selectedPlanId ? 2.5 : 1.5;
        c.setLineDash(item.networkConnected ? (item.locked ? [2, 4] : [8, 5]) : [2, 5]);
        c.beginPath();
        c.arc(station.x, station.y, station.r, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      }
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
      const planColor = item.networkConnected
        ? this.coverageSettings.planColor
        : this.coverageSettings.independentColor;
      c.shadowColor = selected
        ? "#fff"
        : this._hexToRgba(planColor, 0.8);
      c.shadowBlur = selected ? 14 : 8;
      c.fillStyle = item.locked ? "#7f8c8d" : planColor;
      c.strokeStyle = selected ? "#fff" : "rgba(0,0,0,0.55)";
      c.lineWidth = selected ? 2 : 1;
      c.beginPath();
      c.moveTo(sp.x, sp.y - sz);
      c.lineTo(sp.x + sz, sp.y);
      c.lineTo(sp.x, sp.y + sz);
      c.lineTo(sp.x - sz, sp.y);
      c.closePath();
      c.fill();
      c.stroke();

      c.shadowBlur = 0;
      this._drawObjectBadges(
        { ...item, subtype: "Алстанция", station_mobility: item.station_mobility || "stationary" },
        sp,
        { color: planColor },
        sz,
        { isPlan: true, isAlstation: true },
      );
      this._drawStationCoordLabel(sp.x, sp.y + sz + 8, item, item.level, true);
    }
    c.restore();
  }

  drawCursorSnap() {
    if (!this.displaySettings.cursorSnap) return;
    const point = this.cursorPoint || this.ghostPos;
    if (!point) return;
    const systemPx = this.systemSpacing * this.scale;
    if (systemPx < 5 && !this.placementMode && !this.planningMode && !this.chainMode) return;

    const c = this.ctx;
    const sp = this.worldToScreen(point.wx, point.wy);
    const pointer = this.lastPointerScreen;
    const active =
      this.placementMode ||
      this.planningMode ||
      this.chainMode ||
      this.pendingMoveObj ||
      this.pendingPlanMoveId ||
      this.draggingPlanId;
    const color = active ? "#2ecc71" : "#74b9ff";
    const opacity = Math.max(0.12, Math.min(0.85, this.displaySettings.cursorSnapOpacity || 0.42));
    const sizeFactor = Math.max(0.35, Math.min(1, this.displaySettings.cursorSnapSize || 0.62));
    const radius = Math.max(4, Math.min(9, systemPx * 0.24 * sizeFactor));

    c.save();
    if (pointer && Math.hypot(pointer.x - sp.x, pointer.y - sp.y) > 3) {
      c.strokeStyle = active
        ? "rgba(46,204,113," + Math.min(0.36, opacity * 0.55) + ")"
        : "rgba(116,185,255," + Math.min(0.28, opacity * 0.45) + ")";
      c.lineWidth = 1;
      c.setLineDash([2, 5]);
      c.beginPath();
      c.moveTo(pointer.x, pointer.y);
      c.lineTo(sp.x, sp.y);
      c.stroke();
      c.setLineDash([]);
    }

    c.shadowColor = color;
    c.shadowBlur = active ? 6 * sizeFactor : 4 * sizeFactor;
    c.strokeStyle = active
      ? "rgba(46,204,113," + Math.min(0.82, opacity + 0.18) + ")"
      : "rgba(116,185,255," + Math.min(0.72, opacity + 0.12) + ")";
    c.fillStyle = active
      ? "rgba(46,204,113," + Math.min(0.18, opacity * 0.32) + ")"
      : "rgba(116,185,255," + Math.min(0.14, opacity * 0.28) + ")";
    c.lineWidth = 1.25;
    c.beginPath();
    c.arc(sp.x, sp.y, radius, 0, Math.PI * 2);
    c.fill();
    c.stroke();

    c.shadowBlur = 0;
    c.strokeStyle = "rgba(255,255,255," + Math.min(0.66, opacity + 0.12) + ")";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(sp.x - radius - 3, sp.y);
    c.lineTo(sp.x - 2, sp.y);
    c.moveTo(sp.x + 2, sp.y);
    c.lineTo(sp.x + radius + 3, sp.y);
    c.moveTo(sp.x, sp.y - radius - 3);
    c.lineTo(sp.x, sp.y - 2);
    c.moveTo(sp.x, sp.y + 2);
    c.lineTo(sp.x, sp.y + radius + 3);
    c.stroke();

    c.fillStyle = active ? "#2ecc71" : "#74b9ff";
    c.beginPath();
    const dot = Math.max(2.5, radius * 0.42);
    c.moveTo(sp.x, sp.y - dot);
    c.lineTo(sp.x + dot, sp.y);
    c.lineTo(sp.x, sp.y + dot);
    c.lineTo(sp.x - dot, sp.y);
    c.closePath();
    c.fill();

    if (this.displaySettings.cursorSnapLabel && systemPx >= 7) {
      const coord = "[" + point.sx + ":" + point.sy + ":" + (point.z || 0) + "]";
      this._drawBadge(sp.x + radius + 6, sp.y - 9, coord, {
        fontSize: 8,
        fill: "rgba(5,9,14," + Math.min(0.78, opacity + 0.28) + ")",
        stroke: active
          ? "rgba(46,204,113," + Math.min(0.48, opacity + 0.08) + ")"
          : "rgba(116,185,255," + Math.min(0.42, opacity + 0.06) + ")",
        color: "rgba(255,255,255,0.86)",
        bold: true,
      });
    }
    c.restore();
  }

  drawCursorPreview() {
    const point = this.cursorPoint || this.ghostPos;
    if (!point) return;
    const active =
      this.planningMode ||
      this.chainMode ||
      this.placementMode ||
      this.pendingMoveObj ||
      this.pendingPlanMoveId;
    if (!active) return;

    const c = this.ctx;
    const sp = this.worldToScreen(point.wx, point.wy);
    const planItem = this.pendingPlanMoveId
      ? this.planStations.find((st) => st.id === this.pendingPlanMoveId)
      : null;
    const level = planItem
      ? planItem.level
        : this.pendingMoveObj
          ? this.pendingMoveObj.level || this.placementLevel
        : this.planningMode || this.chainMode
          ? this.planLevel
          : this.placementLevel;
    const radius = this._planRadius(level);
    const r = radius * this.scale;

    c.save();
    c.strokeStyle = this.pendingMoveObj ? "#ff7675" : "#2ecc71";
    c.fillStyle = this.pendingMoveObj
      ? "rgba(255,118,117,0.12)"
      : "rgba(46,204,113,0.12)";
    if (r >= 4) {
      c.setLineDash([6, 4]);
      c.beginPath();
      c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.setLineDash([]);
    }

    c.strokeStyle = "rgba(255,255,255,0.8)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(sp.x - 12, sp.y);
    c.lineTo(sp.x + 12, sp.y);
    c.stroke();
    c.beginPath();
    c.moveTo(sp.x, sp.y - 12);
    c.lineTo(sp.x, sp.y + 12);
    c.stroke();

    c.fillStyle = "#fff";
    c.font = "bold 12px sans-serif";
    c.textAlign = "center";
    c.fillText("[" + point.sx + ":" + point.sy + ":0]", sp.x, sp.y - 18);
    c.font = "11px sans-serif";
    c.fillText(level + " ур / " + radius + " укм", sp.x, sp.y + 24);
    c.restore();
  }

  _updateCoordHud(point, modeText) {
    const el = document.getElementById("map-coord-hud");
    if (!el || !point) return;
    const parts = ["[" + point.sx + ":" + point.sy + ":0]"];
    if (modeText) parts.push(modeText);
    parts.push("привязка к системе");
    el.textContent = parts.join(" · ");
    el.style.display = "block";
  }

  _clearCoordHud() {
    const el = document.getElementById("map-coord-hud");
    if (el) el.style.display = "none";
  }

  drawPlanSuggestions() {
    if (!this.planSuggestions.length) return;
    const c = this.ctx;
    c.save();
    for (const item of this.planSuggestions) {
      const sp = this.worldToScreen(item.wx, item.wy);
      if (
        sp.x < -40 ||
        sp.x > this.canvas.width + 40 ||
        sp.y < -40 ||
        sp.y > this.canvas.height + 40
      )
        continue;
      const radius =
        item.radius || this._planRadius(item.level || this.planLevel);
      const r = radius * this.scale;
      if (r >= 4) {
        c.strokeStyle = "rgba(241,196,15,0.45)";
        c.lineWidth = 1;
        c.setLineDash([3, 4]);
        c.beginPath();
        c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      }
      c.fillStyle = "#f1c40f";
      c.strokeStyle = "rgba(0,0,0,0.7)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(sp.x, sp.y - 8);
      c.lineTo(sp.x + 8, sp.y);
      c.lineTo(sp.x, sp.y + 8);
      c.lineTo(sp.x - 8, sp.y);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = "#fff";
      c.font = "10px sans-serif";
      c.textAlign = "center";
      c.fillText(
        "+" + (item.uncovered_players || item.covered_players || 0),
        sp.x,
        sp.y - 12,
      );
    }
    c.restore();
  }

  drawEvaluatedPoint() {
    if (!this.evaluatedPoint) return;
    const c = this.ctx;
    const sp = this.worldToScreen(
      this.evaluatedPoint.wx,
      this.evaluatedPoint.wy,
    );
    if (
      sp.x < -40 ||
      sp.x > this.canvas.width + 40 ||
      sp.y < -40 ||
      sp.y > this.canvas.height + 40
    )
      return;
    c.save();
    c.strokeStyle = "#74b9ff";
    c.fillStyle = "rgba(116,185,255,0.25)";
    c.lineWidth = 2;
    c.setLineDash([4, 4]);
    c.beginPath();
    c.arc(sp.x, sp.y, 16, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = "#74b9ff";
    c.beginPath();
    c.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  drawUncoveredPoints() {
    if (!this.uncoveredPoints.length) return;
    const c = this.ctx;
    c.save();
    for (const item of this.uncoveredPoints) {
      const sp = this.worldToScreen(item.wx, item.wy);
      if (
        sp.x < -20 ||
        sp.x > this.canvas.width + 20 ||
        sp.y < -20 ||
        sp.y > this.canvas.height + 20
      )
        continue;
      c.fillStyle = "rgba(231,76,60,0.95)";
      c.strokeStyle = "rgba(255,255,255,0.75)";
      c.lineWidth = 1;
      c.beginPath();
      c.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    c.restore();
  }

  findSuggestionAt(sx, sy) {
    let best = null,
      bestDist = 16;
    for (const item of this.planSuggestions) {
      const sp = this.worldToScreen(item.wx, item.wy);
      const d = Math.hypot(sp.x - sx, sp.y - sy);
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  _optimizerTargetsParam() {
    const values = Array.from(document.querySelectorAll(".optimizer-target"))
      .filter((el) => el.checked)
      .map((el) => el.value);
    return values.length
      ? values.join(",")
      : "players,accounts,ops,gate,dunya,moon";
  }

  _optimizerScenario() {
    const el = document.getElementById("optimizer-scenario");
    return el ? el.value : "max_coverage";
  }

  async loadPlanSuggestions() {
    const level = this.planLevel || 10;
    const params = new URLSearchParams({
      level: String(level),
      targets: this._optimizerTargetsParam(),
      scenario: this._optimizerScenario(),
    });
    const resp = await fetch("/map/api/plan?" + params.toString());
    if (!resp.ok) {
      alert("Не удалось загрузить предложения планировщика");
      return;
    }
    const data = await resp.json();
    this.planSuggestions = (data.suggestions || []).slice(0, 30);
    this.uncoveredPoints =
      (data.coverage && data.coverage.uncovered_points) || [];
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
    this.addPlanStation({
      sx: item.x,
      sy: item.y,
      wx: item.wx,
      wy: item.wy,
      level: item.level || this.planLevel,
      name: item.name || "Оптимум " + (item.level || this.planLevel) + " ур",
      comment: item.reason || "score " + (item.score || 0),
    });
  }

  _updateSuggestionsPanel() {
    const el = document.getElementById("suggestions-list");
    if (!el) return;
    if (!this.planSuggestions.length) {
      el.innerHTML =
        '<div class="text-muted small">Нет загруженных предложений</div>';
      return;
    }
    el.innerHTML = this.planSuggestions
      .slice(0, 12)
      .map((item, idx) => {
        const gain = item.uncovered_players || item.covered_players || 0;
        return (
          '<div class="suggestion-row border-bottom border-secondary py-1" data-idx="' +
          idx +
          '" style="cursor:pointer;">' +
          "<div><strong>#" +
          (idx + 1) +
          "</strong> [" +
          item.x +
          ":" +
          item.y +
          ":0] " +
          item.level +
          " ур</div>" +
          '<div class="text-muted">новых ' +
          gain +
          ", всего " +
          (item.covered_players || 0) +
          ", score " +
          item.score +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    el.querySelectorAll(".suggestion-row").forEach((row) => {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest(".coord-link")) return;
        const item = this.planSuggestions[parseInt(row.dataset.idx)];
        if (!item) return;
        this.centerOn(item.wx, item.wy);
        this.addSuggestionToPlan(item);
      });
    });
  }

  async loadIntelFacts() {
    const resp = await fetch("/map/api/intel");
    if (!resp.ok) {
      alert("Не удалось загрузить данные из заметок");
      return;
    }
    const data = await resp.json();
    this.intelFacts = data.facts || [];
    this._updateIntelPanel(data.summary || {});
    this.render();
  }

  async loadPlanDraft() {
    try {
      const resp = await fetch("/map/api/planned-stations");
      if (!resp.ok) return;
      const data = await resp.json();
      const stations = data.stations || [];
      if (!stations.length) {
        this._updatePlanPanel();
        return;
      }
      this.planStations = stations.map((st) => {
        const item = {
          id: st.id || this.nextPlanId++,
          name: st.name || "План " + (st.id || this.nextPlanId),
          x: st.x,
          y: st.y,
          z: st.z || 0,
          wx: st.wx,
          wy: st.wy,
          level: st.level || 10,
          radius: st.radius || this._planRadius(st.level || 10),
          status: st.status || "План",
          comment: st.comment || "",
          locked: Boolean(st.locked),
        };
        Object.assign(item, this._estimatePlanStation(item));
        return item;
      });
      this.nextPlanId = Math.max(
        this.nextPlanId,
        ...this.planStations.map((st) => st.id + 1),
      );
      this.selectedPlanId = this.planStations[0].id;
      this._updatePlanPanel();
      this.render();
    } catch (e) {
      console.warn("Plan draft load failed", e);
    }
  }

  savePlanDraftDebounced() {
    clearTimeout(this._planDraftSaveTimer);
    this._planDraftSaveTimer = setTimeout(() => this.savePlanDraft(), 450);
  }

  async savePlanDraft() {
    try {
      await fetch("/map/api/planned-stations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stations: this.planStations }),
      });
    } catch (e) {
      console.warn("Plan draft save failed", e);
    }
  }

  async loadOptimizedPlan() {
    const levelsInput = document.getElementById("optimizer-levels");
    const countInput = document.getElementById("optimizer-count");
    const levels = levelsInput ? levelsInput.value : "6,8,10,12";
    const count = countInput ? countInput.value : "5";
    const params = new URLSearchParams({
      levels: levels,
      count: count,
      limit: "8",
      targets: this._optimizerTargetsParam(),
      scenario: this._optimizerScenario(),
    });
    const resp = await fetch("/map/api/optimize?" + params.toString());
    if (!resp.ok) {
      alert("Не удалось рассчитать оптимальные координаты");
      return;
    }
    const data = await resp.json();
    this.optimizeResults = {
      byLevel: data.by_level || [],
      network: data.network || [],
    };
    this.uncoveredPoints =
      (data.coverage && data.coverage.uncovered_points) || [];
    this.planSuggestions = this.optimizeResults.network.slice();
    this._updateOptimizerPanel(data.coverage || {});
    this._updateSuggestionsPanel();
    this.render();
  }

  optimizeOwnedStations() {
    const levelInput = document.getElementById("owned-station-level");
    const countInput = document.getElementById("owned-station-count");
    const levelsInput = document.getElementById("optimizer-levels");
    const optimizerCount = document.getElementById("optimizer-count");
    const scenario = document.getElementById("optimizer-scenario");

    const level = Math.max(
      1,
      Math.min(20, parseInt(levelInput ? levelInput.value : "8") || 8),
    );
    const count = Math.max(
      1,
      Math.min(12, parseInt(countInput ? countInput.value : "1") || 1),
    );
    if (levelInput) levelInput.value = level;
    if (countInput) countInput.value = count;
    if (levelsInput) levelsInput.value = String(level);
    if (optimizerCount) optimizerCount.value = String(count);
    if (scenario) scenario.value = "max_coverage";
    this.optimizerHint =
      "Расчет для имеющихся станций: " + count + " шт. " + level + " ур";
    this.loadOptimizedPlan();
  }

  _updateOptimizerPanel(coverage = {}) {
    const summary = document.getElementById("optimizer-summary");
    const list = document.getElementById("optimizer-list");
    const networkBtn = document.getElementById("btn-plan-add-network");
    if (summary) {
      summary.textContent =
        "Сейчас покрыто " +
        (coverage.covered || 0) +
        "/" +
        (coverage.targets || 0) +
        ", не покрыто " +
        (coverage.uncovered || 0) +
        (this.optimizerHint ? ". " + this.optimizerHint : "");
    }
    if (networkBtn) networkBtn.disabled = !this.optimizeResults.network.length;
    if (!list) return;
    if (
      !this.optimizeResults.byLevel.length &&
      !this.optimizeResults.network.length
    ) {
      list.innerHTML =
        '<div class="text-muted small">Запросите расчет для нужных уровней</div>';
      return;
    }

    let html = "";
    if (this.optimizeResults.network.length) {
      html += '<div class="small text-success mb-1">Лучший набор сети</div>';
      html += this.optimizeResults.network
        .map(
          (item, idx) =>
            '<div class="optimizer-row border-bottom border-secondary py-1" data-kind="network" data-idx="' +
            idx +
            '" style="cursor:pointer;">' +
            "<strong>#" +
            (idx + 1) +
            "</strong> [" +
            item.x +
            ":" +
            item.y +
            ":0] " +
            item.level +
            " ур" +
            '<div class="text-muted">' +
            this._escapeHtml(item.reason || "") +
            ", score " +
            item.score +
            "</div>" +
            "</div>",
        )
        .join("");
    }
    for (const group of this.optimizeResults.byLevel) {
      const top = (group.suggestions || []).slice(0, 3);
      if (!top.length) continue;
      html +=
        '<div class="small text-muted mt-2">Уровень ' +
        group.level +
        " · радиус " +
        group.radius +
        "</div>";
      html += top
        .map(
          (item, idx) =>
            '<div class="optimizer-row border-bottom border-secondary py-1" data-kind="level" data-level="' +
            group.level +
            '" data-idx="' +
            idx +
            '" style="cursor:pointer;">' +
            "[" +
            item.x +
            ":" +
            item.y +
            ":0] новых " +
            (item.uncovered_players || 0) +
            '<div class="text-muted">всего ' +
            (item.covered_players || 0) +
            ", score " +
            item.score +
            "</div>" +
            "</div>",
        )
        .join("");
    }
    list.innerHTML =
      html ||
      '<div class="text-muted small">Подходящих вариантов не найдено</div>';
    list.querySelectorAll(".optimizer-row").forEach((row) => {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest(".coord-link")) return;
        const item = this._optimizerItemFromRow(row);
        if (!item) return;
        this.centerOn(item.wx, item.wy);
        this.addSuggestionToPlan(item);
      });
    });
  }

  _optimizerItemFromRow(row) {
    if (row.dataset.kind === "network") {
      return this.optimizeResults.network[parseInt(row.dataset.idx)];
    }
    const group = this.optimizeResults.byLevel.find(
      (item) => String(item.level) === row.dataset.level,
    );
    return group && group.suggestions
      ? group.suggestions[parseInt(row.dataset.idx)]
      : null;
  }

  addOptimizedNetworkToPlan() {
    for (const item of this.optimizeResults.network) {
      this.addSuggestionToPlan(item);
    }
  }

  async evaluatePoint(point) {
    if (!point) return;
    const levelsInput = document.getElementById("optimizer-levels");
    const levels = levelsInput
      ? levelsInput.value
      : "1,2,3,4,5,6,7,8,9,10,11,12";
    const params = new URLSearchParams({
      x: String(point.sx || point.x),
      y: String(point.sy || point.y),
      z: String(point.z || 0),
      levels: levels,
      targets: this._optimizerTargetsParam(),
    });
    const resp = await fetch("/map/api/evaluate?" + params.toString());
    if (!resp.ok) {
      alert("Не удалось проверить точку");
      return;
    }
    const data = await resp.json();
    this.evaluatedPoint = point;
    this.pointEvaluation = data;
    this._updatePointEvaluationPanel();
    this.render();
  }

  _updatePointEvaluationPanel() {
    const panel = document.getElementById("point-eval-panel");
    const summary = document.getElementById("point-eval-summary");
    const list = document.getElementById("point-eval-list");
    if (!panel || !summary || !list) return;
    if (!this.pointEvaluation || !this.evaluatedPoint) {
      panel.style.display = "none";
      return;
    }
    const p = this.pointEvaluation.point || this.evaluatedPoint;
    const levels = this.pointEvaluation.levels || [];
    panel.style.display = "block";
    summary.textContent =
      "[" +
      p.x +
      ":" +
      p.y +
      ":" +
      (p.z || 0) +
      "] · целей " +
      ((this.pointEvaluation.coverage &&
        this.pointEvaluation.coverage.targets) ||
        0) +
      ", вес сети " +
      ((this.pointEvaluation.coverage &&
        this.pointEvaluation.coverage.weight_covered) ||
        0) +
      "/" +
      ((this.pointEvaluation.coverage &&
        this.pointEvaluation.coverage.weight_total) ||
        0);
    if (!levels.length) {
      list.innerHTML =
        '<div class="text-muted small">Нет подходящих уровней</div>';
      return;
    }
    list.innerHTML = levels
      .slice(0, 12)
      .map(
        (item, idx) =>
          '<div class="point-eval-row border-bottom border-secondary py-1" data-idx="' +
          idx +
          '" style="cursor:pointer;">' +
          "<div><strong>" +
          item.level +
          " ур</strong> · радиус " +
          item.radius +
          " укм · score " +
          item.score +
          "</div>" +
          '<div class="text-muted">новых ' +
          item.new_targets +
          ", вес +" +
          item.new_weight +
          ", всего " +
          item.covered_targets +
          ", эффективность " +
          item.efficiency +
          "</div>" +
          "</div>",
      )
      .join("");
    list.querySelectorAll(".point-eval-row").forEach((row) => {
      row.addEventListener("click", () => {
        const item = levels[parseInt(row.dataset.idx)];
        if (!item) return;
        this.addEvaluationLevelToPlan(item);
      });
    });
  }

  addBestEvaluationToPlan() {
    const levels =
      this.pointEvaluation && this.pointEvaluation.levels
        ? this.pointEvaluation.levels
        : [];
    if (!levels.length) return;
    this.addEvaluationLevelToPlan(levels[0]);
  }

  addEvaluationLevelToPlan(levelItem) {
    if (!this.evaluatedPoint || !levelItem) return;
    this.addPlanStation({
      sx: this.evaluatedPoint.sx || this.evaluatedPoint.x,
      sy: this.evaluatedPoint.sy || this.evaluatedPoint.y,
      wx: this.evaluatedPoint.wx,
      wy: this.evaluatedPoint.wy,
      level: levelItem.level,
      name: "План " + levelItem.level + " ур",
      comment:
        "Калькулятор точки: новых " +
        levelItem.new_targets +
        ", вес +" +
        levelItem.new_weight +
        ", score " +
        levelItem.score,
    });
    this.clearPointEvaluation();
  }

  clearPointEvaluation(options = {}) {
    this.pointEvaluation = null;
    this.evaluatedPoint = null;
    this._updatePointEvaluationPanel();
    if (options.render !== false) this.render();
  }

  drawIntelFacts() {
    if (!this.intelFacts.length) return;
    const c = this.ctx;
    c.save();
    for (const item of this.intelFacts) {
      if (item.status === "found") continue;
      const sp = this._intelToScreen(item);
      if (
        sp.x < -30 ||
        sp.x > this.canvas.width + 30 ||
        sp.y < -30 ||
        sp.y > this.canvas.height + 30
      )
        continue;
      const color =
        item.kind === "alstation"
          ? "#2ecc71"
          : item.kind === "ops"
            ? "#f39c12"
            : "#74b9ff";
      c.strokeStyle = color;
      c.fillStyle = color;
      c.lineWidth = 2;
      c.setLineDash([5, 4]);
      c.beginPath();
      c.arc(sp.x, sp.y, item.kind === "alstation" ? 13 : 10, 0, Math.PI * 2);
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
    const el = document.getElementById("intel-list");
    const sum = document.getElementById("intel-summary");
    if (sum) {
      sum.textContent =
        "Найдено: " +
        (summary.total || this.intelFacts.length) +
        ", отсутствует: " +
        (summary.missing || 0) +
        ", уже есть: " +
        (summary.found || 0);
    }
    if (!el) return;
    if (!this.intelFacts.length) {
      el.innerHTML =
        '<div class="text-muted small">Нет загруженных данных</div>';
      return;
    }
    const labels = {
      alstation: "Алстанция",
      ops: "ОПС",
      gate: "Врата",
      dunya: "Дуня",
      moon: "Луна",
    };
    el.innerHTML = this.intelFacts
      .slice(0, 24)
      .map((item, idx) => {
        const found = item.status === "found";
        const level = item.level ? " · " + item.level + " ур" : "";
        const action =
          item.kind === "alstation" && !found
            ? '<button class="btn btn-sm btn-outline-success intel-plan-btn" data-idx="' +
              idx +
              '" title="Добавить в план"><i class="bi bi-plus-lg"></i></button>'
            : "";
        return (
          '<div class="intel-row border-bottom border-secondary py-1" data-idx="' +
          idx +
          '" style="cursor:pointer;">' +
          '<div class="d-flex align-items-center gap-1">' +
          '<span class="' +
          (found ? "text-success" : "text-warning") +
          '">' +
          (found ? "✓" : "!") +
          "</span>" +
          "<strong>" +
          (labels[item.kind] || item.kind) +
          "</strong>" +
          "<span>[" +
          item.x +
          ":" +
          item.y +
          ":" +
          (item.z || 0) +
          "]" +
          level +
          "</span>" +
          '<span class="ms-auto">' +
          action +
          "</span>" +
          "</div>" +
          '<div class="text-muted">' +
          this._escapeHtml(item.player || "") +
          " · " +
          this._escapeHtml(item.snippet || "") +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    el.querySelectorAll(".intel-row").forEach((row) => {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest(".coord-link")) return;
        const item = this.intelFacts[parseInt(row.dataset.idx)];
        if (!item) return;
        if (ev.target.closest(".intel-plan-btn")) {
          this.addIntelFactToPlan(item);
          return;
        }
        this.centerOn(item.wx, item.wy);
      });
    });
  }

  addIntelFactToPlan(item) {
    if (!item || item.kind !== "alstation") return;
    if (item.level) {
      this.planLevel = item.level;
      const input = document.getElementById("plan-level");
      if (input) input.value = item.level;
      const val = document.getElementById("plan-level-val");
      const radius = document.getElementById("plan-radius-val");
      if (val) val.textContent = item.level;
      if (radius) radius.textContent = this._planRadius(item.level);
    }
    this.addPlanStation({
      sx: item.x,
      sy: item.y,
      wx: item.wx,
      wy: item.wy,
      level: item.level || this.planLevel,
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
        y: sp.y + Math.sin(angle) * r,
      };
      return visualOffset
        ? this._applyStackOffset(obj, planetPoint)
        : planetPoint;
    }
    return visualOffset ? this._applyStackOffset(obj, sp) : sp;
  }

  _applyStackOffset(obj, sp) {
    if (!obj || obj.type !== "object") return sp;
    const group = this.objects
      .filter(
        (o) =>
          o.type === "object" &&
          this._isVisible(o) &&
          o.x === obj.x &&
          o.y === obj.y &&
          Number(o.z || 0) === Number(obj.z || 0),
      )
      .sort((a, b) => {
        const at = (a.subtype || "") + ":" + (a.id || 0) + ":" + (a.name || "");
        const bt = (b.subtype || "") + ":" + (b.id || 0) + ":" + (b.name || "");
        return at.localeCompare(bt);
      });
    if (group.length <= 1) return sp;
    const idx = group.findIndex(
      (o) => o === obj || (o.id && obj.id && o.id === obj.id),
    );
    if (idx < 0) return sp;
    const ring = Math.min(16, 9 + group.length * 1.5);
    const angle = -Math.PI / 2 + (Math.PI * 2 * idx) / group.length;
    return {
      x: sp.x + Math.cos(angle) * ring,
      y: sp.y + Math.sin(angle) * ring,
    };
  }

  _updateStatus() {
    const el = document.getElementById("map-status");
    if (!el) return;
    const count = this.meta.objects_count || this.objects.length;
    const legacy = this.meta.legacy_coordinates_count || 0;
    const outside = this.meta.out_of_area_count || 0;
    el.textContent =
      "Objects: " +
      count +
      ". Legacy skipped: " +
      legacy +
      ". Outside area: " +
      outside +
      ".";
  }

  drawObjects() {
    const c = this.ctx;
    for (const obj of this.objects) {
      if (!this._isVisible(obj)) continue;
      const sp = this._objectToScreen(obj);
      if (
        sp.x < -20 ||
        sp.x > this.canvas.width + 20 ||
        sp.y < -20 ||
        sp.y > this.canvas.height + 20
      )
        continue;

      const style = this._getStyle(obj);
      const hl = this.highlightedObj === obj;
      const sz = style.size * (hl ? 1.5 : 1);

      c.save();
      if (hl) {
        c.shadowColor = "#fff";
        c.shadowBlur = 10;
      }
      c.fillStyle = style.color;
      c.strokeStyle = hl ? "#fff" : "rgba(0,0,0,0.3)";
      c.lineWidth = hl ? 2 : 1;

      if (style.shape === "circle") {
        c.beginPath();
        c.arc(sp.x, sp.y, sz, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      } else if (style.shape === "diamond") {
        c.beginPath();
        c.moveTo(sp.x, sp.y - sz);
        c.lineTo(sp.x + sz, sp.y);
        c.lineTo(sp.x, sp.y + sz);
        c.lineTo(sp.x - sz, sp.y);
        c.closePath();
        c.fill();
        c.stroke();
      } else if (style.shape === "square") {
        c.fillRect(sp.x - sz / 2, sp.y - sz / 2, sz, sz);
        c.strokeRect(sp.x - sz / 2, sp.y - sz / 2, sz, sz);
      } else if (style.shape === "triangle") {
        c.beginPath();
        c.moveTo(sp.x, sp.y - sz);
        c.lineTo(sp.x + sz, sp.y + sz);
        c.lineTo(sp.x - sz, sp.y + sz);
        c.closePath();
        c.fill();
        c.stroke();
      } else if (style.shape === "star") {
        this._drawStar(sp.x, sp.y, 5, sz, sz / 2);
        c.fill();
        c.stroke();
      }

      this._drawObjectBadges(obj, sp, style, sz);

      // Label
      if (this.scale > 0.4 && obj.name) {
        c.fillStyle = "rgba(255,255,255,0.8)";
        c.font = "9px sans-serif";
        c.textAlign = "center";
        c.fillText(obj.name, sp.x, sp.y + sz + 12);
        c.textAlign = "left";
      }
      c.restore();
    }
  }

  _drawStar(cx, cy, spikes, outer, inner) {
    const c = this.ctx;
    let rot = -Math.PI / 2,
      step = Math.PI / spikes;
    c.beginPath();
    c.moveTo(cx, cy - outer);
    for (let i = 0; i < spikes; i++) {
      c.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
      rot += step;
      c.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
      rot += step;
    }
    c.closePath();
  }

  _getStyle(obj) {
    const sz = 8;
    if (obj.type === "capital")
      return { shape: "circle", color: "#ecf0f1", size: 10 };
    if (obj.type === "account") {
      if (obj.race === "Жук")
        return { shape: "circle", color: "#27ae60", size: sz };
      if (obj.race === "Терран")
        return { shape: "circle", color: "#2980b9", size: sz };
      if (obj.race === "Тосс")
        return { shape: "circle", color: "#8e44ad", size: sz };
      return { shape: "circle", color: "#95a5a6", size: sz };
    }
    if (obj.type === "object") {
      const s = obj.subtype || "";
      if (s.includes("ОПС"))
        return { shape: "square", color: "#e67e22", size: 6 };
      if (s.includes("Алстанц"))
        return {
          shape: "diamond",
          color:
            obj.network_connected === false ||
            obj.network_status === "signal_only" ||
            obj.network_status === "isolated"
              ? "#ff7675"
              : "#e74c3c",
          size: 10,
        };
      if (s.includes("Дуня"))
        return { shape: "triangle", color: "#f39c12", size: 6 };
      if (s.includes("Луна"))
        return { shape: "circle", color: "#95a5a6", size: 6 };
      if (s.includes("Врата"))
        return { shape: "star", color: "#9b59b6", size: 8 };
    }
    return { shape: "circle", color: "#bdc3c7", size: 6 };
  }

  _isVisible(obj) {
    if (obj.type === "capital" || obj.type === "account") {
      if (obj.race === "Терран" && !this.filters["filter-terran"]) return false;
      if (obj.race === "Жук" && !this.filters["filter-zerg"]) return false;
      if (obj.race === "Тосс" && !this.filters["filter-toss"]) return false;
    }
    if (obj.type === "object") {
      const s = obj.subtype || "";
      if (s.includes("ОПС") && !this.filters["filter-ops"]) return false;
      if (s.includes("Алстанц") && !this.filters["filter-alstation"])
        return false;
      if (s.includes("Дуня") && !this.filters["filter-dunya"]) return false;
      if (s.includes("Луна") && !this.filters["filter-luna"]) return false;
      if (s.includes("Врата") && !this.filters["filter-vrata"]) return false;
    }
    return true;
  }

  findObjectAt(sx, sy) {
    let best = null,
      bestDist = 20;
    for (const obj of this.objects) {
      if (!this._isVisible(obj)) continue;
      const sp = this._objectToScreen(obj);
      const d = Math.hypot(sp.x - sx, sp.y - sy);
      if (d < bestDist) {
        bestDist = d;
        best = obj;
      }
    }
    return best;
  }

  showTooltip(obj, sx, sy) {
    if (!this.tooltip) return;
    let html = `<div class="tooltip-title">${obj.name || obj.nick || "Объект"}</div>`;
    if (obj.race)
      html += `<span class="tooltip-race" style="background:${this._getStyle(obj).color}">${obj.race}</span>`;
    html += `<div style="margin-top:4px;font-size:11px;">Координаты: ${obj.x}:${obj.y}:${obj.z || 0}</div>`;
    if (obj.points) html += `<div>Очки: ${obj.points.toLocaleString()}</div>`;
    if (obj.level) html += `<div>Уровень: ${obj.level}</div>`;
    if (obj.radius)
      html += `<div>Радиус: ${obj.radius.toLocaleString()} укм</div>`;
    if (this._isAlstation(obj)) {
      const mobility = this._stationMobility(obj);
      html += `<div>Тип: ${
        mobility === "mobile" ? "перемещаемая" : "стационарная"
      }</div>`;
      const status =
        obj.network_status === "main"
          ? "главная сеть"
          : obj.network_connected
            ? "общая сеть"
            : obj.network_status === "signal_only"
              ? "автономный сигнал, не сеть"
              : "вне общей сети";
      html += `<div>Связь: ${status}</div>`;
    }
    if (obj.url)
      html += `<div><a href="${obj.url}" style="color:#6c5ce7;">Открыть →</a></div>`;
    this.tooltip.innerHTML = html;
    this.tooltip.style.display = "block";
    this.tooltip.style.left = sx + 15 + "px";
    this.tooltip.style.top = sy - 10 + "px";
  }

  hideTooltip() {
    if (this.tooltip) this.tooltip.style.display = "none";
  }

  _onWheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    this.lastPointerScreen = { x: mx, y: my };
    const wb = this.screenToWorld(mx, my);
    this.scale *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.scale = Math.max(0.0002, Math.min(20, this.scale));
    const wa = this.screenToWorld(mx, my);
    this.offsetX += (wa.x - wb.x) * this.scale;
    this.offsetY += -(wa.y - wb.y) * this.scale;
    this.render();
  }

  _isTypingTarget(target) {
    if (!target) return false;
    const tag = (target.tagName || "").toLowerCase();
    return (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      target.isContentEditable
    );
  }

  _currentActionPoint() {
    if (this.ghostPos) return this.ghostPos;
    if (this.cursorPoint) return this.cursorPoint;
    return this._systemPointFromScreen(
      this.canvas.width / 2,
      this.canvas.height / 2,
    );
  }

  _confirmCurrentMapAction() {
    const point = this._currentActionPoint();
    if (!point) return false;
    if (this.pendingMoveObj) {
      this.moveSelectedObjectToPoint(point);
      return true;
    }
    if (this.pendingPlanMoveId) {
      this.moveSelectedPlanToPoint(point);
      return true;
    }
    if (this.planningMode) {
      this.addPlanStation(point);
      return true;
    }
    if (this.chainMode) {
      this.buildChainToPoint(point);
      return true;
    }
    if (this.placementMode) {
      this.ghostPos = point;
      this._onPlacementClick(0, 0);
      return true;
    }
    return false;
  }

  cancelActiveCommand() {
    const hadMode =
      this.pendingMoveObj ||
      this.pendingPlanMoveId ||
      this.placementMode ||
      this.planningMode ||
      this.chainMode ||
      this.draggingPlanId;
    const hadEvaluation = Boolean(this.evaluatedPoint);
    if (this.draggingPlanId) {
      if (this.planDragOriginal) {
        const item = this.planStations.find(
          (st) => st.id === this.planDragOriginal.id,
        );
        if (item) {
          item.x = this.planDragOriginal.x;
          item.y = this.planDragOriginal.y;
          item.z = this.planDragOriginal.z;
          item.wx = this.planDragOriginal.wx;
          item.wy = this.planDragOriginal.wy;
          Object.assign(item, this._estimatePlanStation(item));
        }
      }
      this.draggingPlanId = null;
      this.planDragMoved = false;
      this.planDragOriginal = null;
    }
    this.pendingMoveObj = null;
    this.moveClickArmed = false;
    this.pendingPlanMoveId = null;
    if (this.placementMode) this.togglePlacementMode();
    if (this.planningMode) this.togglePlanningMode();
    if (this.chainMode) this.toggleChainMode(false);
    this.ghostPos = null;
    this.cursorPoint = null;
    this.canvas.style.cursor = "grab";
    this.hideContextMenu();
    this.pointEvaluation = null;
    this.evaluatedPoint = null;
    this._updatePointEvaluationPanel();
    this._clearCoordHud();
    this._updateActionHud();
    this.render();
    return Boolean(hadMode || hadEvaluation);
  }

  _onAuxClick(e) {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    this.cancelActiveCommand();
  }

  _onKeyDown(e) {
    if (this._isTypingTarget(e.target)) return;
    const key = e.key;
    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "z") {
      e.preventDefault();
      this.undoLastAction();
      return;
    }
    if (key === "Escape") {
      e.preventDefault();
      this.cancelActiveCommand();
      return;
    }
    if (key === "Enter" || key === " ") {
      if (this._confirmCurrentMapAction()) {
        e.preventDefault();
      }
      return;
    }
    if (
      (key === "+" || key === "=" || key === "NumpadAdd") &&
      (this.planningMode || this.chainMode || this.selectedPlanId)
    ) {
      e.preventDefault();
      this.setPlanLevel((this.planLevel || 10) + 1);
      return;
    }
    if (
      (key === "-" || key === "_" || key === "NumpadSubtract") &&
      (this.planningMode || this.chainMode || this.selectedPlanId)
    ) {
      e.preventDefault();
      this.setPlanLevel((this.planLevel || 10) - 1);
      return;
    }
    if (
      (key === "Delete" || key === "Backspace") &&
      this.selectedPlanId &&
      !this._isTypingTarget(e.target)
    ) {
      e.preventDefault();
      this.removeSelectedPlanStation();
      return;
    }
    if (
      (key === "l" || key === "L" || key === "д" || key === "Д") &&
      this.selectedPlanId
    ) {
      e.preventDefault();
      this.togglePlanLock(this.selectedPlanId);
      return;
    }
    if (
      (key === "m" || key === "M" || key === "ь" || key === "Ь") &&
      this.selectedPlanId
    ) {
      const item = this.planStations.find(
        (st) => st.id === this.selectedPlanId,
      );
      if (item && !item.locked) {
        e.preventDefault();
        this.startPlanMove(item);
      }
    }
  }

  _onMouseDown(e) {
    if (e.button === 1) {
      e.preventDefault();
      this.cancelActiveCommand();
      return;
    }
    if (e.button === 2) return;
    this.hideContextMenu();
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    if (this.pendingMoveObj) {
      this.moveClickArmed = true;
      const point = this._systemPointFromScreen(mx, my);
      this.ghostPos = point;
      this.cursorPoint = point;
      this._updateCoordHud(point, this._moveModeLabel());
      this.render();
      return;
    }
    const planObj = this.findPlanStationAt(mx, my);
    if (planObj) {
      if (planObj.locked) {
        this.selectedPlanId = planObj.id;
        this._updatePlanPanel();
        this.render();
        return;
      }
      this.draggingPlanId = planObj.id;
      this.selectedPlanId = planObj.id;
      this.planDragMoved = false;
      this.planDragOriginal = {
        id: planObj.id,
        x: planObj.x,
        y: planObj.y,
        z: planObj.z || 0,
        wx: planObj.wx,
        wy: planObj.wy,
      };
      this.pendingPlanMoveId = planObj.id;
      this.ghostPos = {
        sx: planObj.x,
        sy: planObj.y,
        wx: planObj.wx,
        wy: planObj.wy,
      };
      this.cursorPoint = this.ghostPos;
      this._updateCoordHud(this.cursorPoint, this._moveModeLabel());
      this.canvas.style.cursor = "grabbing";
      this._updatePlanPanel();
      this.render();
      return;
    }
    if (
      this.planningMode ||
      this.chainMode ||
      this.pendingMoveObj ||
      this.pendingPlanMoveId
    )
      return;
    this.isDragging = true;
    this._dragMoved = false;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this.canvas.style.cursor = "grabbing";
  }

  _onMouseMove(e) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;

    if (this.draggingPlanId) {
      const item = this.planStations.find(
        (st) => st.id === this.draggingPlanId,
      );
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
      const dx = e.clientX - this.lastMouseX,
        dy = e.clientY - this.lastMouseY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._dragMoved = true;
      this.offsetX += dx;
      this.offsetY += dy;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.render();
      return;
    }
    if (
      this.planningMode ||
      this.chainMode ||
      this.placementMode ||
      this.pendingMoveObj ||
      this.pendingPlanMoveId
    ) {
      const p = this._systemPointFromScreen(mx, my);
      this.ghostPos = p;
      this.cursorPoint = p;
      let modeText = "";
      if (this.pendingMoveObj) modeText = "перемещение объекта";
      else if (this.pendingPlanMoveId) modeText = "перемещение плана";
      else if (this.chainMode) modeText = "цель цепи алстанций";
      else if (this.planningMode) modeText = "плановая алстанция";
      else if (this.placementMode) modeText = "новый объект";
      this._updateCoordHud(p, modeText);
      this.canvas.style.cursor = "crosshair";
      this.render();
      return;
    }
    this.ghostPos = null;
    this.cursorPoint = this._systemPointFromScreen(mx, my);
    this._updateCoordHud(this.cursorPoint, "");
    const coordHit = this.findCoordHitAt(mx, my);
    const obj = this.findObjectAt(mx, my);
    const suggestionObj = this.findSuggestionAt(mx, my);
    if (coordHit) {
      this.highlightedObj = null;
      this.hideTooltip();
      this.canvas.style.cursor = "pointer";
    } else if (obj) {
      this.highlightedObj = obj;
      this.showTooltip(obj, mx, my);
      this.canvas.style.cursor = "pointer";
    } else if (suggestionObj) {
      this.highlightedObj = null;
      this.hideTooltip();
      this.canvas.style.cursor = "copy";
    } else {
      this.highlightedObj = null;
      this.hideTooltip();
      this.canvas.style.cursor = "grab";
    }
    this.render();
  }

  _onMouseUp(e) {
    if (e.button === 2) return;

    if (this.draggingPlanId) {
      const item = this.planStations.find(
        (st) => st.id === this.draggingPlanId,
      );
      if (this.planDragMoved && this.planDragOriginal) {
        const beforeStations = this.planStations.map((st) => {
          const clone = this._clonePlanStation(st);
          if (clone.id === this.planDragOriginal.id) {
            Object.assign(clone, this.planDragOriginal);
          }
          return clone;
        });
        this._pushUndo({
          type: "plan-snapshot",
          stations: beforeStations,
          selectedId: this.planDragOriginal.id,
        });
      }
      this.selectedPlanId = this.draggingPlanId;
      this.draggingPlanId = null;
      this.pendingPlanMoveId = null;
      this.planDragOriginal = null;
      this.ghostPos = null;
      this.cursorPoint = null;
      this._clearCoordHud();
      this._refreshPlanEstimates();
      this._updatePlanPanel();
      this.savePlanDraftDebounced();
      this.render();
      if (item && !this.planDragMoved) this.centerOn(item.wx, item.wy);
      this.planDragMoved = false;
      return;
    }

    const wasDrag = this._dragMoved;
    this.isDragging = false;
    this._dragMoved = false;
    this.canvas.style.cursor = "grab";

    if (wasDrag) return;

    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;

    if (this.pendingMoveObj) {
      if (!this.moveClickArmed) return;
      this.moveClickArmed = false;
      this.moveSelectedObjectToPoint(this._systemPointFromScreen(sx, sy));
      return;
    }

    if (this.pendingPlanMoveId) {
      this.moveSelectedPlanToPoint(this._systemPointFromScreen(sx, sy));
      return;
    }

    if (this.planningMode) {
      const point = this._systemPointFromScreen(sx, sy);
      if (e.shiftKey) {
        this.evaluatePoint(point);
        return;
      }
      const suggestion = this.findSuggestionAt(sx, sy);
      if (suggestion) {
        this.addSuggestionToPlan(suggestion);
        return;
      }
      if (e.altKey) {
        point.locked = true;
        point.name = "Закрепленный план";
      }
      this.addPlanStation(point);
      return;
    }

    if (this.chainMode) {
      this.buildChainToPoint(this._systemPointFromScreen(sx, sy));
      return;
    }

    if (this.placementMode) {
      this._onPlacementClick(sx, sy);
      return;
    }

    const coordHit = this.findCoordHitAt(sx, sy);
    if (coordHit) {
      this.openCoordinate(coordHit);
      return;
    }

    const obj = this.findObjectAt(sx, sy);
    if (obj && obj.type === "object" && this._isAlstation(obj)) {
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
    this.canvas.style.cursor = "grab";
  }

  _onSearch(e) {
    const q = e.target.value.toLowerCase();
    if (!q) {
      this.highlightedObj = null;
      this.render();
      return;
    }
    const found = this.objects.find(
      (o) =>
        (o.name || "").toLowerCase().includes(q) ||
        (o.nick || "").toLowerCase().includes(q),
    );
    if (found) {
      this.centerOn(found.wx || 0, found.wy || 0);
      this.highlightedObj = found;
      this.render();
    }
  }

  zoomIn() {
    this.scale = Math.min(20, this.scale * 1.5);
    this.render();
  }
  zoomOut() {
    this.scale = Math.max(0.0002, this.scale / 1.5);
    this.render();
  }

  systemToWorldX(horizontalCoord) {
    return (horizontalCoord - this.area.center_y) * this.systemSpacing;
  }
  systemToWorldY(verticalCoord) {
    return (verticalCoord - this.area.center_x) * this.systemSpacing;
  }
  worldToSystemX(wx) {
    return wx / this.systemSpacing + this.area.center_y;
  }
  worldToSystemY(wy) {
    return wy / this.systemSpacing + this.area.center_x;
  }
  _snapDown(value, step) {
    return Math.floor(value / step) * step;
  }
  _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  _systemPointFromScreen(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const systemX = this._clamp(
      Math.round(this.worldToSystemY(w.y)),
      this.area.min_x,
      this.area.max_x,
    );
    const systemY = this._clamp(
      Math.round(this.worldToSystemX(w.x)),
      this.area.min_y,
      this.area.max_y,
    );
    return {
      sx: systemX,
      sy: systemY,
      x: systemX,
      y: systemY,
      z: 0,
      wx: this.systemToWorldX(systemY),
      wy: this.systemToWorldY(systemX),
    };
  }

  _pointFromSystemCoords(systemX, systemY) {
    const x = this._clamp(Math.round(systemX), this.area.min_x, this.area.max_x);
    const y = this._clamp(Math.round(systemY), this.area.min_y, this.area.max_y);
    return {
      sx: x,
      sy: y,
      x,
      y,
      z: 0,
      wx: this.systemToWorldX(y),
      wy: this.systemToWorldY(x),
    };
  }

  _pointFromWorld(wx, wy) {
    return this._pointFromSystemCoords(
      this.worldToSystemY(wy),
      this.worldToSystemX(wx),
    );
  }

  _planRadius(level) {
    return Math.max(1, parseInt(level) || 1) * 900;
  }

  _targetObjects() {
    const filters = new Set(this._optimizerTargetsParam().split(","));
    return this.objects.filter((o) => {
      if (o.type === "capital") return filters.has("players");
      if (o.type === "account") return filters.has("accounts");
      if (o.type !== "object") return false;
      const kind = this._objectTargetKind(o);
      if (kind === "alstation") return false;
      return filters.has(kind) || (kind === "object" && filters.has("object"));
    });
  }

  _existingAlstations() {
    return this.objects
      .filter((o) => o.type === "object" && this._isAlstation(o))
      .map((o) => ({
        id: o.id,
        name: o.name || "Алстанция",
        x: o.x,
        y: o.y,
        z: o.z || 0,
        wx: o.wx,
        wy: o.wy,
        radius: o.radius || this._planRadius(o.level || 1),
        level: o.level || 1,
        networkConnected:
          o.network_status === "main" || o.network_connected !== false,
        networkStatus: o.network_status || "network",
      }));
  }

  _distance(a, b) {
    return Math.hypot((a.wx || 0) - (b.wx || 0), (a.wy || 0) - (b.wy || 0));
  }

  _networkTouchTolerance() {
    return this.systemSpacing * 0.5;
  }

  _isNetworkTouch(point, parent) {
    return (
      Math.abs(this._distance(point, parent) - parent.radius) <=
      this._networkTouchTolerance()
    );
  }

  _mainNetworkRoot(fallbackLevel = 10) {
    const stations = this._existingAlstations();
    const root = stations.find(
      (st) => st.x === 2500 && st.y === 2500 && Number(st.z || 0) === 0,
    );
    if (root) return root;
    return {
      id: "main",
      name: "Главная алстанция",
      x: 2500,
      y: 2500,
      z: 0,
      wx: this.systemToWorldX(2500),
      wy: this.systemToWorldY(2500),
      level: fallbackLevel,
      radius: this._planRadius(fallbackLevel),
      networkConnected: true,
      networkStatus: "main",
    };
  }

  _refreshExistingNetworkStatus() {
    const stations = this.objects.filter(
      (o) => o.type === "object" && this._isAlstation(o),
    );
    if (!stations.length) return;
    const root =
      stations.find(
        (st) => st.x === 2500 && st.y === 2500 && Number(st.z || 0) === 0,
      ) || null;
    if (!root) return;
    const connected = [root];
    root.network_connected = true;
    root.network_status = "main";
    root.network_touch_delta = 0;
    let remaining = stations.filter((st) => st !== root);
    let changed = true;
    while (changed) {
      changed = false;
      const next = [];
      for (const station of remaining) {
        const parent = this._bestNetworkParent(station, connected, true);
        if (parent) {
          station.network_connected = true;
          station.network_status = "network";
          station.network_parent = parent.name || "сеть";
          station.network_touch_delta = Math.round(
            Math.abs(this._distance(station, parent) - parent.radius),
          );
          connected.push(station);
          changed = true;
        } else {
          next.push(station);
        }
      }
      remaining = next;
    }
    for (const station of remaining) {
      const covering = connected
        .filter((parent) => this._distance(station, parent) <= parent.radius)
        .sort((a, b) => this._distance(station, a) - this._distance(station, b));
      station.network_connected = false;
      station.network_status = covering.length ? "signal_only" : "isolated";
      station.network_parent = covering[0] ? covering[0].name || "сеть" : null;
      station.network_touch_delta = covering[0]
        ? Math.round(
            Math.abs(this._distance(station, covering[0]) - covering[0].radius),
          )
        : null;
    }
  }

  _bestNetworkParent(point, parents, requireTouch) {
    const candidates = parents
      .map((parent) => ({
        parent,
        delta: Math.abs(this._distance(point, parent) - parent.radius),
      }))
      .filter((item) => !requireTouch || item.delta <= this._networkTouchTolerance())
      .sort((a, b) => a.delta - b.delta);
    return candidates[0] ? candidates[0].parent : null;
  }

  _connectedNetworkAnchors() {
    const stations = this._existingAlstations().filter((st) => st.networkConnected);
    if (stations.length) return stations;
    return [this._mainNetworkRoot(this.planLevel || 10)];
  }

  _connectedNetworkAnchorsWithPlan() {
    const connected = this._connectedNetworkAnchors().slice();
    for (const item of this.planStations) {
      if (!item.networkConnected) continue;
      connected.push({
        id: item.id,
        name: item.name || "План " + item.id,
        x: item.x,
        y: item.y,
        z: item.z || 0,
        wx: item.wx,
        wy: item.wy,
        radius: item.radius,
        level: item.level,
        networkConnected: true,
        networkStatus: "network",
      });
    }
    return connected;
  }

  _coveredBy(point, stations) {
    return stations.some((st) => this._distance(point, st) <= st.radius);
  }

  _estimatePlanStation(station, connectedAnchors = this._connectedNetworkAnchors()) {
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
    const overlaps = existing.filter(
      (st) => this._distance(station, st) < station.radius + st.radius,
    ).length;
    const parent = this._bestNetworkParent(station, connectedAnchors, true);
    const nearestParent = this._bestNetworkParent(station, connectedAnchors, false);
    const signalParent =
      nearestParent && this._distance(station, nearestParent) <= nearestParent.radius
        ? nearestParent
        : null;
    const parentForDelta = parent || signalParent || nearestParent;
    const touchDelta = parentForDelta
      ? Math.round(Math.abs(this._distance(station, parentForDelta) - parentForDelta.radius))
      : null;
    const networkStatus = parent
      ? "network"
      : signalParent
        ? "signal_only"
        : "isolated";
    return {
      covered,
      newCovered,
      overlaps,
      networkConnected: Boolean(parent),
      network_status: networkStatus,
      network_parent: parentForDelta ? parentForDelta.name || "сеть" : null,
      network_touch_delta: touchDelta,
    };
  }

  _planCoverageSummary() {
    const targets = this._targetObjects();
    const existing = this._existingAlstations();
    const planned = this.planStations.map((st) => ({
      wx: st.wx,
      wy: st.wy,
      radius: st.radius,
    }));
    const existingCovered = targets.filter((t) =>
      this._coveredBy(t, existing),
    ).length;
    const totalCovered = targets.filter(
      (t) => this._coveredBy(t, existing) || this._coveredBy(t, planned),
    ).length;
    return {
      targets: targets.length,
      existingCovered,
      totalCovered,
      newCovered: Math.max(0, totalCovered - existingCovered),
      pct: targets.length
        ? Math.round((totalCovered / targets.length) * 1000) / 10
        : 0,
    };
  }

  _makePlanStation(point, level) {
    const cleanLevel = Math.max(1, Math.min(20, parseInt(level) || 10));
    const item = {
      id: this.nextPlanId++,
      name: point.name || "План " + (this.nextPlanId - 1),
      x: point.sx,
      y: point.sy,
      z: 0,
      wx: point.wx,
      wy: point.wy,
      level: cleanLevel,
      radius: this._planRadius(cleanLevel),
      status: point.status || "План",
      comment: point.comment || "",
      locked: Boolean(point.locked),
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
      alert("Координаты вне зоны альянса 2000:2000 - 3000:3000");
      return;
    }
    const exists = this.planStations.find(
      (st) => st.x === point.sx && st.y === point.sy && st.z === 0,
    );
    if (exists) {
      this.selectedPlanId = exists.id;
      this.render();
      this._updatePlanPanel();
      return;
    }
    this._pushUndo(this._planSnapshot());
    const item = this._makePlanStation(point, point.level || this.planLevel);
    this.planStations.push(item);
    this.selectedPlanId = item.id;
    this._refreshPlanEstimates();
    this._updatePlanPanel();
    this.savePlanDraftDebounced();
    this.render();
  }

  _refreshPlanEstimates() {
    const connected = this._connectedNetworkAnchors();
    for (const item of this.planStations) {
      Object.assign(item, this._estimatePlanStation(item, connected));
      if (item.networkConnected) {
        connected.push({
          id: item.id,
          name: item.name || "План " + item.id,
          x: item.x,
          y: item.y,
          z: item.z || 0,
          wx: item.wx,
          wy: item.wy,
          radius: item.radius,
          level: item.level,
          networkConnected: true,
          networkStatus: "network",
        });
      }
    }
  }

  findPlanStationAt(sx, sy) {
    let best = null,
      bestDist = 18;
    for (const item of this.planStations) {
      const sp = this.worldToScreen(item.wx, item.wy);
      const d = Math.hypot(sp.x - sx, sp.y - sy);
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  togglePlanningMode() {
    this.planningMode = !this.planningMode;
    if (this.planningMode && this.placementMode) this.togglePlacementMode();
    if (this.planningMode && this.chainMode) this.toggleChainMode(false);
    this.ghostPos = null;
    const btn = document.getElementById("btn-planning");
    if (btn) {
      btn.classList.toggle("btn-success", this.planningMode);
      btn.classList.toggle("btn-outline-success", !this.planningMode);
      btn.innerHTML = this.planningMode
        ? '<i class="bi bi-check2-circle"></i> Планирование включено'
        : '<i class="bi bi-broadcast-pin"></i> План алстанций';
    }
    const panel = document.getElementById("planning-panel");
    if (panel)
      panel.style.display =
        this.planningMode || this.planStations.length ? "block" : "none";
    this.canvas.style.cursor = this.planningMode ? "crosshair" : "grab";
    this._updatePlanPanel();
    this.render();
  }

  toggleChainMode(force) {
    const next = typeof force === "boolean" ? force : !this.chainMode;
    this.chainMode = next;
    if (this.chainMode) {
      if (this.planningMode) this.togglePlanningMode();
      if (this.placementMode) this.togglePlacementMode();
    }
    this.ghostPos = null;
    this.cursorPoint = null;
    const btn = document.getElementById("btn-plan-chain-to-point");
    if (btn) {
      btn.classList.toggle("btn-info", this.chainMode);
      btn.classList.toggle("btn-outline-info", !this.chainMode);
      btn.innerHTML = this.chainMode
        ? '<i class="bi bi-signpost-split"></i>'
        : '<i class="bi bi-signpost"></i>';
    }
    const status = document.getElementById("chain-summary");
    if (status && this.chainMode) {
      status.textContent = "Выберите конечную точку на карте";
    }
    this.canvas.style.cursor = this.chainMode ? "crosshair" : "grab";
    this._updateActionHud();
    this.render();
  }

  buildChainToPoint(point) {
    if (!point) return;
    const level = this.planLevel || 10;
    const maxCountInput = document.getElementById("optimizer-count");
    const maxCount = Math.max(
      1,
      Math.min(30, parseInt(maxCountInput ? maxCountInput.value : "12") || 12),
    );
    const target = {
      x: point.sx || point.x,
      y: point.sy || point.y,
      z: point.z || 0,
      wx: point.wx,
      wy: point.wy,
    };
    const connected = this._connectedNetworkAnchorsWithPlan();
    const occupied = this._occupiedStationCoords();
    const added = [];
    const undoBefore = this._planSnapshot();

    for (let i = 0; i < maxCount; i++) {
      if (connected.some((anchor) => this._distance(target, anchor) <= anchor.radius)) {
        break;
      }
      const parent = this._bestChainParent(target, connected);
      if (!parent) break;
      const nextPoint = this._boundaryPointToward(parent, target, occupied);
      if (!nextPoint) break;
      const item = this._makePlanStation(
        {
          sx: nextPoint.sx,
          sy: nextPoint.sy,
          wx: nextPoint.wx,
          wy: nextPoint.wy,
          name: "Цепь " + (added.length + 1),
          comment:
            "Цепь до [" +
            target.x +
            ":" +
            target.y +
            ":" +
            (target.z || 0) +
            "]",
        },
        level,
      );
      item.networkConnected = true;
      item.network_status = "network";
      item.network_parent = parent.name || "сеть";
      item.network_touch_delta = Math.round(
        Math.abs(this._distance(item, parent) - parent.radius),
      );
      this.planStations.push(item);
      added.push(item);
      occupied.add(item.x + ":" + item.y + ":" + (item.z || 0));
      connected.push({
        id: item.id,
        name: item.name,
        x: item.x,
        y: item.y,
        z: item.z || 0,
        wx: item.wx,
        wy: item.wy,
        radius: item.radius,
        level: item.level,
        networkConnected: true,
        networkStatus: "network",
      });
    }

    this.chainTarget = target;
    if (added.length) {
      this._pushUndo(undoBefore);
      this.selectedPlanId = added[added.length - 1].id;
      this._refreshPlanEstimates();
      this._updatePlanPanel();
      this.savePlanDraftDebounced();
    }
    const covered = connected.some(
      (anchor) => this._distance(target, anchor) <= anchor.radius,
    );
    const status = document.getElementById("chain-summary");
    if (status) {
      status.textContent = added.length
        ? "Добавлено " +
          added.length +
          " станц. до [" +
          target.x +
          ":" +
          target.y +
          ":0]" +
          (covered ? "" : ". Нужен больший лимит")
        : covered
          ? "Точка уже в сигнале общей сети"
          : "Не удалось построить цепь: нет свободной точки на границе";
    }
    this.toggleChainMode(false);
    this.render();
  }

  _occupiedStationCoords() {
    const occupied = new Set();
    for (const item of this.objects) {
      if (item.type === "object" && this._isAlstation(item)) {
        occupied.add(item.x + ":" + item.y + ":" + (item.z || 0));
      }
    }
    for (const item of this.planStations) {
      occupied.add(item.x + ":" + item.y + ":" + (item.z || 0));
    }
    return occupied;
  }

  _bestChainParent(target, connected) {
    return connected
      .slice()
      .sort(
        (a, b) =>
          this._distance(target, a) -
          a.radius -
          (this._distance(target, b) - b.radius),
      )[0];
  }

  _boundaryPointToward(parent, target, occupied) {
    const baseAngle = Math.atan2(target.wy - parent.wy, target.wx - parent.wx);
    const angleOffsets = [
      0, 0.08, -0.08, 0.16, -0.16, 0.28, -0.28, 0.42, -0.42, 0.62, -0.62,
    ];
    for (const offset of angleOffsets) {
      const angle = baseAngle + offset;
      const wx = parent.wx + Math.cos(angle) * parent.radius;
      const wy = parent.wy + Math.sin(angle) * parent.radius;
      const point = this._pointFromWorld(wx, wy);
      const key = point.sx + ":" + point.sy + ":0";
      if (occupied.has(key)) continue;
      if (!this._isNetworkTouch(point, parent)) continue;
      return point;
    }
    return null;
  }

  drawChainTarget() {
    if (!this.chainTarget) return;
    const sp = this.worldToScreen(this.chainTarget.wx, this.chainTarget.wy);
    if (
      sp.x < -40 ||
      sp.x > this.canvas.width + 40 ||
      sp.y < -40 ||
      sp.y > this.canvas.height + 40
    )
      return;
    const c = this.ctx;
    c.save();
    c.strokeStyle = "#00cec9";
    c.fillStyle = "rgba(0,206,201,0.18)";
    c.lineWidth = 2;
    c.setLineDash([6, 4]);
    c.beginPath();
    c.arc(sp.x, sp.y, 18, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.setLineDash([]);
    c.beginPath();
    c.moveTo(sp.x - 12, sp.y);
    c.lineTo(sp.x + 12, sp.y);
    c.moveTo(sp.x, sp.y - 12);
    c.lineTo(sp.x, sp.y + 12);
    c.stroke();
    c.restore();
  }

  setPlanLevel(level) {
    this.planLevel = Math.max(1, Math.min(20, parseInt(level) || 10));
    const val = document.getElementById("plan-level-val");
    const radius = document.getElementById("plan-radius-val");
    if (val) val.textContent = this.planLevel;
    if (radius) radius.textContent = this._planRadius(this.planLevel);
    if (this.selectedPlanId) {
      const item = this.planStations.find(
        (st) => st.id === this.selectedPlanId,
      );
      if (item) {
        item.level = this.planLevel;
        item.radius = this._planRadius(this.planLevel);
        Object.assign(item, this._estimatePlanStation(item));
      }
    }
    this._refreshPlanEstimates();
    this._updatePlanPanel();
    this.savePlanDraftDebounced();
    this.render();
  }

  removeSelectedPlanStation() {
    if (!this.selectedPlanId) return;
    this._pushUndo(this._planSnapshot());
    if (this.pendingPlanMoveId === this.selectedPlanId)
      this.pendingPlanMoveId = null;
    if (this.draggingPlanId === this.selectedPlanId) this.draggingPlanId = null;
    this.planStations = this.planStations.filter(
      (st) => st.id !== this.selectedPlanId,
    );
    this.selectedPlanId = this.planStations.length
      ? this.planStations[this.planStations.length - 1].id
      : null;
    this.ghostPos = null;
    this.cursorPoint = null;
    this._clearCoordHud();
    this._updatePlanPanel();
    this.savePlanDraftDebounced();
    this.render();
  }

  clearPlan() {
    if (this.planStations.length) this._pushUndo(this._planSnapshot());
    this.planStations = [];
    this.selectedPlanId = null;
    this.pendingPlanMoveId = null;
    this.draggingPlanId = null;
    this.ghostPos = null;
    this.cursorPoint = null;
    this.chainTarget = null;
    const chainSummary = document.getElementById("chain-summary");
    if (chainSummary) chainSummary.textContent = "Цепь до точки: не выбрана";
    this._clearCoordHud();
    this._updatePlanPanel();
    this.savePlanDraftDebounced();
    this.render();
  }

  copyPlan() {
    const text = this.planStations
      .map(
        (st) =>
          "Алстанция " +
          st.level +
          " ур: [" +
          st.x +
          ":" +
          st.y +
          ":0], радиус " +
          st.radius +
          ", новых целей " +
          st.newCovered,
      )
      .join("\n");
    if (!text) return;
    if (navigator.clipboard) navigator.clipboard.writeText(text);
  }

  async savePlanStations() {
    if (!this.planStations.length) return;
    if (!confirm("Сохранить плановые алстанции как объекты?")) return;
    for (const st of this.planStations) {
      const payload = {
        name: st.name || "Алстанция " + st.level + " ур",
        subtype: "Алстанция",
        level: st.level,
        x: st.x,
        y: st.y,
        z: 0,
        status: st.status || "План",
        comment: st.comment || "Создано из планировщика карты",
      };
      const resp = await fetch("/map/api/stations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        alert(data.error || "Ошибка сохранения плана");
        return;
      }
    }
    this.clearPlan();
    await this.loadData();
    this._updateStationsList();
  }

  _updatePlanPanel() {
    const panel = document.getElementById("planning-panel");
    if (panel)
      panel.style.display =
        this.planningMode || this.planStations.length ? "block" : "none";
    const summaryEl = document.getElementById("plan-summary");
    const listEl = document.getElementById("plan-list");
    const summary = this._planCoverageSummary();
    if (summaryEl) {
      summaryEl.innerHTML =
        "План: " +
        this.planStations.length +
        "<br>Новых целей: " +
        summary.newCovered +
        "<br>Покрытие целей: " +
        summary.totalCovered +
        "/" +
        summary.targets +
        " (" +
        summary.pct +
        "%)";
    }
    if (!listEl) return;
    if (!this.planStations.length) {
      listEl.innerHTML =
        '<div class="text-muted small">Плановых алстанций пока нет</div>';
      this._syncPlanEditor(null);
      return;
    }
    if (!this.planStations.some((st) => st.id === this.selectedPlanId)) {
      this.selectedPlanId = this.planStations[0].id;
    }
    listEl.innerHTML = this.planStations
      .map((st) => {
        const active =
          st.id === this.selectedPlanId ? "border-success" : "border-secondary";
        const locked = st.locked ? " · закреплена" : "";
        const networkText = st.networkConnected
          ? "сеть" + (st.network_parent ? " от " + st.network_parent : "")
          : st.network_status === "signal_only"
            ? "автономный сигнал, не сеть"
            : "вне общей сети";
        const networkClass = st.networkConnected ? "text-success" : "text-warning";
        const deltaText =
          typeof st.network_touch_delta === "number"
            ? ", откл. " + st.network_touch_delta
            : "";
        return (
          '<div class="plan-row border-bottom ' +
          active +
          ' py-1" data-id="' +
          st.id +
          '" style="cursor:pointer;">' +
          '<div class="d-flex justify-content-between align-items-center gap-1">' +
          "<span><strong>П" +
          st.id +
          "</strong> " +
          this._escapeHtml(st.name || "") +
          '<br><span class="text-muted">[' +
          st.x +
          ":" +
          st.y +
          ":0] " +
          st.level +
          " ур" +
          locked +
          "</span></span>" +
          '<span class="btn-group btn-group-sm">' +
          '<button class="btn btn-outline-info py-0 px-1 plan-focus-btn" title="Показать"><i class="bi bi-crosshair"></i></button>' +
          '<button class="btn btn-outline-secondary py-0 px-1 plan-move-btn" title="Переместить" ' +
          (st.locked ? "disabled" : "") +
          '><i class="bi bi-arrows-move"></i></button>' +
          '<button class="btn btn-outline-warning py-0 px-1 plan-lock-btn" title="' +
          (st.locked ? "Разблокировать" : "Закрепить") +
          '"><i class="bi ' +
          (st.locked ? "bi-unlock" : "bi-lock") +
          '"></i></button>' +
          '<button class="btn btn-outline-danger py-0 px-1 plan-remove-btn" title="Удалить"><i class="bi bi-x-lg"></i></button>' +
          "</span></div>" +
          '<div class="text-muted">радиус ' +
          st.radius +
          ", новых " +
          st.newCovered +
          ", всего " +
          st.covered +
          ", пересечений " +
          st.overlaps +
          "</div>" +
          '<div class="' +
          networkClass +
          '">' +
          networkText +
          deltaText +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    this._syncPlanEditor(
      this.planStations.find((st) => st.id === this.selectedPlanId) ||
        this.planStations[0],
    );
    listEl.querySelectorAll(".plan-row").forEach((row) => {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest(".coord-link")) return;
        const id = parseInt(row.dataset.id);
        const st = this.planStations.find((item) => item.id === id);
        if (!st) return;
        this.selectedPlanId = id;
        if (ev.target.closest(".plan-focus-btn")) {
          this.centerOn(st.wx, st.wy);
          this._updatePlanPanel();
          return;
        }
        if (ev.target.closest(".plan-move-btn")) {
          this.startPlanMove(st);
          return;
        }
        if (ev.target.closest(".plan-lock-btn")) {
          this.togglePlanLock(st.id);
          return;
        }
        if (ev.target.closest(".plan-remove-btn")) {
          this.removeSelectedPlanStation();
          return;
        }
        this.planLevel = st.level;
        const levelInput = document.getElementById("plan-level");
        if (levelInput) levelInput.value = st.level;
        this.setPlanLevel(st.level);
        this.centerOn(st.wx, st.wy);
      });
    });
  }

  _syncPlanEditor(item) {
    const panel = document.getElementById("plan-edit-panel");
    if (!panel) return;
    if (!item) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "block";
    const name = document.getElementById("plan-edit-name");
    const level = document.getElementById("plan-edit-level");
    const levelVal = document.getElementById("plan-edit-level-val");
    const status = document.getElementById("plan-edit-status");
    const comment = document.getElementById("plan-edit-comment");
    const locked = document.getElementById("plan-edit-locked");
    if (name && name.value !== (item.name || "")) name.value = item.name || "";
    if (level && parseInt(level.value) !== item.level) level.value = item.level;
    if (levelVal) levelVal.textContent = item.level;
    if (status && status.value !== (item.status || "План"))
      status.value = item.status || "План";
    if (comment && comment.value !== (item.comment || ""))
      comment.value = item.comment || "";
    if (locked) locked.checked = Boolean(item.locked);
  }

  updateSelectedPlan(patch) {
    if (!this.selectedPlanId) return;
    const item = this.planStations.find((st) => st.id === this.selectedPlanId);
    if (!item) return;
    const shouldRecordUndo = Object.keys(patch).some(
      (key) => key !== "name" && key !== "comment",
    );
    if (shouldRecordUndo) this._pushUndo(this._planSnapshot());
    if (Object.prototype.hasOwnProperty.call(patch, "name"))
      item.name = patch.name;
    if (Object.prototype.hasOwnProperty.call(patch, "status"))
      item.status = patch.status || "План";
    if (Object.prototype.hasOwnProperty.call(patch, "comment"))
      item.comment = patch.comment || "";
    if (Object.prototype.hasOwnProperty.call(patch, "locked")) {
      item.locked = Boolean(patch.locked);
      if (item.locked && this.pendingPlanMoveId === item.id)
        this.cancelMoveMode();
    }
    if (Object.prototype.hasOwnProperty.call(patch, "level")) {
      item.level = Math.max(
        1,
        Math.min(20, parseInt(patch.level) || item.level || 10),
      );
      item.radius = this._planRadius(item.level);
      Object.assign(item, this._estimatePlanStation(item));
      const val = document.getElementById("plan-edit-level-val");
      if (val) val.textContent = item.level;
    }
    this._refreshPlanEstimates();
    this._updatePlanPanel();
    this.savePlanDraftDebounced();
    this.render();
  }

  togglePlanLock(id) {
    const item = this.planStations.find((st) => st.id === id);
    if (!item) return;
    this.selectedPlanId = id;
    this.updateSelectedPlan({ locked: !item.locked });
  }
  _moveModeLabel() {
    if (this.pendingMoveObj)
      return "Перемещение: " + (this.pendingMoveObj.name || "объект");
    if (this.pendingPlanMoveId) return "Перемещение плановой алстанции";
    return "";
  }

  startObjectMove(obj) {
    if (!obj) return;
    this.pendingMoveObj = obj;
    this.moveClickArmed = false;
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
    if (item.locked) {
      this.selectedPlanId = item.id;
      this._updatePlanPanel();
      this.render();
      return;
    }
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
    this.moveClickArmed = false;
    this.pendingPlanMoveId = null;
    this.ghostPos = null;
    this.cursorPoint = null;
    this.canvas.style.cursor = "grab";
    this._clearCoordHud();
    this.render();
  }

  async moveSelectedObjectToPoint(point) {
    if (!this.pendingMoveObj || !point) return;
    if (!this._isSystemInArea(point.sx, point.sy)) {
      alert("Координаты вне зоны альянса 2000:2000 - 3000:3000");
      return;
    }
    const obj = this.pendingMoveObj;
    const before = { x: obj.x, y: obj.y, z: obj.z || 0 };
    const resp = await fetch("/map/api/stations/" + obj.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: point.sx, y: point.sy, z: obj.z || 0 }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert(data.error || "Ошибка перемещения объекта");
      return;
    }
    this._pushUndo({ type: "object-move", id: obj.id, before });
    this.pendingMoveObj = null;
    this.moveClickArmed = false;
    this.ghostPos = null;
    this.cursorPoint = null;
    this._clearCoordHud();
    await this.loadData();
    this._updateStationsList();
  }

  moveSelectedPlanToPoint(point) {
    if (!this.pendingPlanMoveId || !point) return;
    if (!this._isSystemInArea(point.sx, point.sy)) {
      alert("Координаты вне зоны альянса 2000:2000 - 3000:3000");
      return;
    }
    const item = this.planStations.find(
      (st) => st.id === this.pendingPlanMoveId,
    );
    if (!item) return;
    this._pushUndo(this._planSnapshot());
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
    this.savePlanDraftDebounced();
    this.render();
  }
  exportPNG() {
    const link = document.createElement("a");
    link.download = "aurus-map.png";
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }

  togglePlacementMode() {
    this.placementMode = !this.placementMode;
    if (this.placementMode && this.chainMode) this.toggleChainMode(false);
    this.ghostPos = null;
    const btn = document.getElementById("btn-placement");
    if (btn) {
      btn.classList.toggle("btn-danger", this.placementMode);
      btn.classList.toggle("btn-outline-danger", !this.placementMode);
      btn.innerHTML = this.placementMode
        ? '<i class="bi bi-x-lg"></i> Отменить размещение'
        : '<i class="bi bi-geo-alt"></i> Разместить объект';
    }
    const panel = document.getElementById("placement-panel");
    if (panel) panel.style.display = this.placementMode ? "block" : "none";
    this.canvas.style.cursor = this.placementMode ? "crosshair" : "grab";
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
    grad.addColorStop(0, "rgba(46,204,113,0.2)");
    grad.addColorStop(1, "rgba(46,204,113,0.02)");
    c.fillStyle = grad;
    c.beginPath();
    c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    c.fill();

    c.strokeStyle = "#2ecc71";
    c.lineWidth = 2;
    c.setLineDash([8, 4]);
    c.beginPath();
    c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);

    c.fillStyle = "#2ecc71";
    c.beginPath();
    c.moveTo(sp.x, sp.y - 12);
    c.lineTo(sp.x + 12, sp.y);
    c.lineTo(sp.x, sp.y + 12);
    c.lineTo(sp.x - 12, sp.y);
    c.closePath();
    c.fill();

    c.fillStyle = "#fff";
    c.font = "bold 11px sans-serif";
    c.textAlign = "center";
    c.fillText(
      "[" + g.sx + ":" + g.sy + ":0] ур." + this.placementLevel,
      sp.x,
      sp.y - 18,
    );
    c.textAlign = "left";
    c.restore();
  }

  _onContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    const w = this.screenToWorld(mx, my);
    const sx = Math.round(w.y / 1000 + this.area.center_x);
    const sy = Math.round(w.x / 1000 + this.area.center_y);

    const obj = this.findObjectAt(mx, my);
    const planObj = this.findPlanStationAt(mx, my);
    const suggestionObj = this.findSuggestionAt(mx, my);
    const point = this._systemPointFromScreen(mx, my);
    this._contextPos = {
      sx: point.sx,
      sy: point.sy,
      wx: point.wx,
      wy: point.wy,
      obj: obj,
      planObj: planObj,
      suggestionObj: suggestionObj,
    };

    const menu = document.getElementById("map-context-menu");
    if (!menu) return;

    let html = "";
    if (planObj) {
      html +=
        '<div class="ctx-item" data-action="select_plan"><i class="bi bi-pencil-square"></i> Редактировать плановую</div>';
      if (!planObj.locked) {
        html +=
          '<div class="ctx-item" data-action="move_plan"><i class="bi bi-arrows-move"></i> Переместить плановую</div>';
      }
      html +=
        '<div class="ctx-item" data-action="lock_plan"><i class="bi ' +
        (planObj.locked ? "bi-unlock" : "bi-lock") +
        '"></i> ' +
        (planObj.locked ? "Разблокировать" : "Закрепить") +
        "</div>";
      html +=
        '<div class="ctx-item ctx-danger" data-action="remove_plan"><i class="bi bi-trash"></i> Удалить из плана</div>';
      html += '<div class="ctx-divider"></div>';
    }
    if (suggestionObj) {
      html +=
        '<div class="ctx-item" data-action="add_suggestion"><i class="bi bi-plus-circle"></i> Добавить предложение в план</div>';
      html += '<div class="ctx-divider"></div>';
    }
    if (this.pendingMoveObj) {
      html +=
        '<div class="ctx-item" data-action="move_selected_here"><i class="bi bi-arrows-move"></i> Переместить "' +
        this._escapeHtml(this.pendingMoveObj.name || "объект") +
        '" сюда [' +
        point.sx +
        ":" +
        point.sy +
        ":0]</div>";
      html +=
        '<div class="ctx-item" data-action="cancel_move"><i class="bi bi-x-lg"></i> Отменить перемещение</div>';
      html += '<div class="ctx-divider"></div>';
    }
    if (this.pendingPlanMoveId) {
      html +=
        '<div class="ctx-item" data-action="move_plan_here"><i class="bi bi-arrows-move"></i> Переместить план сюда [' +
        point.sx +
        ":" +
        point.sy +
        ":0]</div>";
      html +=
        '<div class="ctx-item" data-action="cancel_move"><i class="bi bi-x-lg"></i> Отменить перемещение</div>';
      html += '<div class="ctx-divider"></div>';
    }
    if (obj && obj.type === "object") {
      html +=
        '<div class="ctx-item" data-action="edit"><i class="bi bi-pencil"></i> Редактировать</div>';
      html +=
        '<div class="ctx-item" data-action="select_move"><i class="bi bi-crosshair"></i> Выбрать для перемещения</div>';
      html +=
        '<div class="ctx-item ctx-danger" data-action="delete"><i class="bi bi-trash"></i> Удалить</div>';
      html += '<div class="ctx-divider"></div>';
    }
    if (obj && obj.url) {
      html +=
        '<div class="ctx-item" data-action="opencard"><i class="bi bi-box-arrow-up-right"></i> Открыть карточку</div>';
      html += '<div class="ctx-divider"></div>';
    }
    html +=
      '<div class="ctx-item" data-action="plan_station"><i class="bi bi-broadcast-pin"></i> Плановая алстанция</div>';
    html +=
      '<div class="ctx-item" data-action="evaluate_point"><i class="bi bi-graph-up-arrow"></i> Проверить точку [' +
      point.sx +
      ":" +
      point.sy +
      ":0]</div>";
    html +=
      '<div class="ctx-item" data-action="create_station"><i class="bi bi-geo-alt"></i> Новая алстанция</div>';
    html +=
      '<div class="ctx-item" data-action="create_ops"><i class="bi bi-shield"></i> Новый ОПС</div>';
    html +=
      '<div class="ctx-item" data-action="create_dunya"><i class="bi bi-moon"></i> Новая Дуня</div>';

    menu.innerHTML = html;

    let left = e.clientX;
    let top = e.clientY;
    if (left + 210 > window.innerWidth) left = window.innerWidth - 215;
    if (top + 200 > window.innerHeight) top = window.innerHeight - 205;
    left = Math.max(5, left);
    top = Math.max(5, top);

    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.style.display = "block";

    const self = this;
    menu.querySelectorAll(".ctx-item").forEach(function (item) {
      let handled = false;
      const runAction = function (ev) {
        if (handled) return;
        handled = true;
        ev.preventDefault();
        ev.stopPropagation();
        const action = item.dataset.action;
        if (action && typeof self["_ctx_" + action] === "function") {
          self["_ctx_" + action]();
        }
        setTimeout(() => {
          handled = false;
        }, 250);
      };
      item.addEventListener("mousedown", runAction);
      item.addEventListener("click", runAction);
    });
  }

  hideContextMenu() {
    const menu = document.getElementById("map-context-menu");
    if (menu) menu.style.display = "none";
  }

  _escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch];
    });
  }

  _isSystemInArea(x, y) {
    return (
      x >= this.area.min_x &&
      x <= this.area.max_x &&
      y >= this.area.min_y &&
      y <= this.area.max_y
    );
  }

  _ctx_edit() {
    this.hideContextMenu();
    if (this._contextPos && this._contextPos.obj)
      this._showStationEditor(this._contextPos.obj);
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
    this.moveSelectedObjectToPoint({
      sx: this._contextPos.sx,
      sy: this._contextPos.sy,
      wx: this._contextPos.wx,
      wy: this._contextPos.wy,
    });
  }

  _ctx_move() {
    this._ctx_select_move();
  }
  _ctx_delete() {
    this.hideContextMenu();
    if (!this._contextPos || !this._contextPos.obj) return;
    const obj = this._contextPos.obj;
    if (!confirm('Удалить "' + (obj.name || "Объект") + '"?')) return;
    fetch("/map/api/stations/" + obj.id, { method: "DELETE" })
      .then((r) => r.json())
      .then(() => {
        this.loadData().then(() => {
          this.render();
          this._updateStationsList();
        });
      })
      .catch((e) => alert("Ошибка: " + e.message));
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
    this.addPlanStation({
      sx: this._contextPos.sx,
      sy: this._contextPos.sy,
      wx: this._contextPos.wx,
      wy: this._contextPos.wy,
    });
  }

  _ctx_evaluate_point() {
    this.hideContextMenu();
    if (!this._contextPos) return;
    this.evaluatePoint({
      sx: this._contextPos.sx,
      sy: this._contextPos.sy,
      x: this._contextPos.sx,
      y: this._contextPos.sy,
      z: 0,
      wx: this._contextPos.wx,
      wy: this._contextPos.wy,
    });
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
    const input = document.getElementById("plan-level");
    if (input) input.value = this.planLevel;
    const val = document.getElementById("plan-level-val");
    const radius = document.getElementById("plan-radius-val");
    if (val) val.textContent = this.planLevel;
    if (radius) radius.textContent = this._planRadius(this.planLevel);
    this.centerOn(this._contextPos.planObj.wx, this._contextPos.planObj.wy);
    this._updatePlanPanel();
    this.render();
  }

  _ctx_move_plan() {
    this.hideContextMenu();
    if (!this._contextPos || !this._contextPos.planObj) return;
    this.startPlanMove(this._contextPos.planObj);
  }

  _ctx_lock_plan() {
    this.hideContextMenu();
    if (!this._contextPos || !this._contextPos.planObj) return;
    this.togglePlanLock(this._contextPos.planObj.id);
  }

  _ctx_move_plan_here() {
    this.hideContextMenu();
    if (!this._contextPos) return;
    this.moveSelectedPlanToPoint({
      sx: this._contextPos.sx,
      sy: this._contextPos.sy,
      wx: this._contextPos.wx,
      wy: this._contextPos.wy,
    });
  }

  _ctx_remove_plan() {
    this.hideContextMenu();
    if (!this._contextPos || !this._contextPos.planObj) return;
    this.selectedPlanId = this._contextPos.planObj.id;
    this.removeSelectedPlanStation();
  }

  _ctx_create_station() {
    this.hideContextMenu();
    this._openCreateModal("Алстанция", "Алстанция");
  }

  _ctx_create_ops() {
    this.hideContextMenu();
    this._openCreateModal("ОПС", "ОПС");
  }

  _ctx_create_dunya() {
    this.hideContextMenu();
    this._openCreateModal("Дуня", "Дуня");
  }

  _openCreateModal(typeName, subtype) {
    const p = this._contextPos || { sx: 2500, sy: 2500 };
    this._editingSubtype = subtype;
    document.getElementById("st-id").value = "";
    document.getElementById("st-name").value = typeName;
    document.getElementById("st-x").value = p.sx;
    document.getElementById("st-y").value = p.sy;
    document.getElementById("st-z").value = 0;
    const lvl = this.placementLevel;
    document.getElementById("st-level").value = lvl;
    document.getElementById("st-level-val").textContent = lvl;
    document.getElementById("st-radius-info").textContent = lvl * 900;
    this._updateStationCoordInfo(p.sx, p.sy, 0);
    document.getElementById("st-status").value = "Активен";
    document.getElementById("st-comment").value = "";
    this._setStationOwner(null);
    const mobility = document.getElementById("st-mobility");
    const isStation = this._setStationMobilityVisible(subtype);
    if (mobility) mobility.value = isStation ? "stationary" : "mobile";
    document.getElementById("st-modal-title").textContent =
      "Новая: " + typeName;
    document.getElementById("st-delete-btn").style.display = "none";
    const moveBtn = document.getElementById("st-move-btn");
    if (moveBtn) moveBtn.style.display = "none";
    document.getElementById("st-drag-hint").style.display = "none";
    this._createSubtype = subtype;
    new bootstrap.Modal(document.getElementById("stationModal")).show();
  }

  _onPlacementClick(sx, sy) {
    if (!this.ghostPos) return;
    const g = this.ghostPos;
    this._editingSubtype = "Алстанция";
    document.getElementById("st-x").value = g.sx;
    document.getElementById("st-y").value = g.sy;
    document.getElementById("st-z").value = 0;
    const lvl = this.placementLevel;
    document.getElementById("st-level").value = lvl;
    document.getElementById("st-level-val").textContent = lvl;
    document.getElementById("st-radius-info").textContent = lvl * 900;
    this._updateStationCoordInfo(g.sx, g.sy, 0);
    document.getElementById("st-name").value = "";
    document.getElementById("st-id").value = "";
    document.getElementById("st-status").value = "Активен";
    document.getElementById("st-comment").value = "";
    this._setStationOwner(null);
    this._setStationMobilityVisible("Алстанция");
    const mobility = document.getElementById("st-mobility");
    if (mobility) mobility.value = "stationary";
    document.getElementById("st-modal-title").textContent = "Новая алстанция";
    document.getElementById("st-delete-btn").style.display = "none";
    const moveBtn = document.getElementById("st-move-btn");
    if (moveBtn) moveBtn.style.display = "none";
    document.getElementById("st-drag-hint").style.display = "none";
    new bootstrap.Modal(document.getElementById("stationModal")).show();
  }

  async _showStationEditor(obj) {
    let data = {
      id: obj.id,
      name: obj.name,
      x: obj.x,
      y: obj.y,
      z: obj.z,
      level: obj.level,
      status: "Активен",
      comment: "",
      player_id: obj.player_id || null,
      object_type: obj.subtype || "Алстанция",
    };
    try {
      const resp = await fetch("/map/api/stations/" + obj.id);
      if (resp.ok) data = await resp.json();
    } catch (e) {}
    this._editingSubtype = data.object_type || obj.subtype || "Алстанция";
    document.getElementById("st-id").value = data.id || "";
    document.getElementById("st-name").value = data.name || "";
    document.getElementById("st-x").value = data.x || "";
    document.getElementById("st-y").value = data.y || "";
    document.getElementById("st-z").value = data.z || 0;
    this._updateStationCoordInfo(data.x, data.y, data.z || 0);
    const lvl = data.level || 1;
    document.getElementById("st-level").value = lvl;
    document.getElementById("st-level-val").textContent = lvl;
    document.getElementById("st-radius-info").textContent = lvl * 900;
    document.getElementById("st-status").value = data.status || "Активен";
    this._setStationOwner(data.player_id);
    const mobility = document.getElementById("st-mobility");
    const isStation = this._setStationMobilityVisible(this._editingSubtype);
    if (mobility) {
      mobility.value = this._stationMobility({
        ...obj,
        ...data,
        subtype: this._editingSubtype,
      });
    }
    document.getElementById("st-comment").value = this._commentWithoutMobility(
      data.comment || "",
    );
    document.getElementById("st-modal-title").textContent =
      "Редактировать: " + (data.name || "Алстанция");
    document.getElementById("st-delete-btn").style.display = "inline-block";
    const moveBtn = document.getElementById("st-move-btn");
    if (moveBtn) moveBtn.style.display = "inline-block";
    document.getElementById("st-drag-hint").style.display = "block";
    new bootstrap.Modal(document.getElementById("stationModal")).show();
  }

  _updateStationCoordInfo(x, y, z) {
    const el = document.getElementById("st-coord-info");
    if (!el) return;
    const cx = parseInt(x);
    const cy = parseInt(y);
    const cz = parseInt(z || 0);
    if (Number.isNaN(cx) || Number.isNaN(cy)) {
      el.textContent = "Координаты не заданы";
      return;
    }
    const inArea = this._isSystemInArea(cx, cy);
    el.textContent =
      "Координаты: [" +
      cx +
      ":" +
      cy +
      ":" +
      cz +
      "] · привязка к системе" +
      (inArea ? "" : " · вне зоны альянса");
    el.classList.toggle("text-danger", !inArea);
    el.classList.toggle("text-muted", inArea);
  }
  async saveStation() {
    const id = document.getElementById("st-id").value;
    const mobility = document.getElementById("st-mobility")?.value || "stationary";
    const rawComment = document.getElementById("st-comment").value;
    const isStation = this._setStationMobilityVisible(
      this._editingSubtype || this._createSubtype || "Алстанция",
    );
    const ownerId = this._selectedStationOwnerId();
    const ownerSearch = (document.getElementById("st-player-search")?.value || "").trim();
    if (ownerSearch && ownerSearch !== "— Не привязан —" && !ownerId) {
      alert("Выберите владельца из подсказки по точному нику или очистите поле владельца.");
      return;
    }
    const payload = {
      name: document.getElementById("st-name").value || "Алстанция",
      level: parseInt(document.getElementById("st-level").value) || 10,
      x: parseInt(document.getElementById("st-x").value),
      y: parseInt(document.getElementById("st-y").value),
      z: parseInt(document.getElementById("st-z").value) || 0,
      status: document.getElementById("st-status").value,
      comment: isStation ? this._commentWithMobility(rawComment, mobility) : rawComment,
      player_id: ownerId,
    };
    if (this._createSubtype && !id) {
      payload.subtype = this._createSubtype;
    }
    if (isNaN(payload.x) || isNaN(payload.y)) {
      alert("Укажите координаты X и Y");
      return;
    }
    try {
      let resp;
      if (id) {
        resp = await fetch("/map/api/stations/" + id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        resp = await fetch("/map/api/stations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      const data = await resp.json();
      if (!resp.ok) {
        alert(data.error || "Ошибка");
        return;
      }
      this._createSubtype = null;
      bootstrap.Modal.getInstance(
        document.getElementById("stationModal"),
      ).hide();
      await this.loadData();
      this.render();
      this._updateStationsList();
    } catch (e) {
      alert("Ошибка сети: " + e.message);
    }
  }

  moveStationFromModal() {
    const id = parseInt(document.getElementById("st-id").value);
    if (!id) return;
    const obj = this.objects.find((o) => o.id === id && o.type === "object");
    if (!obj) return;
    const modalEl = document.getElementById("stationModal");
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    this.startObjectMove(obj);
  }
  async deleteStation() {
    const id = document.getElementById("st-id").value;
    if (!id) return;
    if (!confirm("Удалить алстанцию?")) return;
    try {
      const resp = await fetch("/map/api/stations/" + id, { method: "DELETE" });
      if (!resp.ok) {
        const d = await resp.json();
        alert(d.error || "Ошибка");
        return;
      }
      bootstrap.Modal.getInstance(
        document.getElementById("stationModal"),
      ).hide();
      await this.loadData();
      this.render();
      this._updateStationsList();
    } catch (e) {
      alert("Ошибка сети: " + e.message);
    }
  }

  _updateStationsList() {
    const el = document.getElementById("stations-list");
    if (!el) return;
    const stations = this.objects.filter((o) => o.type === "object");
    if (!stations.length) {
      el.innerHTML = '<div class="text-muted small">Нет объектов</div>';
      return;
    }
    const icons = {
      Алстанция: "◆",
      ОПС: "■",
      Дуня: "▲",
      Луна: "●",
      Врата: "★",
    };
    const colors = {
      Алстанция: "#e74c3c",
      ОПС: "#e67e22",
      Дуня: "#f39c12",
      Луна: "#95a5a6",
      Врата: "#9b59b6",
    };
    el.innerHTML = stations
      .map((s) => {
        const subtype = s.subtype || "Объект";
        const icon = icons[subtype] || "●";
        const color = colors[subtype] || "#bdc3c7";
        const networkText = this._isAlstation(s)
          ? s.network_status === "main"
            ? " · главная"
            : s.network_connected
              ? " · сеть"
              : " · автономно"
          : "";
        return (
          '<div class="d-flex justify-content-between align-items-center mb-1 py-1 border-bottom border-secondary obj-row" data-id="' +
          s.id +
          '" style="font-size:12px;cursor:pointer;">' +
          '<span><span style="color:' +
          color +
          ';">' +
          icon +
          "</span> <strong>" +
          (s.name || "?") +
          "</strong> [" +
          s.x +
          ":" +
          s.y +
          ":" +
          (s.z || 0) +
          "] ур." +
          s.level +
          networkText +
          "</span>" +
          '<button class="btn btn-sm btn-outline-secondary py-0 px-1 obj-edit-btn" data-id="' +
          s.id +
          '"><i class="bi bi-pencil"></i></button>' +
          "</div>"
        );
      })
      .join("");
    const self = this;
    el.querySelectorAll(".obj-row").forEach(function (row) {
      row.addEventListener("click", function (ev) {
        if (ev.target.closest(".obj-edit-btn")) {
          const id = parseInt(row.dataset.id);
          const obj = self.objects.find((o) => o.id === id);
          if (obj) self._showStationEditor(obj);
          return;
        }
        const id = parseInt(row.dataset.id);
        const obj = self.objects.find((o) => o.id === id);
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
    this.ctx = minimapCanvas.getContext("2d");
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
      y: this.padding + (halfWorld - wy) * s,
    };
  }

  miniToWorld(mx, my) {
    const s = this._getMiniScale();
    const halfWorld = 500000;
    return {
      x: (mx - this.padding) / s - halfWorld,
      y: halfWorld - (my - this.padding) / s,
    };
  }

  render() {
    const c = this.ctx;
    const w = this.canvas.width,
      h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#0a0e14";
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

    c.strokeStyle = "#6c5ce7";
    c.lineWidth = 1.5;
    c.strokeRect(vpTL.x, vpTL.y, vpW, vpH);
    c.fillStyle = "rgba(108, 92, 231, 0.12)";
    c.fillRect(vpTL.x, vpTL.y, vpW, vpH);
  }

  _bindEvents() {
    let dragging = false;
    this.canvas.addEventListener("mousedown", (e) => {
      dragging = true;
      this._navigate(e);
    });
    this.canvas.addEventListener("mousemove", (e) => {
      if (dragging) this._navigate(e);
    });
    this.canvas.addEventListener("mouseup", () => {
      dragging = false;
    });
    this.canvas.addEventListener("mouseleave", () => {
      dragging = false;
    });
  }

  _navigate(e) {
    const r = this.canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (this.canvas.width / r.width);
    const my = (e.clientY - r.top) * (this.canvas.height / r.height);
    const world = this.miniToWorld(mx, my);
    this.gameMap.centerOn(world.x, world.y);
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const canvas = document.getElementById("map-canvas");
  if (canvas) {
    window.map = new GameMap(canvas);
    const miniCanvas = document.getElementById("minimap-canvas");
    if (miniCanvas) {
      window.minimap = new GameMinimap(miniCanvas, window.map);
      const origRender = window.map.render.bind(window.map);
      window.map.render = function () {
        origRender();
        window.minimap.render();
      };
    }
  }
});
