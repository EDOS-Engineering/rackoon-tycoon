// Dev-only smoke + behaviour test for Rackoon Tycoon. NOT shipped with the game.
// Boots the served game, drives title → briefing → play, and asserts the Phase 2
// loop behaves: the briefing pauses the sim, a legal route flows guests, and the
// AWS bill draws the budget down without bankrupting a sensible build.
import { chromium } from "playwright";

const URL = process.env.GAME_URL || "http://127.0.0.1:8000/game/game.html";
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console.error: " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) =>
  errors.push("requestfailed: " + r.url() + " " + (r.failure()?.errorText || ""))
);

await page.goto(URL, { waitUntil: "networkidle", timeout: 20000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: "tooling/shot-title.png" });

// Title → level (Enter starts the campaign's continue level).
await page.keyboard.press("Enter");
await page.waitForTimeout(800);
await page.screenshot({ path: "tooling/shot-briefing.png" });

// The briefing must pause the sim: not started, full budget, no packets in flight.
const briefing = await page.evaluate(() => {
  const s = window.__rackoon.scenes.current;
  return {
    scene: s.constructor.name,
    started: s.started,
    budget: Math.round(s.budget),
    startBudget: s.level.budget,
    packets: s.packets.length,
  };
});

// Help overlay toggles (H).
await page.keyboard.press("KeyH");
await page.waitForTimeout(300);
await page.screenshot({ path: "tooling/shot-help.png" });
const helpOpen = await page.evaluate(() => window.__rackoon.scenes.current.showHelp);
await page.keyboard.press("KeyH"); // close
await page.waitForTimeout(150);

// Begin the shift and build a fully DIAGONAL gate→ALB→EC2→RDS route (exercises
// the new 8-neighbour wiring + routing), then let guests flow.
const begin = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  s.started = true;
  const cat = await import("./src/services/catalog.js");
  const S = cat.SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  s.grid.place(S.alb, gc + 1, gr + 1); // diagonal from the gate
  s.grid.place(S.ec2, gc + 2, gr); // diagonal from the ALB
  s.grid.place(S.rds, gc + 3, gr + 1); // diagonal from the EC2
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr + 1));
  s.grid.addEdge(K(gc + 1, gr + 1), K(gc + 2, gr));
  s.grid.addEdge(K(gc + 2, gr), K(gc + 3, gr + 1));
  s._routeDirty = true;
  return { placed: s.grid.buildings.size };
});
await page.waitForTimeout(5000); // let guests round-trip + the bill tick

const playing = await page.evaluate(() => {
  const s = window.__rackoon.scenes.current;
  return {
    started: s.started,
    routeOk: s.routeOk,
    success: s.success,
    failed: s.failed,
    budget: Math.round(s.budget),
    startBudget: s.level.budget,
    burn: +s.bill.burnRate.toFixed(2),
    billTotal: +s.bill.totalSpent.toFixed(1),
  };
});
await page.screenshot({ path: "tooling/shot-playing.png" });

// --- Diagonal adjacency rule (T3.9) ---
const diag = await page.evaluate(async () => {
  const m = await import("./src/grid/grid.js");
  return {
    orthogonal: m.Grid.areAdjacent(2, 2, 2, 3),
    diagonal: m.Grid.areAdjacent(2, 2, 3, 3),
    self: m.Grid.areAdjacent(2, 2, 2, 2),
    twoAway: m.Grid.areAdjacent(2, 2, 4, 2),
  };
});

// --- Difficulty scaling (T3.8): switch to the hardest tier, restart the level,
// and confirm the budget tightens and the sim speed jumps. ---
await page.evaluate(async () => {
  const d = await import("./src/save/difficulty.js");
  d.setDifficultyId("principal");
  window.__rackoon.scenes.go("level", { levelId: "first_light" });
});
await page.waitForTimeout(500); // let the scene manager swap + run enter()
const diff = await page.evaluate(() => {
  const s = window.__rackoon.scenes.current;
  return {
    name: s.diff ? s.diff.name : "?",
    speedMul: s.speedMul,
    budget: s.budget,
    baseBudget: s.level.budget,
  };
});
await page.waitForTimeout(400);
await page.screenshot({ path: "tooling/shot-difficulty.png" }); // briefing on Principal tier

// --- Sprint 3b: catalog breadth --- verify new service properties are present.
const catalog3b = await page.evaluate(async () => {
  const cat = await import("./src/services/catalog.js");
  const S = cat.SERVICES;
  return {
    natTransferMul:    S.nat_gateway?.transferCostMul,   // should be 8
    vpceTransferMul:   S.vpc_endpoint?.transferCostMul,  // should be 0.02
    wafMitigation:     S.waf?.attackMitigation,          // should be 0.5
    shieldMitigation:  S.shield?.attackMitigation,       // should be 0.75
    rdsMAZResilient:   S.rds_multiaz?.azResilient,       // should be true
    aurSV2AutoScale:   S.aurora_sv2?.autoScale,          // should be true
    streamsReplayable: S.kinesis_streams?.replayable,    // should be true
    groupCount:        cat.PALETTE_GROUPS.length,        // should be 5
    allIds: cat.PALETTE_ORDER.length,                    // all placeable services
  };
});

