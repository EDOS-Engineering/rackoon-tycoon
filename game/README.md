# 🦝 Rackoon Tycoon — Game

> **Build your cloud empire. Tame the traffic.**
> Phase 1 (Sprint 0 + Sprint 1) of the AWS-SAA-C03-study-guide-as-a-game.
> Meet **Rocky**, a raccoon Site Reliability Engineer. Factorio belt-routing meets
> RollerCoaster Tycoon charm: googly-eyed AWS services, request "guests" flowing
> along wires from the front gate to a database and back.

## Run it

ES modules require an HTTP server (they won't load from `file://`):

```bash
# from the repository root
python3 -m http.server 8000
```

Then open: **http://localhost:8000/game/game.html**

Any static file server works; paths are relative.

## How to play

- **Title screen** → click **PLAY** (or press Enter / Space).
- **Build:** click a service in the bottom palette to arm it, then click an empty
  grid tile to place it (costs money — watch the BUDGET chip).
- **Wire:** drag from one building to an orthogonally-adjacent, compatible
  building to lay a wire. (You can also arm the 🔌 Wire tool.)
- **Cut a wire:** right-click near the wire's midpoint.
- **Erase:** arm the 🗑️ tool and click a building (refunds its cost). The gate
  can't be removed.
- **Goal:** wire **Route 53 gate → compute → database** (RDS/DynamoDB/S3). Once a
  route exists, guests spawn and flow. Completed round-trips = **revenue**;
  dead-ended/broken trips = **lost**.
- **Camera:** drag (middle-mouse) or **Space + drag** to pan, **WASD / arrows**
  to pan, **mouse wheel** to zoom. **Esc** returns to the menu.
- **End round** (top-right) → the Round Report tallies your run.

## Zero dependencies

Pure **vanilla JavaScript (ES modules) + HTML5 Canvas + CSS**. No npm packages,
no bundler, no CDN scripts, no runtime network fetches, no asset files — all art
is drawn procedurally on the canvas. `localStorage` stores your best score.

## Architecture (for the next phase)

```
game/
  game.html              entry page (splash + canvas + module bootstrap)
  README.md              this file
  src/
    main.js              bootstrap: wires canvas/input/camera/loop/scenes, starts
    theme.js             brand palette, fonts, constants
    engine/
      loop.js            fixed-timestep update + interpolated render (rAF)
      canvas.js          HiDPI canvas + responsive resize
      camera.js          pan/zoom + world<->screen conversion
      input.js           mouse/keyboard/wheel tracking + per-frame edges
      scene.js           Scene base + SceneManager (title -> level -> results)
    grid/
      grid.js            tile map, buildings, undirected wire graph, picking
      pathfind.js        BFS round-trip routing (gate -> nearest sink -> gate)
    entities/
      packet.js          request "guest": walks a path with smooth interpolation
    services/
      catalog.js         data-driven AWS service catalog + connection rules
    levels/
      levels.js          data-driven level definitions
    render/
      sprites.js         procedural art: googly-eye services, guests, Rocky logo
      gridRenderer.js    floor, animated wires, buildings, hover/ghost previews
    ui/
      hud.js             budget / revenue / success / fail / status HUD
      palette.js         build palette + tooltips (interactive, screen-space)
    save/
      storage.js         localStorage save/load wrapper
    scenes/
      titleScene.js      animated title screen + Play button
      levelScene.js      the playable core (build, wire, route, simulate)
      resultsScene.js    end-of-round report
```

### Extension hooks left for Phase 2+ (economy, waves, win/lose)

- `levelScene._updatePackets()` — marked `HOOK: on-complete` / `on-drop` where
  revenue/penalty are applied (Phase 2 scales these by latency/cost/throughput).
- `levels.js` records are generic — add `waves`, `events`, `requiredService`,
  win/lose conditions without touching the engine.
- `catalog.js` already carries `throughput`/`latency`/`cost` for the live AWS
  bill and overload mechanics; Phase 1 only spends `cost` (budget gate) and shows
  the rest in tooltips.
- `catalog.canConnect()` centralizes wiring rules so Phase 3 gap-puzzles can
  tighten topology per level.

## Scope

This is **Phase 1** only (playable core). Economy/waves/win-lose (Phase 2),
gap-mapped teaching puzzles (Phase 3), and the full juice/audio/accessibility
pass (Phase 4) are intentionally **not** built yet — see `../backlog.md`.
