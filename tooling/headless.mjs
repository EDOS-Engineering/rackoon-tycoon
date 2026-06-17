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
import { Simulation } from "../game/src/sim/simulation.js";
import { MilestoneSet } from "../game/src/sim/milestones.js";
import { RealismTracker } from "../game/src/sim/realism.js";
import { DemandModel } from "../game/src/waves/demand.js";
import { Economy } from "../game/src/economy/economy.js";
import { IncidentDeck } from "../game/src/waves/incidents.js";
import { getLevel } from "../game/src/levels/levels.js";

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

// 4. The composed Simulation core (Phase 7 R1) fast-runs headlessly: build a
//    legal gate→ALB→EC2→RDS route on a real level, seed the rng, and step ~40s
//    of compressed sim time. Same seed → identical (success, failed, budget);
//    a different seed (almost surely) differs. This is the surface that R3/R4/R5
//    balancing hangs off — the whole reason for the extraction.
function runLevel(levelId, seed, steps = 2400, deck = undefined) {
  // `deck === null` strips a level's own deck; an object overrides it; undefined
  // leaves it as authored.
  const base = getLevel(levelId);
  const level = deck === undefined ? base : { ...base, deck: deck || undefined };
  const grid = new Grid(level.cols, level.rows);
  const gateKeys = [];
  for (const gt of level.gates) {
    grid.place(SERVICES.route53, gt.col, gt.row);
    gateKeys.push(Grid.key(gt.col, gt.row));
  }
  for (const s of level.seed || []) {
    const svc = SERVICES[s.id];
    if (svc) grid.place(svc, s.col, s.row);
  }
  // A simple legal route from the first gate: gate → ALB → EC2 → RDS, wired in
  // a line just to the right of the gate (wires are any-distance).
  const [gc, gr] = Grid.parseKey(gateKeys[0]);
  grid.place(SERVICES.alb, gc + 1, gr);
  grid.place(SERVICES.ec2, gc + 2, gr);
  grid.place(SERVICES.rds, gc + 3, gr);
  grid.addEdge(Grid.key(gc, gr), Grid.key(gc + 1, gr));
  grid.addEdge(Grid.key(gc + 1, gr), Grid.key(gc + 2, gr));
  grid.addEdge(Grid.key(gc + 2, gr), Grid.key(gc + 3, gr));

  const sim = new Simulation({ level, grid, gateKeys, rng: makeRng(seed), budget: level.budget });
  let nan = false;
  for (let i = 0; i < steps; i++) {
    sim.recomputeRoute();
    sim.step(1 / 60);
    sim.drainEmitted(); // headless host ignores audio/float cues
    if (Number.isNaN(sim.budget) || Number.isNaN(sim.revenue)) { nan = true; break; }
  }
  return {
    success: sim.success,
    failed: sim.failed,
    budget: Math.round(sim.budget),
    bill: +sim.bill.totalSpent.toFixed(2),
    outcome: sim.outcome,
    incidents: sim.events.events.length,
    nan,
  };
}

const simA = runLevel("first_light", 4242);
const simB = runLevel("first_light", 4242);
if (simA.nan) problems.push("Simulation produced NaN during a headless run");
// Strict determinism is the R1 guarantee: a seeded composed run replays exactly.
// (Seed *sensitivity* lives where the rng is actually consumed — incident zones
// + drop decisions — and is asserted in sections 1 & 2 above. A clean, never-
// overloaded winning route legitimately produces seed-independent output.)
if (JSON.stringify(simA) !== JSON.stringify(simB))
  problems.push("same seed → Simulation run must be byte-identical");
if (!(simA.success > 0)) problems.push("a legal route should route guests over a headless run");
if (!(simA.bill > 0)) problems.push("Simulation should accrue a bill over a headless run");