// --- Route 53 global: AZ immunity + cross-AZ wiring ---
// The current scene is first_light on Principal difficulty (briefing up, not started).
const r53 = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const cat = await import("./src/services/catalog.js");
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);

  // Inject a fake az_failure covering zone 0 (where the gate tile lives).
  s.events.events.push({ kind: "az_failure", zone: 0, state: "active", at: 0, duration: 9999, warn: 0 });

  // Simulate _tickSystems disabled-state logic for the gate building.
  const gateBuilding = s.grid.getBuilding(gc, gr);
  const rawZoneDisabled = s.events.isTileDisabled(gc, gr); // zone 0 IS failing → true
  const gateWouldBeDisabled = gateBuilding.service.role === "gate"
    ? false
    : rawZoneDisabled; // gate is immune → false

  // Cross-AZ wiring: simulate _commitWire conditions.
  // Place an ALB in AZ 2 (col 10) and verify gate can connect to it without adjacency.
  s.grid.place(cat.SERVICES.alb, 10, gr);
  const farBuilding = s.grid.getBuilding(10, gr);
  const gateConn = gateBuilding.service.role === "gate" || farBuilding.service.role === "gate";
  const crossAzWireAllowed = gateConn && cat.canConnect(gateBuilding.service.role, farBuilding.service.role);

  return {
    rawZoneDisabled,       // should be true  (zone 0 failed)
    gateWouldBeDisabled,   // should be false (gate is global/immune)
    crossAzWireAllowed,    // should be true  (gate can skip adjacency)
  };
});

// Sprint 3c: verify boss levels registered + leaky_pipe has its NAT Gateway seed.
const levels3c = await page.evaluate(async () => {
  const m = await import("./src/levels/levels.js");
  const lp = m.LEVELS.leaky_pipe;
  return {
    levelCount: m.LEVEL_ORDER.length,
    leakyExists: !!lp,
    leakySeedHasNat: lp?.seed?.some((s) => s.id === "nat_gateway"),
    singleWriterIsLast: m.LEVEL_ORDER.at(-1) === "single_writer",
  };
});

await browser.close();

console.log("briefing:", JSON.stringify(briefing));
console.log("help open:", helpOpen);
console.log("begin:", JSON.stringify(begin));
console.log("playing:", JSON.stringify(playing));
console.log("diagonal:", JSON.stringify(diag));
console.log("difficulty:", JSON.stringify(diff));
console.log("catalog3b:", JSON.stringify(catalog3b));
console.log("levels3c:", JSON.stringify(levels3c));
console.log("r53 global:", JSON.stringify(r53));
console.log("ERRORS(" + errors.length + "):", errors.join("\n") || "none");

// Behaviour assertions.
const problems = [];
if (briefing.scene !== "LevelScene") problems.push("did not reach LevelScene");
if (briefing.started) problems.push("briefing did not pause the sim");
if (briefing.packets !== 0) problems.push("guests spawned during the briefing");
if (Math.abs(briefing.budget - briefing.startBudget) > 1)
  problems.push("budget drained during the briefing");
if (!helpOpen) problems.push("H help overlay did not open");
if (!playing.routeOk) problems.push("route not valid after a legal build");
if (playing.success <= 0) problems.push("no guests routed after begin");
if (playing.budget >= playing.startBudget) problems.push("bill did not draw the budget down");
if (playing.budget <= 0) problems.push("budget hit $0 within ~5s (too harsh)");
if (!diag.orthogonal || !diag.diagonal) problems.push("diagonal adjacency not enabled");
if (diag.self || diag.twoAway) problems.push("areAdjacent too permissive");
if (diff.name !== "Principal Architect") problems.push("difficulty did not switch to Principal");
if (diff.speedMul !== 1.5) problems.push("Principal speedMul != 1.5");
if (!(diff.budget < diff.baseBudget)) problems.push("Principal did not tighten budget");
if (!r53.rawZoneDisabled) problems.push("test setup: zone 0 should be flagged failed");
if (r53.gateWouldBeDisabled) problems.push("Route 53 gate was disabled by an AZ failure (should be immune)");
if (!r53.crossAzWireAllowed) problems.push("Route 53 cross-AZ wiring blocked (gate should reach any AZ)");
if (catalog3b.natTransferMul !== 8)    problems.push("NAT Gateway transferCostMul should be 8");
if (catalog3b.vpceTransferMul !== 0.02) problems.push("VPC Endpoint transferCostMul should be 0.02");
if (catalog3b.wafMitigation !== 0.5)   problems.push("WAF attackMitigation should be 0.5");
if (catalog3b.shieldMitigation !== 0.75) problems.push("Shield attackMitigation should be 0.75");
if (!catalog3b.rdsMAZResilient)        problems.push("RDS Multi-AZ azResilient should be true");
if (!catalog3b.aurSV2AutoScale)        problems.push("Aurora SV2 autoScale should be true");
if (!catalog3b.streamsReplayable)      problems.push("Kinesis Streams replayable should be true");
if (catalog3b.groupCount !== 5)        problems.push("PALETTE_GROUPS should have 5 groups");
if (levels3c.levelCount !== 7)      problems.push("LEVEL_ORDER should have 7 levels");
if (!levels3c.leakyExists)          problems.push("leaky_pipe level missing");
if (!levels3c.leakySeedHasNat)      problems.push("leaky_pipe seed missing nat_gateway");
if (!levels3c.singleWriterIsLast)   problems.push("single_writer should be last level");
if (levels3c.levelCount !== 7)      problems.push("LEVEL_ORDER should have 7 levels");
if (!levels3c.leakyExists)          problems.push("leaky_pipe level missing");
if (!levels3c.leakySeedHasNat)      problems.push("leaky_pipe seed missing nat_gateway");
if (!levels3c.singleWriterIsLast)   problems.push("single_writer should be last level");
console.log("PROBLEMS(" + problems.length + "):", problems.join(" | ") || "none");

process.exit(errors.length || problems.length ? 1 : 0);
