// packet.js — A request "guest" that walks a precomputed wire path.
// The packet stores a path (array of tile keys) and a float progress index.
// It advances at a constant speed in tiles/second; rendering interpolates
// between the two tile centers it currently sits between, so motion is smooth
// regardless of the fixed sim step.
//
// Lifecycle / status:
//   "travel" — heading toward the sink (first half of the path)
//   "return" — heading back to the gate (second half)
//   "done"   — completed the round-trip (counts as success/revenue)
//   "dropped"— path became invalid mid-flight (counts as a failure)

import { Grid, TILE } from "../grid/grid.js";

let NEXT_ID = 1;

export class Packet {
  // `rng` is the seedable sim RNG. Speed variation affects travel time → the
  // win/lose outcome, so it MUST come from the seeded stream for a reproducible,
  // headless-balanceable run. `bob`/`hue` are cosmetic (render-only, never read by
  // sim logic), so they can stay on Math.random without breaking determinism.
  constructor(path, sinkKey, rng = Math.random, speed = 4.2) {
    this.id = NEXT_ID++;
    this.path = path; // ["c,r", ...] full round-trip
    this.sinkKey = sinkKey;
    this.sinkIndex = path.indexOf(sinkKey);
    this.t = 0; // float position along path (0..path.length-1)
    this.speed = speed * (0.85 + rng() * 0.3); // slight variation (seeded)
    this.status = "travel";
    this.bob = Math.random() * Math.PI * 2; // little vertical wiggle phase
    this.hue = Math.random(); // tiny color variation among guests
    // Cached world position (updated each sim step; render interpolates).
    this.x = 0;
    this.y = 0;
    this.prevX = 0;
    this.prevY = 0;
    this._computeXY();
    this.prevX = this.x;
    this.prevY = this.y;
    // Position history for trail rendering (T4.1). Ring of last 3 positions.
    this._history = [];
  }

  // World-space center of a tile key.
  static tileCenter(key) {
    const [c, r] = Grid.parseKey(key);
    return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
  }

  _computeXY() {
    const i = Math.floor(this.t);
    const frac = this.t - i;
    const aKey = this.path[Math.min(i, this.path.length - 1)];
    const bKey = this.path[Math.min(i + 1, this.path.length - 1)];
    const a = Packet.tileCenter(aKey);
    const b = Packet.tileCenter(bKey);
    this.x = a.x + (b.x - a.x) * frac;
    this.y = a.y + (b.y - a.y) * frac;
  }

  // Advance along the path. `onVisit(key)` fires once per tile entered so the
  // sim can pulse buildings. Returns nothing; check `status` after.
  update(dt, onVisit) {
    if (this.status === "done" || this.status === "dropped") return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.bob += dt * 8;

    const prevIndex = Math.floor(this.t);
    this.t += this.speed * dt;

    const end = this.path.length - 1;
    if (this.t >= end) {
      this.t = end;
      this.status = "done";
    } else if (this.t >= this.sinkIndex && this.status === "travel") {
      this.status = "return";
    }

    const newIndex = Math.floor(this.t);
    if (newIndex !== prevIndex && onVisit) {
      onVisit(this.path[Math.min(newIndex, end)]);
    }

    this._computeXY();

    // Record position in trail history (keep last 3 steps).
    this._history.push({ x: this.x, y: this.y });
    if (this._history.length > 3) this._history.shift();
  }

  // Render interpolation helper: blend prev->cur by alpha for buttery motion.
  renderX(alpha) {
    return this.prevX + (this.x - this.prevX) * alpha;
  }
  renderY(alpha) {
    return this.prevY + (this.y - this.prevY) * alpha;
  }
}