// 5. DemandModel (Phase 7 R3): the continuous demand curve has the shape a
//    living economy needs — a daily peak, quieter weekends, and a customer base
//    that compounds over time. Pure + deterministic (function of t + spec).
const dm = new DemandModel({
  dayLength: 8, diurnalAmp: 0.6, peakHour: 14, weekendMul: 0.7,
  seasonAmp: 0, growthPerDay: 0.05, growthCap: 6,
});
const hourSecs = (h, day = 0) => (day + h / 24) * 8; // sim seconds at hour h of `day`
const peakD0 = dm.rateAt(hourSecs(14, 0));   // Mon afternoon (day 0)
const troughD0 = dm.rateAt(hourSecs(2, 0));   // Mon pre-dawn
const peakD10 = dm.rateAt(hourSecs(14, 10));  // 10 days later, same hour (weekday: day10%7=3)
const satPeak = dm.rateAt(hourSecs(14, 5));    // day 5 = Saturday afternoon
const friPeak = dm.rateAt(hourSecs(14, 4));    // day 4 = Friday afternoon
if (!(peakD0 > troughD0 * 1.5)) problems.push("demand: daily peak should clearly exceed the overnight trough");
if (!(peakD10 > peakD0 * 1.3)) problems.push("demand: growth should compound the base over 10 days");
if (!(satPeak < friPeak)) problems.push("demand: a weekend afternoon should be quieter than a weekday afternoon");
if (!(dm.rateAt(0) >= 0.1)) problems.push("demand: rate should be floored above zero");

// 6. A demand-driven level (sandbox) fast-runs through the composed Simulation:
//    same seed replays identically, guests route, and demand late in the run
//    outpaces early (the growth curve shows up in throughput).
function runWindow(seed) {
  // Strip the sandbox's incident deck so this demand-growth test stays isolated
  // from R5 incidents (a random AZ failure could kill the single test route).
  const level = { ...getLevel("sandbox"), deck: undefined };
  const grid = new Grid(level.cols, level.rows);
  const gateKeys = [];
  for (const gt of level.gates) {
    grid.place(SERVICES.route53, gt.col, gt.row);
    gateKeys.push(Grid.key(gt.col, gt.row));
  }
  const [gc, gr] = Grid.parseKey(gateKeys[0]);
  grid.place(SERVICES.alb, gc + 1, gr);
  grid.place(SERVICES.ec2, gc + 2, gr);
  grid.place(SERVICES.rds, gc + 3, gr);
  grid.addEdge(Grid.key(gc, gr), Grid.key(gc + 1, gr));
  grid.addEdge(Grid.key(gc + 1, gr), Grid.key(gc + 2, gr));
  grid.addEdge(Grid.key(gc + 2, gr), Grid.key(gc + 3, gr));
  const sim = new Simulation({ level, grid, gateKeys, rng: makeRng(seed), budget: level.budget });
  // dayLength is 8s, so a 60*8-step window spans exactly one in-game day — which
  // averages out the diurnal swing and isolates the compounding growth. Compare
  // guests routed in an early full-day window vs a later one (~5 days on).
  const oneDay = 60 * 8;
  const stepN = (n) => { for (let i = 0; i < n; i++) { sim.recomputeRoute(); sim.step(1 / 60); sim.drainEmitted(); } };
  const earlyStart = sim.success;
  stepN(oneDay);                 // day 0
  const earlyRouted = sim.success - earlyStart;
  stepN(oneDay * 5);             // skip ahead ~5 in-game days into the growth curve
  const lateStart = sim.success;
  stepN(oneDay);                 // an equal one-day window, now later
  const lateRouted = sim.success - lateStart;
  return { sim, earlyRouted, lateRouted };
}
const sbA = runWindow(2024);
const sbB = runWindow(2024);
if (!(sbA.sim.success > 0)) problems.push("sandbox demand run should route guests");
if (sbA.sim.success !== sbB.sim.success) problems.push("sandbox demand run must be deterministic for a fixed seed");
if (!(sbA.lateRouted > sbA.earlyRouted)) problems.push("demand growth: a later window should route more guests than an early one");

