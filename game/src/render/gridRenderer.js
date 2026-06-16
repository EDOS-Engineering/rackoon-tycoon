// gridRenderer.js — Draws the world: floor, grid lines, wires, buildings, hover.
// Reads from the Grid model; never mutates it. Wires get an animated "flow"
// dash so routes feel like live Factorio belts. Buildings are drawn via the
// procedural sprite module.

import { PALETTE } from "../theme.js";
import { Grid, TILE } from "../grid/grid.js";
import { drawService, roundRect } from "./sprites.js";

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

  // Solid core.
  ctx.strokeStyle = PALETTE.wire;
  ctx.lineWidth = 4;
  ctx.beginPath();
  grid.forEachEdge((c1, r1, c2, r2) => {
    line(ctx, c1, r1, c2, r2);
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

// Draw every building.
export function drawBuildings(ctx, grid) {
  for (const b of grid.buildings.values()) {
    const cx = b.col * TILE + TILE / 2;
    const cy = b.row * TILE + TILE / 2;
    drawService(ctx, b.service, cx, cy, {
      bob: b.bob,
      look: { x: b.eyeTargetX, y: b.eyeTargetY },
      activity: b.activity,
    });
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
