// levelScene.js — The playable core (Sprint 1).
// Responsibilities:
//   - Own the Grid model + camera control (pan/zoom).
//   - Tile picking + hover highlight.
//   - Build/erase buildings (budget-gated) via the palette.
//   - Wire dragging between compatible services at any grid distance.
//   - Spawn request packets at the gate, route them via BFS to a sink and back.
//   - Track success/fail + revenue/lost; draw HUD, palette, tooltips.
//
// Kept deliberately modular: economy/waves/win-conditions are Phase 2 and slot
// in around the marked hooks (spawn loop, on-complete, on-drop).

import { Scene } from "../engine/scene.js";
import { PALETTE, FONT } from "../theme.js";
import { Grid, TILE } from "../grid/grid.js";
import { getLevel } from "../levels/levels.js";
import { SERVICES, getService, canWire } from "../services/catalog.js";
import { connTypeAllows, CONN_ORDER, DEFAULT_CONN } from "../services/connections.js";
import { BuildPalette } from "../ui/palette.js";
import { drawHUD, drawEventBanner } from "../ui/hud.js";
import {
  drawFloor,
  drawWires,
  drawBuildings,
  drawAZBands,
  drawTileHighlight,
  drawGhost,
  drawPendingWire,
} from "../render/gridRenderer.js";
import { drawPacket, roundRect, lighten } from "../render/sprites.js";
import { audio } from "../engine/audio.js";
// ---- Phase 7 (R1): the simulation core is now a standalone, headless module.
// The scene owns rendering + input and drives a Simulation instance; the sim
// owns the economy/wave/event/load/packet state and the step. ----
import { Simulation } from "../sim/simulation.js";
import { zoneOfColumn, AZ_COUNT } from "../waves/events.js";
import { score, azSpread, OUTCOME } from "../economy/scoring.js";
import { makeRng } from "../sim/rng.js";
import { SINK_ROLES, ROLE } from "../services/catalog.js";
import { getDifficulty } from "../save/difficulty.js";

export class LevelScene extends Scene {
  enter(payload) {
    const level = getLevel(payload && payload.levelId);
    this.level = level;
    this.time = 0;

    // Difficulty (Phase 3: T3.8) — tightens budget + speeds up the whole round.
    this.diff = getDifficulty();
    this.speedMul = this.diff.speedMul;

    // Build + seed the grid (gates, pre-placed buildings) before handing it to
    // the sim, which owns everything that moves.
    const grid = new Grid(level.cols, level.rows);
    const gateKeys = [];
    for (const g of level.gates) {
      grid.place(SERVICES.route53, g.col, g.row);
      gateKeys.push(Grid.key(g.col, g.row));
    }
    for (const s of level.seed || []) {
      const svc = getService(s.id);
      if (svc) grid.place(svc, s.col, s.row);
    }

    // ---- Phase 7 (R1): the simulation core ----
    // Per-run seedable RNG drives all sim-path randomness (incident zones, drop
    // decisions) so a run is reproducible and the headless harness is deterministic.
    this._rng = makeRng();
    this.sim = new Simulation({
      level,
      grid,
      gateKeys,
      rng: this._rng,
      budget: Math.round(level.budget * this.diff.budgetMul),
    });
    this._endTimer = null; // armed when the outcome flips; null while playing

    // Interaction state.
    this.palette = new BuildPalette();
    this.hoverTile = null; // {col,row} or null
    this.wireFrom = null; // {col,row} when dragging a wire
    this._panning = false;

    // Particle effects (T4.1): burst on building placement.
    this._particles = [];

    // Sandbox revenue reinvestment slider (T4 fix): controls what fraction of
    // each completed request's revenue flows back into the AWS budget.
    // Only active when level.goalRequests === 0 (sandbox mode).
    this._reinvestRate = 0.5; // default 50%
    this._sliderDragging = false;
    this._sliderRect = null; // set during render

    // Center + frame the camera on the grid.
    const cam = this.game.camera;
    cam.centerOn(this.grid.worldWidth() / 2, this.grid.worldHeight() / 2);
    this._fitZoom();

    // ---- Briefing / intro-grace (Phase 2 polish) ----
    // The live sim (waves, bill, spawns) stays paused until the player presses
    // Begin, so the briefing can be read in full and the board pre-built calmly.
    this.started = false;
    this.briefingTime = 0; // counts up while the briefing is shown
    this.briefingAutoStart = 45; // failsafe: auto-begin after this long
    this.showHelp = false; // legend overlay (toggled with H)
    this._beginRect = null; // Begin button hit-box (set during render)
    this.connType = DEFAULT_CONN; // active wire connection type (Phase 5: T5.1)
    this.palette.connType = this.connType; // keep palette picker in sync
  }

  // ---- Delegating accessors (Phase 7 R1) ----
  // The simulation owns this state; the renderer + input handlers read/write it
  // through `this.X` exactly as before, so nothing downstream had to change.
  get grid() { return this.sim.grid; }
  get gateKeys() { return this.sim.gateKeys; }
  get bill() { return this.sim.bill; }
  get waves() { return this.sim.waves; }
  get events() { return this.sim.events; }
  get loadModel() { return this.sim.loadModel; }
  get packets() { return this.sim.packets; }
  get revenue() { return this.sim.revenue; }
  get lost() { return this.sim.lost; }
  get success() { return this.sim.success; }
  get failed() { return this.sim.failed; }
  get routeOk() { return this.sim.routeOk; }
  get _reqHint() { return this.sim._reqHint; }
  get _eventsSurvived() { return this.sim._eventsSurvived; }
  get budget() { return this.sim.budget; }
  set budget(v) { this.sim.budget = v; }
  get outcome() { return this.sim.outcome; }
  set outcome(v) { this.sim.outcome = v; }
  get outcomeReason() { return this.sim.outcomeReason; }
  set outcomeReason(v) { this.sim.outcomeReason = v; }
  get _routeDirty() { return this.sim._routeDirty; }
  set _routeDirty(v) { this.sim._routeDirty = v; }
  get _reinvestRate() { return this.sim._reinvestRate; }
  set _reinvestRate(v) { this.sim._reinvestRate = v; }

