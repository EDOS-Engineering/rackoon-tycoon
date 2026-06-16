// titleScene.js — The title screen: animated Rocky logo, brand, Play button.
// Background shows drifting "guest" sparks and faint grid to preview the vibe.
// Click PLAY (or press Enter/Space) to enter the level.

import { Scene } from "../engine/scene.js";
import { PALETTE, FONT, BRAND } from "../theme.js";
import { drawRaccoon, roundRect } from "../render/sprites.js";
import { load } from "../save/storage.js";

export class TitleScene extends Scene {
  enter() {
    this.t = 0;
    this.best = load("bestRouted", 0);
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
  }

  update(dt) {
    this.t += dt;
    const input = this.game.input;

    for (const s of this.sparks) {
      s.x += s.spd * dt * 0.15;
      if (s.x > 1.1) s.x -= 1.2;
    }

    // Hit-test Play button.
    const over = this._overBtn(input.x, input.y);
    this._hot = over;
    if ((over && input.leftDown) || input.pressed("Enter") || input.pressed("Space")) {
      this.game.scenes.go("level", { levelId: "first_light" });
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
    ctx.fillText("▶  PLAY", cx, by + bh / 2 + 1);
    ctx.textBaseline = "alphabetic";

    // Best score + role flavor.
    ctx.fillStyle = PALETTE.textFaint;
    ctx.font = FONT.uiSmall;
    if (this.best > 0) {
      ctx.fillText("Best routed this machine: " + this.best, cx, by + bh + 28);
    }
    ctx.fillText(
      "Meet Rocky, your raccoon SRE. Build the cloud. Tame the traffic.",
      cx,
      H - 24
    );
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
