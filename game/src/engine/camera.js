// camera.js — 2D camera with pan + zoom and world<->screen conversion.
// World units == grid pixels (TILE * cols). Screen units == CSS pixels.
// The camera centers on (x, y) in world space at a given zoom.

export class Camera {
  constructor() {
    this.x = 0; // world-space point at screen center
    this.y = 0;
    this.zoom = 1;
    this.minZoom = 0.4;
    this.maxZoom = 2.6;

    // Viewport in CSS pixels (set by resize()).
    this.vw = 0;
    this.vh = 0;
  }

  resize(vw, vh) {
    this.vw = vw;
    this.vh = vh;
  }

  // Smoothly move toward a target each frame (used to focus the map on start).
  centerOn(x, y) {
    this.x = x;
    this.y = y;
  }

  // Zoom toward a screen anchor (keeps the point under the cursor stable).
  zoomAt(screenX, screenY, factor) {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(screenX, screenY);
    // Shift camera so the anchored world point stays under the cursor.
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  // Pan by a delta given in screen pixels.
  panScreen(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.vw / 2,
      y: (wy - this.y) * this.zoom + this.vh / 2,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.vw / 2) / this.zoom + this.x,
      y: (sy - this.vh / 2) / this.zoom + this.y,
    };
  }

  // Apply the camera transform to a 2D context. Caller wraps in save/restore.
  applyTo(ctx) {
    ctx.translate(this.vw / 2, this.vh / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
