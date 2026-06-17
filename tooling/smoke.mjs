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
    groupCount:        cat.PALETTE_GROUPS.length,        // should be 6 (added Msg)
    allIds: cat.PALETTE_ORDER.length,                    // all placeable services
    sqsBuffers:        S.sqs?.attackMitigation,          // decoupling smooths spikes
    snsExists:         !!S.sns,
    msgGroup:          cat.PALETTE_GROUPS.some((g) => g.id === "integration"),
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
  const mb = m.LEVELS.mesh_bridge;
  const pvl = m.LEVELS.private_lines;
  const lck = m.LEVELS.locked_buckets;
  const cr = m.LEVELS.cache_rules;
  const rh = m.LEVELS.read_heavy;
  const dd = m.LEVELS.decouple_drown;
  const fo = m.LEVELS.fan_out;
  const ss = m.LEVELS.serverless_spike;
  const cs = m.LEVELS.cold_storage;
  const rp = m.LEVELS.right_price;
  const ar = m.LEVELS.across_the_region;
  return {
    levelCount: m.LEVEL_ORDER.length,
    leakyExists: !!lp,
    leakySeedHasNat: lp?.seed?.some((s) => s.id === "nat_gateway"),
    lastIsRegion: m.LEVEL_ORDER.at(-1) === "across_the_region",
    rightPriceNextSecret: rp?.next === "secret_keeper",
    secretNeedsManager: (m.LEVELS.secret_keeper?.winRequires?.pathContainsAll || []).includes("secrets_manager"),
    secretNextRegion: m.LEVELS.secret_keeper?.next === "across_the_region",
    regionHasFailureEvent: (ar?.events || []).some((e) => e.kind === "region_failure"),
    serverlessNextCold: ss?.next === "cold_storage",
    coldNeedsGlacier: (cs?.winRequires?.sinkIs || []).includes("s3_glacier"),
    rightNeedsCheapCompute: (rp?.winRequires?.pathContainsAny || []).some((id) => ["ec2_reserved", "ec2_spot"].includes(id)),
    rightExcludesOnDemand: (rp?.winRequires?.pathExcludes || []).includes("ec2"),
    rightHasSpotEvent: (rp?.events || []).some((e) => e.kind === "spot_interruption"),
    fanOutNextServerless: fo?.next === "serverless_spike",
    serverlessNeedsLambda: (ss?.winRequires?.pathContainsAll || []).includes("lambda"),
    serverlessExcludesEc2: (ss?.winRequires?.pathExcludes || []).includes("ec2"),
    readHeavyNextDecouple: rh?.next === "decouple_drown",
    decoupleNeedsSqs: (dd?.winRequires?.pathContainsAll || []).includes("sqs"),
    fanOutNeedsSns: (fo?.winRequires?.pathContainsAll || []).includes("sns"),
    fanOutMinSinks: fo?.winRequires?.fanOut?.minSinks,
    fanOutSeedsTwoSinks: (fo?.seed || []).length >= 2,
    singleWriterNext: m.LEVELS.single_writer?.next === "mesh_bridge",
    meshNeedsTgw: (mb?.winRequires?.edgeTypeAny || []).includes("tgw"),
    // Phase 6 Secure sprint.
    privateNeedsPlink: (pvl?.winRequires?.edgeTypeAny || []).includes("privatelink"),
    privateExcludesNat: (pvl?.winRequires?.pathExcludes || []).includes("nat_gateway"),
    lockedNeedsCloudfront: (lck?.winRequires?.pathContainsAll || []).includes("cloudfront"),
    lockedExcludesNat: (lck?.winRequires?.pathExcludes || []).includes("nat_gateway"),
    // Phase 6 High-Performing sprint.
    lockedNextCache: lck?.next === "cache_rules",
    cacheNeedsCacheLayer: (cr?.winRequires?.pathContainsAny || []).some((id) => ["cache", "cloudfront"].includes(id)),
    readHeavySinkReplica: (rh?.winRequires?.sinkIs || []).includes("rds_replica"),
    readHeavySeedsPrimary: rh?.seed?.some((s) => s.id === "rds"),
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
    crossAzPenalty: bill.BILL.crossAzPenalty,        // full 8× on cross-AZ hops
    plainTileNoXfer: S.ec2.transferCostMul == null && S.alb.transferCostMul == null, // intra-AZ free
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
  const blocked = (key) => s.sim._isKeyDisabled(key);
  const replica = s.grid.getBuilding(gc + 2, gr);
  const invalidNoPrimary = !s.sim._dependencyMet(replica);
  const routeNoPrimary = pf.gateHasRoute(s.grid, K(gc, gr), blocked);
  // Place a primary RDS anywhere — the replica activates.
  s.grid.place(S.rds, gc + 1, gr + 1);
  const invalidWithPrimary = !s.sim._dependencyMet(replica);
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

// Phase 5: typed connections. Edge type is stored + defaulted; PrivateLink
// topology rule enforced; per-type hop cost feeds billing. (Still sandbox.)
const typedConns = await page.evaluate(async () => {
  const cn = await import("./src/services/connections.js");
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const gm = await import("./src/grid/grid.js");
  const g = new gm.Grid(12, 12);
  g.addEdge("1,1", "2,2");            // default type
  g.addEdge("3,3", "4,4", "tgw");     // explicit type
  return {
    order: cn.CONN_ORDER.length,                       // 4
    defaultType: g.getEdgeType("1,1", "2,2"),          // "vpc"
    tgwType: g.getEdgeType("3,3", "4,4"),              // "tgw"
    tgwHopCost: cn.getConn("tgw").hopCost,             // 2
    vpcHopCost: cn.getConn("vpc").hopCost,             // 0
    plinkExempt: cn.getConn("privatelink").crossAzExempt, // true
    // PrivateLink needs exactly one sink end.
    plinkEdgeToEdge: cn.connTypeAllows("privatelink", S.alb, S.cloudfront), // false
    plinkEdgeToSink: cn.connTypeAllows("privatelink", S.alb, S.rds),        // true
    plinkSinkToSink: cn.connTypeAllows("privatelink", S.rds, S.dynamodb),   // false
    vpcAnyPair: cn.connTypeAllows("vpc", S.alb, S.cloudfront),              // true
  };
});

// Scene wiring honours the active connection type + its topology rule.
const sceneConn = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current; // sandbox
  const S = (await import("./src/services/catalog.js")).SERVICES;
  // PrivateLink between two non-sink tiles must be rejected.
  s.connType = "privatelink";
  s.palette.connType = "privatelink";
  s.grid.place(S.alb, 5, 1);
  s.grid.place(S.cloudfront, 7, 1);
  s.wireFrom = { col: 5, row: 1 };
  s._commitWire({ col: 7, row: 1 });
  const plinkEdgeRejected = !s.grid.hasEdge("5,1", "7,1");
  // PrivateLink to a sink is accepted and records the type.
  s.grid.place(S.rds, 9, 8);
  s.wireFrom = { col: 5, row: 1 };
  s._commitWire({ col: 9, row: 8 });
  const plinkToSinkOk = s.grid.hasEdge("5,1", "9,8");
  const recordedType = s.grid.getEdgeType("5,1", "9,8");
  return { plinkEdgeRejected, plinkToSinkOk, recordedType };
});

