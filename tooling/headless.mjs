// headless.mjs — Dev-only headless simulation harness (Phase 7, R2).
// Runs the pure sim modules directly under Node (no browser, no canvas) so the
// simulation can be fast-run and balanced deterministically. This is the test
// surface every later Phase-7 step (demand model, economy ledger, incident deck)
// hangs off. Run from the repo root:  node tooling/headless.mjs
//
// NOT shipped with the game; does not affect the zero-dependency guarantee.

import { makeRng } from "../game/src/sim/rng.js";
import { EventDirector } from "../game/src/waves/events.js";
import { LoadModel } from "../game/src/waves/load.js";
import { BillMeter } from "../game/src/economy/billing.js";
import { WaveScheduler } from "../game/src/waves/scheduler.js";
import { Grid } from "../game/src/grid/grid.js";
import { SERVICES } from "../game/src/services/catalog.js";

const problems = [];

// 1. Seeded EventDirector → deterministic AZ-failure zones; a different seed
//    (almost surely) differs. This is what makes a run reproducible.
function zones(seed) {
  const evs = Array.from({ length: 8 }, (_, i) => ({
    at: i * 5, kind: "az_failure", duration: 3, warn: 1,
  }));
  return new EventDirector(evs, 18, makeRng(seed)).events.map((e) => e.zone);
}
const zA = zones(12345), zB = zones(12345), zC = zones(99999);
if (JSON.stringify(zA) !== JSON.stringify(zB)) problems.push("same seed → EventDirector zones must match");
if (JSON.stringify(zA) === JSON.stringify(zC)) problems.push("different seed → zones should (almost surely) differ");

// 2. Seeded LoadModel.shouldDrop → deterministic boolean sequence.
function dropSeq(seed) {
  const g = new Grid(6, 6);
  const b = g.place(SERVICES.rds, 2, 2);
  b.dropping = true;
  b.queue = 24; // over tolerance → a non-trivial drop probability
  const lm = new LoadModel(makeRng(seed));
  let out = "";
  for (let i = 0; i < 64; i++) out += lm.shouldDrop(g, Grid.key(2, 2)) ? "1" : "0";
  return out;
}
const dA = dropSeq(7), dB = dropSeq(7), dC = dropSeq(8);
if (dA !== dB) problems.push("same seed → shouldDrop sequence must match");
if (dA === dC) problems.push("different seed → shouldDrop sequence should differ");
if (!/0/.test(dA) || !/1/.test(dA)) problems.push("shouldDrop sequence should be a mix (rng is flowing)");

// 3. Headless run sanity: a small board ticks for ~10s of sim time; the bill
//    accrues, the scheduler advances, no NaN anywhere.
const g = new Grid(10, 6);
g.place(SERVICES.route53, 0, 3);
g.place(SERVICES.ec2, 2, 3);
g.place(SERVICES.rds, 4, 3);
const bill = new BillMeter();
const sched = new WaveScheduler([{ name: "open", duration: 30, rate: 1 }]);
let nanSeen = false;
for (let i = 0; i < 600; i++) {
  const dt = 1 / 60;
  sched.tick(dt);
  const spend = bill.tick(dt, g);
  if (Number.isNaN(spend) || Number.isNaN(bill.totalSpent)) { nanSeen = true; break; }
}
if (nanSeen) problems.push("bill produced NaN during the headless run");
if (!(bill.totalSpent > 0)) problems.push("bill should accrue running cost over a run");

console.log("zones(seed=12345):", JSON.stringify(zA));
console.log("dropSeq deterministic:", dA === dB, " varies-by-seed:", dA !== dC);
console.log("headless run billTotal:", bill.totalSpent.toFixed(2));
console.log("PROBLEMS(" + problems.length + "):", problems.join(" | ") || "none");
process.exit(problems.length ? 1 : 0);
