// gridRenderer.js — Draws the world: floor, grid lines, wires, buildings, hover.
// Reads from the Grid model; never mutates it. Wires get an animated "flow"
// dash so routes feel like live Factorio belts. Buildings are drawn via the
// procedural sprite module.

import { PALETTE } from "../theme.js";
import { Grid, TILE } from "../grid/grid.js";
import { drawService, roundRect } from "./sprites.js";
import { AZ_COUNT, zoneColumnRange, zoneOfColumn, AZ_LABELS } from "../waves/events.js";
import { getConn } from "../services/connections.js";

// Draw the dark workshop floor + grid lines, only across the grid bounds.
export function drawFloor(ctx, grid, time) {
  const w = grid.worldWidth();
  const h = grid.worldHeight();

  // Floor slab with a faint inset border.
  ctx.fillStyle = PALETTE.bgFloor;
  ctx.fillRect(0, 0, w, h);

  // Subtle checker so large empty areas aren't flat.
  ctx.fillStyle = "rgba(255,255,255,0.012)";
  for (let r = 0; r < grid.rows; r++) {
    for (let c = (r % 2); c < grid.cols; c += 2) {
      ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
    }
  }

  // Grid lines.
  ctx.strokeStyle = PALETTE.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= grid.cols; c++) {
    ctx.moveTo(c * TILE, 0);
    ctx.lineTo(c * TILE, h);
  }
  for (let r = 0; r <= grid.rows; r++) {
    ctx.moveTo(0, r * TILE);
    ctx.lineTo(w, r * TILE);
  }
  ctx.stroke();

  // Outer frame.
  ctx.strokeStyle = PALETTE.gridLineHi;
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, w, h);
}

