// titleScene.js — The title screen: animated Rocky logo, brand, Play button.
// Background shows drifting "guest" sparks and faint grid to preview the vibe.
// Click PLAY (or press Enter/Space) to enter the level.

import { Scene } from "../engine/scene.js";
import { PALETTE, FONT, BRAND } from "../theme.js";
import { drawRaccoon, roundRect } from "../render/sprites.js";
import { load } from "../save/storage.js";
import { LEVEL_ORDER, FIRST_LEVEL, getLevel } from "../levels/levels.js";
import { isUnlocked, bestFor, totalStars, resetProgress } from "../save/progress.js";
import { DIFFICULTIES, getDifficultyId, setDifficultyId } from "../save/difficulty.js";

export class TitleScene extends Scene {
  enter() {
    this.t = 0;
    this.best = load("bestRouted", 0);
    this.totalStars = totalStars();
    this.diffId = getDifficultyId();
    // "Continue" target: the furthest unlocked level (else the intro).
    this.continueId = FIRST_LEVEL;
    for (const id of LEVEL_ORDER) {
      if (isUnlocked(id, FIRST_LEVEL)) this.continueId = id;
    }
    // Floating background sparks (decorative "guests").
    this.sparks = [];
    for (let i = 0; i < 36; i++) {
      this.sparks.push({
        x: Math.random(),
        y: Math.random(),
        s: 0.4 + Math.random() * 0.9,
        spd: 0.01 + Math.random() * 0.03,
        ph: Math.random() * Math.PI * 2,
      });
    }
    this._btn = { x: 0, y: 0, w: 0, h: 0 };
    this._levelBtns = []; // filled during render
    this._diffBtns = []; // difficulty chips, filled during render
    this._sandboxBtn = { x: 0, y: 0, w: 0, h: 0 };
    this._newGameBtn = { x: 0, y: 0, w: 0, h: 0 };
    this.confirmReset = false; // "New Game" confirmation modal open?
    this._confirmYes = { x: 0, y: 0, w: 0, h: 0 };
    this._confirmNo = { x: 0, y: 0, w: 0, h: 0 };
  }

  _in(r) {
    const i = this.game.input;
    return i.x >= r.x && i.x <= r.x + r.w && i.y >= r.y && i.y <= r.y + r.h;
  }

  update(dt) {
    this.t += dt;
    const input = this.game.input;

    for (const s of this.sparks) {
      s.x += s.spd * dt * 0.15;
      if (s.x > 1.1) s.x -= 1.2;
    }

    // New Game confirmation modal: it owns all input while open.
    if (this.confirmReset) {
      this._hot = false;
      if (input.leftDown) {
        if (this._in(this._confirmYes)) {
          resetProgress();
          this.best = load("bestRouted", 0);
          this.totalStars = totalStars();
          this.continueId = FIRST_LEVEL;
          this.confirmReset = false;
          return;
        }
        if (this._in(this._confirmNo)) { this.confirmReset = false; return; }
      }
      if (input.pressed("Escape")) this.confirmReset = false;
      return;
    }

    // Hit-test the New Game button → open the confirmation modal.
    if (input.leftDown && this._in(this._newGameBtn)) {
      this.confirmReset = true;
      return;
    }

    // Hit-test the sandbox button.
    if (input.leftDown) {
      const sb = this._sandboxBtn;
      if (input.x >= sb.x && input.x <= sb.x + sb.w && input.y >= sb.y && input.y <= sb.y + sb.h) {
        this.game.scenes.go("level", { levelId: "sandbox" });
        return;
      }
    }

    // Hit-test difficulty chips (sets + persists the choice).
    if (input.leftDown) {
      for (const db of this._diffBtns) {
        if (
          input.x >= db.x &&
          input.x <= db.x + db.w &&
          input.y >= db.y &&
          input.y <= db.y + db.h
        ) {
          setDifficultyId(db.id);
          this.diffId = db.id;
          return;
        }
      }
    }

    // Hit-test the level-select chips (only unlocked are clickable).
    if (input.leftDown) {
      for (const lb of this._levelBtns) {
        if (
          lb.unlocked &&
          input.x >= lb.x &&
          input.x <= lb.x + lb.w &&
          input.y >= lb.y &&
          input.y <= lb.y + lb.h
        ) {
          this.game.scenes.go("level", { levelId: lb.id });
          return;
        }
      }
    }

    // Hit-test Play / Continue button.
    const over = this._overBtn(input.x, input.y);
    this._hot = over;
    if ((over && input.leftDown) || input.pressed("Enter") || input.pressed("Space")) {
      this.game.scenes.go("level", { levelId: this.continueId });
    }
  }

