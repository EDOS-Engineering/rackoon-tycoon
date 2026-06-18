// input.js — Centralized mouse/keyboard input tracking for the canvas.
// Tracks pointer position (in canvas/CSS pixels), button state, wheel delta,
// and exposes per-frame "just pressed/released" edges that scenes can poll.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;

    // Pointer position in CSS pixels relative to canvas top-left.
    this.x = 0;
    this.y = 0;
    this.inside = false;

    // Button state.
    this.left = false;
    this.right = false;
    this.middle = false;

    // Per-frame edges (consumed by endFrame()).
    this.leftDown = false;
    this.leftUp = false;
    this.rightDown = false;

    // Accumulated wheel delta since last frame (positive = zoom out).
    this.wheel = 0;

    // Drag delta accumulation for panning (middle-button or space-drag).
    this.dragDX = 0;
    this.dragDY = 0;
    this._lastDragX = 0;
    this._lastDragY = 0;
    this.dragging = false;

    // Keyboard: set of currently-held keys + just-pressed this frame.
    this.keys = new Set();
    this.keysDown = new Set();

    this._bind();
  }

  _bind() {
    const c = this.canvas;

    c.addEventListener("mousemove", (e) => {
      const r = c.getBoundingClientRect();
      this.x = e.clientX - r.left;
      this.y = e.clientY - r.top;
      this.inside = true;
      if (this.dragging) {
        this.dragDX += this.x - this._lastDragX;
        this.dragDY += this.y - this._lastDragY;
      }
      this._lastDragX = this.x;
      this._lastDragY = this.y;
    });

    c.addEventListener("mouseleave", () => {
      this.inside = false;
    });

    c.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        this.left = true;
        this.leftDown = true;
      } else if (e.button === 1) {
        this.middle = true;
        this.dragging = true;
        this._lastDragX = this.x;
        this._lastDragY = this.y;
      } else if (e.button === 2) {
        this.right = true;
        this.rightDown = true;
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) {
        this.left = false;
        this.leftUp = true;
      } else if (e.button === 1) {
        this.middle = false;
        this.dragging = false;
      } else if (e.button === 2) {
        this.right = false;
      }
    });

    // Wheel = zoom. Prevent the page from scrolling.
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.wheel += e.deltaY;
      },
      { passive: false }
    );

    // Suppress the browser context menu so right-click can mean "remove".
    c.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener("keydown", (e) => {
      if (!this.keys.has(e.code)) this.keysDown.add(e.code);
      this.keys.add(e.code);
      // Keys the game consumes that would otherwise scroll the page or navigate
      // back: Space (pan modifier), Arrows (palette cursor), Backspace (cut wire).
      if (
        e.code === "Space" ||
        e.code === "Backspace" ||
        e.code === "ArrowUp" ||
        e.code === "ArrowDown" ||
        e.code === "ArrowLeft" ||
        e.code === "ArrowRight"
      ) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });
  }

  // True if a key is currently held.
  isDown(code) {
    return this.keys.has(code);
  }

  // True only on the frame the key transitioned to down.
  pressed(code) {
    return this.keysDown.has(code);
  }

  // Call once at the end of every frame to clear edge-triggered state.
  endFrame() {
    this.leftDown = false;
    this.leftUp = false;
    this.rightDown = false;
    this.wheel = 0;
    this.dragDX = 0;
    this.dragDY = 0;
    this.keysDown.clear();
  }
}
