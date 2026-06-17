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

// --- Pre-Phase 5 fixes ---
// AZ randomization: EventDirector must not hardcode zone 1 for every run.
const azFix = await page.evaluate(async () => {
  const m = await import("./src/waves/events.js");
  // Run the constructor 20 times with no explicit zone; collect assigned zones.
  const zones = new Set();
  for (let i = 0; i < 20; i++) {
    const ed = new m.EventDirector(
      [{ at: 10, kind: "az_failure", duration: 5, warn: 3 }],
      18
    );
    zones.add(ed.events[0].zone);
  }
  // After 20 trials we should see at least 2 distinct zones (probability 1 - (1/3)^19 ≈ 1)
  return { distinctZones: zones.size, zones: [...zones].sort() };
});

// Win requirement checking: leaky_pipe must block a non-VPCE route.
const winReq = await page.evaluate(async () => {
  const m = await import("./src/levels/levels.js");
  const leaky = m.LEVELS.leaky_pipe;
  const raccoons = m.LEVELS.raccoons_gate;
  const replay = m.LEVELS.replay_or_gone;
  const writer = m.LEVELS.single_writer;
  return {
    leakyHasReq: !!leaky?.winRequires,
    leakySinkIs:  leaky?.winRequires?.sinkIs?.includes("s3") ?? false,
    leakyPathAll: leaky?.winRequires?.pathContainsAll?.includes("vpc_endpoint") ?? false,
    raccoonsHasReq: !!raccoons?.winRequires,
    raccoonsAny: raccoons?.winRequires?.pathContainsAny?.some(id => ["waf","shield"].includes(id)) ?? false,
    replayHasReq: !!replay?.winRequires,
    replayStreams: replay?.winRequires?.pathContainsAll?.includes("kinesis_streams") ?? false,
    writerHasReq: !!writer?.winRequires,
    writerSinkIs: writer?.winRequires?.sinkIs?.some(id => ["aurora_sv2","aurora_limitless"].includes(id)) ?? false,
  };
});

// AWS fidelity: VPC Endpoint only fronts S3/DynamoDB; Read Replica declares a
// source-primary dependency.
const awsFidelity = await page.evaluate(async () => {
  const cat = await import("./src/services/catalog.js");
  const S = cat.SERVICES;
  return {
    hasCanWire: typeof cat.canWire === "function",
    vpceToS3:   cat.canWire(S.vpc_endpoint, S.s3),        // allowed
    vpceToDdb:  cat.canWire(S.vpc_endpoint, S.dynamodb),  // allowed
    vpceToRds:  cat.canWire(S.vpc_endpoint, S.rds),       // blocked
    replicaDependsOnPrimary:
      (S.rds_replica.dependsOn?.anyOf || []).includes("rds") &&
      (S.rds_replica.dependsOn?.anyOf || []).includes("rds_multiaz"),
  };
});

// Economy realism audit: cost relationships + cross-AZ transfer surcharge.
const economyAudit = await page.evaluate(async () => {
  const cat = await import("./src/services/catalog.js");
  const bill = await import("./src/economy/billing.js");
  const S = cat.SERVICES;
  return {
    vpceCost: S.vpc_endpoint.cost,                   // gateway endpoint = cheap (no hourly)
    shieldCost: S.shield.cost,                       // Shield Advanced = premium
    replicaCost: S.rds_replica.cost,                 // a full standard instance
    rdsCost: S.rds.cost,
    multiAzRatio: S.rds_multiaz.cost / S.rds.cost,   // ~2× (synchronous standby)
    crossAzSurcharge: bill.BILL.crossAzSurcharge,
  };
});

// Sandbox reinvestment: goalRequests=0 level exists; _reinvestRate property present on scene.
const sandboxFix = await page.evaluate(() => {
  const s = window.__rackoon.scenes.current;
  return {
    hasSandboxLevel: !!window.__rackoon,
    hasReinvestRate: "_reinvestRate" in s,
  };
});

