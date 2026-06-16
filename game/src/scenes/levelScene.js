// levelScene.js — The playable core (Sprint 1).
// Responsibilities:
//   - Own the Grid model + camera control (pan/zoom).
//   - Tile picking + hover highlight.
//   - Build/erase buildings (budget-gated) via the palette.
//   - Wire dragging between adjacent compatible tiles.
//   - Spawn request packets at the gate, route them via BFS to a sink and back.
//   - Track success/fail + revenue/lost; draw HUD, palette, tooltips.
//
// Kept deliberately modular: economy/waves/win-conditions are Phase 2 and slot
// in around the marked hooks (spawn loop, on-complete, on-drop).

import { Scene } from "../engine/scene.js";
import { PALETTE, FONT } from "../theme.js";
import { Grid, TILE } from "../grid/grid.js";
import { getLevel } from "../levels/levels.js";
import { SERVICES, getService, canConnect } from "../services/catalog.js";
import { findRoundTrip, gateHasRoute } from "../grid/pathfind.js";
import { Packet } from "../entities/packet.js";
import { BuildPalette } from "../ui/palette.js";
import { drawHUD, drawHints } from "../ui/hud.js";
import {
  drawFloor,
  drawWires,
  drawBuildings,
  drawTileHighlight,
  drawGhost,
  drawPendingWire,
} from "../render/gridRenderer.js";
import { drawPacket, roundRect, lighten } from "../render/sprites.js";

export class LevelScene extends Scene {
  enter(payload) {
    const level = getLevel(payload && payload.levelId);
    this.level = level;
    this.grid = new Grid(level.cols, level.rows);
    this.time = 0;

    // Economy / counters (Phase 1 subset).
    this.budget = level.budget;
    this.revenue = 0;
    this.lost = 0;
    this.success = 0;
    this.failed = 0;

    // Place the gate(s) from the level def.
    this.gateKeys = [];
    for (const g of level.gates) {
      this.grid.place(SERVICES.route53, g.col, g.row);
      this.gateKeys.push(Grid.key(g.col, g.row));
    }
    // Seed any pre-placed buildings.
    for (const s of level.seed || []) {
      const svc = getService(s.id);
      if (svc) this.grid.place(svc, s.col, s.row);
    }

    // Packets in flight.
    this.packets = [];
    this._spawnAcc = 0;

    // Cached route validity (recomputed when topology changes).
    this.routeOk = false;
    this._routeDirty = true;

    // Interaction state.
    this.palette = new BuildPalette();
    this.hoverTile = null; // {col,row} or null
    this.wireFrom = null; // {col,row} when dragging a wire
    this._panning = false;

    // Center + frame the camera on the grid.
    const cam = this.game.camera;
    cam.centerOn(this.grid.worldWidth() / 2, this.grid.worldHeight() / 2);
    this._fitZoom();

    this.introTimer = 6; // show the intro banner for a few seconds
  }

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
    if (this.introTimer > 0) this.introTimer -= dt;
    const input = this.game.input;
    const cam = this.game.camera;
    const W = this.game.canvas.cssW;
    const H = this.game.canvas.cssH;

    // ESC returns to title.
    if (input.pressed("Escape")) {
      this.game.scenes.go("title");
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
    const overUI = this.palette.isOver(input.x, input.y);
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

    // ---- Recompute route validity if topology changed ----
    if (this._routeDirty) {
      this.routeOk = this.gateKeys.some((gk) => gateHasRoute(this.grid, gk));
      this._routeDirty = false;
    }

    // ---- Spawn loop ----
    if (this.routeOk) {
      this._spawnAcc += dt * this.level.spawnRate;
      while (this._spawnAcc >= 1) {
        this._spawnAcc -= 1;
        this._spawnPacket();
      }
    } else {
      this._spawnAcc = 0;
    }

    // ---- Advance packets ----
    this._updatePackets(dt);

    // ---- Building idle animation (bob + eyes glance toward nearest packet) ----
    this._animateBuildings(dt);
  }

