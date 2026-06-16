// hud.js — Screen-space heads-up display: budget, revenue, success/fail, status.
// Pure drawing from values passed in (no game logic here). Rendered after the
// world, in CSS-pixel space (identity transform).

import { PALETTE, FONT } from "../theme.js";
import { roundRect } from "../render/sprites.js";

// Draw a labeled stat "chip". Optional `sub` prints a small line under the value
// (used for the bill's burn-rate readout).
function chip(ctx, x, y, w, h, label, value, color, sub) {
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
  ctx.fillText(label, x + 12, y + 8);

  ctx.fillStyle = color || PALETTE.text;
  ctx.font = FONT.uiBig;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x + 12, y + h - (sub ? 18 : 12));

  if (sub) {
    ctx.fillStyle = PALETTE.textFaint;
    ctx.font = FONT.uiSmall;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(sub, x + 12, y + h - 6);
  }
}

export function drawHUD(ctx, cssW, cssH, state) {
  const pad = 14;
  const h = 56;
  const gap = 10;
  const w = 132;

  let x = pad;
  const y = pad;

  // Budget chip turns red as it runs low (game-over looms at $0).
  const budgetColor =
    state.budget < (state.startBudget || 1) * 0.2 ? PALETTE.bad : PALETTE.accent;
  chip(ctx, x, y, w, h, "BUDGET", "$" + fmt(state.budget), budgetColor);
  x += w + gap;

  // Live AWS bill: total billed so far + the current burn rate (T2.1).
  chip(
    ctx,
    x,
    y,
    w,
    h,
    "AWS BILL",
    "$" + fmt(state.billTotal || 0),
    PALETTE.warn,
    "-$" + (state.burnRate || 0).toFixed(1) + "/s burn"
  );
  x += w + gap;

  chip(ctx, x, y, 118, h, "REVENUE", "$" + fmt(state.revenue), PALETTE.good);
  x += 118 + gap;
  chip(ctx, x, y, 96, h, "ROUTED", String(state.success), PALETTE.good);
  x += 96 + gap;
  chip(ctx, x, y, 96, h, "DROPPED", String(state.failed), PALETTE.bad);

  // Right side: topology status + wave progress bar (stacked).
  const okText = state.routeOk ? "TOPOLOGY: LIVE" : "NO ROUTE TO DB";
  const okColor = state.routeOk ? PALETTE.good : PALETTE.warn;
  ctx.font = FONT.ui;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  const tw = Math.max(ctx.measureText(okText).width + 28, 200);
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

  // Wave progress + phase name (T2.2).
  if (state.wave) {
    drawWaveBar(ctx, bx, y + 36, tw, state.wave, state.goalRequests, state.success);
  }

  // FPS (small, dim, bottom-right corner).
  ctx.fillStyle = PALETTE.textFaint;
  ctx.font = FONT.uiSmall;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(state.fps + " fps", cssW - 10, cssH - 8);
}

// Wave progress bar: fills as the level's wave set elapses, labelled with the
// current phase and the routed-goal progress.
function drawWaveBar(ctx, x, y, w, wave, goal, routed) {
  const h = 34;
  ctx.fillStyle = PALETTE.bgPanel;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  // Phase label + goal counter.
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = FONT.uiSmall;
  ctx.fillStyle = PALETTE.textDim;
  ctx.fillText("WAVE — " + (wave.phaseName || ""), x + 10, y + 5);
  if (goal) {
    ctx.textAlign = "right";
    ctx.fillStyle = routed >= goal ? PALETTE.good : PALETTE.textDim;
    ctx.fillText(routed + " / " + goal + " routed", x + w - 10, y + 5);
  }

  // Progress track.
  const tx = x + 10;
  const tw = w - 20;
  const ty = y + h - 11;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, tx, ty, tw, 5, 3);
  ctx.fill();
  ctx.fillStyle = PALETTE.accent;
  roundRect(ctx, tx, ty, Math.max(2, tw * (wave.progress || 0)), 5, 3);
  ctx.fill();
}

// Big telegraphed event banner under the HUD: warning (amber, counting down) or
// active (red) (T2.3). Returns nothing.
export function drawEventBanner(ctx, cssW, banner) {
  if (!banner) return;
  const w = 460;
  const h = 40;
  const x = cssW / 2 - w / 2;
  const y = 78;
  const warn = !banner.active;
  const col = warn ? PALETTE.warn : PALETTE.bad;

  // Pulse the border for urgency.
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 180);
  ctx.save();
  ctx.fillStyle = "rgba(18,24,32,0.94)";
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5 + pulse * 1.5;
  roundRect(ctx, x, y, w, h, 10);
  ctx.stroke();

  ctx.fillStyle = col;
  ctx.font = FONT.ui;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(banner.text, x + 14, y + h / 2);

  // Countdown / time-left pill on the right.
  const secs = Math.ceil(banner.countdown);
  const label = (warn ? "in " : "") + secs + "s";
  ctx.font = FONT.uiBig;
  ctx.textAlign = "right";
  ctx.fillStyle = PALETTE.text;
  ctx.fillText(label, x + w - 14, y + h / 2 + 1);
  ctx.restore();
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
