// hud.js — Screen-space heads-up display: budget, revenue, success/fail, status.
// Pure drawing from values passed in (no game logic here). Rendered after the
// world, in CSS-pixel space (identity transform).

import { PALETTE, FONT } from "../theme.js";
import { roundRect } from "../render/sprites.js";

// Draw a labeled stat "chip".
function chip(ctx, x, y, w, h, label, value, color) {
  ctx.fillStyle = PALETTE.bgPanel;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 10);
  ctx.stroke();

  ctx.fillStyle = PALETTE.textDim;
  ctx.font = FONT.uiSmall;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, x + 12, y + 9);

  ctx.fillStyle = color || PALETTE.text;
  ctx.font = FONT.uiBig;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x + 12, y + h - 12);
}

export function drawHUD(ctx, cssW, cssH, state) {
  const pad = 14;
  const h = 56;
  const gap = 10;
  const w = 150;

  let x = pad;
  const y = pad;

  chip(ctx, x, y, w, h, "BUDGET", "$" + fmt(state.budget), PALETTE.accent);
  x += w + gap;
  chip(ctx, x, y, w, h, "REVENUE", "$" + fmt(state.revenue), PALETTE.good);
  x += w + gap;
  chip(ctx, x, y, w, h, "LOST", "$" + fmt(state.lost), PALETTE.bad);
  x += w + gap;
  chip(ctx, x, y, 130, h, "ROUTED", String(state.success), PALETTE.good);
  x += 130 + gap;
  chip(ctx, x, y, 130, h, "DROPPED", String(state.failed), PALETTE.bad);

  // Topology status banner (right side).
  const okText = state.routeOk ? "TOPOLOGY: LIVE" : "NO ROUTE TO DB";
  const okColor = state.routeOk ? PALETTE.good : PALETTE.warn;
  ctx.font = FONT.ui;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  const tw = ctx.measureText(okText).width + 28;
  const bx = cssW - pad - tw;
  ctx.fillStyle = PALETTE.bgPanel;
  roundRect(ctx, bx, y, tw, 30, 8);
  ctx.fill();
  ctx.fillStyle = okColor;
  ctx.beginPath();
  ctx.arc(bx + 14, y + 15, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.text;
  ctx.fillText(okText, bx + tw - 12, y + 8);

  // FPS (small, dim, bottom-right corner).
  ctx.fillStyle = PALETTE.textFaint;
  ctx.font = FONT.uiSmall;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(state.fps + " fps", cssW - 10, cssH - 8);
}

// Bottom-center control hints so first-time players aren't lost.
export function drawHints(ctx, cssW, cssH, text) {
  ctx.font = FONT.uiSmall;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const w = ctx.measureText(text).width + 28;
  const x = cssW / 2 - w / 2;
  const y = cssH - 12;
  ctx.fillStyle = "rgba(20,26,34,0.82)";
  roundRect(ctx, x, y - 26, w, 26, 8);
  ctx.fill();
  ctx.fillStyle = PALETTE.textDim;
  ctx.fillText(text, cssW / 2, y - 6);
}

function fmt(n) {
  // Compact money formatting: 12,340 -> "12.3k".
  const v = Math.round(n);
  if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + "k";
  return v.toLocaleString("en-US");
}
