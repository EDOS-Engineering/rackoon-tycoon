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
  tightens the budget and speeds the round), then **PLAY / CONTINUE** a campaign
  level, or launch the **Sandbox** (free build) or **Company Mode** (endless
  free-run — **Resume** when a saved run exists). **New Game** (top-right) wipes
  campaign progress after a confirm.
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

- **19 campaign levels + an endless sandbox + a Company (free-run) mode**,
  covering **every SAA-C03 domain** (Secure / Resilient / High-Performing /
  Cost-Optimized). Each boss level enforces one real exam decision through its
  win condition.
- **24 AWS services** across 6 tabs — **Net** (ALB, CloudFront, NAT, VPC
  Endpoint, ElastiCache), **Compute** (EC2 On-Demand/Reserved/Spot, Lambda,
  Kinesis Streams), **Data** (Firehose, S3, S3 Glacier), **DB** (RDS, Multi-AZ,
  Read Replica, DynamoDB, Aurora SV2/Limitless), **Msg** (SQS, SNS), **Security**
  (WAF, Shield, Secrets Manager). Plus the Route 53 gate.
- **Typed connections** with cost, topology rules, and transitive-routing
  behavior; **realistic economy** (intra-AZ free, cross-AZ 8×, NAT processing,
  Gateway Endpoint ≈ free, cost audits); a structural **dependency model** (a
  Read Replica needs its source primary on the board).
- **Living simulation (Phase 7):** the sim is a standalone, **headless,
  seedable-deterministic** core. A continuous **demand curve** breathes traffic
  over a compressed day/week/season with **compounding growth**; an **economy
  ledger** books every dollar; a seeded, escalating **incident deck** draws
  unscripted AZ failures / spikes / audits / Spot interruptions. **Company
  (free-run) mode** is endless — survive bankruptcy, hit business **milestones**,
  cash out to bank a scored win, and **resume** a saved run later.
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
    sim/                 the headless, seedable-deterministic simulation core (Phase 7)
      simulation.js      the Simulation: owns economy/waves/demand/incidents/packets + step(dt)
      milestones.js      company-mode milestone evaluation (alongside the binary win/lose)
      realism.js         ops-realism tracker: latency-SLO, blast radius, RTO/RPO (T7.6)
      telemetry.js       live operator signals: demand sparkline, margin, SLO burn, headroom (T7.5)
      rng.js             mulberry32 seedable PRNG (reproducible runs)
    services/
      catalog.js         data-driven AWS service catalog + wiring rules (canWire)
      connections.js     typed connections (VPC/Peering/TGW/PrivateLink): cost, topology, transitivity
    economy/
      billing.js         live AWS bill: running cost + data-transfer (cross-AZ penalty)
      economy.js         money ledger: budget/revenue/lost behind named ops (spend/earn/…)
      scoring.js         win/lose evaluation + star scoring
    waves/
      scheduler.js       legacy wave timeline (escalating traffic phases)
      demand.js          continuous demand curve (diurnal/weekly/seasonal + compounding growth)
      load.js            throughput/overload/drop model
      events.js          EventDirector: scripted + drawn incident lifecycle/queries
      incidents.js       seeded IncidentDeck: weighted, telegraphed, escalating draws
    levels/
      levels.js          data-driven level definitions (19 campaign + sandbox + company)
    render/
      sprites.js         procedural art: googly-eye services, guests, Rocky logo
      gridRenderer.js    floor, AZ bands, typed/animated wires, buildings, previews
    ui/
      hud.js             budget / revenue / waves / incident-banner HUD
      palette.js         build palette (6 tabs) + connection-type picker + tooltips
    save/
      storage.js         localStorage wrapper
      progress.js        campaign unlocks, best scores, reset
      run.js             company (free-run) run snapshot: save / resume / clear
      difficulty.js      difficulty tiers (budget × speed)
    scenes/
      titleScene.js      title: living backdrop, difficulty, campaign/sandbox/company launchers
      levelScene.js      render + input host; drives the Simulation (build, wire, route, win/lose)
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

A level can also opt into the Phase-7 living-simulation systems, all pure data:
`demand{}` (a continuous demand curve), `deck{}` (a seeded incident deck),
`mode: "freerun"` + `milestones[]` (endless company mode). See the `company`
level for the full set.

## Scope & roadmap

The campaign is feature-complete across all four SAA-C03 domains (Phases 1–6, 19
levels), and **Phase 7 (the living-simulation core, R1–R6) is done**. See
[`../backlog.md`](../backlog.md) for the full history:

- **Phase 7 — living simulation (✅ done):** the sim was lifted out of the scene
  into a standalone, **headless, seedable-deterministic** core (`sim/simulation.js`),
  driven by a continuous **DemandModel** (diurnal/weekly/seasonal + compounding
  growth), an **Economy** ledger, and a seeded, escalating **IncidentDeck** — plus a
  **Company (free-run) mode** scored on **milestones** with **save/resume**, and an
  **operational-realism** layer (`sim/realism.js`): latency-SLO compliance, blast
  radius, RTO/RPO, and auto-scaling warm-up lag. A live **operator telemetry** panel
  (`sim/telemetry.js`): demand sparkline, margin $/s, SLO error-budget burn, and
  capacity headroom — the instrument readout for reasoning like an on-call engineer.
- **Phase 8 — grand pivot:** fork the engine into a *visual AWS SDK client* — the
  canvas topology becomes real AWS resources read live via the SDK (read-only
  first; the provisioning path is hard-gated on security + a real SDK dependency).

Two dev-only test surfaces live in [`../tooling/`](../tooling/), **not** shipped
with the game: **`headless.mjs`** fast-runs the pure sim modules under Node and
asserts seeded determinism + demand/economy/incident/company invariants (the
balancing surface for the sim core), and **`smoke.mjs`** is a Playwright browser
test that loads the game, asserts no console/page errors, and checks level/win-rule
invariants.