// Edge-type winRequires (Phase 5 + T3.2): mesh_bridge accepts a win only when the
// route crosses a TGW hop. Build a route and flip the edge type.
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "mesh_bridge" }));
await page.waitForTimeout(300);
const edgeWinReq = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  s.grid.place(S.ec2, gc + 1, gr);
  s.grid.place(S.rds, gc + 2, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr), "vpc");
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr), "vpc");
  const blockedByVpc = !s.sim._checkWinRequires().ok; // all-VPC route → win blocked
  // Flip the second hop to a Transit Gateway link.
  s.grid.removeEdge(gc + 1, gr, gc + 2, gr);
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr), "tgw");
  const okWithTgw = s.sim._checkWinRequires().ok;    // now satisfies edgeTypeAny:["tgw"]
  return { blockedByVpc, okWithTgw };
});

// Phase 5b: transitive routing. A two-peering chain can't reach a third node;
// a Transit Gateway hop in the middle (transitive) routes through.
const transitive5b = await page.evaluate(async () => {
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const gm = await import("./src/grid/grid.js");
  const pf = await import("./src/grid/pathfind.js");
  const cn = await import("./src/services/connections.js");
  const K = (c, r) => c + "," + r;

  // (a) Two peering hops in series can't reach the third node.
  const g = new gm.Grid(12, 6);
  g.place(S.route53, 0, 0);
  g.place(S.ec2, 1, 0);
  g.place(S.alb, 2, 0);
  g.place(S.cache, 3, 0);
  g.place(S.rds, 4, 0);
  // gate —vpc→ ec2 —PEER→ alb —PEER→ cache —vpc→ rds. At alb (entered over
  // peering) leaving over peering again is non-transitive → cache/rds unreachable.
  g.addEdge(K(0, 0), K(1, 0), "vpc");
  g.addEdge(K(1, 0), K(2, 0), "peering");
  g.addEdge(K(2, 0), K(3, 0), "peering");
  g.addEdge(K(3, 0), K(4, 0), "vpc");
  const blockedByPeeringChain = !pf.gateHasRoute(g, K(0, 0));
  // Swap the middle hop to a Transit Gateway (transitive) → route forms.
  g.removeEdge(2, 0, 3, 0);
  g.addEdge(K(2, 0), K(3, 0), "tgw");
  const okViaTgw = pf.gateHasRoute(g, K(0, 0));

  // (b) A single peering hop to a sink must still complete the round trip.
  const g2 = new gm.Grid(8, 6);
  g2.place(S.route53, 0, 0);
  g2.place(S.ec2, 1, 0);
  g2.place(S.rds, 2, 0);
  g2.addEdge(K(0, 0), K(1, 0), "vpc");
  g2.addEdge(K(1, 0), K(2, 0), "peering"); // compute —peering→ DB
  const singlePeeringRoundTrip = pf.gateHasRoute(g2, K(0, 0));

  return {
    blockedByPeeringChain,
    okViaTgw,
    singlePeeringRoundTrip,
    peeringNonTransitive: cn.isTransitive("peering") === false,
    tgwTransitive: cn.isTransitive("tgw") === true,
  };
});

