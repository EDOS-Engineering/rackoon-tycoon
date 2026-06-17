# 🦝 Rackoon Tycoon — Backlog

> **Build your cloud empire. Tame the traffic.**
> AWS SAA-C03 study guide reborn as a browser game. **Factorio meets RollerCoaster Tycoon.**

**Status:** Phase 4 ✅ **complete.** Pre-Phase-5 fixes ✅ committed (`8718105`): AZ randomization, level win requirements, sandbox reinvestment slider. Phase 5 🔵 queued: typed connections. Stack: zero-dep vanilla.

## Progress log
- **2026-06-16 — Phase 1 shipped.** `/game` built: vanilla JS ES modules + Canvas, zero deps, ~3,040 LOC across 22 files. Title → level → results scenes; grid build palette; Factorio-style wiring; BFS request routing (gate → nearest DB sink → back); revenue/lost counters; budget gate; localStorage best score; procedural Rocky-the-raccoon art. Verified via `tooling/smoke.mjs` (Playwright, dev-only). Study guide rebranded to Rackoon Tycoon; README rewritten as project doc. Git history rebuilt clean (no AI attribution). **Pending:** rename working dir to `rackoon-tycoon` (held — deferred so it doesn't break an open editor/session).
- **2026-06-16 — Phase 2 shipped + tuned.** Added `economy/billing.js` + `economy/scoring.js`, `waves/{scheduler,load,events}.js`, `save/progress.js`; wired through `levelScene`, `resultsScene`, `titleScene`, `hud`, `levels`. Win/lose, 3-pillar star scoring, persistence/unlocks, campaign level-select, 3 levels (First Light / Rush Hour / When the Zone Goes Dark). **Post-playtest polish:** gentler bill (`rateDivisor` 60→130, transfer 0.04→0.015) + bigger budgets + ~25–30% slower spawn/wave rates; the round now stays paused on a **briefing** until the player clicks *Begin* (read + pre-build calmly); persistent 🎯 objective chip + an **H** help legend for clarity. Upgraded `tooling/smoke.mjs` asserts: briefing pauses the sim, a legal route flows guests, and the bill draws the budget down without bankrupting a sensible build.
- **2026-06-16 — Phase 4 complete (Sprint 4a–4d).** Audio: 8 procedural Web Audio sounds (place, wire, erase, spike, azFail, alert, win, lose). Exam tips on all 19 services + 8 levels (palette tooltip + grid tooltip + results screen). Sandbox mode (no win condition, 9999 budget) + title button. Particle burst on building placement; packet motion trail (3-step position history). → `engine/audio.js` (new), `catalog.js`, `levels.js`, `palette.js`, `levelScene.js`, `resultsScene.js`, `titleScene.js`, `packet.js`, `sprites.js`
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

### 🟠 PHASE 3 — Mechanics, AWS-sim depth & boss gaps (Sprint 3)

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
- [ ] T3.2 "Mesh vs Bridge" — deferred to Phase 5 (requires typed connections).
- [x] T3.3 "Replay or It's Gone" — Kinesis Streams (replayable) vs Firehose (no-replay sink).
- [x] T3.4 "Single Writer's Burden" — Aurora SV2 (vertical auto-scale) vs Limitless (horizontal).
- [x] T3.5 "Raccoons at the Gate" — DDoS traffic spikes; place Shield/WAF/CloudFront.
- [x] T3.6 "When the Zone Goes Dark" — shipped Phase 2; updated with RDS Multi-AZ tip in briefing.

**Sprint 3d — Teaching layer**
- [ ] T3.7 In-level teaching cards + post-level "exam tip" tie-back to the study guide.

> **End of Phase 3:** difficulty + diagonal/typed connections + a broader AWS
> catalog + the gap-mapped boss levels. Each sub-sprint commits independently.

### ✅ PHASE 4 — Polish (Sprint 4) — COMPLETE

**Sprint 4 — Juice & ship**
- [x] T4.1 Particle burst on building placement + packet motion trail. → `levelScene.js`, `packet.js`, `sprites.js`
- [x] T4.2 Audio (Web Audio API): place/wire/erase/alert/spike/azFail/win/lose sfx — procedurally synthesized, zero deps. → `engine/audio.js`, `levelScene.js`, `resultsScene.js`
- [x] T4.3 Exam tips: `examTip` on all 19 services + all 7 levels; shown in palette tooltip, grid building tooltip, and results screen. → `catalog.js`, `levels.js`, `palette.js`, `levelScene.js`, `resultsScene.js`
- [x] T4.4 Sandbox mode (no win condition, 9999 budget, 20×12 grid) + dedicated title-screen button. → `levels.js`, `titleScene.js`, `levelScene.js`
- [ ] T4.5 ~~Accessibility (keyboard, colorblind-safe palette)~~ **— DEPRECATED** (descoped from this Epoch per request). Perf pass + cross-browser check only.
- [ ] T4.6 Final QA, README for the game, link study guide ↔ game.

> **End of Phase 4:** complete, polished, shippable. Final commit.

### 🔵 PHASE 5 — Deep networking layer (deferred)

**Sprint 5 — Typed connections & VPC topology**
- [ ] T5.1 **Typed connections** — edges gain a *type* mapping to a real AWS
      networking construct, each with distinct visuals + gameplay effects:
      plain VPC link, Gateway VPC Endpoint (near-zero data-transfer cost),
      PrivateLink, Transit Gateway, Direct Connect, VPC Peering.
      Connection-type picker in the build bar.
      → `grid.js`, `gridRenderer`, `ui/palette`, `economy/billing`, `levelScene`
- [ ] T5.2 Per-type topology rules — tighten `canConnect` and billing per connection
      type (e.g. Gateway Endpoint only valid Gate/S3 or Gate/DynamoDB pairs,
      Direct Connect only valid with on-prem/partner zones added in 3b).

> **End of Phase 5:** the wire layer becomes a real VPC networking sim.

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