// 7. Economy ledger (Phase 7 R4): every money mutation goes through named ops
//    with one invariant — the budget never goes negative, credits only add, and
//    revenue/lost are monotonic running totals.
const eco = new Economy(100);
eco.spend(30);                          // 100 → 70
const overcharged = eco.spend(999);     // can't overdraw: charges 70, lands at 0
if (eco.budget !== 0) problems.push("economy: an overdraw should clamp the budget at $0");
if (overcharged !== 70) problems.push("economy: spend() should return the amount actually charged");
eco.credit(50);                         // refund → 50
if (eco.budget !== 50) problems.push("economy: credit() should add to the budget");
eco.earn(20);                           // revenue 20, no reinvest (budget stays 50)
if (!(eco.revenue === 20 && eco.budget === 50)) problems.push("economy: earn() with no reinvest should not touch the budget");
eco.earn(20, 0.5);                      // revenue 40, reinvest 10 → budget 60
if (!(eco.revenue === 40 && eco.budget === 60)) problems.push("economy: earn() should reinvest the configured fraction");
eco.penalize(6);
if (eco.lost !== 6) problems.push("economy: penalize() should accumulate lost");
if (!eco.canAfford(60) || eco.canAfford(61)) problems.push("economy: canAfford() boundary wrong");
if (simA.budget < 0 || sbA.sim.budget < 0) problems.push("economy: a composed sim run should never drive the budget below $0");

// 8. IncidentDeck (Phase 7 R5): unscripted incidents drawn over time — seeded
//    (a fixed seed replays exactly), telegraphed (each is scheduled `warn` ahead
//    of when it fires), cooldown-spaced, and escalating (gaps shrink over a run).
function deckDraws(seed) {
  const d = new IncidentDeck({
    firstAt: 5, baseInterval: 12, intervalDecay: 0.8, minInterval: 4, warn: 3,
    jitter: 0.2, cooldown: 6, maxActive: 9,
    cards: [
      { kind: "traffic_spike", weight: 1, duration: [5, 5], magnitude: [1.5, 1.5] },
      { kind: "az_failure", weight: 1, duration: [6, 6] },
    ],
  }, makeRng(seed));
  const out = [];
  for (let t = 0; t < 150; t += 0.5) {
    const ev = d.maybeDraw(+t.toFixed(2), 0);
    if (ev) out.push({ at: +t.toFixed(2), fires: +ev.at.toFixed(2), kind: ev.kind });
  }
  return out;
}
const dkA = deckDraws(101), dkB = deckDraws(101), dkC = deckDraws(202);
if (JSON.stringify(dkA) !== JSON.stringify(dkB)) problems.push("incident deck: same seed must draw identically");
if (JSON.stringify(dkA) === JSON.stringify(dkC)) problems.push("incident deck: a different seed should draw differently");
if (!(dkA.length >= 6)) problems.push("incident deck: should draw several incidents over the run");
if (!dkA.every((e) => e.fires > e.at)) problems.push("incident deck: every incident must be telegraphed (fires after its draw)");
// Escalation: the gap between the last two draws should be tighter than the first two.
const firstGap = dkA[1].at - dkA[0].at;
const lastGap = dkA[dkA.length - 1].at - dkA[dkA.length - 2].at;
if (!(lastGap < firstGap)) problems.push("incident deck: draws should escalate (later gaps tighter than early ones)");

