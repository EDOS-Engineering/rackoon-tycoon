// resultsScene.js — End-of-round tally screen (title → level → RESULTS).
// Phase 1 shows the counters and net result; Phase 2 adds star ratings, win/lose
// and unlocks. Persists a "best routed" score to localStorage.

import { Scene } from "../engine/scene.js";
import { PALETTE, FONT } from "../theme.js";
import { roundRect, drawRaccoon } from "../render/sprites.js";
import { load, save } from "../save/storage.js";

export class ResultsScene extends Scene {
  enter(payload) {
    this.r = payload || {};
    this.t = 0;

    const success = this.r.success || 0;
    // Update best routed score.
    const best = load("bestRouted", 0);
    this.newBest = success > best;
    if (this.newBest) save("bestRouted", success);
    this.best = Math.max(best, success);

    // Net = revenue earned minus money lost, plus leftover budget.
    this.net = (this.r.revenue || 0) - (this.r.lost || 0);
    this.metGoal = success >= (this.r.goalRequests || 0);

    this._btns = {};
  }

  update(dt) {
    this.t += dt;
    const input = this.game.input;
    if (input.leftDown) {
      if (this._hit(this._btns.replay, input)) {
        this.game.scenes.go("level", { levelId: "first_light" });
      } else if (this._hit(this._btns.menu, input)) {
        this.game.scenes.go("title");
      }
    }
    if (input.pressed("Enter") || input.pressed("Space")) {
      this.game.scenes.go("level", { levelId: "first_light" });
    }
    if (input.pressed("Escape")) this.game.scenes.go("title");
  }

  _hit(b, input) {
    if (!b) return false;
    return (
      input.x >= b.x && input.x <= b.x + b.w && input.y >= b.y && input.y <= b.y + b.h
    );
  }

  render(ctx) {
    const W = this.game.canvas.cssW;
    const H = this.game.canvas.cssH;

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PALETTE.bgDeep);
    g.addColorStop(1, "#0c1014");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const panW = 460;
    const panH = 420;
    const px = cx - panW / 2;
    const py = H / 2 - panH / 2;

    // Panel.
    ctx.fillStyle = PALETTE.bgPanel;
    roundRect(ctx, px, py, panW, panH, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    roundRect(ctx, px, py, panW, panH, 18);
    ctx.stroke();

    // Rocky peeking at top.
    drawRaccoon(ctx, cx, py + 10, 86, {
      look: { x: Math.sin(this.t * 1.5) * 0.4, y: 0.1 },
    });

    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.text;
    ctx.font = "800 30px system-ui, sans-serif";
    ctx.fillText("Round Report", cx, py + 96);

    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.ui;
    ctx.fillText(this.r.levelName || "First Light", cx, py + 120);

    // Stat rows.
    const rows = [
      ["Routed (success)", String(this.r.success || 0), PALETTE.good],
      ["Dropped (fail)", String(this.r.failed || 0), PALETTE.bad],
      ["Revenue earned", "$" + (this.r.revenue || 0), PALETTE.good],
      ["Money lost", "$" + (this.r.lost || 0), PALETTE.bad],
      ["Budget remaining", "$" + Math.round(this.r.budget || 0), PALETTE.accent],
    ];
    let ry = py + 150;
    ctx.font = FONT.ui;
    for (const [label, val, color] of rows) {
      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText(label, px + 40, ry + 16);
      ctx.textAlign = "right";
      ctx.fillStyle = color;
      ctx.fillText(val, px + panW - 40, ry + 16);
      ry += 30;
    }

    // Net result line.
    ry += 8;
    ctx.textAlign = "center";
    ctx.font = "700 18px system-ui, sans-serif";
    const netColor = this.net >= 0 ? PALETTE.good : PALETTE.bad;
    ctx.fillStyle = netColor;
    ctx.fillText(
      (this.net >= 0 ? "Net profit  +$" : "Net loss  -$") + Math.abs(this.net),
      cx,
      ry + 16
    );

    // Goal / best.
    ry += 30;
    ctx.font = FONT.uiSmall;
    ctx.fillStyle = this.metGoal ? PALETTE.good : PALETTE.warn;
    ctx.fillText(
      this.metGoal
        ? "Goal reached: 30+ routed! Rocky is proud."
        : "Goal: route 30 requests. Keep building!",
      cx,
      ry + 12
    );
    if (this.newBest) {
      ctx.fillStyle = PALETTE.accent;
      ctx.fillText("★ New best: " + this.best + " routed!", cx, ry + 30);
    }

    // Buttons.
    const bw = 180;
    const bh = 46;
    const by = py + panH - 64;
    const gap = 16;
    const replayX = cx - bw - gap / 2;
    const menuX = cx + gap / 2;
    this._btns.replay = { x: replayX, y: by, w: bw, h: bh };
    this._btns.menu = { x: menuX, y: by, w: bw, h: bh };

    this._button(ctx, this._btns.replay, "▶ Play again", PALETTE.accent, "#1a120a");
    this._button(ctx, this._btns.menu, "Menu", PALETTE.bgPanelHi, PALETTE.text);
  }

  _button(ctx, b, label, fill, textColor) {
    const over =
      this.game.input.x >= b.x &&
      this.game.input.x <= b.x + b.w &&
      this.game.input.y >= b.y &&
      this.game.input.y <= b.y + b.h;
    ctx.fillStyle = over ? lightenHex(fill) : fill;
    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fill();
    ctx.fillStyle = textColor;
    ctx.font = "700 18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.textBaseline = "alphabetic";
  }
}

// Quick perceived-lighten for hover (handles hex + rgb gracefully enough).
function lightenHex(c) {
  if (c.startsWith("#")) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h, 16);
    const r = Math.min(255, ((n >> 16) & 255) + 24);
    const g = Math.min(255, ((n >> 8) & 255) + 24);
    const b = Math.min(255, (n & 255) + 24);
    return `rgb(${r},${g},${b})`;
  }
  return c;
}
