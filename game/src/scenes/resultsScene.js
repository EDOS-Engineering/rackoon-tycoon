// resultsScene.js — End-of-round report (title → level → RESULTS).
// Phase 2: shows the win/lose verdict, a star rating + score, the score's three
// pillars (uptime / cost-efficiency / resilience), and a bill breakdown. Persists
// best score + stars per level and unlocks the next level on a win (T2.5).

import { Scene } from "../engine/scene.js";
import { PALETTE, FONT } from "../theme.js";
import { roundRect, drawRaccoon } from "../render/sprites.js";
import { load, save } from "../save/storage.js";
import { recordResult, bestFor } from "../save/progress.js";
import { OUTCOME } from "../economy/scoring.js";
import { getLevel } from "../levels/levels.js";
import { audio } from "../engine/audio.js";

export class ResultsScene extends Scene {
  enter(payload) {
    this.r = payload || {};
    this.t = 0;

    this.won = this.r.outcome === OUTCOME.WIN;
    this.stars = this.r.stars || 0;
    this.scoreVal = this.r.score || 0;
    this.factors = this.r.factors || { uptime: 0, costEfficiency: 0, resilience: 0 };
    this.bill = this.r.bill || { total: 0, running: 0, transfer: 0 };

    // Net = revenue earned minus money lost.
    this.net = (this.r.revenue || 0) - (this.r.lost || 0);
    this.metGoal = (this.r.success || 0) >= (this.r.goalRequests || 0);

    // Legacy best-routed (kept for the title screen's "best routed" line).
    const best = load("bestRouted", 0);
    if ((this.r.success || 0) > best) save("bestRouted", this.r.success || 0);

    // Persist campaign progress: best score/stars + unlock the next level.
    const levelId = this.r.levelId || "first_light";
    this.persist = recordResult(levelId, {
      score: this.scoreVal,
      stars: this.stars,
      routed: this.r.success || 0,
      won: this.won,
      nextLevelId: this.r.nextLevelId || null,
    });
    this.prevBest = bestFor(levelId);

    // Star pop animation timing.
    this._starAt = [0.35, 0.6, 0.85];

    this._btns = {};

    // Exam tip for this level (T4.3).
    const lvl = getLevel(this.r.levelId || "first_light");
    this.examTip = lvl.examTip || null;

    // Play win/lose sound (T4.2).
    audio.play(this.won ? "win" : "lose");
  }