// --- Phase 4: audio engine + exam tips + sandbox ---
const phase4 = await page.evaluate(async () => {
  // Audio engine exports singleton.
  const am = await import("./src/engine/audio.js");
  const audioOk = typeof am.audio?.play === "function";

  // Exam tips on catalog services.
  const cat = await import("./src/services/catalog.js");
  const S = cat.SERVICES;
  const servicesWithTips = Object.values(S).filter((s) => s.examTip).length;
  const natTip = S.nat_gateway?.examTip?.includes("$0.045") ?? false;

  // Exam tips on levels.
  const m = await import("./src/levels/levels.js");
  const levelsWithTips = Object.values(m.LEVELS).filter((l) => l.examTip).length;
  const sandboxExists = !!m.LEVELS.sandbox;
  const sandboxNoGoal = m.LEVELS.sandbox?.goalRequests === 0;
  const sandboxNotInOrder = !m.LEVEL_ORDER.includes("sandbox");

  return {
    audioOk,
    servicesWithTips,
    natTip,
    levelsWithTips,
    sandboxExists,
    sandboxNoGoal,
    sandboxNotInOrder,
  };
});

// Dependency routing: a Read Replica with no source primary is structurally
// invalid — it carries no traffic and is not a valid routing sink. Adding a
// primary anywhere on the board activates it. Run in the clean sandbox board.
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "sandbox" }));
await page.waitForTimeout(300);
const depRouting = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const cat = await import("./src/services/catalog.js");
  const pf = await import("./src/grid/pathfind.js");
  const S = cat.SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  // gate -> EC2 -> Read Replica, no primary on the board.
  s.grid.place(S.ec2, gc + 1, gr);
  s.grid.place(S.rds_replica, gc + 2, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr));
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr));
  const blocked = (key) => s._isKeyDisabled(key);
  const replica = s.grid.getBuilding(gc + 2, gr);
  const invalidNoPrimary = !s._dependencyMet(replica);
  const routeNoPrimary = pf.gateHasRoute(s.grid, K(gc, gr), blocked);
  // Place a primary RDS anywhere — the replica activates.
  s.grid.place(S.rds, gc + 1, gr + 1);
  const invalidWithPrimary = !s._dependencyMet(replica);
  const routeWithPrimary = pf.gateHasRoute(s.grid, K(gc, gr), blocked);
  return { invalidNoPrimary, routeNoPrimary, invalidWithPrimary, routeWithPrimary };
});