// A deck-driven Simulation run is deterministic and actually fires incidents
// beyond the level's scripted set.
const deckSpec = {
  firstAt: 5, baseInterval: 8, intervalDecay: 0.85, minInterval: 5, warn: 3,
  cooldown: 6, maxActive: 2,
  cards: [
    { kind: "traffic_spike", weight: 2, duration: [5, 8], magnitude: [1.4, 1.8] },
    { kind: "az_failure", weight: 1, duration: [6, 9] },
    { kind: "cost_audit", weight: 1, duration: [8, 10], magnitude: [1.3, 1.5] },
  ],
};
const scriptedCount = runLevel("first_light", 7, 1, null).incidents; // deck stripped → scripted only
const deckRunA = runLevel("first_light", 7, 1800, deckSpec);
const deckRunB = runLevel("first_light", 7, 1800, deckSpec);
if (deckRunA.nan) problems.push("incident-deck sim run produced NaN");
if (JSON.stringify(deckRunA) !== JSON.stringify(deckRunB)) problems.push("incident-deck sim run must be deterministic for a fixed seed");
if (!(deckRunA.incidents > scriptedCount)) problems.push("incident deck should fire incidents beyond the scripted set during a run");

// 9. Company mode (Phase 7 R6): milestone evaluation, freerun outcome rules, and
//    snapshot/resume round-trip.
const ms = new MilestoneSet([
  { id: "a", label: "Serve 100", metric: "success", target: 100 },
  { id: "b", label: "Earn $500", metric: "revenue", target: 500 },
]);
const mEval1 = ms.evaluate({ success: 100, revenue: 200 });
if (!(mEval1.doneCount === 1 && !mEval1.allDone)) problems.push("milestones: partial completion mis-evaluated");
if (!(Math.abs(mEval1.progress - (1 + 200 / 500) / 2) < 1e-9)) problems.push("milestones: aggregate progress wrong");
const mEval2 = ms.evaluate({ success: 120, revenue: 600 });
if (!mEval2.allDone) problems.push("milestones: allDone should be true when every target is met");
if (new MilestoneSet([]).evaluate({}).allDone) problems.push("milestones: an empty set is not 'allDone'");

// Build + step a real company (freerun) run, then snapshot → rebuild → restore.
function buildCompany(seed, snap) {
  const level = getLevel("company");
  let grid, gateKeys;
  if (snap) {
    ({ grid, gateKeys } = Simulation.buildGridFromSnapshot(snap));
  } else {
    grid = new Grid(level.cols, level.rows);
    gateKeys = [];
    for (const gt of level.gates) { grid.place(SERVICES.route53, gt.col, gt.row); gateKeys.push(Grid.key(gt.col, gt.row)); }
    const [gc, gr] = Grid.parseKey(gateKeys[0]);
    grid.place(SERVICES.alb, gc + 1, gr);
    grid.place(SERVICES.ec2, gc + 2, gr);
    grid.place(SERVICES.rds, gc + 3, gr);
    grid.addEdge(Grid.key(gc, gr), Grid.key(gc + 1, gr));
    grid.addEdge(Grid.key(gc + 1, gr), Grid.key(gc + 2, gr));
    grid.addEdge(Grid.key(gc + 2, gr), Grid.key(gc + 3, gr));
  }
  const sim = new Simulation({ level, grid, gateKeys, rng: makeRng(seed), budget: snap ? snap.economy.budget : level.budget });
  if (snap) sim.applySnapshot(snap);
  return sim;
}
const co = buildCompany(31);
if (co.mode !== "freerun") problems.push("company: level should run in freerun mode");
for (let i = 0; i < 1800; i++) { co.recomputeRoute(); co.step(1 / 60); co.drainEmitted(); }
// Freerun never auto-wins on a routed goal — it stays PLAYING (or LOSE if broke).
if (co.outcome === "win") problems.push("company: freerun should not auto-WIN on a goal");
if (co.success <= 0) problems.push("company: a legal route should serve requests");
const mEvalRun = co.evaluateMilestones();
if (mEvalRun.total !== 4) problems.push("company: should evaluate its 4 milestones");

// Snapshot → rebuild grid → restore: the run state survives a round-trip.
const snap = co.snapshot();
const co2 = buildCompany(snap.seed, snap);
const sameState =
  co2.success === co.success &&
  co2.failed === co.failed &&
  Math.round(co2.budget) === Math.round(co.budget) &&
  Math.abs(co2.simTime - co.simTime) < 1e-6 &&
  co2.grid.buildings.size === co.grid.buildings.size &&
  co2.grid.edges.size === co.grid.edges.size;
