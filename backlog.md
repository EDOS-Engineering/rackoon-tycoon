# 🦝 Rackoon Tycoon — Backlog

> **Build your cloud empire. Tame the traffic.**
> AWS SAA-C03 study guide reborn as a browser game. **Factorio meets RollerCoaster Tycoon.**

**Status:** Phase 2 ✅ **complete & tuned** — live AWS bill, wave scheduler, AZ-failure/traffic-spike/cost-audit events, per-building overload (queue→latency→drops), win/lose + 3-pillar star scoring, localStorage progress/unlocks, title-screen level select, and 3 campaign levels. Playtested + headless-verified (0 errors). Phase 3 (gap-puzzle boss levels) is next. Stack: zero-dep vanilla.

## Progress log
- **2026-06-16 — Phase 1 shipped.** `/game` built: vanilla JS ES modules + Canvas, zero deps, ~3,040 LOC across 22 files. Title → level → results scenes; grid build palette; Factorio-style wiring; BFS request routing (gate → nearest DB sink → back); revenue/lost counters; budget gate; localStorage best score; procedural Rocky-the-raccoon art. Verified via `tooling/smoke.mjs` (Playwright, dev-only). Study guide rebranded to Rackoon Tycoon; README rewritten as project doc. Git history rebuilt clean (no AI attribution). **Pending:** rename working dir to `rackoon-tycoon` (held — deferred so it doesn't break an open editor/session).
- **2026-06-16 — Phase 2 shipped + tuned.** Added `economy/billing.js` + `economy/scoring.js`, `waves/{scheduler,load,events}.js`, `save/progress.js`; wired through `levelScene`, `resultsScene`, `titleScene`, `hud`, `levels`. Win/lose, 3-pillar star scoring, persistence/unlocks, campaign level-select, 3 levels (First Light / Rush Hour / When the Zone Goes Dark). **Post-playtest polish:** gentler bill (`rateDivisor` 60→130, transfer 0.04→0.015) + bigger budgets + ~25–30% slower spawn/wave rates; the round now stays paused on a **briefing** until the player clicks *Begin* (read + pre-build calmly); persistent 🎯 objective chip + an **H** help legend for clarity. Upgraded `tooling/smoke.mjs` asserts: briefing pauses the sim, a legal route flows guests, and the bill draws the budget down without bankrupting a sensible build.

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

### 🟠 PHASE 3 — Learning puzzles / boss gaps (Sprint 3)

**Sprint 3 — Gap-mapped levels** (each teaches one Priority Gap)
- [ ] T3.1 "The Leaky Pipe" — NAT money-leak; fix with Gateway VPC Endpoint tile.
- [ ] T3.2 "Mesh vs Bridge" — internal Lattice mesh vs PrivateLink to an external partner zone.
- [ ] T3.3 "Replay or It's Gone" — Streams (replayable) vs Firehose (funnel-to-S3) under a data wave.
- [ ] T3.4 "Single Writer's Burden" — DB overload: auto-grow (v2) vs shard (Limitless).
- [ ] T3.5 "Raccoons at the Gate" — DDoS wave; place Shield/WAF/CloudFront.
- [ ] T3.6 "When the Zone Goes Dark" — AZ failure; Multi-AZ standby vs read replica.
- [ ] T3.7 In-level teaching cards + post-level "exam tip" tie-back.

> **End of Phase 3:** content-complete, teaches the gaps. Commit.

### 🔵 PHASE 4 — Polish (Sprint 4)

**Sprint 4 — Juice & ship**
- [ ] T4.1 Theme art pass: Factorio belts + RCT park dressing, animated packets, particle FX.
- [ ] T4.2 Audio (Web Audio): place/connect/alert/win sfx + ambient (if approved).
- [ ] T4.3 Tutorial/onboarding + tooltips for every service tile.
- [ ] T4.4 Sandbox/endless mode; difficulty settings.
- [ ] T4.5 Accessibility (keyboard, colorblind-safe palette), perf pass, cross-browser check.
- [ ] T4.6 Final QA, README for the game, link study guide ↔ game.

> **End of Phase 4:** complete, polished, shippable. Final commit.

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
