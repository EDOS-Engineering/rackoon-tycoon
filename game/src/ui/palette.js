// palette.js — Bottom build palette with category tabs.
// Layout (bottom of screen):
//   [ Wire | Erase ]  |  [ Tab: Net ] [ Compute ] [ Data ] [ DB ] [ Security ]
//   [ service buttons for the active tab ]
//
// The palette owns its button layout and hit-testing. The level scene asks which
// tool is selected and feeds it pointer state; the palette reports clicks back.

import { PALETTE, FONT } from "../theme.js";
import { roundRect, drawService, lighten } from "../render/sprites.js";
import { SERVICES, PALETTE_GROUPS } from "../services/catalog.js";
import { CONN, CONN_ORDER, getConn, DEFAULT_CONN } from "../services/connections.js";

const BTN   = 64;  // service button size
const GAP   = 8;   // gap between service buttons
const PAD   = 12;  // bar padding
const TOOL_W = 56; // wire / erase button width
const TAB_H  = 26; // tab row height
const TAB_GAP = 6;
const TAB_W  = 68; // fixed tab width (fits the longest label, e.g. "SECURITY")
const CONN_H = 22; // connection-type picker row height

export class BuildPalette {
  constructor() {
    this.selected   = null;  // service id currently armed, or null
    this.wireMode   = false;
    this.eraseMode  = false;
    this.activeGroup = PALETTE_GROUPS[0].id; // current tab
    this.connType   = DEFAULT_CONN; // active wire connection type (Phase 5: T5.1)
    this._rects     = [];  // service + tool hit rects (current frame)
    this._tabRects  = [];  // tab hit rects
    this._connRects = [];  // connection-type chip hit rects
    this.hoverId    = null;
    this._t         = 0;
    this._barRect   = null; // full bar rect (for isOver)
  }

  // Compute layout from screen dimensions. Returns the full bar rect.
  _layout(cssW, cssH) {
    this._rects = [];
    this._tabRects = [];
    this._connRects = [];

    const grp = PALETTE_GROUPS.find((g) => g.activeGroup === this.activeGroup)
             || PALETTE_GROUPS.find((g) => g.id === this.activeGroup)
             || PALETTE_GROUPS[0];

    const tools = ["__wire", "__erase"];
    const svcIds = grp.ids;

    // Layout: [tools] | [content], where the content area holds the tab row and
    // the service row. The content width is the MAX of the (fixed) tab row and the
    // current group's service row, so the bar width stays stable across groups and
    // the 6 tabs always fit (no overflow when a group has few services).
    const toolBlockW = tools.length * TOOL_W + (tools.length - 1) * GAP;
    const sepW = 12;
    const svcBlockW = svcIds.length * BTN + Math.max(0, svcIds.length - 1) * GAP;
    const nTabs = PALETTE_GROUPS.length;
    const tabRowW = nTabs * TAB_W + (nTabs - 1) * TAB_GAP;
    const contentW = Math.max(svcBlockW, tabRowW);
    const totalW = toolBlockW + sepW + contentW + PAD * 2;
    const barH = CONN_H + GAP + TAB_H + GAP + BTN + PAD * 2;

    const barX = cssW / 2 - totalW / 2;
    const barY = cssH - barH - 14;
    this._barRect = { x: barX, y: barY, w: totalW, h: barH };
    const contentX = barX + PAD + toolBlockW + sepW;
    this._sepX = contentX - sepW / 2; // divider between tools and content

    // Connection-type picker row (spans the inner width, chips centred).
    const connY = barY + PAD;
    const innerW = totalW - PAD * 2;
    const cN = CONN_ORDER.length;
    const cGap = 6;
    const cW = Math.floor((innerW - (cN - 1) * cGap) / cN);
    let ccx = barX + PAD;
    for (const id of CONN_ORDER) {
      this._connRects.push({ id, x: ccx, y: connY, w: cW, h: CONN_H });
      ccx += cW + cGap;
    }

    // Tab row — fixed-width tabs, centred in the content area.
    const tabY = connY + CONN_H + GAP;
    let tx = contentX + (contentW - tabRowW) / 2;
    for (const g of PALETTE_GROUPS) {
      this._tabRects.push({ id: g.id, x: tx, y: tabY, w: TAB_W, h: TAB_H });
      tx += TAB_W + TAB_GAP;
    }

    // Service row — centred in the content area, under the tabs.
    const btnY = tabY + TAB_H + GAP;
    let sx = contentX + (contentW - svcBlockW) / 2;
    for (const id of svcIds) {
      this._rects.push({ id, x: sx, y: btnY, w: BTN, h: BTN });
      sx += BTN + GAP;
    }

    // Tool buttons (left block).
    let tcx = barX + PAD;
    for (const id of tools) {
      this._rects.push({ id, x: tcx, y: btnY, w: TOOL_W, h: BTN });
      tcx += TOOL_W + GAP;
    }

    return this._barRect;
  }