  update(dt) {
    this.t += dt;
    const input = this.game.input;
    if (input.leftDown) {
      if (this._hit(this._btns.replay, input)) {
        this.game.scenes.go("level", { levelId: this.r.levelId || "first_light" });
      } else if (this._hit(this._btns.next, input) && this._nextId) {
        this.game.scenes.go("level", { levelId: this._nextId });
      } else if (this._hit(this._btns.menu, input)) {
        this.game.scenes.go("title");
      }
    }
    if (input.pressed("Enter") || input.pressed("Space")) {
      const go = this._nextId || this.r.levelId || "first_light";
      this.game.scenes.go("level", { levelId: go });
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
    const panW = 480;
    const examLines = this.examTip ? wrapTip(this.examTip, 54) : [];
    const examH = examLines.length > 0 ? 26 + examLines.length * 15 : 0;
    const panH = 520 + examH;
    const px = cx - panW / 2;
    const py = Math.max(10, H / 2 - panH / 2);

    // Panel.
    ctx.fillStyle = PALETTE.bgPanel;
    roundRect(ctx, px, py, panW, panH, 18);
    ctx.fill();
    ctx.strokeStyle = this.won ? "rgba(126,217,87,0.4)" : "rgba(255,94,94,0.35)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, px, py, panW, panH, 18);
    ctx.stroke();

    // Rocky peeking at top.
    drawRaccoon(ctx, cx, py + 6, 78, {
      look: { x: Math.sin(this.t * 1.5) * 0.4, y: 0.1 },
    });

    // Verdict.
    ctx.textAlign = "center";
    ctx.fillStyle = this.won ? PALETTE.good : PALETTE.bad;
    ctx.font = "800 30px system-ui, sans-serif";
    ctx.fillText(this.won ? "Wave Survived!" : "Game Over", cx, py + 92);

    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.ui;
    ctx.fillText(this.r.levelName || "First Light", cx, py + 114);

    // Stars (animated pop-in).
    this._drawStars(ctx, cx, py + 150);

    // Score.
    ctx.fillStyle = PALETTE.accent;
    ctx.font = "800 34px system-ui, sans-serif";
    ctx.fillText(String(this.scoreVal), cx, py + 198);
    ctx.fillStyle = PALETTE.textFaint;
    ctx.font = FONT.uiSmall;
    ctx.fillText("SCORE", cx, py + 214);

    // The three scoring pillars as labelled bars.
    let by = py + 232;
    by = this._bar(ctx, px, by, panW, "Uptime", this.factors.uptime, PALETTE.good);
    by = this._bar(ctx, px, by, panW, "Cost efficiency", this.factors.costEfficiency, PALETTE.accent);
    by = this._bar(ctx, px, by, panW, "Resilience", this.factors.resilience, PALETTE.accent2);

    // Stat rows (compact).
    const rows = [
      ["Routed / Dropped", (this.r.success || 0) + " / " + (this.r.failed || 0), PALETTE.text],
      ["Revenue − losses", money(this.net), this.net >= 0 ? PALETTE.good : PALETTE.bad],
      ["AWS bill (run + transfer)", "$" + Math.round(this.bill.total), PALETTE.warn],
      ["Budget remaining", "$" + Math.round(this.r.budget || 0), PALETTE.accent],
    ];
    let ry = by + 6;
    ctx.font = FONT.uiSmall;
    for (const [label, val, color] of rows) {
      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText(label, px + 30, ry + 12);
      ctx.textAlign = "right";
      ctx.fillStyle = color;
      ctx.fillText(val, px + panW - 30, ry + 12);
      ry += 20;
    }

    // Bill breakdown sub-line.
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.textFaint;
    ctx.fillText(
      "Bill: $" +
        Math.round(this.bill.running) +
        " running  +  $" +
        Math.round(this.bill.transfer) +
        " data transfer",
      cx,
      ry + 10
    );
    ry += 22;

    // SAA-C03 exam tip (T4.3) — shown for every completed level.
    if (examLines.length > 0) {
      const tipX = px + 18;
      const tipW = panW - 36;
      const tipY = ry + 8;
      ctx.fillStyle = "rgba(255,179,71,0.08)";
      roundRect(ctx, tipX, tipY, tipW, examH - 2, 8);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,179,71,0.25)";
      ctx.lineWidth = 1;
      roundRect(ctx, tipX, tipY, tipW, examH - 2, 8);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.fillStyle = PALETTE.accent;
      ctx.fillText("📚  SAA-C03 EXAM TIP", tipX + 10, tipY + 11);
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = PALETTE.textDim;
      let ety = tipY + 24;
      for (const ln of examLines) {
        ctx.fillText(ln, tipX + 10, ety);
        ety += 15;
      }
      ry = ety + 4;
    }

    // Unlock / best celebration.
    if (this.persist && this.persist.unlockedNext && this._nextLabel()) {
      ctx.fillStyle = PALETTE.good;
      ctx.font = FONT.ui;
      ctx.fillText("★ Unlocked: " + this._nextLabel() + "!", cx, ry + 10);
    } else if (this.persist && this.persist.newBest) {
      ctx.fillStyle = PALETTE.accent;
      ctx.font = FONT.ui;
      ctx.fillText("New best score for this level!", cx, ry + 10);
    }

    // Buttons.
    this._nextId = this.won ? this.r.nextLevelId || null : null;
    const haveNext = !!this._nextId;
    const bw = haveNext ? 150 : 180;
    const bh = 44;
    const by2 = py + panH - 58;
    const gap = 12;

    if (haveNext) {
      const totalW = bw * 3 + gap * 2;
      let bx = cx - totalW / 2;
      this._btns.replay = { x: bx, y: by2, w: bw, h: bh };
      this._btns.next = { x: bx + bw + gap, y: by2, w: bw, h: bh };
      this._btns.menu = { x: bx + (bw + gap) * 2, y: by2, w: bw, h: bh };
      this._button(ctx, this._btns.replay, "↻ Replay", PALETTE.bgPanelHi, PALETTE.text);
      this._button(ctx, this._btns.next, "Next level ▸", PALETTE.accent, "#1a120a");
      this._button(ctx, this._btns.menu, "Menu", PALETTE.bgPanelHi, PALETTE.text);
    } else {
      const totalW = bw * 2 + gap;
      let bx = cx - totalW / 2;
      this._btns.replay = { x: bx, y: by2, w: bw, h: bh };
      this._btns.menu = { x: bx + bw + gap, y: by2, w: bw, h: bh };
      this._button(ctx, this._btns.replay, "↻ Try again", PALETTE.accent, "#1a120a");
      this._button(ctx, this._btns.menu, "Menu", PALETTE.bgPanelHi, PALETTE.text);
    }
  }

  _drawStars(ctx, cx, y) {
    const gap = 46;
    for (let i = 0; i < 3; i++) {
      const earned = i < this.stars;
      const appear = Math.min(1, Math.max(0, (this.t - this._starAt[i]) / 0.25));
      const scale = earned ? 0.6 + 0.4 * easeOut(appear) : 1;
      const x = cx + (i - 1) * gap;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.font = "30px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = earned ? appear : 0.25;
      ctx.fillStyle = earned ? PALETTE.accent : PALETTE.textFaint;
      ctx.fillText(earned ? "★" : "☆", 0, 0);
      ctx.restore();
    }
  }

  _bar(ctx, px, y, panW, label, value, color) {
    const x = px + 30;
    const w = panW - 60;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = FONT.uiSmall;
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText(label, x, y);
    ctx.textAlign = "right";
    ctx.fillStyle = color;
    ctx.fillText(Math.round((value || 0) * 100) + "%", x + w, y);

    const ty = y + 15;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, x, ty, w, 5, 3);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, x, ty, Math.max(2, w * clamp01(value || 0)), 5, 3);
    ctx.fill();
    return y + 26;
  }

  _nextLabel() {
    const id = this.r.nextLevelId;
    if (!id) return null;
    return getLevel(id).name;
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
    ctx.font = "700 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.textBaseline = "alphabetic";
  }
}

function wrapTip(text, n) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > n) { lines.push(cur.trim()); cur = w; }
    else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

function money(n) {
  return (n >= 0 ? "+$" : "-$") + Math.abs(Math.round(n));
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
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
