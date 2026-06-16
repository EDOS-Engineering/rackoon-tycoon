// main.js — Bootstrap. Wires the canvas, input, camera, loop, and scene manager
// together, registers the three scenes (title → level → results), and starts.
// This is the only module the HTML loads; everything else is pulled in as ES
// module imports, so there are ZERO external/runtime dependencies.

import { CanvasSurface } from "./engine/canvas.js";
import { Input } from "./engine/input.js";
import { Camera } from "./engine/camera.js";
import { GameLoop } from "./engine/loop.js";
import { SceneManager } from "./engine/scene.js";
import { TitleScene } from "./scenes/titleScene.js";
import { LevelScene } from "./scenes/levelScene.js";
import { ResultsScene } from "./scenes/resultsScene.js";

function boot() {
  const canvasEl = document.getElementById("game");
  if (!canvasEl) {
    console.error("Missing #game canvas");
    return;
  }

  // Shared "game" services object passed to every scene.
  const game = {};
  game.canvas = new CanvasSurface(canvasEl);
  game.ctx = game.canvas.ctx;
  game.input = new Input(canvasEl);
  game.camera = new Camera();
  game.scenes = new SceneManager(game);

  // Keep the camera viewport in sync with the canvas size.
  game.canvas.onResize((w, h) => game.camera.resize(w, h));

  // Register scenes (factories so each entry starts fresh).
  game.scenes.register("title", (g) => new TitleScene(g));
  game.scenes.register("level", (g) => new LevelScene(g));
  game.scenes.register("results", (g) => new ResultsScene(g));

  // The loop: fixed-step update, interpolated render.
  game.loop = new GameLoop({
    update: (dt) => {
      game.scenes.update(dt);
      game.input.endFrame(); // clear per-frame input edges after sim
    },
    render: (alpha) => {
      game.scenes.render(game.ctx, alpha);
    },
    step: 1 / 60,
  });

  // Start on the title screen.
  game.scenes.go("title");
  game.loop.start();

  // Hide the loading splash once we're running.
  const splash = document.getElementById("splash");
  if (splash) splash.style.display = "none";

  // Expose for quick console poking during dev (not required by the game).
  window.__rackoon = game;
}

// Boot when the DOM is ready.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