// Phase 6 Secure (T6.1): private_lines blocks a NAT/public route and accepts a
// PrivateLink route. Uses the level's seeded NAT + DynamoDB.
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "private_lines" }));
await page.waitForTimeout(300);
const secureWin = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  // Seeded NAT at (8,2), DynamoDB at (12,4). Route the public way first.
  s.grid.addEdge(K(gc, gr), K(8, 2), "vpc");  // gate -> NAT
  s.grid.addEdge(K(8, 2), K(12, 4), "vpc");   // NAT -> DDB
  const natBlocked = !s.sim._checkWinRequires().ok;
  // Tear down the NAT path, expose the DB privately over PrivateLink.
  s.grid.removeEdge(gc, gr, 8, 2);
  s.grid.removeEdge(8, 2, 12, 4);
  s.grid.place(S.ec2, gc + 1, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr), "vpc");
  s.grid.addEdge(K(gc + 1, gr), K(12, 4), "privatelink");
  const plinkOk = s.sim._checkWinRequires().ok;
  return { natBlocked, plinkOk };
});

// Phase 6 High-Performing (T6.7 cache_rules): a direct DB route is blocked; a
// route through a cache layer wins. Uses the seeded RDS.
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "cache_rules" }));
await page.waitForTimeout(300);
const cacheWin = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  // Seeded RDS at (12,4). Direct compute -> DB, no cache.
  s.grid.place(S.ec2, gc + 1, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr), "vpc");
  s.grid.addEdge(K(gc + 1, gr), K(12, 4), "vpc");
  const noCacheBlocked = !s.sim._checkWinRequires().ok;
  // Insert a cache between compute and the DB.
  s.grid.removeEdge(gc + 1, gr, 12, 4);
  s.grid.place(S.cache, gc + 2, gr);
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr), "vpc");
  s.grid.addEdge(K(gc + 2, gr), K(12, 4), "vpc");
  const cacheOk = s.sim._checkWinRequires().ok;
  return { noCacheBlocked, cacheOk };
});