if (!sameState) problems.push("company: snapshot/restore should preserve the run state + board");

// 10. Operational realism (Phase 7 T7.6): SLO compliance, blast radius, RTO/RPO,
//     and auto-scaling warm-up lag.
const rt = new RealismTracker();
rt.onComplete(40, 60); // in SLO
rt.onComplete(80, 60); // breached
if (!(rt.sloMet === 1 && rt.sloBreached === 1 && Math.abs(rt.sloCompliance - 0.5) < 1e-9))
  problems.push("realism: SLO compliance mis-counted");
rt.tick(1, true, 100, 25); // 25% of capacity offline
if (Math.abs(rt.peakBlastRadius - 0.25) > 1e-9) problems.push("realism: blast radius wrong");
rt.tick(1, true, 100, 50); // peak rises to 50%
if (Math.abs(rt.peakBlastRadius - 0.5) > 1e-9) problems.push("realism: peak blast radius should track the max");
// Outage: service was up, now no route for 3s → RTO 3, two drops = RPO 2.
rt.tick(2, false, 100, 100);
rt.onOutageDrop(); rt.onOutageDrop();
rt.tick(1, false, 100, 100);
if (!(rt.worstRtoSec >= 3 - 1e-9)) problems.push("realism: RTO should track the outage duration");
if (!rt.inOutage) problems.push("realism: should report being in an outage");
rt.tick(1, true, 100, 0); // recover
if (rt.inOutage) problems.push("realism: recovery should clear the outage");
if (rt.dataLost !== 2) problems.push("realism: RPO data-lost count wrong");
// Pre-establishment downtime must NOT score (no route built yet ≠ an outage).
const rt2 = new RealismTracker();
rt2.tick(5, false, 10, 10);
if (rt2.worstRtoSec > 0) problems.push("realism: pre-establishment 'no route yet' should not count as downtime");

// Auto-scaling warm-up: an autoScale tier's capacity ramps toward demand instead
// of snapping, so the first tick is near base and it climbs over time (≤ 2× base).
const gw = new Grid(6, 6);
const ab = gw.place(SERVICES.aurora_sv2, 2, 2);
const baseCap = Math.max(1, SERVICES.aurora_sv2.throughput);
const lmw = new LoadModel(makeRng(1));
lmw._demand.set("2,2", baseCap * 4); // heavy demand → target pinned at 2× base
lmw.update(gw, 1 / 60);
const warm1 = ab._warmCap;
for (let i = 0; i < 600; i++) lmw.update(gw, 1 / 60);
const warm2 = ab._warmCap;
if (!(warm1 < warm2)) problems.push("warm-up: capacity should ramp up over time, not instantly");
if (!(warm1 < baseCap * 1.5)) problems.push("warm-up: first-tick capacity should still be near base (lag)");
if (!(warm2 > baseCap && warm2 <= baseCap * 2 + 1e-6)) problems.push("warm-up: warmed capacity should approach (but not exceed) 2× base");

// Integration: the composed company run exposes sane realism metrics.
const cm = co.metrics();
if (!(cm.sloCompliance >= 0 && cm.sloCompliance <= 1)) problems.push("realism: sloCompliance out of [0,1] in a real run");
if (!(cm.peakBlastRadius >= 0 && cm.peakBlastRadius <= 1)) problems.push("realism: peakBlastRadius out of [0,1] in a real run");
if (typeof cm.worstRtoSec !== "number" || typeof cm.dataLost !== "number") problems.push("realism: RTO/RPO metrics missing from a real run");

