// scene.js — Tiny scene/state manager: title -> level -> results.
// A Scene implements optional enter(payload)/exit/update(dt)/render(ctx, alpha).
// SceneManager keeps the active scene and routes the game loop + input to it.
// Scene transitions are deferred to a safe point (end of frame) to avoid
// mutating the active scene mid-update.

export class Scene {
  constructor(game) {
    this.game = game; // back-reference to shared services (input, camera, etc.)
  }
  enter(_payload) {}
  exit() {}
  update(_dt) {}
  render(_ctx, _alpha) {}
}

export class SceneManager {
  constructor(game) {
    this.game = game;
    this.scenes = new Map(); // name -> factory(game) => Scene
    this.current = null;
    this.currentName = null;
    this._pending = null; // { name, payload }
  }

  register(name, factory) {
    this.scenes.set(name, factory);
  }

  // Request a scene switch; applied at the next frame boundary.
  go(name, payload = null) {
    this._pending = { name, payload };
  }

  _applyPending() {
    if (!this._pending) return;
    const { name, payload } = this._pending;
    this._pending = null;
    const factory = this.scenes.get(name);
    if (!factory) {
      console.error(`Scene "${name}" not registered`);
      return;
    }
    if (this.current) this.current.exit();
    this.current = factory(this.game);
    this.currentName = name;
    this.current.enter(payload);
  }

  update(dt) {
    this._applyPending();
    if (this.current) this.current.update(dt);
  }

  render(ctx, alpha) {
    if (this.current) this.current.render(ctx, alpha);
  }
}
