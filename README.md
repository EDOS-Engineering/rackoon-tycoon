# 🦝 Rackoon Tycoon

> **Build your cloud empire. Tame the traffic.**

Two things in one repo, both aimed at passing the **AWS Certified Solutions Architect – Associate (SAA-C03)** exam:

1. **A gap-focused study guide** — `index.html`, a single-page reference tuned for an experienced engineer. Skips the 101 material, targets **2023–2026 services** and the scenario traps that sink veterans.
2. **A browser game** — `game/`, the same material as a playable tycoon sim. Meet **Rocky**, a raccoon Site Reliability Engineer. **Factorio** belt-routing meets **RollerCoaster Tycoon** charm: googly-eyed AWS services, request "guests" flowing along wires from the front gate to a database and back.

Both are **zero-dependency**: pure HTML/CSS/vanilla-JS. No build step, no npm runtime packages, no CDN scripts, no network calls.

---

## Quick start

**Study guide** — just open the file:
```bash
open index.html        # macOS; or double-click it
```

**Game** — ES modules need an HTTP server (they won't load from `file://`):
```bash
python3 -m http.server 8000      # from the repo root
```
Then open **http://localhost:8000/game/game.html**
(Serving from the root also lets you open the study guide at `http://localhost:8000/index.html`.)

---

## The study guide (`index.html`)

Gap-driven SAA-C03 reference. Highlights:

- **🔴 Priority Gaps** — the specific weak spots surfaced in a gap interview, each with the trap, the correct answer, and a click-to-reveal self-quiz: Gateway VPC Endpoint vs NAT cost, VPC Lattice vs PrivateLink, Kinesis Streams vs Firehose, Aurora Limitless vs Serverless v2, Lambda-in-VPC networking, RCP resource ceiling, Cognito User vs Identity Pools, RDS cross-AZ cost fixes.
- **New services 2023–2026** — Bedrock, VPC Lattice, Verified Access, S3 Express One Zone, Aurora Limitless, Resource Control Policies, ElastiCache Serverless, Graviton4, Trainium2/Inferentia2, Q Business, Clean Rooms, DataZone, and more.
- **Domain-by-domain coverage** — compute, storage, database, networking, security, AI/ML, serverless, cost, migration — each with exam-trap callouts.
- **Comparison tables** — SQS/SNS/EventBridge/Kinesis, ECS/EKS/Fargate, DR strategies, S3 storage classes, IAM policy evaluation order.
- **Scenario patterns** and a **progress-tracked pre-exam checklist** (state saved to `localStorage`).

## The game (`game/`)

A grid builder + tower-defense routing sim. Place AWS service buildings, wire **Route 53 gate → compute → database**, and watch request guests flow. Completed round-trips earn revenue; dead-ended trips are lost. See **[`game/README.md`](game/README.md)** for full controls and architecture.

**Status: Phase 1 (playable core).** Economy/waves/win-lose (Phase 2), gap-mapped teaching puzzles (Phase 3), and the full juice/audio/accessibility pass (Phase 4) are planned — see **[`backlog.md`](backlog.md)**.

---

## Project structure

```
.
├── index.html        Study guide (single page, zero-dep)
├── game/             Rackoon Tycoon game (vanilla JS + Canvas)
│   ├── game.html     Game entry point
│   ├── README.md     Game controls + architecture
│   └── src/          Engine, grid, entities, services, scenes, UI
├── backlog.md        Game design + Sprints/Tasks/Phases roadmap
├── tooling/          Dev-only headless-browser smoke test (Playwright)
└── CLAUDE.md         Project rules
```

## Roadmap

| Phase | Scope | Status |
|------|-------|--------|
| 1 | Playable core: grid, build palette, wiring, request routing | ✅ done |
| 2 | Economy, AWS bill meter, traffic waves, win/lose | planned |
| 3 | Gap-mapped teaching levels (the Priority Gaps as boss puzzles) | planned |
| 4 | Theme art, audio, tutorial, accessibility, polish | planned |

Full task breakdown in [`backlog.md`](backlog.md).

## Development

The game ships with **zero runtime dependencies**. A dev-only smoke test under `tooling/` uses Playwright (headless Chromium) to load the game, capture console/page errors, and screenshot the title and level scenes:

```bash
python3 -m http.server 8000 &           # serve the repo
cd tooling && npm install               # one-time: installs Playwright
node smoke.mjs                          # loads the game, asserts no errors
```

`tooling/` is not part of the shipped game and does not affect its zero-dependency guarantee.