  _handleWorld(input) {
    const t = this.hoverTile;

    // BUILD mode: left-click places the armed service on an empty in-bounds tile.
    if (this.palette.selected) {
      const svc = SERVICES[this.palette.selected];
      if (input.leftDown && t && !this.grid.hasBuilding(t.col, t.row)) {
        if (svc.cost <= this.budget) {
          this.grid.place(svc, t.col, t.row);
          this.budget -= svc.cost;
          this._routeDirty = true;
          // Stay armed (shift NOT required) so players can place several;
          // they can right-click empty or press the tool again to disarm.
          if (svc.cost > this.budget) this.palette.clearSelection();
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
          this.budget += b.service.cost; // refund
          this._routeDirty = true;
          this._dropPacketsOnBrokenPaths();
        }
      }
      return;
    }

    // WIRE mode: press on a building tile to start a wire, release on an
    // adjacent compatible building tile to commit it.
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
  _commitWire(toTile) {
    const from = this.wireFrom;
    if (!from || !toTile) return;
    if (from.col === toTile.col && from.row === toTile.row) return;
    if (!Grid.areAdjacent(from.col, from.row, toTile.col, toTile.row)) return;

    const a = this.grid.getBuilding(from.col, from.row);
    const b = this.grid.getBuilding(toTile.col, toTile.row);
    if (!a || !b) return;
    if (!canConnect(a.service.role, b.service.role)) return;

    const aKey = Grid.key(from.col, from.row);
    const bKey = Grid.key(toTile.col, toTile.row);
    if (this.grid.addEdge(aKey, bKey)) {
      this._routeDirty = true;
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
      this._dropPacketsOnBrokenPaths();
    }
  }

  // -------------------------------------------------------------------------
  // PACKETS
  // -------------------------------------------------------------------------
  _spawnPacket() {
    // Pick a gate that currently has a route, then route from it.
    for (const gk of this.gateKeys) {
      const trip = findRoundTrip(this.grid, gk);
      if (trip) {
        this.packets.push(new Packet(trip.path, trip.sinkKey));
        return;
      }
    }
  }

  _updatePackets(dt) {
    const live = [];
    for (const p of this.packets) {
      p.update(dt, (key) => {
        const [c, r] = Grid.parseKey(key);
        const b = this.grid.getBuilding(c, r);
        if (b) b.activity = 1; // pulse the building the packet enters
      });

      if (p.status === "done") {
        // ---- HOOK: on-complete → revenue. Phase 2 scales by latency/cost. ----
        const reward = 12;
        this.revenue += reward;
        this.success++;
        this._spawnFloat(p.x, p.y, "+$" + reward, PALETTE.good);
      } else if (p.status === "dropped") {
        // ---- HOOK: on-drop → lost. ----
        const penalty = 6;
        this.lost += penalty;
        this.failed++;
        this._spawnFloat(p.x, p.y, "drop", PALETTE.bad);
      } else {
        live.push(p);
      }
    }
    this.packets = live;
  }

  // When a wire/building is removed, any packet whose remaining path is broken
  // is dropped (counts as a failure) rather than teleporting through a gap.
  _dropPacketsOnBrokenPaths() {
    for (const p of this.packets) {
      if (p.status === "done" || p.status === "dropped") continue;
      const idx = Math.floor(p.t);
      // Verify every remaining edge still exists.
      for (let i = idx; i < p.path.length - 1; i++) {
        if (!this.grid.hasEdge(p.path[i], p.path[i + 1])) {
          p.status = "dropped";
          break;
        }
      }
    }
  }

  // Floating "+$/drop" text feedback.
  _spawnFloat(x, y, text, color) {
    if (!this._floats) this._floats = [];
    this._floats.push({ x, y, text, color, life: 1 });
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
        valid =
          a &&
          b &&
          Grid.areAdjacent(
            this.wireFrom.col,
            this.wireFrom.row,
            this.hoverTile.col,
            this.hoverTile.row
          ) &&
          canConnect(a.service.role, b.service.role);
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

    drawBuildings(ctx, this.grid);

    // Packets on top of buildings.
    for (const p of this.packets) {
      drawPacket(ctx, p.renderX(alpha), p.renderY(alpha), {
        bob: p.bob,
        status: p.status,
      });
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

    // HUD + palette (screen space).
    drawHUD(ctx, W, H, {
      budget: this.budget,
      revenue: this.revenue,
      lost: this.lost,
      success: this.success,
      failed: this.failed,
      routeOk: this.routeOk,
      fps: this.game.loop.fps,
    });
    this.palette.render(ctx, W, H, this.budget);

    // Control hints.
    drawHints(
      ctx,
      W,
      H,
      "Build: click a tile  •  Wire: drag between neighbors  •  Cut: right-click wire  •  Pan: drag/Space/WASD  •  Zoom: wheel  •  Esc: menu"
    );

    // Intro banner.
    if (this.introTimer > 0) this._renderIntro(ctx, W, H);

    // "End round" button (Phase 1: jump to results to see the tally).
    this._renderEndButton(ctx, W, H);
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
    const h = 46 + lines.length * 15;

    // Keep on screen.
    const W = this.game.canvas.cssW;
    const x = Math.min(mx, W - w - 8);
    const y = my;

    ctx.fillStyle = "rgba(18,24,32,0.96)";
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = svc.color;
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
    for (const ln of lines) {
      ctx.fillText(ln, x + 12, ty);
      ty += 15;
    }
  }

  _renderIntro(ctx, W, H) {
    const a = Math.min(1, this.introTimer / 1.5);
    const lines = wrapText(this.level.intro, 56);
    const w = 560;
    const h = 70 + lines.length * 18;
    const x = W / 2 - w / 2;
    const y = 86;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(18,24,32,0.92)";
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = PALETTE.accent;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 14);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = PALETTE.accent;
    ctx.font = FONT.uiBig;
    ctx.fillText("🦝  " + this.level.name, x + 18, y + 14);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.uiSmall;
    let ty = y + 46;
    for (const ln of lines) {
      ctx.fillText(ln, x + 18, ty);
      ty += 18;
    }
    ctx.restore();
  }

  _renderEndButton(ctx, W, H) {
    const w = 130;
    const h = 34;
    const x = W - w - 14;
    const y = 52;
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
    ctx.fillText("End round ▸", x + w / 2, y + h / 2);
    ctx.textBaseline = "alphabetic";

    if (over && this.game.input.leftDown) {
      this.game.scenes.go("results", {
        levelName: this.level.name,
        success: this.success,
        failed: this.failed,
        revenue: this.revenue,
        lost: this.lost,
        budget: this.budget,
        startBudget: this.level.budget,
        goalRequests: this.level.goalRequests,
      });
    }
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
// levelScene.js — The playable core (Sprint 1).
// Responsibilities:
//   - Own the Grid model + camera control (pan/zoom).
//   - Tile picking + hover highlight.
//   - Build/erase buildings (budget-gated) via the palette.
//   - Wire dragging between adjacent compatible tiles.
//   - Spawn request packets at the gate, route them via BFS to a sink and back.
//   - Track success/fail + revenue/lost; draw HUD, palette, tooltips.
//
// Kept deliberately modular: economy/waves/win-conditions are Phase 2 and slot
// in around the marked hooks (spawn loop, on-complete, on-drop).

import { Scene } from "../engine/scene.js";
import { PALETTE, FONT } from "../theme.js";
import { Grid, TILE } from "../grid/grid.js";
import { getLevel } from "../levels/levels.js";
import { SERVICES, getService, canConnect } from "../services/catalog.js";
import { findRoundTrip, gateHasRoute } from "../grid/pathfind.js";
import { Packet } from "../entities/packet.js";
import { BuildPalette } from "../ui/palette.js";
import { drawHUD, drawHints } from "../ui/hud.js";
import {
  drawFloor,
  drawWires,
  drawBuildings,
  drawTileHighlight,
  drawGhost,
  drawPendingWire,
} from "../render/gridRenderer.js";
import { drawPacket, roundRect, lighten } from "../render/sprites.js";

export class LevelScene extends Scene {
  enter(payload) {
    const level = getLevel(payload && payload.levelId);
    this.level = level;
    this.grid = new Grid(level.cols, level.rows);
    this.time = 0;

    // Economy / counters (Phase 1 subset).
    this.budget = level.budget;
    this.revenue = 0;
    this.lost = 0;
    this.success = 0;
    this.failed = 0;

    // Place the gate(s) from the level def.
    this.gateKeys = [];
    for (const g of level.gates) {
      this.grid.place(SERVICES.route53, g.col, g.row);
      this.gateKeys.push(Grid.key(g.col, g.row));
    }
    // Seed any pre-placed buildings.
    for (const s of level.seed || []) {
      const svc = getService(s.id);
      if (svc) this.grid.place(svc, s.col, s.row);
    }

    // Packets in flight.
    this.packets = [];
    this._spawnAcc = 0;

    // Cached route validity (recomputed when topology changes).
    this.routeOk = false;
    this._routeDirty = true;

    // Interaction state.
    this.palette = new BuildPalette();
    this.hoverTile = null; // {col,row} or null
    this.wireFrom = null; // {col,row} when dragging a wire
    this._panning = false;

    // Center + frame the camera on the grid.
    const cam = this.game.camera;
    cam.centerOn(this.grid.worldWidth() / 2, this.grid.worldHeight() / 2);
    this._fitZoom();

    this.introTimer = 6; // show the intro banner for a few seconds
  }

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
    if (this.introTimer > 0) this.introTimer -= dt;
    const input = this.game.input;
    const cam = this.game.camera;
    const W = this.game.canvas.cssW;
    const H = this.game.canvas.cssH;

    // ESC returns to title.
    if (input.pressed("Escape")) {
      this.game.scenes.go("title");
      return;
    }

    // ---- Camera: zoom (wheel) + pan (middle drag, space-drag, or right-drag in empty space) ----
    if (input.wheel !== 0) {
      const factor = Math.pow(0.999, input.wheel); // smooth, direction-correct
      cam.zoomAt(input.x, input.y, factor);
    }
    // Middle-mouse drag pans.
    if (input.dragDX || input.dragDY) {
      cam.panScreen(input.dragDX, input.dragDY);
    }
    // Space + left-drag also pans (no middle mouse on trackpads).
    const spacePan = input.isDown("Space");
    if (spacePan && input.left) {
      // Use raw movement: approximate by tracking pointer delta via wire-less drag.
      // We piggyback on dragDX/DY only for middle; emulate here with last pos.
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
    const overUI = this.palette.isOver(input.x, input.y);
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

    // ---- Recompute route validity if topology changed ----
    if (this._routeDirty) {
      this.routeOk = this.gateKeys.some((gk) => gateHasRoute(this.grid, gk));
      this._routeDirty = false;
    }

    // ---- Spawn loop ----
    if (this.routeOk) {
      this._spawnAcc += dt * this.level.spawnRate;
      while (this._spawnAcc >= 1) {
        this._spawnAcc -= 1;
        this._spawnPacket();
      }
    } else {
      this._spawnAcc = 0;
    }

    // ---- Advance packets ----
    this._updatePackets(dt);

    // ---- Building idle animation (bob + eyes glance toward nearest packet) ----
    this._animateBuildings(dt);
  }

  _handleWorld(input) {
    const t = this.hoverTile;

    // BUILD mode: left-click places the armed service on an empty in-bounds tile.
    if (this.palette.selected) {
      const svc = SERVICES[this.palette.selected];
      if (input.leftDown && t && !this.grid.hasBuilding(t.col, t.row)) {
        if (svc.cost <= this.budget) {
          this.grid.place(svc, t.col, t.row);
          this.budget -= svc.cost;
          this._routeDirty = true;
          // Stay armed (shift NOT required) so players can place several;
          // they can right-click empty or press the tool again to disarm.
          if (svc.cost > this.budget) this.palette.clearSelection();
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
          this.budget += b.service.cost; // refund
          this._routeDirty = true;
          this._dropPacketsOnBrokenPaths();
        }
      }
      return;
    }

    // WIRE mode: press on a building tile to start a wire, release on an
    // adjacent compatible building tile to commit it.
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
  _commitWire(toTile) {
    const from = this.wireFrom;
    if (!from || !toTile) return;
    if (from.col === toTile.col && from.row === toTile.row) return;
    if (!Grid.areAdjacent(from.col, from.row, toTile.col, toTile.row)) return;

    const a = this.grid.getBuilding(from.col, from.row);
    const b = this.grid.getBuilding(toTile.col, toTile.row);
    if (!a || !b) return;
    if (!canConnect(a.service.role, b.service.role)) return;

    const aKey = Grid.key(from.col, from.row);
    const bKey = Grid.key(toTile.col, toTile.row);
    if (this.grid.addEdge(aKey, bKey)) {
      this._routeDirty = true;
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
      this._dropPacketsOnBrokenPaths();
    }
  }

  // -------------------------------------------------------------------------
  // PACKETS
  // -------------------------------------------------------------------------
  _spawnPacket() {
    // Pick a gate that currently has a route, then route from it.
    for (const gk of this.gateKeys) {
      const trip = findRoundTrip(this.grid, gk);
      if (trip) {
        this.packets.push(new Packet(trip.path, trip.sinkKey));
        return;
      }
    }
  }

  _updatePackets(dt) {
    const live = [];
    for (const p of this.packets) {
      p.update(dt, (key) => {
        const [c, r] = Grid.parseKey(key);
        const b = this.grid.getBuilding(c, r);
        if (b) b.activity = 1; // pulse the building the packet enters
      });

      if (p.status === "done") {
        // ---- HOOK: on-complete → revenue. Phase 2 scales by latency/cost. ----
        const reward = 12;
        this.revenue += reward;
        this.success++;
        this._spawnFloat(p.x, p.y, "+$" + reward, PALETTE.good);
      } else if (p.status === "dropped") {
        // ---- HOOK: on-drop → lost. ----
        const penalty = 6;
        this.lost += penalty;
        this.failed++;
        this._spawnFloat(p.x, p.y, "drop", PALETTE.bad);
      } else {
        live.push(p);
      }
    }
    this.packets = live;
  }

  // When a wire/building is removed, any packet whose remaining path is broken
  // is dropped (counts as a failure) rather than teleporting through a gap.
  _dropPacketsOnBrokenPaths() {
    for (const p of this.packets) {
      if (p.status === "done" || p.status === "dropped") continue;
      const idx = Math.floor(p.t);
      // Verify every remaining edge still exists.
      for (let i = idx; i < p.path.length - 1; i++) {
        if (!this.grid.hasEdge(p.path[i], p.path[i + 1])) {
          p.status = "dropped";
          break;
        }
      }
    }
  }

  // Floating "+$/drop" text feedback.
  _spawnFloat(x, y, text, color) {
    if (!this._floats) this._floats = [];
    this._floats.push({ x, y, text, color, life: 1 });
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
        valid =
          a &&
          b &&
          Grid.areAdjacent(
            this.wireFrom.col,
            this.wireFrom.row,
            this.hoverTile.col,
            this.hoverTile.row
          ) &&
          canConnect(a.service.role, b.service.role);
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

    drawBuildings(ctx, this.grid);

    // Packets on top of buildings.
    for (const p of this.packets) {
      drawPacket(ctx, p.renderX(alpha), p.renderY(alpha), {
        bob: p.bob,
        status: p.status,
      });
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

    // HUD + palette (screen space).
    drawHUD(ctx, W, H, {
      budget: this.budget,
      revenue: this.revenue,
      lost: this.lost,
      success: this.success,
      failed: this.failed,
      routeOk: this.routeOk,
      fps: this.game.loop.fps,
    });
    this.palette.render(ctx, W, H, this.budget);

    // Control hints.
    drawHints(
      ctx,
      W,
      H,
      "Build: click a tile  •  Wire: drag between neighbors  •  Cut: right-click wire  •  Pan: drag/Space/WASD  •  Zoom: wheel  •  Esc: menu"
    );

    // Intro banner.
    if (this.introTimer > 0) this._renderIntro(ctx, W, H);

    // "End round" button (Phase 1: jump to results to see the tally).
    this._renderEndButton(ctx, W, H);
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
    const h = 46 + lines.length * 15;

    // Keep on screen.
    const W = this.game.canvas.cssW;
    const x = Math.min(mx, W - w - 8);
    const y = my;

    ctx.fillStyle = "rgba(18,24,32,0.96)";
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = svc.color;
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
    for (const ln of lines) {
      ctx.fillText(ln, x + 12, ty);
      ty += 15;
    }
  }

  _renderIntro(ctx, W, H) {
    const a = Math.min(1, this.introTimer / 1.5);
    const lines = wrapText(this.level.intro, 56);
    const w = 560;
    const h = 70 + lines.length * 18;
    const x = W / 2 - w / 2;
    const y = 86;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(18,24,32,0.92)";
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = PALETTE.accent;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 14);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = PALETTE.accent;
    ctx.font = FONT.uiBig;
    ctx.fillText("🦝  " + this.level.name, x + 18, y + 14);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.uiSmall;
    let ty = y + 46;
    for (const ln of lines) {
      ctx.fillText(ln, x + 18, ty);
      ty += 18;
    }
    ctx.restore();
  }

  _renderEndButton(ctx, W, H) {
    const w = 130;
    const h = 34;
    const x = W - w - 14;
    const y = 52;
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
    ctx.fillText("End round ▸", x + w / 2, y + h / 2);
    ctx.textBaseline = "alphabetic";

    if (over && this.game.input.leftDown) {
      this.game.scenes.go("results", {
        levelName: this.level.name,
        success: this.success,
        failed: this.failed,
        revenue: this.revenue,
        lost: this.lost,
        budget: this.budget,
        startBudget: this.level.budget,
        goalRequests: this.level.goalRequests,
      });
    }
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
