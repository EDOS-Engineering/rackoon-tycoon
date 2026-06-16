// canvas.js — Sets up the HiDPI-aware canvas and handles responsive resize.
// Keeps the drawing buffer matched to devicePixelRatio so art stays crisp,
// while exposing logical CSS-pixel width/height (cssW/cssH) to the game.

export class CanvasSurface {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;
    this._onResize = [];

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  // Register a callback fired after every resize (e.g. camera.resize).
  onResize(fn) {
    this._onResize.push(fn);
    fn(this.cssW, this.cssH);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = this.canvas.getBoundingClientRect();
    // Fall back to window size before the element has laid out.
    const w = Math.max(1, Math.round(rect.width || window.innerWidth));
    const h = Math.max(1, Math.round(rect.height || window.innerHeight));

    this.dpr = dpr;
    this.cssW = w;
    this.cssH = h;

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);

    // Reset transform then scale so 1 unit == 1 CSS pixel for UI drawing.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const fn of this._onResize) fn(w, h);
  }
}