  _fitZoom() {
    const cam = this.game.camera;
    const margin = 1.18; // leave room for HUD/palette
    const zx = cam.vw / (this.grid.worldWidth() * margin);
    const zy = cam.vh / (this.grid.worldHeight() * margin);
    cam.zoom = clamp(Math.min(zx, zy), cam.minZoom, cam.maxZoom);
  }

  // -------------------------------------------------------------------------
  // UPDATE
  // -------------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    const input = this.game.input;
    const cam = this.game.camera;
    const W = this.game.canvas.cssW;
    const H = this.game.canvas.cssH;

    // Unlock AudioContext on the first user interaction (browser autoplay policy).
    if (input.leftDown || input.rightDown || input.pressed("Enter") || input.pressed("Space")) {
      audio.resume();
    }

    // Help legend (H) freezes the scene while it's open so it can be read safely.
    if (input.pressed("KeyH")) this.showHelp = !this.showHelp;
    if (this.showHelp) {
      if (input.pressed("Escape")) this.showHelp = false;
      return;
    }

    // ESC returns to title.
    if (input.pressed("Escape")) {
      this.game.scenes.go("title");
      return;
    }

    // C cycles the active wire connection type (Phase 5: T5.1). The palette
    // picker is the shared source of truth — keep both in step here and below.
    if (input.pressed("KeyC")) {
      const i = CONN_ORDER.indexOf(this.connType);
      this.connType = CONN_ORDER[(i + 1) % CONN_ORDER.length];
      this.palette.connType = this.connType;
      audio.play("wire");
    }
    // A palette click may have changed the type — adopt it.
    if (this.palette.connType && this.palette.connType !== this.connType) {
      this.connType = this.palette.connType;
    }

    // ---- Win/lose: once decided, freeze the sim and flip to results after a
    // short beat so the player sees the final frame (T2.4). The sim flips the
    // outcome; the scene owns the end-of-round pause + transition. ----
    if (this.outcome !== OUTCOME.PLAYING) {
      if (this._endTimer == null) this._endTimer = 1.6; // armed on the flip frame
      this._endTimer -= dt;
      if (this._endTimer <= 0) this._goToResults();
      this._animateBuildings(dt); // keep the world breathing under the overlay
      return;
    }

    // ---- Camera: zoom (wheel) + pan (middle-drag, Space-drag, or WASD/arrows) ----
    if (input.wheel !== 0) {
      // deltaY<0 (scroll up) -> factor>1 -> zoom in, toward the cursor.
      const factor = Math.pow(0.999, input.wheel);
      cam.zoomAt(input.x, input.y, factor);
    }
    // Middle-mouse drag pans (Input accumulates the delta in dragDX/DY).
    if (input.dragDX || input.dragDY) {
      cam.panScreen(input.dragDX, input.dragDY);
    }
    // Space + left-drag also pans (trackpads usually have no middle button).
    // We track our own last pointer position to derive the per-frame delta, and
    // set _panning so this drag doesn't also place/wire in the world below.
    const spacePan = input.isDown("Space");
    if (spacePan && input.left) {
      if (this._lastPanX != null) {
        cam.panScreen(input.x - this._lastPanX, input.y - this._lastPanY);
      }
      this._lastPanX = input.x;
      this._lastPanY = input.y;
      this._panning = true;
    } else {
      this._lastPanX = null;
      this._lastPanY = null;
      this._panning = false;
    }
    // Arrow / WASD keyboard pan.
    const panSpeed = 420 / cam.zoom;
    let kdx = 0,
      kdy = 0;
    if (input.isDown("ArrowLeft") || input.isDown("KeyA")) kdx -= 1;
    if (input.isDown("ArrowRight") || input.isDown("KeyD")) kdx += 1;
    if (input.isDown("ArrowUp") || input.isDown("KeyW")) kdy -= 1;
    if (input.isDown("ArrowDown") || input.isDown("KeyS")) kdy += 1;
    if (kdx || kdy) {
      cam.x += kdx * panSpeed * dt;
      cam.y += kdy * panSpeed * dt;
    }

    // ---- Pointer → tile picking ----
    // While the briefing is up, its card also blocks world clicks so reading or
    // pressing Begin never accidentally places a building on the board behind it.
    const overBriefing =
      !this.started && this._hitRect(this._briefingRect, input.x, input.y);
    // Sandbox slider tracks independently of the palette.
    const isSandbox = !this.level.goalRequests;
    if (isSandbox && this._sliderRect) {
      const sr = this._sliderRect;
      if (input.leftDown && input.x >= sr.x && input.x <= sr.x + sr.w &&
          input.y >= sr.y - 10 && input.y <= sr.y + sr.h + 10) {
        this._sliderDragging = true;
      }
      if (!input.left) this._sliderDragging = false;
      if (this._sliderDragging && input.left) {
        const frac = clamp((input.x - sr.x) / sr.w, 0, 1);
        this._reinvestRate = Math.round(frac * 10) / 10; // snap to 10%
      }
    }
    const overUI = this.palette.isOver(input.x, input.y) || overBriefing;
    this.palette.updateHover(input.x, input.y, dt);

