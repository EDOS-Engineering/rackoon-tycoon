// sprites.js — Procedural Canvas art for the cozy-industrial look.
// All art is drawn at runtime (zero asset files): the googly-eye service
// buildings, the request "guests", and the Rocky raccoon logo mark.
// Functions take a ctx already transformed into the space they draw in.

import { PALETTE, EYE } from "../theme.js";
import { TILE } from "../grid/grid.js";

// ---------------------------------------------------------------------------
// Rounded rectangle path helper.
// ---------------------------------------------------------------------------
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// A googly eye: white sclera + pupil that drifts toward (lookX, lookY) which
// is a -1..1 offset, plus a highlight. Used on every service building so the
// park feels alive.
// ---------------------------------------------------------------------------
function googlyEye(ctx, cx, cy, radius, lookX, lookY) {
  // Sclera
  ctx.fillStyle = EYE.white;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = Math.max(1, radius * 0.12);
  ctx.stroke();

  // Pupil drifts but stays inside the sclera.
  const pr = radius * 0.52;
  const maxOff = radius - pr - radius * 0.08;
  const px = cx + lookX * maxOff;
  const py = cy + lookY * maxOff;
  ctx.fillStyle = EYE.pupil;
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.fill();

  // Catch-light
  ctx.fillStyle = EYE.shine;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(px - pr * 0.3, py - pr * 0.35, pr * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Draw a service building centered in its tile.
//   service: catalog record (color, emoji, label)
//   bob:     animation phase (radians) for gentle vertical bounce
//   look:    {x,y} googly-eye gaze in -1..1
//   activity:0..1 glow pulse when a packet recently visited
//   alpha:   overall opacity (used for ghost preview)
// ---------------------------------------------------------------------------
export function drawService(ctx, service, cx, cy, opts = {}) {
  const bob = opts.bob || 0;
  const look = opts.look || { x: 0, y: 0.1 };
  const activity = opts.activity || 0;
  const alpha = opts.alpha == null ? 1 : opts.alpha;

  const size = TILE * 0.74;
  const bounce = Math.sin(bob) * 1.6;
  const x = cx - size / 2;
  const y = cy - size / 2 + bounce;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Soft drop shadow grounds the building on the floor.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.46, size * 0.42, size * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Activity glow (packet just passed through).
  if (activity > 0.01) {
    ctx.save();
    ctx.globalAlpha = alpha * activity * 0.7;
    ctx.shadowColor = service.color;
    ctx.shadowBlur = 28 * activity;
    roundRect(ctx, x, y, size, size, 14);
    ctx.fillStyle = service.color;
    ctx.fill();
    ctx.restore();
  }

  // Body — brand-colored rounded block with a subtle vertical gradient.
  const grad = ctx.createLinearGradient(0, y, 0, y + size);
  grad.addColorStop(0, lighten(service.color, 0.18));
  grad.addColorStop(1, darken(service.color, 0.22));
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, size, size, 14);
  ctx.fill();

  // Top "panel light" strip for an industrial machine vibe.
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  roundRect(ctx, x + size * 0.12, y + size * 0.1, size * 0.76, size * 0.16, 6);
  ctx.fill();

  // Outline
  ctx.strokeStyle = darken(service.color, 0.4);
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, size, size, 14);
  ctx.stroke();

  // Emoji "face plate" badge lower-center.
  ctx.font = `${Math.round(size * 0.3)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(service.emoji, cx, y + size * 0.72);

  // Two googly eyes near the top — the signature look.
  const eyeR = size * 0.15;
  const eyeY = y + size * 0.36;
  const eyeDX = size * 0.2;
  googlyEye(ctx, cx - eyeDX, eyeY, eyeR, look.x, look.y);
  googlyEye(ctx, cx + eyeDX, eyeY, eyeR, look.x, look.y);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// A request "guest" packet: a little glowing capsule with a smiley, bobbing.
// ---------------------------------------------------------------------------
export function drawPacket(ctx, x, y, opts = {}) {
  const bob = opts.bob || 0;
  const status = opts.status || "travel";
  const history = opts.history || [];
  const r = TILE * 0.13;
  const yy = y + Math.sin(bob) * 2.2;

  const base = status === "return" ? PALETTE.good : PALETTE.guest;

  // Trail (T4.1): fading ghost circles behind the current position.
  for (let i = 0; i < history.length; i++) {
    const alpha = ((i + 1) / (history.length + 1)) * 0.28;
    const hr = r * (0.45 + 0.3 * ((i + 1) / history.length));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(history[i].x, history[i].y, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  // Glow
  ctx.shadowColor = base;
  ctx.shadowBlur = 12;
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(x, yy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Tiny happy face so guests read as "people".
  ctx.fillStyle = "rgba(20,20,25,0.85)";
  ctx.beginPath();
  ctx.arc(x - r * 0.32, yy - r * 0.18, r * 0.16, 0, Math.PI * 2);
  ctx.arc(x + r * 0.32, yy - r * 0.18, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(20,20,25,0.85)";
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  ctx.arc(x, yy + r * 0.05, r * 0.42, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Rocky the raccoon — logo mark. Drawn within a box of side `s` centered at
// (cx,cy). Stylized front-facing head: gray fur, black bandit mask, ears,
// snout, and the same googly eyes used on services (brand tie-in).
// ---------------------------------------------------------------------------
export function drawRaccoon(ctx, cx, cy, s, opts = {}) {
  const look = opts.look || { x: 0, y: 0.05 };
  ctx.save();
  ctx.translate(cx, cy);
  const u = s / 100; // work in a 100x100 design space

  // Ears
  ctx.fillStyle = PALETTE.raccoonFur;
  triangle(ctx, -34 * u, -28 * u, -14 * u, -44 * u, -6 * u, -20 * u);
  triangle(ctx, 34 * u, -28 * u, 14 * u, -44 * u, 6 * u, -20 * u);
  ctx.fillStyle = PALETTE.raccoonMask;
  triangle(ctx, -28 * u, -28 * u, -16 * u, -38 * u, -12 * u, -23 * u);
  triangle(ctx, 28 * u, -28 * u, 16 * u, -38 * u, 12 * u, -23 * u);

  // Head
  ctx.fillStyle = PALETTE.raccoonFur;
  ctx.beginPath();
  ctx.ellipse(0, 0, 40 * u, 36 * u, 0, 0, Math.PI * 2);
  ctx.fill();

  // Lighter cheeks
  ctx.fillStyle = PALETTE.cream;
  ctx.beginPath();
  ctx.ellipse(0, 10 * u, 26 * u, 22 * u, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bandit mask — the iconic raccoon band across the eyes.
  ctx.fillStyle = PALETTE.raccoonMask;
  ctx.beginPath();
  ctx.moveTo(-38 * u, -6 * u);
  ctx.quadraticCurveTo(-20 * u, -16 * u, 0, -8 * u);
  ctx.quadraticCurveTo(20 * u, -16 * u, 38 * u, -6 * u);
  ctx.quadraticCurveTo(34 * u, 10 * u, 18 * u, 12 * u);
  ctx.quadraticCurveTo(0, 6 * u, -18 * u, 12 * u);
  ctx.quadraticCurveTo(-34 * u, 10 * u, -38 * u, -6 * u);
  ctx.closePath();
  ctx.fill();

  // Googly eyes sit on the mask (brand consistency with services).
  googlyEye(ctx, -16 * u, 0, 11 * u, look.x, look.y);
  googlyEye(ctx, 16 * u, 0, 11 * u, look.x, look.y);

  // Snout + nose
  ctx.fillStyle = PALETTE.cream;
  ctx.beginPath();
  ctx.ellipse(0, 20 * u, 12 * u, 10 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.raccoonMask;
  ctx.beginPath();
  ctx.ellipse(0, 16 * u, 5 * u, 4 * u, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ---- small geometry / color utilities -------------------------------------
function triangle(ctx, x1, y1, x2, y2, x3, y3) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fill();
}

export function lighten(hex, amt) {
  return mix(hex, "#ffffff", amt);
}
export function darken(hex, amt) {
  return mix(hex, "#000000", amt);
}
function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bl = Math.round(ca.b + (cb.b - ca.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
