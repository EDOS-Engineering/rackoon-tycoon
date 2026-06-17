# 🦝 Rackoon Tycoon — Game

> **Build your cloud empire. Tame the traffic.**
> An AWS SAA-C03 study guide reborn as a playable tycoon sim. Meet **Rocky**, a
> raccoon Site Reliability Engineer. Factorio belt-routing meets RollerCoaster
> Tycoon charm: googly-eyed AWS services, request "guests" flowing along wires
> from the front gate to a database and back — while a live AWS bill ticks.

## Run it

ES modules require an HTTP server (they won't load from `file://`):

```bash
# from the repository root
python3 -m http.server 8000
```

Then open: **http://localhost:8000/game/game.html**

Any static file server works; paths are relative. If you update the game and see
a startup error, **hard-reload** (Cmd/Ctrl + Shift + R) to clear cached modules.

## How to play

- **Title screen** → pick a **difficulty** (Architect / Senior / Principal — each
  tightens the budget and speeds the round), choose a **campaign** level or the
  **Sandbox**, then **PLAY / CONTINUE** (or press Enter / Space). **New Game**
  (top-right) wipes progress after a confirm.
- **Briefing:** every level opens paused on a briefing with the goal, the win
  condition, and an **exam tip** — build calmly, then press **Begin**.
- **Build:** click a service in the bottom palette (6 tabs) to arm it, then click
  an empty tile to place it (costs money — watch the BUDGET chip).
- **Wire:** drag from one building to another **compatible** building — **any
  distance**, no adjacency needed. Right-click near a wire's midpoint to cut it.
- **Connection types:** pick the wire's network construct in the picker row (or
  press **C** to cycle): **VPC · Peering · TGW · PrivateLink**. Each prices the
  hop differently and has its own topology rule (PrivateLink must end at a
  service; peering is non-transitive; Transit Gateway is a transitive hub).
- **Erase:** arm the 🗑️ tool and click a building (refunds its cost). The gate
  can't be removed.
- **Goal:** wire **Route 53 gate → compute → database/storage** so guests flow.
  Completed round-trips = **revenue**; dead-ended/broken trips = **lost**. Most
  levels add a **win condition** (a required service, sink, connection type, or
  one to avoid) on top of the routed-request target — read the briefing.
- **Pressure:** a live **AWS bill** (per-tile running cost + data-transfer)
  draws down the budget; escalating **waves** raise traffic; **incidents** hit —
  AZ failures, traffic spikes, cost audits, Spot interruptions. Press **H** for a
  help legend.
- **Camera:** drag (middle-mouse) or **Space + drag** to pan, **WASD / arrows**
  to pan, **mouse wheel** to zoom. **Esc** returns to the menu.
- **End round** (top-right) → the Round Report tallies your run, stars (uptime ×
  cost-efficiency × resilience), and the exam tip.

## What's in it

- **17 campaign levels + an endless sandbox**, covering **every SAA-C03 domain**
  (Secure / Resilient / High-Performing / Cost-Optimized). Each boss level
  enforces one real exam decision through its win condition.
- **23 AWS services** across 6 tabs — **Net** (ALB, CloudFront, NAT, VPC
  Endpoint, ElastiCache), **Compute** (EC2 On-Demand/Reserved/Spot, Lambda,
  Kinesis Streams), **Data** (Firehose, S3, S3 Glacier), **DB** (RDS, Multi-AZ,
  Read Replica, DynamoDB, Aurora SV2/Limitless), **Msg** (SQS, SNS), **Security**
  (WAF, Shield). Plus the Route 53 gate.
- **Typed connections** with cost, topology rules, and transitive-routing
  behavior; **realistic economy** (intra-AZ free, cross-AZ 8×, NAT processing,
  Gateway Endpoint ≈ free, cost audits); a structural **dependency model** (a
  Read Replica needs its source primary on the board).
- Procedural **audio** (zero-dep Web Audio), placement **particles** + packet
  **trails**, and **exam-tip teaching cards** before and after each level.