    const world = cam.screenToWorld(input.x, input.y);
    const col = Math.floor(world.x / TILE);
    const row = Math.floor(world.y / TILE);
    this.hoverTile =
      !overUI && this.grid.inBounds(col, row) ? { col, row } : null;

    // ---- Palette clicks (UI first) ----
    if (input.leftDown && overUI) {
      this.palette.handleClick(input.x, input.y, this.budget);
    }

    // ---- World interactions (only when not over UI and not panning) ----
    if (!overUI && !this._panning) {
      this._handleWorld(input);
    }

    // Right-click on a wire cuts it (works regardless of armed tool).
    if (input.rightDown && this.hoverTile) {
      this._tryCutWireNear(this.hoverTile.col, this.hoverTile.row, world);
    }

    // ---- Begin the round when the briefing is dismissed (intro-grace). The
    // player can pan/build during the briefing; only this flips the sim on. ----
    if (!this.started) {
      this.briefingTime += dt;
      const beginClicked =
        this._beginRect &&
        this._hitRect(this._beginRect, input.x, input.y) &&
        input.leftDown;
      if (
        input.pressed("Enter") ||
        input.pressed("Space") ||
        beginClicked ||
        this.briefingTime >= this.briefingAutoStart
      ) {
        this.started = true;
      }
    }

    // ---- Recompute route validity (during the briefing too, so the topology
    // indicator + build ghost stay live while you set up). Disabled tiles (AZ
    // failure) are excluded, so an outage invalidates a single-zone route. ----
    this.sim.recomputeRoute();

    // ---- The live sim (waves, bill, spawns, overload, win/lose) runs only once
    // the shift has begun. `sdt` is the difficulty-scaled timestep (T3.8): on
    // harder tiers the whole round — waves, spawns, bill, guests — runs faster. ----
    if (this.started) {
      const sdt = dt * this.speedMul;
      this.sim.step(sdt);
      this._drainSim();
    }