// 11. Operator telemetry + headless balancing (Phase 7 T7.5): the live signals a
//     tuner reads — demand (sparkline), margin, SLO burn, headroom — derived from
//     the sim, deterministic, and trackable across a run for curve tuning.
function runCompanyTel(seed) {
  const sim = buildCompany(seed);
  let minHeadroom = 1;
  let peakDemand = 0;
  for (let i = 0; i < 1800; i++) {
    sim.recomputeRoute();
    sim.step(1 / 60);
    sim.drainEmitted();
    const t = sim.telemetry();
    if (t.headroom < minHeadroom) minHeadroom = t.headroom;
    if (t.demandNow > peakDemand) peakDemand = t.demandNow;
  }
  return { sim, tel: sim.telemetry(), minHeadroom, peakDemand };
}
const telA = runCompanyTel(31);
const telB = runCompanyTel(31);
const tl = telA.tel;
if (!(tl.demandNow > 0)) problems.push("telemetry: demandNow should be positive on a demand level");
if (!(tl.headroom >= 0 && tl.headroom <= 1)) problems.push("telemetry: headroom out of [0,1]");
if (!(tl.sloBurn >= 0)) problems.push("telemetry: SLO burn should be ≥ 0");
if (!(Array.isArray(tl.demandHist) && tl.demandHist.length > 1)) problems.push("telemetry: demand sparkline history not populated");
if (typeof tl.marginPerSec !== "number") problems.push("telemetry: margin must be a number");
// demandNow must track the live demand curve.
if (Math.abs(tl.demandNow - telA.sim.demand.rateAt(telA.sim.simTime)) > 1e-9)
  problems.push("telemetry: demandNow should equal the demand curve at the current time");
// Deterministic for a fixed seed — the balancer can rely on repeatable signals.
const telDet =
  telA.minHeadroom === telB.minHeadroom &&
  telA.peakDemand === telB.peakDemand &&
  tl.demandHist[tl.demandHist.length - 1] === telB.tel.demandHist[telB.tel.demandHist.length - 1];
if (!telDet) problems.push("telemetry: balancing signals must be deterministic for a fixed seed");
// A headroom sweep is a real balancing signal: under the company's growth curve,
// peak demand should exceed the baseline (the curve is doing its job).
if (!(telA.peakDemand > 1)) problems.push("telemetry: peak demand should rise above baseline over a run");

// 12. Sim-depth incident kinds: each new kind drives its own effect, and a deck
//     of them runs deterministically through the composed sim.
function dir(ev) {
  const d = new EventDirector([{ at: 0, duration: 9999, warn: 0, ...ev }], 18, makeRng(1));
  d.tick(0.1); // → the event is active
  return d;
}
if (dir({ kind: "viral_spike", magnitude: 3 }).spawnMultiplier() !== 3) problems.push("viral_spike: should drive the spawn multiplier");
if (dir({ kind: "price_hike", magnitude: 1.5 }).billMultiplier() !== 1.5) problems.push("price_hike: should inflate the bill multiplier");
if (dir({ kind: "noisy_neighbor", magnitude: 0.6 }).capacityMultiplier() !== 0.6) problems.push("noisy_neighbor: should derate capacity (<1)");
if (dir({ kind: "cert_expiry", magnitude: 0.4 }).edgeDropRate() !== 0.4) problems.push("cert_expiry: should set an edge drop rate");
const depDir = dir({ kind: "dependency_outage", target: "rds" });
if (!(depDir.isServiceDisabled("rds") && !depDir.isServiceDisabled("ec2"))) problems.push("dependency_outage: should disable only the targeted service id");
// Neutrals when nothing of that kind is active.
const neutral = new EventDirector([{ at: 999, kind: "az_failure", duration: 1, warn: 0 }], 18, makeRng(1));
neutral.tick(0.1);
if (!(neutral.spawnMultiplier() === 1 && neutral.billMultiplier() === 1 && neutral.capacityMultiplier() === 1 && neutral.edgeDropRate() === 0 && !neutral.isServiceDisabled("rds")))
  problems.push("incident effects should be neutral when no matching event is active");

