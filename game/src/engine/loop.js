// loop.js — Fixed-timestep update + variable-rate render via requestAnimationFrame.
// The simulation advances in fixed STEP increments (deterministic, stable physics
// for packet movement), while rendering happens once per animation frame and is
// passed an interpolation alpha for smooth visuals between sim steps.

export class GameLoop {
  constructor({ update, render, step = 1 / 60, maxFrame = 0.25 }) {
    this.update = update; // (dt) => void   dt is the fixed STEP in seconds
    this.render = render; // (alpha) => void alpha in [0,1] between sim steps
    this.step = step;
    this.maxFrame = maxFrame; // clamp huge dt (tab was backgrounded)
    this._acc = 0;
    this._last = 0;
    this._running = false;
    this._raf = 0;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  _frame = (now) => {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._frame);

    let frameTime = (now - this._last) / 1000;
    this._last = now;
    if (frameTime > this.maxFrame) frameTime = this.maxFrame;

    this._acc += frameTime;
    // Drain accumulated time in fixed steps.
    let guard = 0;
    while (this._acc >= this.step && guard < 240) {
      this.update(this.step);
      this._acc -= this.step;
      guard++;
    }

    const alpha = this._acc / this.step;
    this.render(alpha);

    // Rolling FPS readout for the HUD/debug.
    this._fpsAcc += frameTime;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
  };
}
