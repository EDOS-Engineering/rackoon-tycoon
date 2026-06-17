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

A grid builder + tower-defense routing sim. Place AWS service buildings, wire **Route 53 gate → compute → database**, and watch request guests flow while a live AWS bill draws down your budget. Completed round-trips earn revenue; dead-ended trips are lost; escalating waves and incidents (AZ failures, traffic spikes, cost audits, Spot interruptions) test your design. See **[`game/README.md`](game/README.md)** for full controls and architecture.

**Status: feature-complete campaign.** **17 levels + an endless sandbox**, covering **every SAA-C03 exam domain** (Secure / Resilient / High-Performing / Cost-Optimized) — each boss level is a real architecture decision the exam tests. Highlights:

- **23 AWS services** across 6 build-palette tabs (Net, Compute, Data, DB, Msg, Security), each with stats + an exam tip.
- **Typed connections** — wires carry a real networking construct: **VPC link, VPC Peering, Transit Gateway, PrivateLink** — each with its own cost, topology rule, and **transitive-routing** behavior (peering is non-transitive; TGW is a transitive hub).
- **Realistic economy** — per-tile running cost + data-transfer billing modeled on AWS: intra-AZ free, **cross-AZ 8×**, NAT processing ×8, Gateway Endpoint ≈ free; cost audits inflate the bill.
- **Per-level win conditions** that enforce the lesson (reach S3 only via a Gateway Endpoint; serve reads from a Read Replica; buffer a spike through SQS; fan out via SNS; archive cold data to Glacier; buy steady compute Reserved, not On-Demand).
- **Difficulty tiers**, procedural audio (zero-dep Web Audio), particle/trail juice, a structural **dependency model** (a Read Replica needs its primary on the board), and exam-tip teaching cards before and after each level.

See **[`backlog.md`](backlog.md)** for the full phase history and what's next (multi-region DR, a secrets tile, perf/QA pass).

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
| 2 | Economy, AWS bill meter, traffic waves, win/lose, scoring | ✅ done |
| 3 | Difficulty tiers, diagonal/any-distance wiring, broad catalog, gap-mapped boss levels | ✅ done |
| 4 | Procedural audio, particles/trails, exam tips, sandbox mode | ✅ done |
| 5 | Typed connections (VPC / Peering / Transit Gateway / PrivateLink) + transitive routing | ✅ done |
| 6 | Full SAA-C03 curriculum coverage — boss levels for every exam domain (19 levels) | ✅ done |
| 7 | **Living simulation** — longer missions, time-varying demand, a compounding/fluctuating economy, a richer "unforeseen circumstances" incident deck, and a long-form "company" mode | 🔵 planned |
| 8 | **Grand pivot** — fork into a *visual AWS SDK client*: the canvas topology becomes real AWS resources read live via the SDK (read-only first), with a gated provisioning path | 🟣 vision |

**Where this is heading.** Phases 1–6 made a complete SAA-C03 exam-prep game. Phase 7 grows it into a real simulation of operating a living, growing AWS system over time — for distributed-systems designers, not just exam-takers. Phase 8 is the long-term pivot: fork the engine into a visual AWS SDK/API client that reads (and eventually drives) live cloud accounts. The Phase 8 write path is hard-gated on security + a real dependency on the AWS SDK — read-only and dry-run by default. Full task breakdown in [`backlog.md`](backlog.md).

## Development

The game ships with **zero runtime dependencies**. A dev-only smoke test under `tooling/` uses Playwright (headless Chromium) to load the game, capture console/page errors, and screenshot the title and level scenes:

```bash
python3 -m http.server 8000 &           # serve the repo
cd tooling && npm install               # one-time: installs Playwright
node smoke.mjs                          # loads the game, asserts no errors
```

`tooling/` is not part of the shipped game and does not affect its zero-dependency guarantee.
