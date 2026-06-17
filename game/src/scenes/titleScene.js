// titleScene.js — The title screen: animated Rocky logo, brand, Play button.
// Background shows drifting "guest" sparks and faint grid to preview the vibe.
// Click PLAY (or press Enter/Space) to enter the level.

import { Scene } from "../engine/scene.js";
import { PALETTE, FONT, BRAND } from "../theme.js";
import { drawRaccoon, roundRect } from "../render/sprites.js";
import { load } from "../save/storage.js";
import { LEVEL_ORDER, FIRST_LEVEL, getLevel } from "../levels/levels.js";
import { isUnlocked, bestFor, totalStars } from "../save/progress.js";
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
  }

  update(dt) {
    this.t += dt;
    const input = this.game.input;

    for (const s of this.sparks) {
      s.x += s.spd * dt * 0.15;
      if (s.x > 1.1) s.x -= 1.2;
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
    const topY = H * 0.3;

    // Logo: raccoon in a soft amber halo. Eyes follow the cursor for charm.
    const lookX = clamp((this.game.input.x - cx) / (W * 0.5), -1, 1) * 0.6;
    const lookY = clamp((this.game.input.y - topY) / (H * 0.5), -1, 1) * 0.5;
    const bob = Math.sin(this.t * 1.6) * 6;

    ctx.save();
    ctx.shadowColor = "rgba(255,179,71,0.5)";
    ctx.shadowBlur = 50;
    drawRaccoon(ctx, cx, topY + bob, 150, { look: { x: lookX, y: lookY } });
    ctx.restore();

    // Wordmark.
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.text;
    ctx.font = FONT.title;
    ctx.fillText("Rackoon", cx, topY + 150);
    ctx.fillStyle = PALETTE.accent;
    ctx.fillText("Tycoon", cx, topY + 214);

    // Mascot emoji flourish.
    ctx.font = "40px system-ui, sans-serif";
    ctx.fillText("🦝", cx + 220, topY + 150);

    // Tagline.
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = FONT.ui;
    ctx.fillText(BRAND.tagline, cx, topY + 252);

    // PLAY button.
    const bw = 220;
    const bh = 60;
    const bx = cx - bw / 2;
    const by = topY + 290;
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

    // Difficulty selector (T3.8) then the level-select strip below it.
    this._renderDifficulty(ctx, cx, by + bh + 18, W);
    this._renderLevelSelect(ctx, cx, by + bh + 92, W);

    // Best score + role flavor.
    ctx.fillStyle = PALETTE.textFaint;
    ctx.font = FONT.uiSmall;
    ctx.textAlign = "center";
    const flavor =
      this.totalStars > 0
        ? "Rocky's stars: " + this.totalStars + " ★   •   Best routed: " + this.best
        : "Meet Rocky, your raccoon SRE. Build the cloud. Tame the traffic.";
    ctx.fillText(flavor, cx, H - 20);
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
    ctx.fillStyle = PALETTE.textFaint;
    ctx.font = FONT.uiSmall;
    ctx.fillText("DIFFICULTY", cx, y - 8);

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
        d.tag + "  ·  budget ×" + d.budgetMul + "  ·  speed ×" + d.speedMul,
        x + 12,
        y + 38
      );
      x += cw + gap;
    }
    ctx.textAlign = "center";
  }

  // A row of level chips: locked ones are dimmed and unclickable; unlocked ones
  // show earned stars and launch on click.
  _renderLevelSelect(ctx, cx, y, W) {
    this._levelBtns = [];
    const n = LEVEL_ORDER.length;
    const cw = 128; // narrower chips to fit 7 levels on screen
    const ch = 54;
    const gap = 8;
    const totalW = n * cw + (n - 1) * gap;
    let x = cx - totalW / 2;

    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.textFaint;
    ctx.font = FONT.uiSmall;
    ctx.fillText("CAMPAIGN", cx, y - 8);

    for (const id of LEVEL_ORDER) {
      const lvl = getLevel(id);
      const unlocked = isUnlocked(id, FIRST_LEVEL);
      const best = bestFor(id);
      const rect = { id, x, y: y + 4, w: cw, h: ch, unlocked };
      this._levelBtns.push(rect);

      const over =
        unlocked &&
        this.game.input.x >= x &&
        this.game.input.x <= x + cw &&
        this.game.input.y >= y + 4 &&
        this.game.input.y <= y + 4 + ch;

      ctx.fillStyle = over ? PALETTE.bgPanelHi : PALETTE.bgPanel;
      ctx.globalAlpha = unlocked ? 1 : 0.45;
      roundRect(ctx, x, y + 4, cw, ch, 10);
      ctx.fill();
      ctx.strokeStyle = unlocked ? "rgba(255,179,71,0.35)" : "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      roundRect(ctx, x, y + 4, cw, ch, 10);
      ctx.stroke();

      ctx.fillStyle = unlocked ? PALETTE.text : PALETTE.textFaint;
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.textAlign = "left";
      // Truncate long names to fit the narrower chip
      const nameStr = (unlocked ? "" : "🔒 ") + lvl.name;
      ctx.fillText(nameStr.length > 18 ? nameStr.slice(0, 17) + "…" : nameStr, x + 8, y + 22);

      // Stars earned (or a hint).
      ctx.font = "12px system-ui, sans-serif";
      if (best && best.stars) {
        ctx.fillStyle = PALETTE.accent;
        ctx.fillText("★".repeat(best.stars) + "☆".repeat(3 - best.stars), x + 8, y + 40);
      } else if (unlocked) {
        ctx.fillStyle = PALETTE.textFaint;
        ctx.fillText("☆☆☆ not cleared", x + 8, y + 40);
      } else {
        ctx.fillStyle = PALETTE.textFaint;
        ctx.fillText("win prev. to unlock", x + 8, y + 40);
      }
      ctx.globalAlpha = 1;
      x += cw + gap;
    }
    ctx.textAlign = "center";
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