## Zero dependencies

Pure **vanilla JavaScript (ES modules) + HTML5 Canvas + CSS**. No npm packages,
no bundler, no CDN scripts, no runtime network fetches, no asset files — all art
is drawn procedurally on the canvas and all audio is synthesized with the Web
Audio API. `localStorage` stores progress, best scores, and difficulty.

## Architecture

```
game/
  game.html              entry page (splash + canvas + module bootstrap + honest error fallback)
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
      audio.js           procedural Web Audio SFX (place/wire/erase/alert/win/lose…)
    grid/
      grid.js            tile map, buildings, typed undirected wire graph, picking
      pathfind.js        BFS round-trip routing + transitive-link rules
    entities/
      packet.js          request "guest": walks a path with smooth interpolation + trail
    services/
      catalog.js         data-driven AWS service catalog + wiring rules (canWire)
      connections.js     typed connections (VPC/Peering/TGW/PrivateLink): cost, topology, transitivity
    economy/
      billing.js         live AWS bill: running cost + data-transfer (cross-AZ penalty)
      scoring.js         win/lose evaluation + star scoring
    waves/
      scheduler.js       wave timeline (escalating traffic phases)
      load.js            throughput/overload/drop model
      events.js          incidents: AZ failure, traffic spike, cost audit, spot interruption
    levels/
      levels.js          data-driven level definitions (17 campaign + sandbox)
    render/
      sprites.js         procedural art: googly-eye services, guests, Rocky logo
      gridRenderer.js    floor, AZ bands, typed/animated wires, buildings, previews
    ui/
      hud.js             budget / revenue / waves / incident-banner HUD
      palette.js         build palette (6 tabs) + connection-type picker + tooltips
    save/
      storage.js         localStorage wrapper
      progress.js        campaign unlocks, best scores, reset
      difficulty.js      difficulty tiers (budget × speed)
    scenes/
      titleScene.js      title: difficulty + level select + sandbox + New Game
      levelScene.js      the core loop (build, wire, route, simulate, win/lose)
      resultsScene.js    end-of-round report + exam tip
```

## Adding a level

Levels are pure data in `levels/levels.js` — no engine changes needed. A record
sets the grid, budget, gates, optional pre-placed `seed` buildings, `waves`,
`events`, a `goalRequests` target, and an optional `winRequires` spec that
enforces the lesson:

- `sinkIs` — the route's destination must be one of these service ids.
- `pathContainsAll` / `pathContainsAny` — required services on the route.
- `pathExcludes` — services the route must avoid (e.g. "no NAT/public hop").
- `edgeTypeAll` / `edgeTypeAny` — required connection types on the route (e.g. a
  Transit Gateway or PrivateLink hop).
- `fanOut: { service, minSinks }` — a tile (e.g. SNS) wired to ≥ N sink
  subscribers (pub/sub fan-out).

Chain levels with `next`, list them in `LEVEL_ORDER`, and add an `intro` +
`examTip`. See existing boss levels (`leaky_pipe`, `mesh_bridge`, `private_lines`,
`decouple_drown`, `cold_storage`, `right_price`, …) for patterns.

## Scope & roadmap

The campaign is feature-complete across all four SAA-C03 domains (Phases 1–6, 19
levels). Two horizons are planned in [`../backlog.md`](../backlog.md):

- **Phase 7 — living simulation:** longer missions with time-varying demand, a
  compounding/fluctuating economy, a richer "unforeseen circumstances" incident
  deck, and a long-form "company" mode — operating a real, growing AWS system over
  time, not just short exam puzzles.
- **Phase 8 — grand pivot:** fork the engine into a *visual AWS SDK client* — the
  canvas topology becomes real AWS resources read live via the SDK (read-only
  first; the provisioning path is hard-gated on security + a real SDK dependency).

A dev-only Playwright smoke test (loads the game, asserts no console/page errors,
checks level/win-rule invariants) is in [`../tooling/`](../tooling/) and is **not**
shipped with the game.