  _overBtn(mx, my) {
    const b = this._btn;
    return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
  }

  render(ctx, _alpha) {
    const W = this.game.canvas.cssW;
    const H = this.game.canvas.cssH;

    // Background gradient.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PALETTE.bgDeep);
    g.addColorStop(1, "#0c1014");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Faint grid wash.
    ctx.strokeStyle = "rgba(255,255,255,0.025)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 56;
    for (let x = 0; x < W; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = 0; y < H; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    // Drifting sparks.
    for (const s of this.sparks) {
      const px = s.x * W;
      const py = s.y * H + Math.sin(this.t * 0.8 + s.ph) * 8;
      ctx.fillStyle = "rgba(255,209,102,0.5)";
      ctx.beginPath();
      ctx.arc(px, py, 2.2 * s.s, 0, Math.PI * 2);
      ctx.fill();
    }

    const cx = W / 2;
    const topY = H * 0.22;

    // Logo: raccoon in a soft amber halo. Eyes follow the cursor for charm.
    const lookX = clamp((this.game.input.x - cx) / (W * 0.5), -1, 1) * 0.6;
    const lookY = clamp((this.game.input.y - topY) / (H * 0.5), -1, 1) * 0.5;
    const bob = Math.sin(this.t * 1.6) * 6;

    ctx.save();
    ctx.shadowColor = "rgba(255,179,71,0.5)";
    ctx.shadowBlur = 44;
    drawRaccoon(ctx, cx, topY + bob, 128, { look: { x: lookX, y: lookY } });
    ctx.restore();

    // Wordmark.
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.text;
    ctx.font = FONT.title;
    ctx.fillText("Rackoon", cx, topY + 128);
    ctx.fillStyle = PALETTE.accent;
    ctx.fillText("Tycoon", cx, topY + 184);

    // Mascot emoji flourish.
    ctx.font = "36px system-ui, sans-serif";
    ctx.fillText("🦝", cx + 200, topY + 128);

    // Tagline.
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.ui;
    ctx.fillText(BRAND.tagline, cx, topY + 216);

    // PLAY button.
    const bw = 220;
    const bh = 54;
    const bx = cx - bw / 2;
    const by = topY + 248;
    this._btn = { x: bx, y: by, w: bw, h: bh };

    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);
    ctx.fillStyle = this._hot ? PALETTE.accent : "#e09a2e";
    ctx.shadowColor = "rgba(255,179,71," + (0.3 + pulse * 0.4) + ")";
    ctx.shadowBlur = this._hot ? 30 : 16;
    roundRect(ctx, bx, by, bw, bh, 14);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#1a120a";
    ctx.font = "800 24px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const playLabel = this.continueId === FIRST_LEVEL ? "▶  PLAY" : "▶  CONTINUE";
    ctx.fillText(playLabel, cx, by + bh / 2 + 1);
    ctx.textBaseline = "alphabetic";

    // Difficulty selector (T3.8) then the compact level grid below it.
    this._renderDifficulty(ctx, cx, by + bh + 16, W);
    const lvlBottom = this._renderLevelSelect(ctx, cx, by + bh + 80, W);

    // Reserved hover line: full name + subtitle of the focused mission (keeps the
    // grid chips terse). When nothing is hovered, show a compact progress stat.
    ctx.textAlign = "center";
    ctx.font = FONT.uiSmall;
    const hl = this._hoverLevelId ? getLevel(this._hoverLevelId) : null;
    ctx.fillStyle = hl ? PALETTE.textDim : PALETTE.textFaint;
    const label = hl
      ? hl.name + (hl.subtitle ? "  —  " + hl.subtitle : "")
      : LEVEL_ORDER.length + " missions  ·  " + this.totalStars + " ★ earned  ·  best routed " + this.best + "  ·  hover for details";
    ctx.fillText(label, cx, lvlBottom + 18);

    this._renderSandboxBtn(ctx, cx, lvlBottom + 30, W);

    // New Game button (top-right) + its confirmation modal (drawn on top).
    this._renderNewGameBtn(ctx, W, H);
    if (this.confirmReset) this._renderConfirm(ctx, W, H);
  }