// Draw all wires with an animated flow dash.
export function drawWires(ctx, grid, time) {
  ctx.save();
  ctx.lineCap = "round";

  // Underlying glow pass.
  ctx.strokeStyle = PALETTE.wireGlow;
  ctx.lineWidth = 10;
  ctx.beginPath();
  grid.forEachEdge((c1, r1, c2, r2) => {
    line(ctx, c1, r1, c2, r2);
  });
  ctx.stroke();

  // Solid core, coloured by connection type (Phase 5: T5.1). Each edge strokes
  // individually so the type's colour reads at a glance.
  ctx.lineWidth = 4;
  grid.forEachEdge((c1, r1, c2, r2, type) => {
    ctx.strokeStyle = getConn(type).color;
    ctx.beginPath();
    line(ctx, c1, r1, c2, r2);
    ctx.stroke();
  });

  // Cross-AZ overlay: wires whose ends sit in different AZ bands carry the 8×
  // inter-AZ penalty — tint them amber so the price is visible. PrivateLink keeps
  // traffic private (crossAzExempt), so it pays nothing and is not tinted.
  ctx.strokeStyle = "rgba(255,179,71,0.7)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  grid.forEachEdge((c1, r1, c2, r2, type) => {
    if (!getConn(type).crossAzExempt &&
        zoneOfColumn(c1, grid.cols) !== zoneOfColumn(c2, grid.cols)) {
      line(ctx, c1, r1, c2, r2);
    }
  });
  ctx.stroke();

  // Animated bright dashes "flowing" along each wire.
  ctx.strokeStyle = "rgba(231,255,255,0.85)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 16]);
  ctx.lineDashOffset = -(time * 36) % 22;
  ctx.beginPath();
  grid.forEachEdge((c1, r1, c2, r2) => {
    line(ctx, c1, r1, c2, r2);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // Solder nubs where wires meet a building keep junctions tidy.
  ctx.fillStyle = PALETTE.wire;
  grid.forEachEdge((c1, r1, c2, r2) => {
    nub(ctx, c1, r1);
    nub(ctx, c2, r2);
  });

  ctx.restore();
}

function line(ctx, c1, r1, c2, r2) {
  ctx.moveTo(c1 * TILE + TILE / 2, r1 * TILE + TILE / 2);
  ctx.lineTo(c2 * TILE + TILE / 2, r2 * TILE + TILE / 2);
}
function nub(ctx, c, r) {
  ctx.beginPath();
  ctx.arc(c * TILE + TILE / 2, r * TILE + TILE / 2, 3, 0, Math.PI * 2);
  ctx.fill();
}

// Draw every building, including the Phase-2 overload heat ring + offline state.
export function drawBuildings(ctx, grid, time = 0) {
  for (const b of grid.buildings.values()) {
    const cx = b.col * TILE + TILE / 2;
    const cy = b.row * TILE + TILE / 2;

    // Overload heat: a ring whose color ramps green -> amber -> red with load,
    // so bottlenecks are visible at a glance (T2.2).
    const heat = b.heat || 0;
    if (heat > 0.18 && !b.disabled) {
      const col = heatColor(heat);
      ctx.save();
      ctx.globalAlpha = Math.min(0.9, 0.3 + heat * 0.5);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      const pr = TILE * 0.42 + (heat > 1 ? Math.sin(time * 8) * 2 : 0);
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.stroke();
      // A soft glow under heavy load.
      if (heat > 0.8) {
        ctx.globalAlpha = (heat - 0.8) * 0.5;
        ctx.shadowColor = col;
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    const dim = b.disabled || b.invalid;
    drawService(ctx, b.service, cx, cy, {
      bob: dim ? 0 : b.bob,
      look: { x: b.eyeTargetX, y: b.eyeTargetY },
      activity: b.activity,
      alpha: dim ? 0.32 : 1,
    });

    // Offline overlay (AZ failure): dim + a red "zzz/down" mark.
    if (b.disabled) {
      ctx.save();
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PALETTE.bad;
      ctx.fillText("⚡✕", cx, cy - TILE * 0.34);
      ctx.restore();
    } else if (b.invalid) {
      // Structural-dependency overlay (e.g. Read Replica with no primary):
      // a dashed amber ring + warning mark, distinct from the AZ-down state.
      ctx.save();
      ctx.strokeStyle = PALETTE.warn;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PALETTE.warn;
      ctx.fillText("⚠", cx, cy - TILE * 0.34);
      ctx.restore();
    }
  }
}

// Green -> amber -> red ramp for load in [0, ~1.4].
function heatColor(h) {
  const t = Math.min(1, h);
  // 0 -> good (green), 0.5 -> warn (amber), 1 -> bad (red).
  if (t < 0.5) {
    return mix(PALETTE.good, PALETTE.warn, t / 0.5);
  }
  return mix(PALETTE.warn, PALETTE.bad, (t - 0.5) / 0.5);
}

function mix(a, b, t) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function parseHex(c) {
  let h = c.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Draw the Availability-Zone bands behind the buildings: faint vertical column
// regions with a label, and a red wash over any failed zone (T2.3). `failed` is
// a Set of failed zone indices.
export function drawAZBands(ctx, grid, failed, time) {
  const h = grid.worldHeight();
  for (let z = 0; z < AZ_COUNT; z++) {
    const [c0, c1] = zoneColumnRange(z, grid.cols);
    const x = c0 * TILE;
    const w = (c1 - c0 + 1) * TILE;
    const down = failed && failed.has(z);

    // Subtle zone separator tint (alternating) so the bands read as zones.
    ctx.save();
    ctx.globalAlpha = down ? 1 : 0.5;
    ctx.fillStyle = down
      ? "rgba(255,94,94," + (0.12 + Math.abs(Math.sin(time * 3)) * 0.08) + ")"
      : z % 2 === 0
        ? "rgba(72,202,228,0.020)"
        : "rgba(255,179,71,0.018)";
    ctx.fillRect(x, 0, w, h);

    // Zone label, top of the band.
    ctx.globalAlpha = down ? 0.95 : 0.4;
    ctx.fillStyle = down ? PALETTE.bad : PALETTE.textFaint;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      (down ? "✕ " : "") + (AZ_LABELS[z] || "AZ " + z),
      x + w / 2,
      6
    );
    ctx.restore();
  }
}

// Tile highlight (hover / valid-placement / wire-source). `style` chooses color.
export function drawTileHighlight(ctx, col, row, style) {
  const x = col * TILE;
  const y = row * TILE;
  let fill = PALETTE.tileHover;
  let stroke = PALETTE.gridLineHi;
  if (style === "valid") {
    fill = PALETTE.tileValid;
    stroke = PALETTE.good;
  } else if (style === "invalid") {
    fill = PALETTE.tileInvalid;
    stroke = PALETTE.bad;
  } else if (style === "wire") {
    fill = "rgba(72,202,228,0.18)";
    stroke = PALETTE.wire;
  }
  ctx.save();
  ctx.fillStyle = fill;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  roundRect(ctx, x + 2, y + 2, TILE - 4, TILE - 4, 8);
  ctx.stroke();
  ctx.restore();
}

// Ghost preview of the building about to be placed (semi-transparent).
export function drawGhost(ctx, service, col, row, valid) {
  const cx = col * TILE + TILE / 2;
  const cy = row * TILE + TILE / 2;
  drawService(ctx, service, cx, cy, { alpha: valid ? 0.55 : 0.3 });
  drawTileHighlight(ctx, col, row, valid ? "valid" : "invalid");
}

// A pending wire being dragged from a source tile to the cursor.
export function drawPendingWire(ctx, fromCol, fromRow, toWorldX, toWorldY, valid) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = valid ? PALETTE.wire : PALETTE.bad;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(fromCol * TILE + TILE / 2, fromRow * TILE + TILE / 2);
  ctx.lineTo(toWorldX, toWorldY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