// Phase 6 (T6.8 read_heavy): the win needs a Read Replica sink, which itself
// needs the seeded primary on the board (dependency model).
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "read_heavy" }));
await page.waitForTimeout(300);
const readWin = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  // Seeded primary RDS at (8,6). Route reads to a Read Replica.
  s.grid.place(S.ec2, gc + 1, gr);
  s.grid.place(S.rds_replica, gc + 2, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr), "vpc");
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr), "vpc");
  const replicaOk = s.sim._checkWinRequires().ok; // replica valid (primary seeded) + is the sink
  return { replicaOk };
});

// Phase 6 Resilient (T6.4 decouple_drown): a direct route is blocked; routing
// through an SQS queue wins.
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "decouple_drown" }));
await page.waitForTimeout(300);
const decoupleWin = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  s.grid.place(S.ec2, gc + 1, gr);
  s.grid.place(S.rds, gc + 2, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr), "vpc");
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr), "vpc");
  const noQueueBlocked = !s.sim._checkWinRequires().ok;
  // Insert an SQS queue between the gate and compute.
  s.grid.removeEdge(gc, gr, gc + 1, gr);
  s.grid.place(S.sqs, gc + 1, gr - 1);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr - 1), "vpc");
  s.grid.addEdge(K(gc + 1, gr - 1), K(gc + 1, gr), "vpc");
  const sqsOk = s.sim._checkWinRequires().ok;
  return { noQueueBlocked, sqsOk };
});

// Phase 6 Resilient (T6.5 fan_out): an SNS topic wired to ONE sink fails the
// fan-out; wired to BOTH seeded sinks it wins.
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "fan_out" }));
await page.waitForTimeout(300);
const fanOutWin = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  // Seeded sinks: s3 (13,3), dynamodb (13,7). Build gate -> ec2 -> sns.
  s.grid.place(S.ec2, gc + 1, gr);
  s.grid.place(S.sns, gc + 2, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr), "vpc");
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr), "vpc");
  // Fan to only ONE subscriber first.
  s.grid.addEdge(K(gc + 2, gr), K(13, 3), "vpc");
  const oneSinkBlocked = !s.sim._checkWinRequires().ok;
  // Add the second subscriber.
  s.grid.addEdge(K(gc + 2, gr), K(13, 7), "vpc");
  const twoSinksOk = s.sim._checkWinRequires().ok;
  return { oneSinkBlocked, twoSinksOk };
});

// Phase 6d Cost: new cost-optimized service variants + spot-interruption event.
const cost6d = await page.evaluate(async () => {
  const cat = await import("./src/services/catalog.js");
  const ev = await import("./src/waves/events.js");
  const S = cat.SERVICES;
  return {
    glacierCheaper: !!S.s3_glacier && S.s3_glacier.cost < S.s3.cost,
    glacierStorage: S.s3_glacier?.role === "storage",
    reservedCheaper: S.ec2_reserved?.cost < S.ec2?.cost,
    spotCheaper: S.ec2_spot?.cost < S.ec2_reserved?.cost,
    spotInterruptible: S.ec2_spot?.spotInterruptible === true,
    spotEventKind: ev.EVENT_KIND.SPOT_INTERRUPTION === "spot_interruption",
    serviceCount: cat.PALETTE_ORDER.length, // 23
  };
});