  // Small top-right button that opens the reset-progress confirmation.
  _renderNewGameBtn(ctx, W, H) {
    const bw = 132, bh = 34;
    const bx = W - bw - 18, by = 18;
    this._newGameBtn = { x: bx, y: by, w: bw, h: bh };
    const over = this._in(this._newGameBtn);

    ctx.fillStyle = over ? "rgba(120,44,44,0.6)" : "rgba(40,28,28,0.55)";
    roundRect(ctx, bx, by, bw, bh, 9);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,120,120,0.5)";
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, bw, bh, 9);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillStyle = over ? "#ffd6d6" : PALETTE.textDim;
    ctx.fillText("↺  New Game", bx + bw / 2, by + bh / 2);
    ctx.textBaseline = "alphabetic";
  }

  // Confirmation modal for wiping progress. Reset (destructive) / Cancel.
  _renderConfirm(ctx, W, H) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, W, H);

    const mw = 460, mh = 200;
    const mx = W / 2 - mw / 2, my = H / 2 - mh / 2;
    ctx.fillStyle = "rgba(20,26,34,0.98)";
    roundRect(ctx, mx, my, mw, mh, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,120,120,0.6)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, mx, my, mw, mh, 16);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.text;
    ctx.font = "800 20px system-ui, sans-serif";
    ctx.fillText("Start a New Game?", W / 2, my + 44);

    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.uiSmall;
    const starsTxt = this.totalStars > 0 ? this.totalStars + " ★" : "your stars";
    ctx.fillText("This erases ALL campaign progress and " + starsTxt + ".", W / 2, my + 78);
    ctx.fillText("Difficulty and sandbox stay. This cannot be undone.", W / 2, my + 98);

    // Buttons.
    const bw = 150, bh = 44, gap = 24;
    const byb = my + mh - bh - 24;
    const yesX = W / 2 - bw - gap / 2;
    const noX = W / 2 + gap / 2;
    this._confirmYes = { x: yesX, y: byb, w: bw, h: bh };
    this._confirmNo = { x: noX, y: byb, w: bw, h: bh };

    const yesOver = this._in(this._confirmYes);
    ctx.fillStyle = yesOver ? "#d65a5a" : "#b94a4a";
    roundRect(ctx, yesX, byb, bw, bh, 11);
    ctx.fill();
    ctx.fillStyle = "#1a0e0e";
    ctx.font = "800 15px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("↺  Reset everything", yesX + bw / 2, byb + bh / 2);

    const noOver = this._in(this._confirmNo);
    ctx.fillStyle = noOver ? PALETTE.bgPanelHi : PALETTE.bgPanel;
    roundRect(ctx, noX, byb, bw, bh, 11);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    roundRect(ctx, noX, byb, bw, bh, 11);
    ctx.stroke();
    ctx.fillStyle = PALETTE.text;
    ctx.fillText("Cancel", noX + bw / 2, byb + bh / 2);
    ctx.textBaseline = "alphabetic";
  }

  // A row of difficulty chips (T3.8). The selected tier is highlighted; clicking
  // one persists the choice (applied to budget + speed when a level starts).
  _renderDifficulty(ctx, cx, y, W) {
    this._diffBtns = [];
    const n = DIFFICULTIES.length;
    const cw = 176;
    const ch = 46;
    const gap = 12;
    const totalW = n * cw + (n - 1) * gap;
    let x = cx - totalW / 2;

    ctx.textAlign = "center";

    for (const d of DIFFICULTIES) {
      const sel = d.id === this.diffId;
      const rect = { id: d.id, x, y: y + 4, w: cw, h: ch };
      this._diffBtns.push(rect);
      const over =
        this.game.input.x >= x &&
        this.game.input.x <= x + cw &&
        this.game.input.y >= y + 4 &&
        this.game.input.y <= y + 4 + ch;

      ctx.fillStyle = sel || over ? PALETTE.bgPanelHi : PALETTE.bgPanel;
      roundRect(ctx, x, y + 4, cw, ch, 10);
      ctx.fill();
      ctx.strokeStyle = sel ? PALETTE.accent : "rgba(255,255,255,0.08)";
      ctx.lineWidth = sel ? 2 : 1;
      roundRect(ctx, x, y + 4, cw, ch, 10);
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.fillStyle = sel ? PALETTE.accent : PALETTE.text;
      ctx.font = "700 13px system-ui, sans-serif";
      ctx.fillText((sel ? "● " : "") + d.name, x + 12, y + 22);
      ctx.fillStyle = PALETTE.textFaint;
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(
        "budget ×" + d.budgetMul + "  ·  speed ×" + d.speedMul,
        x + 12,
        y + 38
      );
      x += cw + gap;
    }
    ctx.textAlign = "center";
  }

  // Compact wrapped grid of level chips. Dense: each chip shows its number, a
  // short name, and earned stars; the hovered chip's full name+subtitle is shown
  // on a reserved label line by the caller. Returns the grid's bottom Y.
  _renderLevelSelect(ctx, cx, y, W) {
    this._levelBtns = [];
    this._hoverLevelId = null;
    const n = LEVEL_ORDER.length;
    const cw = 100, ch = 40, gap = 6;
    // Pick a column count that keeps the grid tight and on-screen.
    const maxRowW = Math.min(W - 80, 920);
    const cols = Math.max(4, Math.min(9, Math.floor((maxRowW + gap) / (cw + gap))));

    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < n; i++) {
      const id = LEVEL_ORDER[i];
      const row = Math.floor(i / cols);
      const col = i % cols;
      const itemsInRow = Math.min(cols, n - row * cols);
      const rowW = itemsInRow * cw + (itemsInRow - 1) * gap;
      const x = cx - rowW / 2 + col * (cw + gap);
      const cy = y + row * (ch + gap);

      const lvl = getLevel(id);
      const unlocked = isUnlocked(id, FIRST_LEVEL);
      const best = bestFor(id);
      this._levelBtns.push({ id, x, y: cy, w: cw, h: ch, unlocked });
      const over = unlocked && this._in({ x, y: cy, w: cw, h: ch });
      if (over) this._hoverLevelId = id;

      ctx.globalAlpha = unlocked ? 1 : 0.4;
      ctx.fillStyle = over ? PALETTE.bgPanelHi : PALETTE.bgPanel;
      roundRect(ctx, x, cy, cw, ch, 7);
      ctx.fill();
      ctx.strokeStyle = best && best.stars
        ? PALETTE.accent
        : unlocked ? (over ? "rgba(255,179,71,0.6)" : "rgba(255,179,71,0.28)") : "rgba(255,255,255,0.06)";
      ctx.lineWidth = best && best.stars ? 1.5 : 1;
      roundRect(ctx, x, cy, cw, ch, 7);
      ctx.stroke();

      // Number badge + short name on line 1.
      ctx.textAlign = "left";
      ctx.font = "700 9px system-ui, sans-serif";
      ctx.fillStyle = PALETTE.textFaint;
      ctx.fillText(String(i + 1).padStart(2, "0"), x + 8, cy + 16);
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.fillStyle = unlocked ? PALETTE.text : PALETTE.textFaint;
      const nm = unlocked ? lvl.name : "🔒 " + lvl.name;
      ctx.fillText(nm.length > 13 ? nm.slice(0, 12) + "…" : nm, x + 24, cy + 16);

      // Stars (or status) on line 2.
      ctx.font = "10px system-ui, sans-serif";
      if (best && best.stars) {
        ctx.fillStyle = PALETTE.accent;
        ctx.fillText("★".repeat(best.stars) + "☆".repeat(3 - best.stars), x + 8, cy + 31);
      } else if (unlocked) {
        ctx.fillStyle = PALETTE.textFaint;
        ctx.fillText("☆☆☆", x + 8, cy + 31);
      } else {
        ctx.fillStyle = PALETTE.textFaint;
        ctx.fillText("locked", x + 8, cy + 31);
      }
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "center";
    const rows = Math.ceil(n / cols);
    return y + rows * (ch + gap) - gap;
  }

  // Sandbox button — always unlocked, separate from the campaign chain.
  _renderSandboxBtn(ctx, cx, y, W) {
    const bw = 170;
    const bh = 36;
    const bx = cx - bw / 2;
    const over =
      this.game.input.x >= bx &&
      this.game.input.x <= bx + bw &&
      this.game.input.y >= y &&
      this.game.input.y <= y + bh;
    this._sandboxBtn = { x: bx, y, w: bw, h: bh };

    ctx.fillStyle = over ? PALETTE.bgPanelHi : PALETTE.bgPanel;
    roundRect(ctx, bx, y, bw, bh, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,209,102,0.3)";
    ctx.lineWidth = 1;
    roundRect(ctx, bx, y, bw, bh, 10);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText("🏖  Sandbox (free build)", cx, y + bh / 2);
    ctx.textBaseline = "alphabetic";
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