  _hit(mx, my) {
    for (const r of this._rects) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r.id;
    }
    return null;
  }

  _hitTab(mx, my) {
    for (const r of this._tabRects) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r.id;
    }
    return null;
  }

  _hitConn(mx, my) {
    for (const r of this._connRects) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r.id;
    }
    return null;
  }

  handleClick(mx, my, budget) {
    // Connection-type chip click? (does not disturb the armed tool/service.)
    const connId = this._hitConn(mx, my);
    if (connId) {
      this.connType = connId;
      return true;
    }

    // Tab click?
    const tabId = this._hitTab(mx, my);
    if (tabId) {
      this.activeGroup = tabId;
      this._clear(); // deselect tool when switching groups
      return true;
    }

    const id = this._hit(mx, my);
    if (id == null) return false;

    if (id === "__wire") {
      this._arm("wire");
    } else if (id === "__erase") {
      this._arm("erase");
    } else {
      const svc = SERVICES[id];
      if (svc && svc.cost <= budget) {
        if (this.selected === id) this._clear();
        else this._arm("build", id);
      }
    }
    return true;
  }

  _arm(mode, id = null) {
    this.wireMode  = mode === "wire";
    this.eraseMode = mode === "erase";
    this.selected  = mode === "build" ? id : null;
  }

  _clear() {
    this.selected  = null;
    this.wireMode  = false;
    this.eraseMode = false;
  }

  clearSelection() { this._clear(); }

  updateHover(mx, my, dt) {
    this._t += dt;
    const conn = this._hitConn(mx, my);
    this.hoverId = conn ? "__conn:" + conn : (this._hit(mx, my) || this._hitTab(mx, my));
  }

  isOver(mx, my) {
    if (!this._barRect) return false;
    const b = this._barRect;
    return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
  }

  render(ctx, cssW, cssH, budget) {
    const bar = this._layout(cssW, cssH);
    const grp = PALETTE_GROUPS.find((g) => g.id === this.activeGroup) || PALETTE_GROUPS[0];

    // Bar background
    ctx.fillStyle = "rgba(24,31,40,0.93)";
    roundRect(ctx, bar.x, bar.y, bar.w, bar.h, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    roundRect(ctx, bar.x, bar.y, bar.w, bar.h, 14);
    ctx.stroke();

    // Connection-type picker chips
    for (const cr of this._connRects) {
      const conn = getConn(cr.id);
      const active = cr.id === this.connType;
      const over = this.hoverId === "__conn:" + cr.id && !active;
      ctx.fillStyle = active ? conn.color : over ? PALETTE.bgPanelHi : PALETTE.bgPanel;
      roundRect(ctx, cr.x, cr.y, cr.w, cr.h, 6);
      ctx.fill();
      if (active) {
        ctx.strokeStyle = lighten(conn.color, 0.3);
        ctx.lineWidth = 1.5;
        roundRect(ctx, cr.x, cr.y, cr.w, cr.h, 6);
        ctx.stroke();
      }
      ctx.font = "700 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = active ? "#0c0f14" : conn.color;
      ctx.fillText(conn.short.toUpperCase(), cr.x + cr.w / 2, cr.y + cr.h / 2);
    }

    // Category tabs
    for (const tr of this._tabRects) {
      const g = PALETTE_GROUPS.find((g) => g.id === tr.id);
      const active = tr.id === this.activeGroup;
      const over   = this.hoverId === tr.id && !active;

      ctx.fillStyle = active ? PALETTE.accent : over ? PALETTE.bgPanelHi : PALETTE.bgPanel;
      roundRect(ctx, tr.x, tr.y, tr.w, tr.h, 7);
      ctx.fill();

      ctx.font = "700 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = active ? "#1a120a" : PALETTE.textDim;
      ctx.fillText(g.label.toUpperCase(), tr.x + tr.w / 2, tr.y + tr.h / 2);
    }

    // Vertical separator between tools and service buttons
    const firstSvc = this._rects.find((r) => !r.id.startsWith("__"));
    if (firstSvc && this._sepX != null) {
      const btnY = firstSvc.y;
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this._sepX, btnY + 6);
      ctx.lineTo(this._sepX, btnY + BTN - 6);
      ctx.stroke();
    }

    // Buttons (tools + services)
    for (const r of this._rects) {
      const isTool = r.id.startsWith("__");
      const armed  =
        (r.id === "__wire"  && this.wireMode) ||
        (r.id === "__erase" && this.eraseMode) ||
        (!isTool && this.selected === r.id);

      const svc       = isTool ? null : SERVICES[r.id];
      const affordable = isTool || (svc && svc.cost <= budget);

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
        ctx.font = "22px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(r.id === "__wire" ? "🔌" : "🗑️", r.x + r.w / 2, r.y + r.h / 2 - 6);
        ctx.font = FONT.uiSmall;
        ctx.fillStyle = PALETTE.textDim;
        ctx.fillText(r.id === "__wire" ? "Wire" : "Erase", r.x + r.w / 2, r.y + r.h - 9);
      } else if (svc) {
        ctx.save();
        ctx.translate(0, -6);
        const scale = 0.62;
        ctx.translate(r.x + r.w / 2, r.y + r.h / 2 - 2);
        ctx.scale(scale, scale);
        drawService(ctx, svc, 0, 0, { bob: 0, look: { x: 0, y: 0.1 } });
        ctx.restore();
        ctx.font = FONT.uiSmall;
        ctx.fillStyle = affordable ? PALETTE.accent : PALETTE.bad;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText("$" + svc.cost, r.x + r.w / 2, r.y + r.h - 7);
      }
      ctx.restore();
    }

    // Tooltip for hovered service (above the bar)
    const hov = this.hoverId;
    if (hov && hov.startsWith("__conn:")) {
      const conn = getConn(hov.slice(7));
      const tipLines = conn.examTip ? ["", "📚 Exam:", ...wrap(conn.examTip, 44)] : [];
      this._panel(ctx, bar, conn.label, [...wrap(conn.blurb, 44), ...tipLines], conn.color);
    } else if (hov && !hov.startsWith("__") && SERVICES[hov]) {
      this._tooltip(ctx, SERVICES[hov], bar);
    } else if (hov === "__wire") {
      this._toolTip(ctx, bar, "Wire tool", "Drag between two services to lay a wire — any distance. Pick the connection type in the row above (or press C to cycle). Right-click a wire to cut it.");
    } else if (hov === "__erase") {
      this._toolTip(ctx, bar, "Erase tool", "Click a building to remove it (refunds its cost), or click a wire to cut it. Gate tiles cannot be removed. Wires can also be cut by right-click or Delete.");
    }

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }

  _tooltip(ctx, svc, bar) {
    const extras = [];
    if (svc.transferCostMul != null && svc.transferCostMul !== 1) {
      extras.push(svc.transferCostMul > 1
        ? `⚠ Transfer cost ×${svc.transferCostMul} per hop`
        : `✓ Transfer cost ×${svc.transferCostMul} per hop (cheap!)`);
    }
    if (svc.attackMitigation) extras.push(`🛡 Absorbs ${Math.round(svc.attackMitigation * 100)}% of spike multiplier`);
    if (svc.azResilient)       extras.push("✓ Survives AZ failure (auto-promotes standby)");
    if (svc.autoScale)         extras.push("✓ Auto-scales throughput up to 2× under load");
    if (svc.replayable)        extras.push("✓ Replayable — up to 365-day retention");

    const lines = wrap(svc.blurb, 44);
    const statLine = `Cost $${svc.cost}  •  Throughput ${svc.throughput}  •  Latency ${svc.latency}ms`;
    const tipLines = svc.examTip ? ["", "📚 Exam:", ...wrap(svc.examTip, 44)] : [];
    this._panel(ctx, bar, svc.label, [statLine, ...(extras.length ? ["", ...extras, ""] : [""]), ...lines, ...tipLines], svc.color);
  }

  _toolTip(ctx, bar, title, body) {
    this._panel(ctx, bar, title, wrap(body, 44), PALETTE.accent2);
  }

  _panel(ctx, bar, title, bodyLines, accent) {
    const w = 340;
    const lineH = 16;
    const h = 44 + bodyLines.length * lineH;
    const x = bar.x + bar.w / 2 - w / 2;
    const y = bar.y - h - 10;

    ctx.fillStyle = "rgba(18,24,32,0.96)";
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = accent || PALETTE.accent;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 10);
    ctx.stroke();

    ctx.fillStyle = lighten(accent || PALETTE.accent, 0.25);
    ctx.font = FONT.ui;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(title, x + 14, y + 12);

    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.uiSmall;
    let ty = y + 34;
    for (const ln of bodyLines) {
      if (ln.startsWith("⚠")) {
        ctx.fillStyle = PALETTE.warn;
      } else if (ln.startsWith("✓") || ln.startsWith("🛡")) {
        ctx.fillStyle = PALETTE.good;
      } else if (ln.startsWith("📚")) {
        ctx.fillStyle = PALETTE.accent;
      } else {
        ctx.fillStyle = PALETTE.textDim;
      }
      ctx.fillText(ln, x + 14, ty);
      ty += lineH;
    }
  }
}

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