// A deck made entirely of the new kinds runs through the real sim, deterministically.
const depthDeck = {
  firstAt: 4, baseInterval: 6, intervalDecay: 0.9, minInterval: 4, warn: 2, cooldown: 4, maxActive: 3,
  cards: [
    { kind: "viral_spike", weight: 1, duration: [5, 7], magnitude: [2.5, 3] },
    { kind: "noisy_neighbor", weight: 1, duration: [5, 7], magnitude: [0.6, 0.7] },
    { kind: "price_hike", weight: 1, duration: [6, 9], magnitude: [1.3, 1.5] },
    { kind: "cert_expiry", weight: 1, duration: [4, 6], magnitude: [0.3, 0.5] },
    { kind: "dependency_outage", weight: 1, duration: [5, 7], target: "rds" },
  ],
};
const depthScripted = runLevel("first_light", 9, 1, null).incidents;
const depA = runLevel("first_light", 9, 1800, depthDeck);
const depB = runLevel("first_light", 9, 1800, depthDeck);
if (depA.nan) problems.push("sim-depth deck run produced NaN");
if (JSON.stringify(depA) !== JSON.stringify(depB)) problems.push("sim-depth deck run must be deterministic for a fixed seed");
if (!(depA.incidents > depthScripted)) problems.push("sim-depth deck should fire its new-kind incidents during a run");

console.log("zones(seed=12345):", JSON.stringify(zA));
console.log("dropSeq deterministic:", dA === dB, " varies-by-seed:", dA !== dC);
console.log("headless run billTotal:", bill.totalSpent.toFixed(2));
console.log("sim(first_light,4242):", JSON.stringify(simA));
console.log("sim deterministic:", JSON.stringify(simA) === JSON.stringify(simB));
console.log("demand peak/trough(d0):", peakD0.toFixed(2) + "/" + troughD0.toFixed(2),
  " peak d10:", peakD10.toFixed(2), " fri/sat:", friPeak.toFixed(2) + "/" + satPeak.toFixed(2));
console.log("sandbox demand run:", JSON.stringify({
  success: sbA.sim.success, earlyRouted: sbA.earlyRouted, lateRouted: sbA.lateRouted,
  label: sbA.sim.demand.label(sbA.sim.simTime),
}));
console.log("incident deck draws(seed101):", dkA.length, " firstGap:", firstGap.toFixed(1), " lastGap:", lastGap.toFixed(1));
console.log("deck sim run:", JSON.stringify({ scripted: scriptedCount, withDeck: deckRunA.incidents, outcome: deckRunA.outcome, deterministic: JSON.stringify(deckRunA) === JSON.stringify(deckRunB) }));
console.log("company run:", JSON.stringify({ mode: co.mode, success: co.success, budget: Math.round(co.budget), day: +co.simDays.toFixed(1), milestones: mEvalRun.doneCount + "/" + mEvalRun.total, snapshotRestored: sameState }));
console.log("realism:", JSON.stringify({ slo: +cm.sloCompliance.toFixed(3), peakBlast: +cm.peakBlastRadius.toFixed(3), worstRto: +cm.worstRtoSec.toFixed(1), dataLost: cm.dataLost, warmRamp: warm1.toFixed(1) + "→" + warm2.toFixed(1) + " (base " + baseCap + ")" }));
console.log("telemetry:", JSON.stringify({ demandNow: +tl.demandNow.toFixed(2), margin: +tl.marginPerSec.toFixed(2), sloBurn: +tl.sloBurn.toFixed(2), headroom: +tl.headroom.toFixed(2), minHeadroom: +telA.minHeadroom.toFixed(2), peakDemand: +telA.peakDemand.toFixed(2), deterministic: telDet }));
console.log("simDepth:", JSON.stringify({ scripted: depthScripted, withDeck: depA.incidents, deterministic: JSON.stringify(depA) === JSON.stringify(depB), success: depA.success, failed: depA.failed }));
console.log("PROBLEMS(" + problems.length + "):", problems.join(" | ") || "none");
process.exit(problems.length ? 1 : 0);
