# 🦝 Rackoon Tycoon — Backlog

> **Build your cloud empire. Tame the traffic.**
> AWS SAA-C03 study guide reborn as a browser game. **Factorio meets RollerCoaster Tycoon.**

**Status:** Phases 1–6 ✅ **complete.** Feature-complete campaign: **19 levels + sandbox**, every SAA-C03 domain ≥3 boss levels; 24 services / 6 palette tabs; typed connections (VPC/Peering/TGW/PrivateLink) with transitive routing; realistic cross-AZ economy; incidents (AZ failure, traffic spike, cost audit, spot interruption, region failure, + sim-depth: viral spike, dependency outage, noisy neighbor, cert expiry, price hike). **Phase 7 ✅ R-series complete (R1–R6):** the simulation is now a standalone, headless, **seedable-deterministic** core (`sim/simulation.js`) driven by a living-economy **DemandModel** (diurnal/weekly/seasonal + compounding growth), an **Economy** ledger, a seeded escalating **IncidentDeck**, and a new **Company (free-run) mode** with business **milestones** + save/resume. Verified by `tooling/headless.mjs` (fast-run balancing harness) + the Playwright smoke. Stack: zero-dep vanilla. **Next:** T7.6 realism polish; **Phase 8** — the grand pivot: fork into a visual AWS SDK client.