    // ---- Building idle animation (always, so the world keeps breathing). ----
    this._animateBuildings(dt);
  }

  // Screen-space rect hit test.
  _hitRect(r, x, y) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // Build the results payload (score + stars + bill breakdown) and transition.
  _goToResults() {
    if (this._sentResults) return;
    this._sentResults = true;

    // AZ spread: how many zones host the player's compute/sink buildings.
    const zoneCounts = new Array(AZ_COUNT).fill(0);
    for (const b of this.grid.buildings.values()) {
      const role = b.service.role;
      if (role === ROLE.COMPUTE || SINK_ROLES.has(role)) {
        zoneCounts[zoneOfColumn(b.col, this.level.cols)]++;
      }
    }
    const spread = azSpread(zoneCounts);
    const bd = this.bill.breakdown();

    // Resilience denominator: only events that actually fired (warning/active/
    // done) count as "faced", so winning early isn't penalised for events that
    // never arrived. Surviving = facing it and still being in the round.
    let faced = 0;
    for (const e of this.events.events) {
      if (e.state !== "pending") faced++;
    }
    const survived =
      this.outcome === OUTCOME.LOSE
        ? this._eventsSurvived // a loss stops the clock; only fully-cleared ones count
        : faced; // win/cashout: everything that fired was weathered

    const sc = score({
      success: this.success,
      failed: this.failed,
      revenue: this.revenue,
      lost: this.lost,
      billTotal: bd.total,
      startBudget: this.level.budget,
      eventsFaced: faced,
      eventsSurvived: survived,
      azSpread: spread,
      outcome: this.outcome,
    });

    this.game.scenes.go("results", {
      levelId: this.level.id,
      levelName: this.level.name,
      nextLevelId: this.level.next || null,
      outcome: this.outcome,
      outcomeReason: this.outcomeReason,
      success: this.success,
      failed: this.failed,
      revenue: this.revenue,
      lost: this.lost,
      budget: this.budget,
      startBudget: this.level.budget,
      goalRequests: this.level.goalRequests,
      bill: bd,
      score: sc.value,
      stars: sc.stars,
      factors: sc.factors,
    });
  }

  _handleWorld(input) {
    const t = this.hoverTile;

    // BUILD mode: left-click places the armed service on an empty in-bounds tile.
    if (this.palette.selected) {
      const svc = SERVICES[this.palette.selected];
      if (input.leftDown && t && !this.grid.hasBuilding(t.col, t.row)) {
        if (this.sim.economy.canAfford(svc.cost)) {
          this.grid.place(svc, t.col, t.row);
          this.sim.economy.spend(svc.cost);
          this._routeDirty = true;
          audio.play("place");
          this._spawnParticles(t.col * TILE + TILE / 2, t.row * TILE + TILE / 2, svc.color);
          if (!this.sim.economy.canAfford(svc.cost)) this.palette.clearSelection();
        }
      }
      return;
    }

    // ERASE mode: left-click removes a building (refund), except the gate.
    if (this.palette.eraseMode) {
      if (input.leftDown && t) {
        const b = this.grid.getBuilding(t.col, t.row);
        if (b && b.service.role !== "gate") {
          this.grid.remove(t.col, t.row);
          this.sim.economy.credit(b.service.cost); // refund
          this._routeDirty = true;
          audio.play("erase");
          this.sim._dropPacketsOnBrokenPaths();
        }
      }
      return;
    }

    // WIRE mode: press on a building tile to start a wire, release on any
    // compatible building tile to commit it (any distance).
    if (this.palette.wireMode) {
      if (input.leftDown && t && this.grid.hasBuilding(t.col, t.row)) {
        this.wireFrom = { col: t.col, row: t.row };
      }
      if (input.leftUp && this.wireFrom) {
        this._commitWire(t);
        this.wireFrom = null;
      }
      return;
    }

    // DEFAULT (no tool): left-click a wire-eligible pair also drags a wire,
    // so wiring feels natural even without arming the tool.
    if (input.leftDown && t && this.grid.hasBuilding(t.col, t.row)) {
      this.wireFrom = { col: t.col, row: t.row };
    }
    if (input.leftUp && this.wireFrom) {
      this._commitWire(t);
      this.wireFrom = null;
    }
  }

  // Commit a wire from this.wireFrom to the tile under the cursor, if legal.
  // Wires span any distance on the grid (no adjacency rule) — a real VPC links
  // services across subnets/AZs, not just neighbouring racks. Legality is purely
  // service-appropriateness (canWire). Cross-AZ wires bill a small data-transfer
  // surcharge per packet (see _updatePackets), mirroring AWS inter-AZ pricing.
  _commitWire(toTile) {
    const from = this.wireFrom;
    if (!from || !toTile) return;
    if (from.col === toTile.col && from.row === toTile.row) return;

    const a = this.grid.getBuilding(from.col, from.row);
    const b = this.grid.getBuilding(toTile.col, toTile.row);
    if (!a || !b) return;
    if (!canWire(a.service, b.service)) return;
    // Per-type topology rule (e.g. PrivateLink needs a sink endpoint).
    if (!connTypeAllows(this.connType, a.service, b.service)) return;

    const aKey = Grid.key(from.col, from.row);
    const bKey = Grid.key(toTile.col, toTile.row);
    if (this.grid.addEdge(aKey, bKey, this.connType)) {
      this._routeDirty = true;
      audio.play("wire");
    }
  }

  // Cut a wire if the cursor is near a midpoint of one touching this tile.
  _tryCutWireNear(col, row, world) {
    const k = Grid.key(col, row);
    let best = null;
    let bestD = 1e9;
    for (const nk of this.grid.neighbors(k)) {
      const [nc, nr] = Grid.parseKey(nk);
      const mx = ((col + nc) / 2) * TILE + TILE / 2;
      const my = ((row + nr) / 2) * TILE + TILE / 2;
      const d = Math.hypot(world.x - mx, world.y - my);
      if (d < bestD) {
        bestD = d;
        best = nk;
      }
    }
    if (best && bestD < TILE * 0.6) {
      const [nc, nr] = Grid.parseKey(best);
      this.grid.removeEdge(col, row, nc, nr);
      this._routeDirty = true;
      this.sim._dropPacketsOnBrokenPaths();
    }
  }

  // Drain the side-effect events the sim queued during step() and turn them into
  // the scene's audio + floating-text feedback. This is the one place render/
  // audio concerns re-attach to the pure sim — keeping the sim itself headless.
  _drainSim() {
    for (const e of this.sim.drainEmitted()) {
      if (e.kind === "sound") audio.play(e.name);
      else if (e.kind === "float")
        this._spawnFloat(e.x, e.y, e.text, e.good ? PALETTE.good : PALETTE.bad);
    }
  }

  // Floating "+$/drop" text feedback.
  _spawnFloat(x, y, text, color) {
    if (!this._floats) this._floats = [];
    this._floats.push({ x, y, text, color, life: 1 });
  }

  // Burst of small squares on building placement (T4.1).
  _spawnParticles(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 55 + Math.random() * 90;
      this._particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: 1,
        color,
        size: 3.5 + Math.random() * 4,
      });
    }
  }

  _animateBuildings(dt) {
    // Find nearest packet to each building so eyes glance at passing guests.
    for (const b of this.grid.buildings.values()) {
      b.bob += dt * 2.2;
      b.activity = Math.max(0, b.activity - dt * 2.5);

      let nx = 0,
        ny = 0,
        bestD = 1e9;
      const bx = b.col * TILE + TILE / 2;
      const by = b.row * TILE + TILE / 2;
      for (const p of this.packets) {
        const d = (p.x - bx) * (p.x - bx) + (p.y - by) * (p.y - by);
        if (d < bestD) {
          bestD = d;
          nx = p.x - bx;
          ny = p.y - by;
        }
      }
      if (bestD < (TILE * 3) * (TILE * 3) && (nx || ny)) {
        const len = Math.hypot(nx, ny) || 1;
        // Ease toward the gaze target.
        b.eyeTargetX += (clamp(nx / len, -1, 1) - b.eyeTargetX) * 0.2;
        b.eyeTargetY += (clamp(ny / len, -1, 1) - b.eyeTargetY) * 0.2;
      } else {
        // Idle: drift eyes back toward a gentle downward gaze.
        b.eyeTargetX += (0 - b.eyeTargetX) * 0.05;
        b.eyeTargetY += (0.15 - b.eyeTargetY) * 0.05;
      }
    }

    if (this._floats) {
      for (const f of this._floats) f.life -= dt * 0.9;
      this._floats = this._floats.filter((f) => f.life > 0);
    }

    // Particles (T4.1).
    if (this._particles.length > 0) {
      for (const p of this._particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 180 * dt; // gravity
        p.vx *= 0.92;
        p.life -= dt * 2.8;
      }
      this._particles = this._particles.filter((p) => p.life > 0);
    }
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  render(ctx, alpha) {
    const cam = this.game.camera;
    const W = this.game.canvas.cssW;
    const H = this.game.canvas.cssH;

    // Backdrop (outside the grid).
    ctx.fillStyle = PALETTE.bgDeep;
    ctx.fillRect(0, 0, W, H);

    // ---- World space ----
    ctx.save();
    cam.applyTo(ctx);

    drawFloor(ctx, this.grid, this.time);
    // Availability-Zone bands + any failed-zone wash (T2.3), under the wires.
    drawAZBands(ctx, this.grid, this.events.failedZones(), this.time);
    drawWires(ctx, this.grid, this.time);

    // Hover highlight + ghost/wire previews.
    if (this.hoverTile) {
      const { col, row } = this.hoverTile;
      if (this.palette.selected) {
        const svc = SERVICES[this.palette.selected];
        const valid =
          !this.grid.hasBuilding(col, row) && svc.cost <= this.budget;
        drawGhost(ctx, svc, col, row, valid);
      } else if (this.palette.eraseMode) {
        const b = this.grid.getBuilding(col, row);
        drawTileHighlight(ctx, col, row, b && b.service.role !== "gate" ? "invalid" : "hover");
      } else {
        drawTileHighlight(ctx, col, row, "hover");
      }
    }

    // Pending wire drag.
    if (this.wireFrom) {
      const world = cam.screenToWorld(this.game.input.x, this.game.input.y);
      let valid = false;
      if (this.hoverTile) {
        const a = this.grid.getBuilding(this.wireFrom.col, this.wireFrom.row);
        const b = this.grid.getBuilding(this.hoverTile.col, this.hoverTile.row);
        // Wires span any distance — validity is service-appropriateness plus the
        // active connection type's topology rule (e.g. PrivateLink → sink end).
        valid = a && b && canWire(a.service, b.service) &&
                connTypeAllows(this.connType, a.service, b.service);
      }
      drawPendingWire(
        ctx,
        this.wireFrom.col,
        this.wireFrom.row,
        world.x,
        world.y,
        valid
      );
    }

    drawBuildings(ctx, this.grid, this.time);

    // Packets on top of buildings.
    for (const p of this.packets) {
      drawPacket(ctx, p.renderX(alpha), p.renderY(alpha), {
        bob: p.bob,
        status: p.status,
        history: p._history,
      });
    }

    // Placement particles (T4.1) — above buildings, below floats.
    for (const p of this._particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life) * 0.85;
      ctx.fillStyle = p.color;
      const s = p.size * Math.max(0.3, p.life);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.restore();
    }

    // Floating feedback text (world space).
    if (this._floats) {
      ctx.textAlign = "center";
      ctx.font = "700 14px system-ui, sans-serif";
      for (const f of this._floats) {
        ctx.globalAlpha = Math.max(0, f.life);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y - (1 - f.life) * 26);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    // ---- End world space ----

    // World-space building tooltip (drawn in screen space at cursor).
    this._renderBuildingTooltip(ctx);

    // HUD + palette (screen space). On a demand-driven level the wave chip shows
    // the living-economy phase (day / hour / peak) instead of a scripted phase.
    const cur = this.waves.current();
    const dem = this.sim.demand;
    const wave = dem
      ? { phaseName: dem.label(this.sim.simTime), progress: dem.dayFraction(this.sim.simTime) }
      : { phaseName: cur.phase.name, progress: this.waves.progress() };
    drawHUD(ctx, W, H, {
      budget: this.budget,
      startBudget: this.level.budget,
      revenue: this.revenue,
      lost: this.lost,
      success: this.success,
      failed: this.failed,
      routeOk: this.routeOk,
      fps: this.game.loop.fps,
      billTotal: this.bill.totalSpent,
      burnRate: this.bill.burnRate,
      goalRequests: this.level.goalRequests,
      wave,
    });
    this.palette.render(ctx, W, H, this.budget);

    // Telegraphed event warning / active banner (T2.3).
    drawEventBanner(ctx, W, this.events.banner());

    // Persistent one-line objective (always visible, top-center) — keeps the
    // core goal + flow on screen after the briefing closes.
    this._renderObjective(ctx, W);

    // Win requirement hint: shown when goal count is met but build doesn't satisfy
    // the level's service constraints. Otherwise, if a placed building has an
    // unmet structural dependency (e.g. a Read Replica with no source primary),
    // warn about that — it's why the route may not be forming.
    if (this._reqHint) {
      this._renderReqHint(ctx, W);
    } else {
      const inv = this._firstInvalidBuilding();
      if (inv) this._renderDepHint(ctx, W, inv);
    }

    // Sandbox reinvestment slider (only in sandbox mode, once shift started).
    if (!this.level.goalRequests && this.started) this._renderSandboxSlider(ctx, W);

    // Briefing overlay — stays up (sim paused) until the shift begins.
    if (!this.started) this._renderBriefing(ctx, W, H);

    // "Cash out" button (end early to the report) — only once the shift is on.
    this._renderEndButton(ctx, W, H);

    // Win/lose overlay once the round is decided (T2.4).
    if (this.outcome !== OUTCOME.PLAYING) this._renderOutcome(ctx, W, H);

    // Help legend on top of everything when toggled (H).
    if (this.showHelp) this._renderHelp(ctx, W, H);
  }

  // Full-screen-ish verdict card shown for the brief end-of-round beat.
  _renderOutcome(ctx, W, H) {
    const win = this.outcome === OUTCOME.WIN;
    ctx.save();
    ctx.fillStyle = "rgba(8,11,15,0.6)";
    ctx.fillRect(0, 0, W, H);
    const txt = win ? "WAVE SURVIVED!" : "GAME OVER";
    const sub = win
      ? "Tallying your score…"
      : this.outcomeReason === "bankrupt"
        ? "The AWS bill drained your budget."
        : "Too many requests dropped — SLA breached.";
    ctx.textAlign = "center";
    ctx.fillStyle = win ? PALETTE.good : PALETTE.bad;
    ctx.font = "800 52px system-ui, sans-serif";
    ctx.fillText(txt, W / 2, H / 2 - 8);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.uiBig;
    ctx.fillText(sub, W / 2, H / 2 + 30);
    ctx.restore();
  }

  // Tooltip when hovering a placed building on the grid (not over the palette).
  _renderBuildingTooltip(ctx) {
    if (!this.hoverTile) return;
    if (this.palette.selected || this.palette.eraseMode || this.wireFrom) return;
    const b = this.grid.getBuilding(this.hoverTile.col, this.hoverTile.row);
    if (!b) return;
    const svc = b.service;

    const mx = this.game.input.x + 16;
    const my = this.game.input.y + 16;
    const w = 250;
    const lines = wrapText(svc.blurb, 36);
    const stat =
      svc.role === "gate"
        ? "Front gate — entry & exit"
        : `$${svc.cost}  •  thrpt ${svc.throughput}  •  ${svc.latency}ms`;

    // Live status line (Phase 2): offline / overloaded / load% + current latency.
    let live = null;
    let liveColor = PALETTE.textDim;
    if (svc.role !== "gate") {
      if (b.invalid) {
        live = "INVALID — missing required dependency (see banner)";
        liveColor = PALETTE.warn;
      } else if (b.disabled) {
        live = "OFFLINE — this AZ is down";
        liveColor = PALETTE.bad;
      } else {
        const pct = Math.round((b.load || 0) * 100);
        const lat = Math.round(b.latencyMs || svc.latency);
        if (b.dropping) {
          live = `OVERLOADED ${pct}% — dropping! ${lat}ms`;
          liveColor = PALETTE.bad;
        } else if ((b.load || 0) > 0.7) {
          live = `Load ${pct}% — nearing capacity, ${lat}ms`;
          liveColor = PALETTE.warn;
        } else {
          live = `Load ${pct}% — healthy, ${lat}ms`;
          liveColor = PALETTE.good;
        }
      }
    }

    const tipLines = svc.examTip ? wrapText(svc.examTip, 34) : [];
    const h = (live ? 62 : 46) + lines.length * 15 + (tipLines.length > 0 ? 6 + tipLines.length * 15 : 0);

    // Keep on screen.
    const W = this.game.canvas.cssW;
    const x = Math.min(mx, W - w - 8);
    const y = my;

    ctx.fillStyle = "rgba(18,24,32,0.96)";
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = b.disabled ? PALETTE.bad : svc.color;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 10);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = FONT.ui;
    ctx.fillStyle = lighten(svc.color, 0.25);
    ctx.fillText(svc.emoji + "  " + svc.label, x + 12, y + 10);
    ctx.font = FONT.uiSmall;
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText(stat, x + 12, y + 30);
    let ty = y + 46;
    if (live) {
      ctx.fillStyle = liveColor;
      ctx.fillText(live, x + 12, ty);
      ty += 16;
    }
    ctx.fillStyle = PALETTE.textDim;
    for (const ln of lines) {
      ctx.fillText(ln, x + 12, ty);
      ty += 15;
    }

    if (tipLines.length > 0) {
      ty += 4;
      ctx.fillStyle = PALETTE.accent;
      ctx.font = "700 10px system-ui, sans-serif";
      ctx.fillText("📚 EXAM TIP", x + 12, ty);
      ty += 14;
      ctx.font = FONT.uiSmall;
      ctx.fillStyle = PALETTE.textDim;
      for (const ln of tipLines) {
        ctx.fillText(ln, x + 12, ty);
        ty += 15;
      }
    }
  }

  // Briefing card shown until the shift begins (sim paused). Honors explicit
  // line breaks in the intro, dims the board, and offers a Begin button.
  _renderBriefing(ctx, W, H) {
    const a = Math.min(1, this.briefingTime / 0.4); // gentle fade-in
    const paras = String(this.level.intro || "").split("\n");
    const lines = [];
    for (const p of paras) {
      if (p.trim() === "") {
        lines.push("");
        continue;
      }
      for (const ln of wrapText(p, 64)) lines.push(ln);
    }
    // Teaching card (T3.7): surface the SAA-C03 exam tip up-front, taught before
    // the round (it's also shown again on the results screen for reinforcement).
    const tipLines = this.level.examTip ? wrapText(this.level.examTip, 72) : [];
    const tipH = tipLines.length ? tipLines.length * 15 + 40 : 0;

    const w = 600;
    const pad = 22;
    const titleH = 54;
    const bodyH = lines.length * 18;
    const btnH = 46;
    const h = pad * 2 + titleH + bodyH + tipH + btnH + 18;
    const x = W / 2 - w / 2;
    const y = Math.max(64, H / 2 - h / 2);
    this._briefingRect = { x, y, w, h };

    ctx.save();
    ctx.globalAlpha = a;

    // Dim backdrop to focus the read.
    ctx.fillStyle = "rgba(8,11,15,0.5)";
    ctx.fillRect(0, 0, W, H);

    // Card.
    ctx.fillStyle = "rgba(18,24,32,0.97)";
    roundRect(ctx, x, y, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = PALETTE.accent;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 16);
    ctx.stroke();

    // Title.
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = PALETTE.accent;
    ctx.font = FONT.uiBig;
    ctx.fillText("🦝  " + this.level.name, x + pad, y + pad);
    // Difficulty subtitle (T3.8).
    ctx.font = FONT.uiSmall;
    ctx.fillStyle = PALETTE.textFaint;
    ctx.fillText(
      "Difficulty: " + this.diff.name + " — change on the title screen",
      x + pad,
      y + pad + 26
    );

    // Body.
    ctx.font = FONT.uiSmall;
    ctx.fillStyle = PALETTE.textDim;
    let ty = y + pad + titleH;
    for (const ln of lines) {
      if (ln) ctx.fillText(ln, x + pad, ty);
      ty += 18;
    }

    // Exam-tip teaching strip (T3.7).
    if (tipLines.length) {
      ty += 8;
      ctx.strokeStyle = "rgba(142,123,239,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + pad, ty);
      ctx.lineTo(x + w - pad, ty);
      ctx.stroke();
      ty += 12;
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.fillStyle = PALETTE.accent;
      ctx.fillText("📚  SAA-C03 EXAM TIP  ·  deeper notes in the Rackoon study guide", x + pad, ty);
      ty += 17;
      ctx.font = FONT.uiSmall;
      ctx.fillStyle = PALETTE.textDim;
      for (const ln of tipLines) {
        ctx.fillText(ln, x + pad, ty);
        ty += 15;
      }
    }

    // Begin button.
    const bw = 200;
    const bh = 40;
    const bx = W / 2 - bw / 2;
    const by = y + h - pad - bh;
    this._beginRect = { x: bx, y: by, w: bw, h: bh };
    const over = this._hitRect(this._beginRect, this.game.input.x, this.game.input.y);
    ctx.fillStyle = over ? PALETTE.accent : "#e09a2e";
    roundRect(ctx, bx, by, bw, bh, 12);
    ctx.fill();
    ctx.fillStyle = "#1a120a";
    ctx.font = "800 18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("▶  Begin shift", W / 2, by + bh / 2 + 1);

    // Keyboard hint.
    ctx.fillStyle = PALETTE.textFaint;
    ctx.font = FONT.uiSmall;
    ctx.textBaseline = "top";
    ctx.fillText(
      "Press Enter / Space to begin  •  H for help  •  you can build while you read",
      W / 2,
      by + bh + 8
    );
    ctx.restore();
  }

  // Slim always-on objective reminder (top-center) so the goal + flow stay clear.
  _renderObjective(ctx, W) {
    if (!this.started && this.briefingTime < 0.3) return; // let the card own the first beat
    const isSandbox = !this.level.goalRequests;
    const txt = isSandbox
      ? "∞ Sandbox — " + this.success + " routed   ·   gate → compute → database"
      : "🎯 Route " + this.success + " / " + this.level.goalRequests + "   ·   gate → compute → database";
    ctx.save();
    ctx.font = FONT.uiSmall;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(txt).width + 28;
    const h = 24;
    const x = W / 2 - w / 2;
    const y = 12;
    ctx.fillStyle = "rgba(18,24,32,0.85)";
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,179,71,0.25)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 12);
    ctx.stroke();
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText(txt, W / 2, y + h / 2 + 1);
    ctx.restore();
  }

  // Help legend overlay (toggled with H; pauses the scene while open).
  _renderHelp(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = "rgba(8,11,15,0.74)";
    ctx.fillRect(0, 0, W, H);

    const rows = [
      ["🎯", "Goal", "Route the target number of guests: gate → compute → database → back."],
      ["🧱", "Build & wire", "Click a service in the bottom bar, then an empty tile. Drag from one service to another to wire — any distance, no adjacency needed; right-click a wire to cut."],
      ["🔌", "Connection types", "Pick the wire type in the bar (or press C): VPC link, VPC Peering, Transit Gateway, PrivateLink. Each prices the hop differently — TGW always adds processing; PrivateLink avoids the cross-AZ penalty but must end at a sink."],
      ["💰", "AWS bill", "Buildings + data transfer burn your budget (top-left). Intra-AZ traffic is FREE; a wire crossing an AZ band (amber) costs 8× per hop. Multi-AZ resilience is real money — keep chatty tiers in one AZ. Don't let the budget hit $0."],
      ["📈", "Waves", "Traffic ramps up in phases (top-right). Add capacity before the peaks arrive."],
      ["🔥", "Overload", "A building past its throughput queues up — latency climbs, then it drops guests. Watch the hot tiles."],
      ["🗺️", "Zones", "The board spans AZ bands (us-rk-1a/b/c). A zone can fail and disable its tiles — spread compute & DBs across zones. Route 53 is global: immune to AZ failures, wires to any zone."],
      ["⭐", "Score", "Stars reward uptime, cost-efficiency, and resilience. Win to unlock the next level."],
    ];

    // Layout constants. Pre-wrap every description so each row claims exactly the
    // vertical space it needs (fixes the old fixed-height rows overlapping).
    const w = 620;
    const pad = 26;
    const labelX = 60; // text column (icon sits in the left gutter)
    const lineH = 16;
    const titleGap = 20; // label baseline → first description line
    const rowGap = 16; // space between rows
    const wrapChars = 76;
    const x = W / 2 - w / 2;

    const items = rows.map(([icon, label, desc]) => ({
      icon, label, lines: wrapText(desc, wrapChars),
    }));
    let bodyH = 0;
    for (const it of items) bodyH += titleGap + it.lines.length * lineH + rowGap;

    const headerH = 58;
    const footerH = 40;
    const h = headerH + bodyH + footerH;
    const y = Math.max(20, H / 2 - h / 2);

    ctx.fillStyle = "rgba(18,24,32,0.98)";
    roundRect(ctx, x, y, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = PALETTE.accent;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 16);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = PALETTE.accent;
    ctx.font = FONT.uiBig;
    ctx.fillText("How to play", x + pad, y + 22);

    let ry = y + headerH;
    for (const it of items) {
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(it.icon, x + pad, ry - 1);
      ctx.font = "700 13px system-ui, sans-serif";
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(it.label, x + labelX, ry);
      ctx.font = FONT.uiSmall;
      ctx.fillStyle = PALETTE.textDim;
      let dy = ry + titleGap;
      for (const ln of it.lines) {
        ctx.fillText(ln, x + labelX, dy);
        dy += lineH;
      }
      ry += titleGap + it.lines.length * lineH + rowGap;
    }

    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.textFaint;
    ctx.font = FONT.uiSmall;
    ctx.fillText("Press H or Esc to close", W / 2, y + h - 24);
    ctx.restore();
  }

  _renderEndButton(ctx, W, H) {
    // Hidden during the briefing, and once the round has resolved.
    if (!this.started || this.outcome !== OUTCOME.PLAYING) return;
    // No Cash Out in Sandbox: there's no goal to wrap up, and it collides with the
    // reinvestment slider. Esc returns to the menu instead.
    if (!this.level.goalRequests) return;
    const w = 130;
    const h = 30;
    const x = W - w - 14;
    const y = 92; // below the topology chip + wave bar
    const over =
      this.game.input.x >= x &&
      this.game.input.x <= x + w &&
      this.game.input.y >= y &&
      this.game.input.y <= y + h;
    this._endRect = { x, y, w, h };

    ctx.fillStyle = over ? PALETTE.bgPanelHi : PALETTE.bgPanel;
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.uiSmall;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Cash out ▸", x + w / 2, y + h / 2);
    ctx.textBaseline = "alphabetic";

    if (over && this.game.input.leftDown) {
      // Ending early: a win if the routed goal is already met, otherwise it's
      // scored as a (non-loss) wrap-up — the score reflects what you achieved.
      this.outcome =
        this.level.goalRequests && this.success >= this.level.goalRequests
          ? OUTCOME.WIN
          : OUTCOME.WIN; // cashing out is always a "completed" run, just lower-scored
      this.outcomeReason = "cashout";
      this._goToResults();
    }
  }

  // Requirement-not-met warning: amber chip below the objective, explaining
  // what the player's route is still missing to qualify for a win.
  _renderReqHint(ctx, W) {
    const lines = wrapText(this._reqHint, 70);
    ctx.save();
    ctx.font = FONT.uiSmall;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const lineH = 14;
    const w = Math.min(W - 40, 520);
    const h = 18 + lines.length * lineH;
    const x = W / 2 - w / 2;
    const y = 44; // just below the objective chip

    ctx.fillStyle = "rgba(255,179,71,0.12)";
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = PALETTE.warn;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();

    ctx.fillStyle = PALETTE.warn;
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText("⚠ GOAL MET — BUT WIN BLOCKED:", W / 2, y + 5);
    ctx.font = FONT.uiSmall;
    ctx.fillStyle = PALETTE.text;
    let ty = y + 17;
    for (const ln of lines) {
      ctx.fillText(ln, W / 2, ty);
      ty += lineH;
    }
    ctx.restore();
  }

  // First placed building with an unmet structural dependency, or null.
  _firstInvalidBuilding() {
    for (const b of this.grid.buildings.values()) {
      if (b.invalid) return b;
    }
    return null;
  }

  // Dependency warning chip: a placed tile can't function until its required
  // source service exists on the board (e.g. Read Replica needs a primary).
  _renderDepHint(ctx, W, b) {
    const svc = b.service;
    const msg = (svc.dependsOn && svc.dependsOn.hint) || (svc.label + " is missing a required dependency.");
    const lines = wrapText(msg, 70);
    ctx.save();
    ctx.font = FONT.uiSmall;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const lineH = 14;
    const w = Math.min(W - 40, 520);
    const h = 18 + lines.length * lineH;
    const x = W / 2 - w / 2;
    const y = 44;

    ctx.fillStyle = "rgba(255,179,71,0.12)";
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = PALETTE.warn;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();

    ctx.fillStyle = PALETTE.warn;
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText("⚠ " + svc.label.toUpperCase() + " INACTIVE:", W / 2, y + 5);
    ctx.font = FONT.uiSmall;
    ctx.fillStyle = PALETTE.text;
    let ty = y + 17;
    for (const ln of lines) {
      ctx.fillText(ln, W / 2, ty);
      ty += lineH;
    }
    ctx.restore();
  }

  // Sandbox revenue-reinvestment slider. Horizontal track in the top-right area.
  _renderSandboxSlider(ctx, W) {
    const slW = 200;
    const slH = 8;
    const slX = W - slW - 14;
    const slY = 130; // below Cash Out button
    this._sliderRect = { x: slX, y: slY, w: slW, h: slH };

    ctx.save();

    // Label.
    ctx.font = FONT.uiSmall;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText(
      "💰 Revenue → Budget: " + Math.round(this._reinvestRate * 100) + "%",
      slX + slW,
      slY - 5
    );

    // Track background.
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, slX, slY, slW, slH, 4);
    ctx.fill();

    // Filled portion.
    const fillW = Math.max(0, slW * this._reinvestRate);
    if (fillW > 1) {
      ctx.fillStyle = PALETTE.good;
      roundRect(ctx, slX, slY, fillW, slH, 4);
      ctx.fill();
    }

    // Thumb.
    const thumbX = slX + fillW;
    ctx.fillStyle = PALETTE.text;
    ctx.beginPath();
    ctx.arc(thumbX, slY + slH / 2, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.bgDeep;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 0% / 100% end labels.
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = PALETTE.textFaint;
    ctx.fillText("0%", slX, slY + slH + 12);
    ctx.textAlign = "right";
    ctx.fillText("100%", slX + slW, slY + slH + 12);

    ctx.restore();
  }
}

// ---- helpers ----
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function wrapText(text, n) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > n) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}