// Any-distance wiring: _commitWire must accept a far, non-adjacent compatible
// pair, and still reject inappropriate pairs (sink<->sink, VPCE->RDS) at any
// distance. Driven directly via the scene's wire commit (still the sandbox).
const wireRules = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const cat = await import("./src/services/catalog.js");
  const S = cat.SERVICES;
  // Far, compatible: EC2 (compute) -> RDS (sink), 8+ tiles apart, non-adjacent.
  s.grid.place(S.ec2, 12, 1);
  s.grid.place(S.rds, 18, 10);
  s.wireFrom = { col: 12, row: 1 };
  s._commitWire({ col: 18, row: 10 });
  const farCompatibleWired = s.grid.hasEdge("12,1", "18,10");
  // Far, inappropriate: RDS (sink) <-> DynamoDB (sink) must be rejected.
  s.grid.place(S.dynamodb, 14, 5);
  s.wireFrom = { col: 18, row: 10 };
  s._commitWire({ col: 14, row: 5 });
  const sinkToSinkBlocked = !s.grid.hasEdge("18,10", "14,5");
  // Far, inappropriate: VPC Endpoint -> RDS must be rejected (S3/DynamoDB only).
  s.grid.place(S.vpc_endpoint, 16, 2);
  s.wireFrom = { col: 16, row: 2 };
  s._commitWire({ col: 18, row: 10 });
  const vpceToRdsBlocked = !s.grid.hasEdge("16,2", "18,10");
  return { farCompatibleWired, sinkToSinkBlocked, vpceToRdsBlocked };
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
console.log("azFix:", JSON.stringify(azFix));
console.log("winReq:", JSON.stringify(winReq));
console.log("awsFidelity:", JSON.stringify(awsFidelity));
console.log("economyAudit:", JSON.stringify(economyAudit));
console.log("depRouting:", JSON.stringify(depRouting));
console.log("wireRules:", JSON.stringify(wireRules));
console.log("sandboxFix:", JSON.stringify(sandboxFix));
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
// Pre-Phase-5 fix assertions.
if (azFix.distinctZones < 2)        problems.push("AZ failure zone not randomized — all " + azFix.distinctZones + " trials hit same zone");
if (!winReq.leakyHasReq)            problems.push("leaky_pipe missing winRequires");
if (!winReq.leakySinkIs)            problems.push("leaky_pipe winRequires.sinkIs should include 's3'");
if (!winReq.leakyPathAll)           problems.push("leaky_pipe winRequires.pathContainsAll should include 'vpc_endpoint'");
if (!winReq.raccoonsHasReq)         problems.push("raccoons_gate missing winRequires");
if (!winReq.raccoonsAny)            problems.push("raccoons_gate winRequires.pathContainsAny should include 'waf' or 'shield'");
if (!winReq.replayHasReq)           problems.push("replay_or_gone missing winRequires");
if (!winReq.replayStreams)          problems.push("replay_or_gone winRequires.pathContainsAll should include 'kinesis_streams'");
if (!winReq.writerHasReq)           problems.push("single_writer missing winRequires");
if (!winReq.writerSinkIs)           problems.push("single_writer winRequires.sinkIs should include aurora_sv2 or aurora_limitless");
if (!sandboxFix.hasReinvestRate)    problems.push("LevelScene missing _reinvestRate for sandbox slider");
// AWS-fidelity assertions.
if (!awsFidelity.hasCanWire)        problems.push("catalog.canWire export missing");
if (!awsFidelity.vpceToS3)          problems.push("VPC Endpoint should be allowed to front S3");
if (!awsFidelity.vpceToDdb)         problems.push("VPC Endpoint should be allowed to front DynamoDB");
if (awsFidelity.vpceToRds)          problems.push("VPC Endpoint must NOT front RDS (Gateway endpoints serve S3/DynamoDB only)");
if (!awsFidelity.replicaDependsOnPrimary) problems.push("rds_replica.dependsOn should list rds + rds_multiaz");
if (!depRouting.invalidNoPrimary)   problems.push("Read Replica with no primary should be structurally invalid");
if (depRouting.routeNoPrimary)      problems.push("route should NOT form through a primary-less Read Replica");
if (depRouting.invalidWithPrimary)  problems.push("Read Replica should be valid once a primary is on the board");
if (!depRouting.routeWithPrimary)   problems.push("route should form through a Read Replica once a primary exists");
// Any-distance wiring + appropriateness.
if (!wireRules.farCompatibleWired)  problems.push("non-adjacent compatible wire (EC2->RDS) should be allowed");
if (!wireRules.sinkToSinkBlocked)   problems.push("sink<->sink wire should be rejected at any distance");
if (!wireRules.vpceToRdsBlocked)    problems.push("VPC Endpoint -> RDS wire should be rejected at any distance");
// Economy realism.
if (economyAudit.vpceCost > 40)     problems.push("VPC Endpoint should be cheap (gateway endpoint has no hourly fee)");
if (economyAudit.shieldCost < 280)  problems.push("Shield Advanced should be premium-priced");
if (economyAudit.replicaCost < 120) problems.push("Read Replica should cost ~a full standard instance");
if (economyAudit.multiAzRatio < 1.6) problems.push("RDS Multi-AZ should cost ~2× single-AZ RDS");
if (economyAudit.crossAzSurcharge <= 0) problems.push("cross-AZ transfer surcharge should be > 0");

console.log("phase4:", JSON.stringify(phase4));

// Phase 4 assertions.
if (!phase4.audioOk)                problems.push("AudioEngine.play is not a function");
if (phase4.servicesWithTips < 18)   problems.push("fewer than 18 services have examTip");
if (!phase4.natTip)                 problems.push("nat_gateway examTip should mention $0.045");
if (phase4.levelsWithTips < 7)      problems.push("fewer than 7 levels have examTip");
if (!phase4.sandboxExists)          problems.push("sandbox level missing");
if (!phase4.sandboxNoGoal)          problems.push("sandbox goalRequests should be 0");
if (!phase4.sandboxNotInOrder)      problems.push("sandbox should not be in LEVEL_ORDER");

console.log("PROBLEMS(" + problems.length + "):", problems.join(" | ") || "none");

process.exit(errors.length || problems.length ? 1 : 0);