## Progress log
- **2026-06-16 — Phase 1 shipped.** `/game` built: vanilla JS ES modules + Canvas, zero deps, ~3,040 LOC across 22 files. Title → level → results scenes; grid build palette; Factorio-style wiring; BFS request routing (gate → nearest DB sink → back); revenue/lost counters; budget gate; localStorage best score; procedural Rocky-the-raccoon art. Verified via `tooling/smoke.mjs` (Playwright, dev-only). Study guide rebranded to Rackoon Tycoon; README rewritten as project doc. Git history rebuilt clean (no AI attribution). **Pending:** rename working dir to `rackoon-tycoon` (held — deferred so it doesn't break an open editor/session).
- **2026-06-16 — Phase 2 shipped + tuned.** Added `economy/billing.js` + `economy/scoring.js`, `waves/{scheduler,load,events}.js`, `save/progress.js`; wired through `levelScene`, `resultsScene`, `titleScene`, `hud`, `levels`. Win/lose, 3-pillar star scoring, persistence/unlocks, campaign level-select, 3 levels (First Light / Rush Hour / When the Zone Goes Dark). **Post-playtest polish:** gentler bill (`rateDivisor` 60→130, transfer 0.04→0.015) + bigger budgets + ~25–30% slower spawn/wave rates; the round now stays paused on a **briefing** until the player clicks *Begin* (read + pre-build calmly); persistent 🎯 objective chip + an **H** help legend for clarity. Upgraded `tooling/smoke.mjs` asserts: briefing pauses the sim, a legal route flows guests, and the bill draws the budget down without bankrupting a sensible build.
- **2026-06-16 — Phase 4 complete (Sprint 4a–4d).** Audio: 8 procedural Web Audio sounds (place, wire, erase, spike, azFail, alert, win, lose). Exam tips on all 19 services + 8 levels (palette tooltip + grid tooltip + results screen). Sandbox mode (no win condition, 9999 budget) + title button. Particle burst on building placement; packet motion trail (3-step position history). → `engine/audio.js` (new), `catalog.js`, `levels.js`, `palette.js`, `levelScene.js`, `resultsScene.js`, `titleScene.js`, `packet.js`, `sprites.js`
- **2026-06-17 — Phase 7 kickoff: architecture review + R2 (seedable RNG + headless harness).** Ran an architecture review (research subagent + `/improve-codebase-architecture`): the helper sim modules are clean seams but the simulation that composes them lives inside the 1616-line `LevelScene`; no headless sim; unseeded sim-path RNG. Recorded the architecture-first plan (R1–R6) + order + locked design decisions (time-compressed clock; both win models — milestone scenarios + endless free-run). Shipped **R2** (the first, decision-independent step): new `sim/rng.js` (mulberry32 seedable PRNG) threaded through the two sim-path randoms (`EventDirector` AZ-zone pick, `LoadModel.shouldDrop`), defaulting to `Math.random` for back-compat; new `tooling/headless.mjs` runs the sim modules under Node with no canvas and asserts seeded determinism. Removed the Sandbox "Cash Out" button (overlapped the reinvest slider, no goal to wrap up; Esc exits). → `sim/rng.js`, `waves/{events,load}.js`, `scenes/levelScene.js`, `tooling/headless.mjs`. headless 0 problems; browser smoke 0/0.
- **2026-06-17 — Sim depth: five new incident kinds (feature branch).** Extended the incident
  system with the richer "unforeseen circumstances": **viral_spike** (a huge demand surge →
  `spawnMultiplier`), **price_hike** (sustained bill inflation → `billMultiplier`),
  **noisy_neighbor** (shared-tenancy contention derates effective capacity via a new
  `capacityMultiplier()` applied in `load.js`), **cert_expiry** (TLS at the edge rejects a
  fraction of NEW connections via a new `edgeDropRate()` rolled in the spawn loop), and
  **dependency_outage** (a targeted service id goes dark via a new `isServiceDisabled(id)`,
  downing all its tiles + routing around them). All telegraphed/banner'd, data-driven as deck
  cards (added to the company deck), and seeded-deterministic. Headless + smoke assert each
  effect + a deck of all five running through the real sim. → `waves/events.js`,
  `sim/simulation.js`, `waves/load.js`, `levels/levels.js`, `tooling/{headless,smoke}.mjs`. headless 0; smoke 0/0.
- **2026-06-17 — Company Run Report (feature branch).** Cashing out (or going bankrupt in)
  a freerun company run now shows a dedicated **Run Report** instead of the scenario verdict:
  a banked-vs-folded headline + day reached, the **milestone checklist** (each with current/
  target), an **ops scorecard** (SLO % · peak blast · worst RTO · data lost (RPO) · peak load),
  the **business line** (served / revenue / bill / budget), score + stars, and the exam tip.
  `_goToResults` adds `mode`/`milestones`/`ops` to the payload (only for freerun); `ResultsScene`
  branches to `_renderCompany` when `mode==="freerun"`. Surfaces everything the Phase-7 sim
  tracks. Smoke asserts the cash-out hands the results scene a company-shaped payload (mode +
  4 milestones + ops scorecard). → `scenes/{levelScene,resultsScene}.js`, `tooling/smoke.mjs`. headless 0; smoke 0/0.
- **2026-06-17 — Phase 7 T7.5 telemetry depth (feature branch).** New `sim/telemetry.js`
  `Telemetry` derives the live operator instrument panel from sim state: **demand** (current
  + rolling sparkline), **margin $/s** (revenue rate − burn, smoothed), **SLO burn**
  (error-budget burn vs allowed, off a new `sloTarget`), and **headroom** (1 − busiest
  serving load). `Simulation.telemetry()` exposes a snapshot; the OPS-TELEMETRY HUD chip
  became a full panel (outcome row + operator-signal row + demand sparkline). Headless reads
  the signals for curve tuning (min-headroom / peak-demand sweep) and asserts they're sane,
  curve-tracking, and deterministic. → `sim/{telemetry,simulation}.js`, `scenes/levelScene.js`,
  `tooling/headless.mjs`. headless 0; smoke 0/0.
- **2026-06-17 — Phase 7 T7.6 realism polish (feature branch).** New `sim/realism.js`
  `RealismTracker` rolls up four operational signals real architects answer to: **latency-SLO
  compliance**, **blast radius** (peak capacity-weighted fraction an incident downs), **RTO**
  (longest post-establishment outage), and an **RPO proxy** (work dropped during an outage).
  Added **auto-scaling warm-up lag** in `load.js` (autoScale capacity ramps over `WARMUP_TAU`
  instead of snapping → spikes transiently overload). Surfaced via `Simulation.metrics()`
  (milestones can target `sloCompliance`), an **OPS TELEMETRY** HUD chip, and company
  save/resume; company mode gains a "Hold SLO ≥ 95%" milestone. Headless asserts all four
  (incl. that pre-build "no route yet" time isn't scored as downtime). → `sim/{realism,simulation}.js`,
  `waves/load.js`, `scenes/levelScene.js`, `levels/levels.js`, `tooling/headless.mjs`. headless 0; smoke 0/0.
- **2026-06-17 — Phase 7 R1 + R3 shipped; Help overlay fixed.** **R1:** lifted the simulation out of the 1600-line `LevelScene` into a pure, headless, deterministic `sim/simulation.js` (`step(dt)` + `recomputeRoute()`; side-effects via a drained `emitted` queue; scene delegates state through accessors so the renderer/input are untouched) — a no-behaviour-change lift, with `tooling/headless.mjs` now fast-running a real `Simulation` to a seeded, byte-identical win. **R3:** new `waves/demand.js` `DemandModel.rateAt(t)` — a continuous living-economy curve (diurnal + weekday/weekend + seasonal + compounding growth), wired as the spawn-rate source when a level defines `demand{}`; sandbox now breathes/grows; HUD chip shows `Day N · HH:00 · phase`. **Help fix:** the legend's fixed 48px rows overlapped multi-line descriptions — now each row sizes to its wrapped line count and the card to the total. → `sim/simulation.js`, `waves/demand.js`, `scenes/levelScene.js`, `levels/levels.js`, `tooling/{headless,smoke}.mjs`. headless 0; smoke 0/0.
- **2026-06-17 — UI polish + roadmap Epochs.** Fixed the palette tab overflow (bar width tracked the active group's service row, so narrow groups let the 6-tab row spill — SECURITY bled off; now the content area is `max(serviceRow, tabRow)` with fixed-width tabs, stable bar). Collapsed the title's 19-mission grid into a styled **Campaign dropdown** (two readable columns, modal). Perf: cached the building body gradient + color-mix in the render hot path. Added two roadmap Epochs to this backlog: **Phase 7** (living simulation — time-varying demand, compounding economy, richer incident deck, long-form "company" mode) and **Phase 8** (grand pivot — fork into a visual AWS SDK client, read-only first, hard security/dependency gates). → `palette.js`, `titleScene.js`, `sprites.js`, READMEs, `backlog.md`. smoke: 0/0, 60fps.
- **2026-06-17 — T6.3 Secret Keeper (Secrets Manager).** 19th level: broker DB credentials through a new `secrets_manager` tile (Security group) instead of hard-coding them — `pathContainsAll:["secrets_manager"]`. Inserted before the DR finale; Secure domain now has 4 boss levels. → `catalog.js`, `levels.js`, `smoke.mjs`. smoke: 19 levels, 0/0.
- **2026-06-17 — Title-screen UI cleanup + T6.6 multi-region DR.** Title: replaced the runaway single-row level strip (17 chips × 128px blew the screen width) with a compact wrapped grid of numbered chips (4–9 auto-columns, number + short name + stars), the hovered mission's full name/subtitle on a reserved line; tightened logo/wordmark spacing. T6.6 "Across the Region" (18th level): new `region_failure` event downs the primary region's AZ bands — Multi-AZ can't save it (single-region); only the global Route 53 gate + a DR-region replica survive. Resilient domain now has 4 boss levels. → `titleScene.js`, `waves/events.js`, `levelScene.js`, `levels.js`, `smoke.mjs`. smoke: 18 levels, 0 errors, 0 problems.
- **2026-06-17 — Phase 6 Sprint 6d shipped (Cost domain).** Two cost levels with new mechanics: "Cold Storage" (archive to a cheap **S3 Glacier** class under a tight budget — `sinkIs:["s3_glacier"]`; new storage tile, low cost + high retrieval latency) and "Right Price Compute" (buy the steady base with **Reserved** not On-Demand — `pathContainsAny:["ec2_reserved","ec2_spot"]` + `pathExcludes:["ec2"]`; new `ec2_reserved`/`ec2_spot` tiles + a new `spot_interruption` event that takes Spot tiles offline, so Spot-only builds drop). Campaign now **17 levels**; Cost domain has 5 boss levels. → `catalog.js`, `waves/events.js`, `levelScene.js`, `levels.js`, `smoke.mjs`. smoke: 0 errors, 0 problems.
- **2026-06-17 — Phase 6 core goal met (every domain ≥3 boss levels).** Added "Serverless Spike" (T6.9): bursty workload won by a Lambda→DynamoDB serverless path with no always-on EC2 (`sinkIs:["dynamodb"]` + `pathContainsAll:["lambda"]` + `pathExcludes:["ec2"]`), no new services. Campaign now **15 levels**. Domain coverage: Secure 3, Resilient 3, High-Performing 5, Cost 3. Remaining Phase 6 is enrichment needing new mechanics: 6d Cost (Cold Storage = S3 storage-class tiers; Right Price Compute = purchasing modes + spot-interruption event), T6.6 multi-region DR (region-failure event + second-region board concept), T6.3 Secret Keeper (secrets tile). → `levels.js`, `smoke.mjs`. smoke: 0 errors, 0 problems.
- **2026-06-17 — Phase 6 Sprint 6b shipped (Resilient domain) + first new services.** Two decoupling levels: "Decouple or Drown" (buffer a spike through an **SQS** queue — `pathContainsAll:["sqs"]`; SQS reuses the spike-absorption field to model buffering) and "Fan Out" (publish to ≥2 subscribers through an **SNS** topic — new `winRequires.fanOut` structural check, since the single-path router can't express one-to-many). New `sqs`/`sns` tiles + a "Msg" palette group (now 6 groups, 20 services). Campaign now 14 levels ending in fan_out; Resilient domain has 3 boss levels (with zone_down). T6.6 multi-region DR deferred (needs a region-failure event + board concept). → `catalog.js`, `levelScene.js`, `levels.js`, `smoke.mjs`. smoke: 0 errors, 0 problems.
- **2026-06-17 — Phase 6 Sprint 6c shipped (High-Performing domain).** Two more curriculum levels, no new services: "Cache Rules" (front a read-storming DB with ElastiCache/CloudFront — `pathContainsAny:["cache","cloudfront"]`) and "Read Heavy" (scale reads with an RDS Read Replica — `sinkIs:["rds_replica"]`, which requires the seeded primary via the dependency model, teaching Read Replica vs Multi-AZ). Campaign now 12 levels ending in read_heavy. → `levels.js`, `smoke.mjs`. smoke: 0 errors, 0 problems (cache gate + replica route verified behaviourally).
- **2026-06-17 — Phase 6 Sprint 6a shipped (Secure domain).** Two curriculum levels, no new services: "Private Lines" (reach a private DynamoDB over PrivateLink, no NAT — `edgeTypeAny:["privatelink"]` + new `pathExcludes`) and "Locked Buckets" (private S3 served only via CloudFront/OAC — `pathContainsAll:["cloudfront"]` + `pathExcludes`). Campaign now 10 levels; Secure domain has 3 boss levels. Added `pathExcludes` to `_checkWinRequires`. Also corrected the 5b router rule: it was blocking round-trip return legs through a sink reached over peering/PrivateLink — now a node is non-transitable only when BOTH its entry and exit edges are non-transitive (peering→peering), so single peering/PrivateLink hops to a sink round-trip correctly. → `levels.js`, `levelScene.js`, `pathfind.js`, `smoke.mjs`. smoke: 0 errors, 0 problems.
- **2026-06-17 — Phase 5b shipped (transitive routing) + honest boot error.** Connection types carry a `transitive` flag (VPC/TGW transitive; Peering/PrivateLink not); the router (`pathfind.js` BFS) won't transit a node reached over a non-transitive link — a two-peering A—B—C chain can't reach C, while a Transit Gateway hub routes through. Phase 5 now fully complete. Separately, `game.html`'s startup fallback now surfaces the real error + a hard-reload hint (stale cached modules after an update were showing the misleading "needs a server" message). → `connections.js`, `pathfind.js`, `game.html`, `smoke.mjs`. smoke: 0 errors, 0 problems.
- **2026-06-17 — Phase 3 & Phase 5 closed out.** (T3.2) "Mesh vs Bridge" campaign finale — Transit Gateway hub vs N² peering mesh; 8th campaign level, wins require a TGW hop. (T5.3) edge-type `winRequires` (`edgeTypeAll`/`edgeTypeAny`) inspects the connection type of wires on the active path — the capability T3.2 needed; also unblocks a future PrivateLink-edge level. (T3.7) teaching layer — briefing now shows an up-front exam-tip strip with a study-guide tie-back (reinforced again on results). Only Phase 5b (transitive-routing sim) remains, explicitly deferred. → `levels.js`, `levelScene.js`, `smoke.mjs`. smoke: 0 errors, 0 problems (8 levels).
- **2026-06-17 — Phase 5 T5.1/T5.2 shipped (typed connections).** Wires now carry a real AWS networking construct. Edge type stored on the grid (`edgeType` map; `addEdge(...,type)`, `getEdgeType`, `forEachEdge` passes type). Four types: VPC link (default), VPC Peering, Transit Gateway (+2/hop processing), PrivateLink (+1.3/hop but cross-AZ exempt, must end at a sink). Picker row in the build bar (chips + hover tooltip) and `C` to cycle; `_commitWire`/preview validate `connTypeAllows`; billing adds `conn.hopCost` and skips the cross-AZ penalty when `crossAzExempt`; renderer colours each edge by type and tints only non-exempt cross-AZ wires. → `grid.js`, `connections.js`, `levelScene.js`, `ui/palette.js`, `render/gridRenderer.js`, help text, `smoke.mjs`. Deferred: transitive-routing sim (Phase 5b), Direct Connect (needs on-prem node). smoke: 0 errors, 0 problems.
- **2026-06-17 — Cross-AZ transfer = full 8× penalty (exam realism).** Reverted the earlier softened inter-AZ cost. Transfer model now mirrors AWS billing exactly: intra-AZ traffic is FREE (a plain tile contributes 0 to a hop), a tile's own `transferCostMul` (NAT ×8, VPCE ×0.02) is its processing/egress charge and stacks regardless of AZ, and crossing an AZ boundary adds the full `BILL.crossAzPenalty` (8×). Gate/internet-edge hops stay exempt. Makes AZ-failure events bite: multi-AZ HA is now a real cost/resilience tradeoff (core SAA theme). → `billing.js`, `levelScene.js`, `connections.js`, help text, `smoke.mjs`. smoke: 0 errors, 0 problems.
- **2026-06-17 — AWS-fidelity pass.** Fixed game logic that diverged from real AWS behavior. (1) **Structural dependencies:** RDS Read Replica now requires a source primary (`rds`/`rds_multiaz`) on the board — a primary-less replica is flagged invalid (dashed amber ring + banner), carries no traffic, and is not a routing sink. New `dependsOn` catalog field + `_dependencyMet`. (2) **Gateway VPC Endpoint** may only front S3/DynamoDB (the two Gateway-endpoint services) — new `validSinks` + `canWire()` enforce it at wire time. (3) **Any-distance wiring:** dropped the neighbouring-square rule for all services (was gate-only) — a VPC links services across subnets/AZs, not just adjacent racks. Legality is purely service-appropriateness. (4) **Economy realism:** cross-AZ hops bill an inter-AZ transfer surcharge (`BILL.crossAzSurcharge`; gate/internet-edge hops exempt; cross-AZ wires tinted amber); catalog costs corrected — Gateway VPCE 40→25 (no hourly fee), Shield Advanced 200→300 (premium), Read Replica 80→130 (full standard instance), Multi-AZ stays ~2× single-AZ. → `catalog.js`, `billing.js`, `levelScene.js`, `grid.js`, `gridRenderer.js`, `smoke.mjs`. smoke: 0 errors, 0 problems.
- **2026-06-17 — Pre-Phase-5 fixes committed (`8718105`).** (1) AZ failure zones now randomized per-run across all 3 AZs — EventDirector assigns distinct random zones to events with no explicit zone; (2) Four boss levels enforce specific win requirements via `winRequires` spec: leaky_pipe→S3-via-VPC-Endpoint, raccoons_gate→WAF/Shield, replay_or_gone→Kinesis Streams, single_writer→Aurora SV2/Limitless; generic ALB→EC2→RDS can no longer beat specialized challenges; (3) Sandbox reinvestment slider (0–100%, 10% snaps) at top-right feeds revenue back into AWS budget for perpetual profitable play. smoke.mjs: 0 errors, 0 problems.
- **2026-06-16 — Phase 3 started (Sprint 3a).** Difficulty tiers (Architect base / Senior / Principal): each tightens budget (×1 / ×0.8 / ×0.65) and speeds the whole round (×1 / ×1.25 / ×1.5); selectable + persisted on the title screen, applied per level. Diagonal (8-neighbour) grid connections for wiring + routing (renderer + packet motion were already generic). Headless-verified: title difficulty selector, Principal briefing (budget $975), and a fully diagonal route flowing guests. → `save/difficulty.js`, `grid.js`, `scenes/titleScene.js`, `scenes/levelScene.js`.

---

## 1. Concept

You are **Rocky**, a raccoon Site Reliability Engineer running a cloud theme park. **Requests** (your "guests") pour in through the front gate (Route 53). You place AWS service **buildings** on a grid and wire them together so requests flow to the database and back — fast, cheap, and resilient. Misconfigure and requests drop, latency spikes, the bill balloons, attackers break in. Survive escalating **waves** (traffic surges, DDoS, AZ failures) while keeping the **AWS bill** under budget.

**Why it teaches SAA-C03:** every mechanic maps to a real exam decision. The "Priority Gaps" become boss puzzles.

| Game mechanic | Maps to exam concept |
|---|---|
| Plug a leaking money-pipe with an Endpoint tile | Gateway VPC Endpoint vs NAT cost |
| Internal vs external service wiring | VPC Lattice vs PrivateLink |
| Pick a stream tile: Replay vs Firehose-funnel | Kinesis Streams vs Firehose |
| DB tile overload → shard vs auto-grow | Aurora Limitless vs Serverless v2 |
| DDoS wave → place Shield/WAF/CloudFront | Edge security & resilience |
| AZ-failure event → standby promotion | Multi-AZ vs read replica |
| Budget meter / cost audits | Cost-optimized architecture domain |

## 2. Genre & feel

- **Genre:** grid builder + tower-defense routing + light economy sim. Single-player, level-based with an endless sandbox.
- **Feel:** quirky, cozy-industrial. Factorio's satisfying conveyor/connection routing + RCT's bouncy management charm and isometric-ish park vibe. Googly-eyed services, little raccoon engineers scurrying, packets as theme-park guests on belts.
- **Session shape:** short levels (3–6 min) so it doubles as exam-break study.

## 3. Tech decisions (⚠️ NEEDS APPROVAL)

**Proposed stack — zero runtime dependencies:**
- **Vanilla JavaScript** (ES modules), **HTML5 Canvas** for rendering, CSS for UI chrome.
- No framework, no bundler required. Runs by opening `index.html` / a game page in any modern browser.
- Local dev server (optional): `python3 -m http.server` — already on macOS, nothing to install.
- **Art:** procedural Canvas drawing + emoji + CSS. No asset packages.
- **Audio (optional):** Web Audio API directly (no library), or skip in v1.
- **Persistence:** `localStorage` (save/load, progress). No backend.

**Dependency policy:** zero npm runtime deps recommended (matches "avoid risky npm dependencies"). If audio/sprites later justify a library, the only candidates I'd propose are tiny, audited, zero-transitive-dep ones (e.g. `howler.js` for sound) — and only with your explicit OK. **Default plan ships with NONE.**

> 🔔 **Approval needed before build:**
> 1. Confirm **zero-dependency vanilla** stack (or grant a vetted allowlist).
> 2. Green-light the plan to start Phase 1.

## 4. Architecture (source layout, post-approval)

```
/game
  game.html            # entry page
  /src
    main.js            # bootstrap, game loop (requestAnimationFrame)
    engine/            # loop, input, canvas, scene manager
    grid/              # tile map, placement, pathfinding (BFS/A*)
    entities/          # request packets, buildings, attackers
    services/          # AWS service definitions (data-driven catalog)
    economy/           # budget, billing meter, cost rules
    waves/             # wave/event scheduler, difficulty curve
    levels/            # level + puzzle definitions (gap-mapped)
    ui/                # HUD, build palette, tooltips, tutorial
    save/              # localStorage persistence
  /assets              # generated/procedural; sounds if approved
```

---

## 5. Sprints, Tasks & Phases

Work is **phased** — one phase per session to preserve context. Each phase ends in a runnable, committed state.

### ✅ PHASE 1 — Playable core (Sprints 0–1) — COMPLETE

**Sprint 0 — Foundation & brand**
- [x] T0.1 Scaffold `/game` + `game.html` + module entry, game loop (rAF), fixed-timestep update/render split. → `main.js`, `engine/loop.js`
- [x] T0.2 Canvas renderer + camera (pan/zoom), responsive resize. → `engine/canvas.js`, `engine/camera.js`
- [x] T0.3 Grid/tile map data structure + render; mouse → tile picking. → `grid/grid.js`, `render/gridRenderer.js`
- [x] T0.4 Brand/visual identity: palette, Rackoon logo mark, googly-eye service sprite style, title screen. → `theme.js`, `render/sprites.js`, `scenes/titleScene.js`
- [x] T0.5 Scene manager (title → level → results), basic state machine. → `engine/scene.js`

**Sprint 1 — Build & route**
- [x] T1.1 Service catalog (data-driven): Route 53 gate, ALB, EC2/ASG, Lambda, S3, RDS, DynamoDB, ElastiCache — each with stats (cost, throughput, latency). → `services/catalog.js`
- [x] T1.2 Build palette UI + place/remove buildings on grid (budget-gated). → `ui/palette.js`, `scenes/levelScene.js`
- [x] T1.3 Connections: draw wires between adjacent/compatible tiles (Factorio-style). → `grid/grid.js`, `render/gridRenderer.js`
- [x] T1.4 Request packets: spawn at gate, pathfind through wired topology to a DB sink and back. → `grid/pathfind.js`, `entities/packet.js`
- [x] T1.5 Success/fail: routed requests = revenue; dropped/dead-ended = lost. Live counters. → `ui/hud.js`, `scenes/levelScene.js`

> **End of Phase 1:** ✅ place services, wire them, watch guests flow, earn/lose. Committed (`b0acd18`), verified headless.

### ✅ PHASE 2 — Economy, waves, lose/win (Sprint 2) — COMPLETE

**Sprint 2 — Pressure & stakes**
- [x] T2.1 Budget + live **AWS bill meter** (per-tile running cost, data-transfer costs between tiles). → `economy/billing.js`
- [x] T2.2 Wave scheduler: escalating traffic surges; throughput overload → latency → drops. → `waves/scheduler.js`, `waves/load.js`
- [x] T2.3 Events: AZ failure, traffic spike, cost audit. Telegraphed with warnings. → `waves/events.js`
- [x] T2.4 Win/lose conditions, score, star rating (uptime × cost-efficiency × resilience). → `economy/scoring.js`
- [x] T2.5 Results screen + `localStorage` save/load + progress unlocks. → `scenes/resultsScene.js`, `save/progress.js`, `scenes/titleScene.js`

> **End of Phase 2:** ✅ a real game loop with stakes — committed, playtested, and tuned (intro-grace briefing, gentler economy, H help legend).

### ✅ PHASE 3 — Mechanics, AWS-sim depth & boss gaps (Sprint 3) — COMPLETE

> **MVP Epoch goal:** by the end of this Epoch the game is a *semi-complete
> simulation of the AWS ecosystem for solutions architecture* — a meaningfully
> broad service catalog and real connection types, not merely generic wires.
> Phase 3 is chunked into sub-sprints; each lands runnable + committed.

**Sprint 3a — Mechanics & difficulty** ✅
- [x] T3.8 Difficulty settings — 3 tiers; base = current pace. Each tightens the
      **budget** and **speeds up** the whole round. Selectable + persisted on the
      title screen, applied per level. → `save/difficulty.js`, `titleScene`, `levelScene`
- [x] T3.9 Diagonal grid connections — 8-neighbour wiring + routing. → `grid.js`
- [x] T3.13 Route 53 global model — gate tile immune to AZ failures; can wire directly
      to endpoints in any AZ (no adjacency constraint). Help overlay + level briefing
      updated to teach the concept. → `levelScene.js`, `levels.js`, `catalog.js`

**Sprint 3b — AWS-sim breadth** ✅
- [x] T3.11 Expanded catalog (18 placeable services): CloudFront, WAF, Shield, NAT Gateway,
      VPC Endpoint; Kinesis Streams, Kinesis Firehose; Aurora SV2, Aurora Limitless,
      RDS Multi-AZ, RDS Read Replica. Each with stats + gameplay-effect properties
      (`transferCostMul`, `attackMitigation`, `azResilient`, `autoScale`, `replayable`).
- [x] T3.12 Gameplay mechanics wired: NAT ×8 transfer cost, VPCE ×0.02, WAF/Shield
      spike absorption, Multi-AZ AZ resilience, SV2 auto-scaling throughput. Category-tab
      palette (Net/Compute/Data/DB/Security) replaces the flat row. → `catalog.js`,
      `palette.js`, `levelScene.js`, `load.js`

**Sprint 3c — Gap-mapped boss levels** ✅
- [x] T3.1 "The Leaky Pipe" — NAT money-leak; pre-seeded NAT + cost audit; fix = VPC Endpoint.
- [x] T3.2 "Mesh vs Bridge" — Transit Gateway hub vs N² peering mesh. Shipped as the
      campaign finale using Phase 5 typed connections + the new edge-type `winRequires`
      (`edgeTypeAny: ["tgw"]`). → `levels.js`, `levelScene.js`.
- [x] T3.3 "Replay or It's Gone" — Kinesis Streams (replayable) vs Firehose (no-replay sink).
- [x] T3.4 "Single Writer's Burden" — Aurora SV2 (vertical auto-scale) vs Limitless (horizontal).
- [x] T3.5 "Raccoons at the Gate" — DDoS traffic spikes; place Shield/WAF/CloudFront.
- [x] T3.6 "When the Zone Goes Dark" — shipped Phase 2; updated with RDS Multi-AZ tip in briefing.

**Sprint 3d — Teaching layer** ✅
- [x] T3.7 In-level teaching cards + post-level "exam tip" tie-back. The briefing now
      carries an exam-tip strip (taught up-front, reinforced on the results screen) with
      a study-guide tie-back line; per-level `examTip` on all levels. → `levelScene.js`.

> **End of Phase 3:** difficulty + diagonal/typed connections + a broader AWS
> catalog + the gap-mapped boss levels. Each sub-sprint commits independently.

### ✅ PHASE 4 — Polish (Sprint 4) — COMPLETE

**Sprint 4 — Juice & ship**
- [x] T4.1 Particle burst on building placement + packet motion trail. → `levelScene.js`, `packet.js`, `sprites.js`
- [x] T4.2 Audio (Web Audio API): place/wire/erase/alert/spike/azFail/win/lose sfx — procedurally synthesized, zero deps. → `engine/audio.js`, `levelScene.js`, `resultsScene.js`
- [x] T4.3 Exam tips: `examTip` on all 19 services + all 7 levels; shown in palette tooltip, grid building tooltip, and results screen. → `catalog.js`, `levels.js`, `palette.js`, `levelScene.js`, `resultsScene.js`
- [x] T4.4 Sandbox mode (no win condition, 9999 budget, 20×12 grid) + dedicated title-screen button. → `levels.js`, `titleScene.js`, `levelScene.js`
- [ ] T4.5 ~~Accessibility (keyboard, colorblind-safe palette)~~ **— DEPRECATED** (descoped from this Epoch per request). Perf pass + cross-browser check only.
- [x] T4.6 README for the game (done) + study-guide ↔ game links (study guide → game
      button in `index.html`; game → study-guide corner link in `game.html`). Final QA =
      the headless smoke suite (`tooling/smoke.mjs`, 0/0). Remaining: a manual
      cross-browser/device pass (rolls into T4.5).

> **End of Phase 4:** complete, polished, shippable. Final commit.

### ✅ PHASE 5 — Deep networking layer (typed connections) — COMPLETE (incl. 5b transitive-routing sim)

**Sprint 5 — Typed connections & VPC topology.** Detailed plan below; sized for
one session. Foundation (`services/connections.js`) already landed.

#### Design decision (conflict resolution)
The original T5.1 note listed "Gateway VPC Endpoint" and "Direct Connect" as
connection *types*. Resolved as follows, to avoid redundancy and unmodelled nodes:
- **Gateway VPC Endpoint stays a *building*** (added in Phase 3b as `vpc_endpoint`,
  already restricted to S3/DynamoDB via `validSinks`). Not duplicated as a type.
- **Direct Connect deferred** — needs an on-prem/partner node the catalog doesn't
  model. Park until an on-prem tile exists (would be a Phase 3b-style catalog add).
- Connection **types** therefore model the inter-service network constructs that
  are *not* tiles: **VPC link** (default), **VPC Peering**, **Transit Gateway**,
  **PrivateLink**.

#### Connection-type table (implemented in `services/connections.js` ✅)
| id | real AWS | transferMul | crossAzExempt | topology rule | color |
|----|----------|-------------|---------------|---------------|-------|
| `vpc` | same-VPC link (default) | 1.0 | no | any `canWire` pair | cyan |
| `peering` | VPC Peering (1:1, non-transitive) | 1.0 | no | any `canWire` pair | green |
| `tgw` | Transit Gateway (hub, transitive) | 1.6 | no | any `canWire` pair | magenta |
| `privatelink` | PrivateLink (interface endpoint) | 1.3 | **yes** | exactly one end is a sink/storage | blue |

#### Tasks
- [x] **T5.0 Foundation** — `services/connections.js`: `CONN` records, `CONN_ORDER`,
      `DEFAULT_CONN`, `getConn`, `connTypeAllows` (PrivateLink needs one sink end).
- [x] **T5.1 Typed edges + picker + visuals + billing** — done. Edge type stored
      in `grid.edgeType` (`addEdge(...,type)`, `getEdgeType`, `forEachEdge` passes it);
      scene `connType` + `C`-cycle + palette picker row (chips, hover tooltip);
      `_commitWire`/preview validate the type; billing adds `conn.hopCost` per hop
      and skips the cross-AZ penalty when `crossAzExempt`; renderer colours each
      edge core by type and tints only non-exempt cross-AZ edges amber.
  1. **`grid/grid.js`** — store edge type. Add `this.edgeType = new Map()` (edgeKey→typeId).
     `addEdge(aKey,bKey,type="vpc")` records it; `_removeEdgeByKeys` deletes it;
     new `getEdgeType(aKey,bKey)`; `forEachEdge(fn)` passes `type` as 5th arg.
     (grid stays import-free — default type is the literal `"vpc"`.)
  2. **`scenes/levelScene.js`** —
     - State: `this.connType = DEFAULT_CONN`. Import `CONN`, `getConn`, `connTypeAllows`,
       `CONN_ORDER` from connections.js.
     - `_commitWire`: after `canWire`, also require `connTypeAllows(this.connType,a,b)`;
       pass `this.connType` to `grid.addEdge`. Reject + (optional) sfx on fail.
     - Wire preview validity also checks `connTypeAllows`.
     - Key `C` cycles `connType` through `CONN_ORDER` (and sync from palette click).
     - Billing (in `_updatePackets` visit cb): read the edge type between `prevKey`
       and the entered key via `grid.getEdgeType`; fold into the hop cost:
       `xferMul = tileMul * conn.transferMul`, then add `crossAzSurcharge` only when
       `crossAz && !conn.crossAzExempt` (PrivateLink crossing an AZ pays no surcharge).
     - Help legend: add a "Connections" row; update the wire-tool blurb.
  3. **`ui/palette.js`** — connection-type picker in the build bar.
     - `this.connType = DEFAULT_CONN`. Lay out 4 small chips (short label, type color
       when active) as a strip; add `_connRects` + hit-testing in `handleClick`
       (test before tabs/buttons). Hover a chip → reuse `_panel` to show its blurb +
       examTip. Scene reads `palette.connType` (single source of truth; `C` key also
       updates it).
  4. **`render/gridRenderer.js`** — `drawWires` colors each edge's solid core by
     `getConn(type).color` (per-edge stroke, not one batched pass). Keep glow + flow
     dash generic. Cross-AZ amber overlay only when the edge is cross-AZ **and not**
     `crossAzExempt` (PrivateLink stays untinted). Import `getConn`.
- [x] **T5.2 Per-type topology rules** — done via `connTypeAllows` (PrivateLink
      requires exactly one sink end), enforced at wire-commit + preview. Other three
      stay permissive (lesson is cost/visual + transitivity note in tooltips).
- [x] **T5.3 Edge-type `winRequires`** — `_checkWinRequires` now supports
      `edgeTypeAll` / `edgeTypeAny`, inspecting the connection type of each wire on the
      active path. Exercised by the `mesh_bridge` level (TGW). Unblocks future levels
      that demand a PrivateLink edge (Phase 6 T6.1). → `levelScene.js`.

#### Verification (`tooling/smoke.mjs`)
- `connections` import OK; `CONN_ORDER.length === 4`; `connTypeAllows("privatelink", edge, sink)`
  true, `connTypeAllows("privatelink", edge, edge)` false.
- `grid.addEdge(a,b,"tgw")` → `getEdgeType` returns `"tgw"`; default is `"vpc"`.
- Scene: wire a `tgw` edge cross-AZ → higher per-hop charge than a `vpc` edge (compare
  `bill.transferSpent` deltas, or assert the cost formula directly).
- PrivateLink crossing an AZ is **not** amber-tinted / pays no surcharge (assert via the
  cost formula or a flag exposed for test).

#### Sprint 5b — Transitive-routing simulation ✅
- [x] **T5.4** — peering is non-transitive, TGW is transitive. Each connection type
      carries a `transitive` flag (`connections.js` + `isTransitive`); the router
      (`pathfind.js` BFS) enforces it: a node reached over a non-transitive link
      (VPC Peering / PrivateLink) may be a destination but cannot be *transited*
      onward, so a two-peering A—B—C chain can't reach C while a Transit Gateway
      hub routes through. Verified headless (peering chain blocked, TGW routes).

#### Deferred (note, don't silently drop)
- **Direct Connect** — needs an on-prem node (catalog add first).

> **End of Phase 5:** wires carry a real AWS networking construct — typed, priced,
> coloured, topology-checked, and now transitivity-aware in the router.

### 🟣 PHASE 6 — Full SAA-C03 curriculum coverage (level roadmap)

Goal: the campaign should touch **every SAA-C03 exam domain**, each boss level a
concrete decision the exam tests. Today's 7 levels skew to networking/DB; this
phase fills the gaps. Build per sub-sprint (one domain per session), each level a
data-only `levels.js` addition where the catalog already supports it, plus the few
new services/mechanics flagged below.

#### Domain coverage matrix (current → target)
SAA-C03 weights: **Secure 30% · Resilient 26% · High-Performing 24% · Cost 20%.**

| Domain | Have | Gap to fill |
|--------|------|-------------|
| **Secure** | `raccoons_gate` (WAF/Shield/CloudFront) | private connectivity (PrivateLink/endpoints, no public exposure), encryption at rest + S3 OAC, secrets/identity |
| **Resilient** | `zone_down` (Multi-AZ) | decoupling (SQS/SNS), multi-region DR + RPO/RTO, backups/auto-recovery |
| **High-Performing** | `rush_hour` (scale-out), `replay_or_gone` (streaming) | caching tiers (CloudFront/ElastiCache/DAX), read scaling (read replicas), serverless/event-driven |
| **Cost** | `leaky_pipe` (NAT vs endpoint), `single_writer` (DB right-sizing) | many-VPC connectivity cost (TGW vs Peering), storage tiering (S3/Glacier lifecycle), compute purchasing (Spot/Reserved/Savings) |

#### Proposed campaign (existing 7 + 11 new = 18; unlock chain in order)
Each new level: **concept → exam lesson → win mechanic → new deps.** "win mechanic"
reuses the `winRequires` system (`sinkIs` / `pathContainsAll` / `pathContainsAny`,
extended where noted); events reuse `EventDirector`.

**Sprint 6a — Secure ✅** (3 Secure levels now: `raccoons_gate` + these two)
- [x] **T6.1 "Private Lines"** — reach a private DynamoDB with zero public exposure.
  Win: route reaches the DB over a `privatelink` edge with **no** `nat_gateway` hop
  (`edgeTypeAny:["privatelink"]` + new `pathExcludes`). Seeded NAT is the trap. No
  new services. → `levels.js`, `levelScene.js` (added `pathExcludes` to `winRequires`).
- [x] **T6.2 "Locked Buckets"** — serve private S3 only through CloudFront (OAC).
  Win: `sinkIs:["s3"]` + `pathContainsAll:["cloudfront"]` + `pathExcludes:["nat_gateway"]`.
  Encryption-at-rest / OAC taught via intro + exam tip (no new tile needed). → `levels.js`.
- [x] **T6.3 "Secret Keeper"** — no hard-coded creds; broker the DB connection through
  Secrets Manager. Win: `pathContainsAll:["secrets_manager"]`. New **`secrets_manager`**
  tile (Security group). Rotation/KMS/IAM taught via exam tip. → `catalog.js`, `levels.js`.

> Router correction made here (needed for PrivateLink levels): the 5b non-transitive
> rule was too strict — it blocked the **round-trip return leg** through a sink reached
> over peering/PrivateLink. Fixed to the accurate rule: a node can't be transited only
> when **both** its entry and exit edges are non-transitive (peering→peering). Single
> peering/PrivateLink hops to a sink now round-trip correctly. → `grid/pathfind.js`.

**Sprint 6b — Resilient ✅** (decouple_drown + fan_out; new `sqs`/`sns` tiles)
- [x] **T6.4 "Decouple or Drown"** — absorb a spike with a queue between tiers. Win:
  `pathContainsAll:["sqs"]`. New **`sqs`** tile (role EDGE) reuses the spike-absorption
  field (`attackMitigation: 0.5`) to model buffering — decoupling smooths bursts.
  → `catalog.js`, `levels.js`.
- [x] **T6.5 "Fan Out"** — one event, many subscribers. Win: `pathContainsAll:["sns"]`
  + new `winRequires.fanOut` ({service, minSinks}) — a structural check that an SNS
  tile is wired to ≥2 sink subscribers (the single-path router can't express
  one-to-many). New **`sns`** tile; two subscriber sinks seeded. → `catalog.js`,
  `levels.js`, `levelScene.js` (fanOut check). New palette group **"Msg"** (sqs, sns).
- [x] **T6.6 "Across the Region"** — survive a whole-region loss. New
  **`region_failure`** event kind downs a set of AZ bands (the primary region),
  leaving the last band as the DR region. Crucially, **Multi-AZ does NOT survive it**
  (single-region) — only the global Route 53 gate + a stack replicated into the DR
  region keep serving. Survival-based (like `zone_down`), tight SLA, DR strategies +
  RTO/RPO taught via the briefing/exam tip. → `waves/events.js`, `levelScene.js`,
  `levels.js`. (Reuses the existing AZ bands as regions — no separate-board concept.)

**Sprint 6c — High-Performing ✅** (cache_rules + read_heavy; no new services)
- [x] **T6.7 "Cache Rules"** — cut DB load + latency with a cache layer. Win:
  `sinkIs` a DB + `pathContainsAny:["cache","cloudfront"]`; seeded RDS buckles under a
  read storm until a cache fronts it. → `levels.js`.
- [x] **T6.8 "Read Heavy"** — scale a read-mostly workload with a Read Replica. Win:
  `sinkIs:["rds_replica"]`; the replica needs the seeded RDS primary (dependency model),
  so the level teaches Read Replica (read scaling) vs Multi-AZ (HA). → `levels.js`.
  (Read/write split in the load model deferred — the win rule + lesson stand without it.)
- [x] **T6.9 "Serverless Spike"** — spiky, event-driven, pay-per-use. Win:
  `sinkIs:["dynamodb"]` + `pathContainsAll:["lambda"]` + `pathExcludes:["ec2"]` — a
  Lambda→DynamoDB path with no always-on fleet. No new services (`api_gateway` front
  left optional). → `levels.js`.

**Sprint 6d — Cost ✅** (cold_storage + right_price; new storage-class + purchasing-mode mechanics)
- ~~**T6.10 "Mesh vs Bridge"**~~ — ✅ **shipped early as T3.2** (campaign finale; TGW
  hub via `edgeTypeAny: ["tgw"]`). The edge-type `winRequires` extension it needed
  (now T5.3) is also done — so T6.1 "Private Lines" can reuse it for a PrivateLink edge.
- [x] **T6.11 "Cold Storage"** — archive cold data to a cheap storage class. Win:
  `sinkIs:["s3_glacier"]` under a tight budget. New **`s3_glacier`** tile (STORAGE role,
  low cost, high retrieval latency → earns less per request). Lifecycle/IA taught via
  exam tip. → `catalog.js`, `levels.js`.
- [x] **T6.12 "Right Price Compute"** — match purchasing to the workload shape. Win:
  `pathContainsAny:["ec2_reserved","ec2_spot"]` + `pathExcludes:["ec2"]`. New
  **`ec2_reserved`** (cheap steady) + **`ec2_spot`** (cheapest, `spotInterruptible`)
  tiles and a new **`spot_interruption`** event kind that takes Spot tiles offline
  (reuses the `disabled` path) — a Spot-only build drops, so the resilient cost-optimal
  answer is Reserved for the steady base. → `catalog.js`, `waves/events.js`,
  `levelScene.js`, `levels.js`.

#### Catalog / mechanic additions this phase needs (roadmap)
- **Services:** `sqs`, `sns` (core decoupling — highest value); then optional
  `eventbridge`, `api_gateway`, `dax`, `kms`/`secrets_manager`.
- **Mechanics:** edge-type-aware `winRequires` (unlocks T6.1/T6.10 with no new art);
  read/write split in the load model (T6.8); S3 storage-class cost tiers (T6.11);
  compute purchasing modes + `spot_interruption` event (T6.12); `region_failure`
  event + second-region board concept (T6.6).
- **Reuse:** PrivateLink, VPCE, TGW/Peering, Multi-AZ, replicas, cache, CloudFront,
  Kinesis, Aurora tiers — all already in the catalog.

#### Sequencing recommendation
Start with the cheap, high-coverage wins that need **no new services** — **T6.1,
T6.10** (edge-type `winRequires`), **T6.7, T6.8** (caching / read replicas) — then add
**SQS/SNS** for **T6.4/T6.5**, then the heavier mechanics (DR region, storage tiers,
purchasing) last. Keep one domain per session; each level lands runnable + smoke-checked.

> **End of Phase 6:** every SAA-C03 domain has ≥3 boss levels; the campaign is a
> playable exam-prep map. 19 levels + sandbox.

### 🔵 PHASE 7 — Living simulation (longer missions, dynamic economy)

**Vision.** Evolve from short 3–6 min exam puzzles into a **full simulation of the
AWS ecosystem** — missions that model larger, longer-lived systems whose conditions
change over time, for real-world distributed-systems designers *and* for fun. The
architecture you build must hold up as demand grows, revenue fluctuates, and the
unforeseen hits. Today every level is a static wave script with a fixed budget; this
Epoch makes the world *alive*.

**Pillars & candidate tasks** (data/mechanics, not just levels):
- **T7.1 Time-varying demand** — replace flat wave rates with continuous demand
  curves: diurnal cycles, weekday/weekend, seasonality, and a long-run **growth
  trend** (your user base compounds). Traffic is a signal over time, not 4 steps.
  → `waves/` (new demand model), `levelScene` spawn loop.
- **T7.2 Dynamic, compounding economy** — revenue **fluctuates** (price changes,
  demand dips, SLA penalties/credits) and **growth** compounds: profit reinvests
  into budget; success buys scale; under-provisioning loses customers (revenue
  decays). Capacity planning becomes the core loop. → `economy/`.
- **T7.3 Unforeseen-circumstances deck** — expand incidents into a richer, partly
  random event deck beyond AZ/region/spot/audit: viral spike, upstream dependency
  outage, security incident, data-loss/backup-restore test (RPO/RTO scored), noisy-
  neighbor, cert expiry, price hike. Telegraphed, weighted, escalating. → `waves/events.js`.
- **T7.4 Long-form "company" mode** — a persistent, long-running scenario (20–60+ min
  or save-and-resume) with milestones (users served, uptime SLOs, margin targets)
  instead of a single goalRequests number. Build a system that *survives and grows*.
  → new mode in `levels.js` + persistence in `save/`.
- **T7.5 Balancing + telemetry. ✅ DONE (2026-06-17).** New `sim/telemetry.js` `Telemetry`
  (pure derivation over sim state) computes the live operator instrument panel: **demand**
  (current multiplier + a rolling sparkline history), **margin $/s** (revenue rate − burn,
  EMA-smoothed), **SLO burn** (error-budget burn vs the allowed rate, off a new `sloTarget`),
  and **headroom** (1 − busiest serving tile's load). `Simulation` updates it each step and
  exposes `telemetry()`. The level's OPS-TELEMETRY HUD chip grew into a full panel: the T7.6
  outcome row, the T7.5 operator-signal row, and a demand sparkline. Headless reads the
  signals to tune curves (min-headroom / peak-demand sweep) and asserts they're sane,
  curve-tracking, and **deterministic** for a fixed seed. → `sim/{telemetry,simulation}.js`,
  `scenes/levelScene.js`, `tooling/headless.mjs`. headless 0; smoke 0/0.
- **T7.6 Realism deepening. ✅ DONE (2026-06-17).** New `sim/realism.js` `RealismTracker`
  (pure) rolls up the four ops numbers a real review grades: **latency-SLO compliance**
  (served round-trips under `sloMs`), **blast radius** (peak capacity-weighted fraction an
  incident takes offline), **RTO** (longest outage after the service was up), and an **RPO
  proxy** (requests dropped during an outage). The fourth axis, **auto-scaling warm-up
  lag**, lives in `load.js`: an autoScale tier's capacity now ramps toward demand over a
  time constant (`WARMUP_TAU`) instead of snapping, so a spike transiently overloads (which
  then shows in SLO/latency). Surfaced via `Simulation.metrics()` (so milestones can target
  `sloCompliance`), an **OPS TELEMETRY** HUD chip, persisted across company save/resume, and
  asserted in the headless harness (SLO counting, blast peak, RTO/RPO, pre-establishment
  downtime excluded, warm-up ramp). The `company` level adds a "Hold SLO ≥ 95%" milestone +
  `sloMs`. → `sim/{realism,simulation}.js`, `waves/load.js`, `scenes/levelScene.js`, `levels/levels.js`, `tooling/headless.mjs`. headless 0; smoke 0/0.

#### Execution plan — architecture-first (from the Phase-7 architecture review)
The helper sim modules are already clean seams (`billing`, `scheduler`, `load`,
`events`, `scoring`), but the **simulation that composes them lives inside the
1616-line `LevelScene.update()`**, interleaved with input/camera/UI and even
`audio.play()` inside the tick; the economy is loose scene fields mutated in 4+
places; demand is a finite step function; events are a fixed scripted timeline;
sim-path `Math.random()` is unseeded; and there is **no headless sim**. So Phase 7
is gated on extracting a composable, deterministic, headless-runnable sim core
*first*. Refactors (keep zero-dep/vanilla, keep the 19 levels + smoke green, keep
the data-driven catalog/levels pattern):

- **R2 — Headless harness + seedable RNG. _(do FIRST; small, additive, low risk)_**
  Add `sim/rng.js` (mulberry32, ~6 lines); thread it through the 3 sim-path randoms
  (`events.js` AZ-zone pick, `load.js` drop decision — leave cosmetic randoms alone);
  add `tooling/headless.mjs` that runs the sim modules under Node with no canvas.
  This is the test surface for every later step; unblocks T7.5 (headless balancing).
- **R1 — Extract a `Simulation` core. ✅ DONE (2026-06-17).** Lifted `_tickSystems` +
  the spawn loop + `_updatePackets` + `_checkOutcome` + win-requires/route/dependency
  logic out of `LevelScene` into `sim/simulation.js` (one `step(dt)` + `recomputeRoute()`);
  no audio/render side-effects inside the step — they're pushed onto an `emitted` queue
  the scene drains (`_drainSim`). Building runtime fields (`b.load`, `b.disabled`,
  `b.invalid`) still written so the renderer is untouched; `s.budget/s.bill/s.success/...`
  delegate to the sim via accessors so the smoke suite stayed green. `tooling/headless.mjs`
  now fast-runs a real `Simulation` (first_light): same seed → byte-identical run to a
  win with an accruing bill. Pure lift, no behaviour change. headless 0 problems; browser
  smoke 0/0. → `sim/simulation.js`, `scenes/levelScene.js`, `tooling/{headless,smoke}.mjs`.
- **R3 — `DemandModel` (`waves/demand.js`). ✅ DONE (2026-06-17).** Pure, deterministic
  `rateAt(t)` = base × diurnal (cosine peaking at `peakHour`) × weekday/weekend ×
  seasonal sine × compounding `growth^days` (capped, floored). The `Simulation` carries
  a sim clock (`simTime`) and uses the curve for the spawn-rate multiplier when a level
  defines `demand{}`, else falls back to the legacy `WaveScheduler.multiplier()`; the HUD
  wave chip shows the living-economy phase (`Day N · HH:00 · weekday peak`). Sandbox now
  ships a `demand{}` spec (8s day, mid-afternoon peak, quiet weekends, ~5%/day growth).
  Headless asserts curve shape (peak≫trough, growth over 10 days, weekend<weekday) + a
  sandbox run where a later full-day window outpaces an early one. headless 0; smoke 0/0.
  → `waves/demand.js`, `sim/simulation.js`, `scenes/levelScene.js`, `levels/levels.js`, `tooling/headless.mjs`.
- **R4 — `Economy` ledger (`economy/economy.js`). ✅ DONE (2026-06-17).** New `Economy`
  owns budget/revenue/lost behind named ops (`canAfford/spend/credit/chargeBill/
  chargeTransfer/earn(reward,reinvestRate)/penalize`) with one invariant set: the budget
  never goes negative, credits only add, revenue/lost are monotonic. The five scattered
  inline money mutations (running bill, per-hop transfer, request reward, drop penalty,
  build/erase) now all route through it — sim flows + scene build/erase. `sim.budget/
  revenue/lost` delegate to the ledger so renderer/HUD/win-eval are untouched. Pure lift:
  first_light replays byte-identical. Headless asserts the ledger invariants + that a
  composed run never drives budget < 0. Growth/churn hang off this ledger next (T7.2 cont.).
  → `economy/economy.js`, `sim/simulation.js`, `scenes/levelScene.js`, `tooling/headless.mjs`. headless 0; smoke 0/0.
- **R5 — `IncidentDeck`. ✅ DONE (2026-06-17).** New `waves/incidents.js` `IncidentDeck`:
  a seeded draw engine that picks weighted incident cards over time, telegraphed (`warn`
  lead), cooldown-spaced (global + per-kind), with escalation (interval shrinks + severity
  grows per draw) and a `maxActive` ceiling. `EventDirector` composes it (4th ctor arg) and
  feeds each drawn incident into its normal `events[]` lifecycle, so EVERY query
  (`isTileDisabled/isTileInFailedRegion/failedZones/spawnMultiplier/billMultiplier/
  spotInterrupted/banner`), the smoke's direct `events.push`, and the resilience scoring
  work unchanged. A level opts in via `deck{}` (Simulation passes `level.deck`); sandbox now
  ships a gentle endless deck (one incident at a time, slow escalation). Headless asserts
  the deck is seeded-deterministic, telegraphed, escalating, and that a deck-driven sim run
  fires incidents beyond the scripted set + replays identically. headless 0; smoke 0/0.
  → `waves/incidents.js`, `waves/events.js`, `sim/simulation.js`, `levels/levels.js`, `tooling/headless.mjs`.
- **R6 — Company/run state + milestones + save/resume. ✅ DONE (2026-06-17).** Added a
  `mode: scenario|freerun` to the sim. **Freerun (company)** is endless: no routed goal,
  bankruptcy is the only loss, success is measured by business **milestones**. New
  `sim/milestones.js` `MilestoneSet.evaluate(metrics)` (pure) runs *alongside* the binary
  `evaluate`; the sim exposes `metrics()`/`evaluateMilestones()`/`simDays` and flips
  `milestonesComplete` when all are met (keeps PLAYING so you can keep growing; cash out to
  bank a scored win). **Save/resume:** `Simulation.snapshot()` + `buildGridFromSnapshot()` +
  `applySnapshot()` serialize the board (typed edges) + ledger + counters + clock + seed;
  `save/run.js` persists one run; the title shows "Company Mode" / "Resume", the scene saves
  on Esc and clears on cash-out/bankruptcy. New `company` freerun level (demand + deck + 4
  milestones) + a milestone HUD + freerun cash-out. **Also fixed a real determinism bug**:
  packet *speed* used `Math.random` (affects travel time → outcome) — now seeded, so runs are
  genuinely reproducible. Headless asserts milestone eval, freerun outcome rules, and a
  snapshot→rebuild→restore round-trip. → `sim/{simulation,milestones}.js`, `save/run.js`,
  `entities/packet.js`, `scenes/{levelScene,titleScene}.js`, `levels/levels.js`, `tooling/headless.mjs`. headless 0; smoke 0/0.

**Locked design decisions (owner):**
- **Time model = time-compressed** — an abstract clock where one in-game "day" ≈ a few
  real seconds (a 60-day run plays in minutes). Demand curves read as days/weeks;
  shapes the R1 clock abstraction + R3 demand signal.
- **Win model = both (mode pick)** — support **milestone "scenario"** missions (hit
  business targets: users served, uptime SLO, margin → scored win) **and** an **endless
  "free-run" company** mode (run until bankruptcy/quit, scored by peak). Player picks
  per mission. Shapes R6 (`mode: scenario|freerun`, milestone-or-peak `evaluate`).

**Order:** ~~R2~~ ✅ → ~~R1~~ ✅ → ~~R3~~ ✅ → ~~R4~~ ✅ → ~~R5~~ ✅ → ~~R6~~ ✅ → ~~T7.6~~ ✅ — **Phase 7 complete.** T7.6 (latency
SLOs, scaling-lag/warm-up in `LoadModel`, blast radius, RPO/RTO) landed on the stable
seams the R-series built. Every step shipped runnable + smoke-checked + a headless
balancing assertion. **Next horizon: Phase 8** (the visual AWS-SDK pivot).

> **End of Phase 7:** levels feel like operating a real, growing AWS system over time
> — demand breathes, money compounds, and the unexpected tests the architecture.

**Polish / icebox (visual, not blocking the R-series):**
- ✅ **Title-screen living backdrop. DONE (2026-06-17).** Replaced the floating sparks with
  a faded mini-architecture behind the title: real service nodes (in-game `drawService`
  art) scattered around the periphery, joined by typed wires showcasing all four
  connection types (VPC/Peering/TGW/PrivateLink, each in its CONN color), packets flowing
  along the wires, nodes bobbing. Pure decoration (packet positions from the scene clock,
  no sim); nodes hug the edges so the centred title + buttons stay legible. → `titleScene.js`.

### 🟣 PHASE 8 — Grand pivot: fork into a visual AWS SDK client

**Vision (the larger goal).** Fork this project into a **visual AWS SDK / API client**:
the same canvas topology model, but the tiles are *real AWS resources* and wires are
*real relationships*. Read live account state and render it as a navigable map; later,
provision/configure through the SDK. The game engine becomes the visualization +
interaction layer for an actual cloud control surface.

**Why it's feasible from here:** the catalog is already a data-driven service model,
the grid is already a typed resource+relationship graph, and routing/economy already
mirror AWS semantics. The bridge is a mapping layer + the SDK.

**Direction & gated tasks** (each a deliberate step; safety-gated):
- **T8.0 Fork** — split into a separate repo/product; keep the game as the teaching
  artifact, the client as the pro tool. Record the shared engine boundary.
- **T8.1 Read-only discovery (spike)** — integrate **aws-sdk-js v3** (or a thin
  backend) to `describe/list` real resources (VPC, subnets, EC2/ASG, RDS, S3, ELB…)
  and render them on the canvas via the resource→tile mapping. **Read-only.**
- **T8.2 Auth** — AWS SSO / STS, least-privilege **read-only** role; never store
  long-lived secrets; explicit account/region selection.
- **T8.3 Resource→tile mapping layer** — translate live AWS objects into the existing
  building/edge model (and back); show real cost (Cost Explorer / pricing) in the bill.
- **T8.4 (Gated) write path** — provision/modify via SDK with **dry-run by default**,
  explicit per-action confirmation, change preview/diff, and sandbox-account guards.
- **T8.5 De-game the UI** — pro-mode chrome for operators while keeping the legible,
  spatial topology view.

> ⚠️ **Hard gates for Phase 8.** This breaks two founding constraints and needs
> explicit approval: (1) **dependencies** — a real AWS SDK (no longer zero-dep), and
> likely a backend for credentials; (2) **security** — it touches live infrastructure
> and real money, so it must be **read-only / dry-run by default**, least-privilege,
> sandbox-first, with confirmation on every mutation. Park the write path until the
> read-only client is proven and the auth/safety model is signed off.

---

## 6. Risks & guardrails
- **Context budget:** strictly one phase per session; each phase self-contained and committed.
- **Scope creep:** v1 targets ~6 levels + sandbox; extra services are stretch.
- **No risky deps:** zero runtime npm by default; any addition needs explicit approval.
- **Always caveman mode** for chat (see `CLAUDE.md`); normal prose for code/commits.

## 7. Open decisions for you
1. **Dependencies:** zero-dep vanilla (recommended) or grant an allowlist?
2. **Build agent model:** which model should the browser-game dev agent run on?
3. **Pacing:** start Phase 1 now, or review/adjust the design first?
