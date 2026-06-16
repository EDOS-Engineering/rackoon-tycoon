// palette.js — Bottom build palette + tooltips. Screen-space, interactive.
// Owns its button layout and hit-testing. The level scene asks it which tool is
// selected and feeds it pointer state; the palette reports clicks back via the
// returned selection. Also renders the affordable/too-expensive state per item.

import { PALETTE, FONT } from "../theme.js";
import { roundRect, drawService, lighten } from "../render/sprites.js";
import { SERVICES, PALETTE_ORDER } from "../services/catalog.js";

const BTN = 64; // button size
const GAP = 10;
const PAD = 12;

export class BuildPalette {
  constructor() {
    this.selected = null; // service id currently armed, or null
    this.wireMode = false; // wire tool armed
    this.eraseMode = false; // erase tool armed
    this._rects = []; // cached hit rects for this frame
    this.hoverId = null; // id under cursor (for tooltip)
    this._t = 0;
  }

  // Layout buttons centered along the bottom. Returns total bar rect.
  _layout(cssW, cssH) {
    this._rects = [];
    const tools = ["__wire", "__erase", ...PALETTE_ORDER];
    const totalW = tools.length * BTN + (tools.length - 1) * GAP;
    const barW = totalW + PAD * 2;
    const barH = BTN + PAD * 2;
    const barX = cssW / 2 - barW / 2;
    const barY = cssH - barH - 14;

    let x = barX + PAD;
    const y = barY + PAD;
    for (const id of tools) {
      this._rects.push({ id, x, y, w: BTN, h: BTN });
      x += BTN + GAP;
    }
    return { x: barX, y: barY, w: barW, h: barH };
  }

  // Returns the tool id under (mx,my) or null.
  _hit(mx, my) {
    for (const r of this._rects) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        return r.id;
      }
    }
    return null;
  }

  // Handle a click at screen (mx,my) given current budget. Returns true if the
  // palette consumed the click (so the world shouldn't also act on it).
  handleClick(mx, my, budget) {
    const id = this._hit(mx, my);
    if (id == null) return false;

    if (id === "__wire") {
      this._arm("wire");
    } else if (id === "__erase") {
      this._arm("erase");
    } else {
      const svc = SERVICES[id];
      if (svc.cost <= budget) {
        if (this.selected === id) this._clear();
        else this._arm("build", id);
      }
    }
    return true;
  }

  _arm(mode, id = null) {
    this.wireMode = mode === "wire";
    this.eraseMode = mode === "erase";
    this.selected = mode === "build" ? id : null;
  }
  _clear() {
    this.selected = null;
    this.wireMode = false;
    this.eraseMode = false;
  }
  clearSelection() {
    this._clear();
  }

  // Update hover (for tooltip) — call each frame with pointer pos.
  updateHover(mx, my, dt) {
    this._t += dt;
    this.hoverId = this._hit(mx, my);
  }

  // True if the pointer is currently over the palette bar (so the level scene
  // can suppress world placement when interacting with UI).
  isOver(mx, my) {
    return this._hit(mx, my) != null;
  }

  render(ctx, cssW, cssH, budget) {
    const bar = this._layout(cssW, cssH);

    // Bar background.
    ctx.fillStyle = "rgba(24,31,40,0.92)";
    roundRect(ctx, bar.x, bar.y, bar.w, bar.h, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    roundRect(ctx, bar.x, bar.y, bar.w, bar.h, 14);
    ctx.stroke();

    for (const r of this._rects) {
      const isTool = r.id.startsWith("__");
      const armed =
        (r.id === "__wire" && this.wireMode) ||
        (r.id === "__erase" && this.eraseMode) ||
        (!isTool && this.selected === r.id);

      const svc = isTool ? null : SERVICES[r.id];
      const affordable = isTool || svc.cost <= budget;

      // Button base.
      ctx.fillStyle = armed ? PALETTE.bgPanelHi : PALETTE.bgPanel;
      roundRect(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.fill();
      if (armed) {
        ctx.strokeStyle = PALETTE.accent;
        ctx.lineWidth = 2.5;
        roundRect(ctx, r.x, r.y, r.w, r.h, 10);
        ctx.stroke();
      }

      ctx.save();
      ctx.globalAlpha = affordable ? 1 : 0.38;

      if (isTool) {
        // Tool glyph.
        ctx.font = "26px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const glyph = r.id === "__wire" ? "🔌" : "🗑️";
        ctx.fillText(glyph, r.x + r.w / 2, r.y + r.h / 2 - 6);
        ctx.font = FONT.uiSmall;
        ctx.fillStyle = PALETTE.textDim;
        ctx.fillText(
          r.id === "__wire" ? "Wire" : "Erase",
          r.x + r.w / 2,
          r.y + r.h - 11
        );
      } else {
        // Mini service sprite preview (drawn small, centered, no bob).
        ctx.save();
        ctx.translate(0, -6);
        const scale = 0.62;
        ctx.translate(r.x + r.w / 2, r.y + r.h / 2 - 2);
        ctx.scale(scale, scale);
        drawService(ctx, svc, 0, 0, { bob: 0, look: { x: 0, y: 0.1 } });
        ctx.restore();
        // Cost label.
        ctx.font = FONT.uiSmall;
        ctx.fillStyle = affordable ? PALETTE.accent : PALETTE.bad;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText("$" + svc.cost, r.x + r.w / 2, r.y + r.h - 7);
      }
      ctx.restore();
    }

    // Tooltip for the hovered service (above the bar).
    if (this.hoverId && !this.hoverId.startsWith("__")) {
      this._tooltip(ctx, SERVICES[this.hoverId], bar);
    } else if (this.hoverId === "__wire") {
      this._toolTip(ctx, bar, "Wire tool", "Drag between two adjacent tiles to lay a wire. Right-click a wire to cut it.");
    } else if (this.hoverId === "__erase") {
      this._toolTip(ctx, bar, "Erase tool", "Click a building to remove it (refunds its cost).");
    }
  }

  _tooltip(ctx, svc, bar) {
    const lines = wrap(svc.blurb, 42);
    const statLine = `Cost $${svc.cost}  •  Throughput ${svc.throughput}  •  Latency ${svc.latency}ms`;
    this._panel(ctx, bar, svc.label, [statLine, "", ...lines], svc.color);
  }
  _toolTip(ctx, bar, title, body) {
    this._panel(ctx, bar, title, wrap(body, 42), PALETTE.accent2);
  }

  _panel(ctx, bar, title, bodyLines, accent) {
    const w = 320;
    const lineH = 16;
    const h = 44 + bodyLines.length * lineH;
    const x = bar.x + bar.w / 2 - w / 2;
    const y = bar.y - h - 10;

    ctx.fillStyle = "rgba(18,24,32,0.96)";
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 10);
    ctx.stroke();

    ctx.fillStyle = lighten(accent, 0.25);
    ctx.font = FONT.ui;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(title, x + 14, y + 12);

    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.uiSmall;
    let ty = y + 34;
    for (const ln of bodyLines) {
      ctx.fillText(ln, x + 14, ty);
      ty += lineH;
    }
  }
}

// Naive word-wrap to N characters per line.
function wrap(text, n) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > n) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur += " " + w;
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}