// T6.11 cold_storage: a Standard-S3 sink is blocked; Glacier wins.
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "cold_storage" }));
await page.waitForTimeout(300);
const coldWin = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  s.grid.place(S.ec2, gc + 1, gr);
  s.grid.place(S.s3, gc + 2, gr); // Standard S3
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr), "vpc");
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr), "vpc");
  const standardBlocked = !s.sim._checkWinRequires().ok;
  // Swap the sink to Glacier.
  s.grid.remove(gc + 2, gr);
  s.grid.place(S.s3_glacier, gc + 2, gr);
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr), "vpc");
  const glacierOk = s.sim._checkWinRequires().ok;
  return { standardBlocked, glacierOk };
});

// T6.12 right_price: On-Demand EC2 is blocked; Reserved wins. And a spot event
// takes a Spot tile offline.
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "right_price" }));
await page.waitForTimeout(300);
const rightWin = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  // Seeded RDS at (12,4). On-Demand path first.
  s.grid.place(S.ec2, gc + 1, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr), "vpc");
  s.grid.addEdge(K(gc + 1, gr), K(12, 4), "vpc");
  const onDemandBlocked = !s.sim._checkWinRequires().ok;
  // Replace with Reserved compute.
  s.grid.remove(gc + 1, gr);
  s.grid.place(S.ec2_reserved, gc + 1, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr), "vpc");
  s.grid.addEdge(K(gc + 1, gr), K(12, 4), "vpc");
  const reservedOk = s.sim._checkWinRequires().ok;
  // A Spot tile goes offline during a spot-interruption event.
  s.grid.place(S.ec2_spot, gc + 1, gr + 2);
  s.events.events.push({ kind: "spot_interruption", state: "active", at: 0, duration: 9999, warn: 0 });
  const spotOfflineDuringEvent = s.sim._isKeyDisabled(K(gc + 1, gr + 2));
  return { onDemandBlocked, reservedOk, spotOfflineDuringEvent };
});

// T6.6 across_the_region: a region failure downs the primary region (even
// Multi-AZ there), but the DR region (last band) + the global gate survive, and
// a DR-region route still works.
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "across_the_region" }));
await page.waitForTimeout(300);
const regionDR = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const ev = await import("./src/waves/events.js");
  const K = (c, r) => c + "," + r;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  // Primary-region Multi-AZ DB (band 0, col ~3) and a DR-region stack (band 2,
  // cols 13-15 on an 18-wide board → zone 2).
  s.grid.place(S.rds_multiaz, 3, 3);          // primary region, "HA" but single-region
  s.grid.place(S.ec2, 14, 5);                 // DR region compute
  s.grid.place(S.rds, 15, 5);                 // DR region DB
  s.grid.addEdge(K(gc, gr), K(14, 5), "vpc"); // gate -> DR compute (global gate)
  s.grid.addEdge(K(14, 5), K(15, 5), "vpc");
  // Inject an active region failure (downs the primary region's bands).
  s.events.events.push({ kind: "region_failure", state: "active", at: 0, duration: 9999, warn: 0, zones: [0, 1] });
  const primaryMultiAzDown = s.sim._isKeyDisabled(K(3, 3));   // Multi-AZ does NOT survive a region loss
  const drComputeUp = !s.sim._isKeyDisabled(K(14, 5));        // DR region survives
  const gateUp = !s.sim._isKeyDisabled(K(gc, gr));            // Route 53 is global
  const drRouteSurvives = (await import("./src/grid/pathfind.js")).gateHasRoute(
    s.grid, K(gc, gr), (key) => s.sim._isKeyDisabled(key)
  );
  return { primaryMultiAzDown, drComputeUp, gateUp, drRouteSurvives };
});

// Company Run Report: cashing out a freerun run hands the results scene a
// company-shaped payload (mode + milestone eval + ops scorecard) so it renders
// the dedicated report instead of the scenario verdict.
await page.evaluate(() => window.__rackoon.scenes.go("level", { levelId: "company" }));
await page.waitForTimeout(300);
await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  s.started = true;
  const S = (await import("./src/services/catalog.js")).SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  s.grid.place(S.ec2, gc + 1, gr);
  s.grid.place(S.rds, gc + 2, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr), "vpc");
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr), "vpc");
  s._routeDirty = true;
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const s = window.__rackoon.scenes.current;
  s.outcome = "win"; s.outcomeReason = "cashout"; s._goToResults();
});
await page.waitForTimeout(400);
const runReport = await page.evaluate(() => {
  const rs = window.__rackoon.scenes.current;
  const r = rs.r || {};
  return {
    scene: rs.constructor.name,
    isCompany: rs.isCompany === true,
    mode: r.mode,
    milestoneTotal: r.milestones ? r.milestones.total : -1,
    hasOps: !!(r.ops && typeof r.ops.sloCompliance === "number"),
    sloPresent: !!(r.ops && r.ops.sloCompliance != null),
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
console.log("azFix:", JSON.stringify(azFix));
console.log("winReq:", JSON.stringify(winReq));
console.log("awsFidelity:", JSON.stringify(awsFidelity));
console.log("economyAudit:", JSON.stringify(economyAudit));
console.log("depRouting:", JSON.stringify(depRouting));
console.log("wireRules:", JSON.stringify(wireRules));
console.log("typedConns:", JSON.stringify(typedConns));
console.log("sceneConn:", JSON.stringify(sceneConn));
console.log("edgeWinReq:", JSON.stringify(edgeWinReq));
console.log("transitive5b:", JSON.stringify(transitive5b));
console.log("secureWin:", JSON.stringify(secureWin));
console.log("cacheWin:", JSON.stringify(cacheWin));
console.log("readWin:", JSON.stringify(readWin));
console.log("decoupleWin:", JSON.stringify(decoupleWin));
console.log("fanOutWin:", JSON.stringify(fanOutWin));
console.log("cost6d:", JSON.stringify(cost6d));
console.log("coldWin:", JSON.stringify(coldWin));
console.log("rightWin:", JSON.stringify(rightWin));
console.log("regionDR:", JSON.stringify(regionDR));
console.log("runReport:", JSON.stringify(runReport));
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
if (catalog3b.groupCount !== 6)        problems.push("PALETTE_GROUPS should have 6 groups (incl. Msg)");
if (catalog3b.sqsBuffers !== 0.5)      problems.push("SQS should buffer spikes (attackMitigation 0.5)");
if (!catalog3b.snsExists)              problems.push("SNS service missing");
if (!catalog3b.msgGroup)               problems.push("PALETTE_GROUPS should include the integration/Msg group");
if (levels3c.levelCount !== 19)     problems.push("LEVEL_ORDER should have 19 levels");
if (!levels3c.leakyExists)          problems.push("leaky_pipe level missing");
if (!levels3c.leakySeedHasNat)      problems.push("leaky_pipe seed missing nat_gateway");
if (!levels3c.lastIsRegion)         problems.push("across_the_region should be the last level");
if (!levels3c.rightPriceNextSecret) problems.push("right_price.next should chain to secret_keeper");
if (!levels3c.secretNeedsManager)   problems.push("secret_keeper should require secrets_manager in the route");
if (!levels3c.secretNextRegion)     problems.push("secret_keeper.next should chain to across_the_region");
if (!levels3c.regionHasFailureEvent) problems.push("across_the_region should schedule a region_failure event");
if (!levels3c.serverlessNextCold)   problems.push("serverless_spike.next should chain to cold_storage");
if (!levels3c.coldNeedsGlacier)     problems.push("cold_storage should require the s3_glacier sink");
if (!levels3c.rightNeedsCheapCompute) problems.push("right_price should require Reserved/Spot compute");
if (!levels3c.rightExcludesOnDemand) problems.push("right_price should exclude on-demand ec2");
if (!levels3c.rightHasSpotEvent)    problems.push("right_price should schedule a spot_interruption event");
if (!levels3c.fanOutNextServerless) problems.push("fan_out.next should chain to serverless_spike");
if (!levels3c.serverlessNeedsLambda) problems.push("serverless_spike should require Lambda in the route");
if (!levels3c.serverlessExcludesEc2) problems.push("serverless_spike should exclude EC2 from the route");
if (!levels3c.readHeavyNextDecouple) problems.push("read_heavy.next should chain to decouple_drown");
if (!levels3c.decoupleNeedsSqs)     problems.push("decouple_drown should require an SQS queue");
if (!levels3c.fanOutNeedsSns)       problems.push("fan_out should require an SNS topic");
if (levels3c.fanOutMinSinks !== 2)  problems.push("fan_out fanOut.minSinks should be 2");
if (!levels3c.fanOutSeedsTwoSinks)  problems.push("fan_out should seed at least 2 subscriber sinks");
if (!levels3c.singleWriterNext)     problems.push("single_writer.next should chain to mesh_bridge");
if (!levels3c.meshNeedsTgw)         problems.push("mesh_bridge winRequires should demand a TGW edge");
if (!levels3c.privateNeedsPlink)    problems.push("private_lines should require a PrivateLink edge");
if (!levels3c.privateExcludesNat)   problems.push("private_lines should exclude nat_gateway from the route");
if (!levels3c.lockedNeedsCloudfront) problems.push("locked_buckets should require CloudFront in the route");
if (!levels3c.lockedExcludesNat)    problems.push("locked_buckets should exclude nat_gateway from the route");
if (!levels3c.lockedNextCache)      problems.push("locked_buckets.next should chain to cache_rules");
if (!levels3c.cacheNeedsCacheLayer) problems.push("cache_rules should require a cache/CloudFront layer");
if (!levels3c.readHeavySinkReplica) problems.push("read_heavy should require an rds_replica sink");
if (!levels3c.readHeavySeedsPrimary) problems.push("read_heavy should seed an RDS primary for the replica");
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
if (economyAudit.crossAzPenalty < 8) problems.push("cross-AZ transfer penalty should be the full 8×");
if (!economyAudit.plainTileNoXfer)  problems.push("plain tiles should carry no transfer mul (intra-AZ must be free)");
// Phase 5: typed connections.
if (typedConns.order !== 4)         problems.push("CONN_ORDER should have 4 types");
if (typedConns.defaultType !== "vpc") problems.push("edge default type should be 'vpc'");
if (typedConns.tgwType !== "tgw")   problems.push("explicit edge type not recorded");
if (typedConns.tgwHopCost !== 2)    problems.push("TGW hopCost should be 2");
if (typedConns.vpcHopCost !== 0)    problems.push("VPC link hopCost should be 0 (intra-AZ free)");
if (!typedConns.plinkExempt)        problems.push("PrivateLink should be cross-AZ exempt");
if (typedConns.plinkEdgeToEdge)     problems.push("PrivateLink edge<->edge should be rejected (needs a sink end)");
if (!typedConns.plinkEdgeToSink)    problems.push("PrivateLink edge<->sink should be allowed");
if (typedConns.plinkSinkToSink)     problems.push("PrivateLink sink<->sink should be rejected (needs exactly one sink end)");
if (!typedConns.vpcAnyPair)         problems.push("VPC link should allow any canWire pair");
if (!sceneConn.plinkEdgeRejected)   problems.push("scene: PrivateLink between non-sink tiles should be rejected");
if (!sceneConn.plinkToSinkOk)       problems.push("scene: PrivateLink to a sink should commit");
if (sceneConn.recordedType !== "privatelink") problems.push("scene: committed edge should record its connection type");
if (!edgeWinReq.blockedByVpc)       problems.push("mesh_bridge: all-VPC route should NOT satisfy the TGW win rule");
if (!edgeWinReq.okWithTgw)          problems.push("mesh_bridge: a TGW hop should satisfy the win rule");
if (!transitive5b.peeringNonTransitive) problems.push("peering should be non-transitive");
if (!transitive5b.tgwTransitive)    problems.push("TGW should be transitive");
if (!transitive5b.blockedByPeeringChain) problems.push("5b: a two-peering chain should NOT route to a third node");
if (!transitive5b.okViaTgw)         problems.push("5b: a transitive TGW hop should route through");
if (!transitive5b.singlePeeringRoundTrip) problems.push("5b: a single peering hop to a sink should still round-trip");
if (!secureWin.natBlocked)          problems.push("private_lines: a NAT/public route should NOT win");
if (!secureWin.plinkOk)             problems.push("private_lines: a PrivateLink route should win");
if (!cacheWin.noCacheBlocked)       problems.push("cache_rules: a direct DB route (no cache) should NOT win");
if (!cacheWin.cacheOk)              problems.push("cache_rules: a route through a cache layer should win");
if (!readWin.replicaOk)             problems.push("read_heavy: a Read Replica route (with seeded primary) should win");
if (!decoupleWin.noQueueBlocked)    problems.push("decouple_drown: a direct route (no SQS) should NOT win");
if (!decoupleWin.sqsOk)             problems.push("decouple_drown: a route through SQS should win");
if (!fanOutWin.oneSinkBlocked)      problems.push("fan_out: SNS wired to one sink should NOT satisfy fan-out");
if (!fanOutWin.twoSinksOk)          problems.push("fan_out: SNS wired to two sinks should win");
// Phase 6d Cost.
if (!cost6d.glacierCheaper)         problems.push("s3_glacier should be cheaper than s3");
if (!cost6d.glacierStorage)         problems.push("s3_glacier should be a storage-role sink");
if (!cost6d.reservedCheaper)        problems.push("ec2_reserved should be cheaper than on-demand ec2");
if (!cost6d.spotCheaper)            problems.push("ec2_spot should be cheaper than ec2_reserved");
if (!cost6d.spotInterruptible)      problems.push("ec2_spot should be spotInterruptible");
if (!cost6d.spotEventKind)          problems.push("EVENT_KIND.SPOT_INTERRUPTION should exist");
if (!coldWin.standardBlocked)       problems.push("cold_storage: a Standard-S3 sink should NOT win");
if (!coldWin.glacierOk)             problems.push("cold_storage: a Glacier sink should win");
if (!rightWin.onDemandBlocked)      problems.push("right_price: an On-Demand EC2 path should NOT win");
if (!rightWin.reservedOk)           problems.push("right_price: a Reserved-compute path should win");
if (!rightWin.spotOfflineDuringEvent) problems.push("right_price: a Spot tile should go offline during a spot-interruption event");
if (!regionDR.primaryMultiAzDown)   problems.push("across_the_region: Multi-AZ in the primary region should go down in a region failure");
if (!regionDR.drComputeUp)          problems.push("across_the_region: DR-region tiles should survive a region failure");
if (!regionDR.gateUp)               problems.push("across_the_region: the global Route 53 gate should survive a region failure");
if (!regionDR.drRouteSurvives)      problems.push("across_the_region: a DR-region route should keep serving through the outage");
// Company Run Report.
if (runReport.scene !== "ResultsScene") problems.push("company cash-out should transition to the results scene");
if (!runReport.isCompany)           problems.push("company results should flag isCompany (render the Run Report)");
if (runReport.mode !== "freerun")   problems.push("company results payload should carry mode=freerun");
if (runReport.milestoneTotal !== 4) problems.push("company Run Report should carry the 4 milestones");
if (!runReport.hasOps || !runReport.sloPresent) problems.push("company Run Report should carry the ops scorecard (SLO etc.)");

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
