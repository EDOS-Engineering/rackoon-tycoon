// levels.js — Data-driven level definitions.
// Each record shapes one playable level. Phase-2+ fields are optional; sensible
// defaults apply. Sprint 3c adds 4 gap-mapped boss levels, each teaching one
// SAA-C03 Priority Gap through the game mechanics.
//
// Record shape:
//   id, name, subtitle, cols, rows, budget, spawnRate, gates, seed, intro
//   goalRequests   — routed-request target (win condition)
//   next           — id of the level this one unlocks on a win
//   slaMaxDropRate — lose if drop rate exceeds this (default 0.35)
//   waves          — [{ name, duration, rate }]
//   events         — [{ at, kind, duration, warn, zone?, magnitude? }]
//   seed           — [{ id, col, row }] pre-placed buildings (player wires them)
//
// Event kinds: "az_failure" | "traffic_spike" | "cost_audit"

export const LEVELS = {
  // ---- Tutorial ----
  first_light: {
    id: "first_light",
    name: "First Light",
    subtitle: "Wire your first round-trip",
    cols: 14,
    rows: 9,
    budget: 1500,
    spawnRate: 0.75,
    gates: [{ col: 1, row: 4 }],
    seed: [],
    goalRequests: 30,
    next: "rush_hour",
    waves: [
      { name: "Quiet open",  duration: 24, rate: 0.8  },
      { name: "First guests", duration: 28, rate: 1.1  },
      { name: "Steady flow", duration: 32, rate: 1.35 },
    ],
    events: [],
    slaMaxDropRate: 0.5,
    intro:
      "Welcome, Rocky! Get guests from the front gate to a database and back.\n\n1) Click a service in the bottom bar, then click an empty tile to place it — try an ALB, then EC2, then RDS.\n2) Drag between neighbouring tiles to wire them up: gate → ALB → EC2 → RDS.\n\nGuests then flow on their own: completed round-trips earn money, while your live AWS bill (top-left) slowly burns budget. Route 30 guests to win. Take your time — the shift starts when you click Begin. Press H any time for a help legend.",
    examTip:
      "The 3-tier architecture (load balancer → compute → database) is a foundational SAA-C03 pattern. Route 53 routes externally; ALB distributes internally. Always place resources in multiple AZs.",
  },

  // ---- Phase 2 levels ----
  rush_hour: {
    id: "rush_hour",
    name: "Rush Hour",
    subtitle: "Survive the surge without dropping requests",
    cols: 16,
    rows: 10,
    budget: 2200,
    spawnRate: 0.9,
    gates: [{ col: 1, row: 5 }],
    seed: [],
    goalRequests: 70,
    next: "zone_down",
    waves: [
      { name: "Warm-up",      duration: 20, rate: 0.9 },
      { name: "Morning rush", duration: 26, rate: 1.5 },
      { name: "Peak load",    duration: 30, rate: 2.3 },
      { name: "Wind-down",    duration: 16, rate: 1.2 },
    ],
    events: [
      { at: 44, kind: "traffic_spike", duration: 9, warn: 6, magnitude: 1.7 },
    ],
    slaMaxDropRate: 0.35,
    intro:
      "Traffic escalates in waves. A single small database will choke — its queue fills, latency climbs, requests drop. Spread load with a cache and parallel compute, or pick a higher-throughput sink. A traffic spike hits mid-shift. Route 70 to win.",
    examTip:
      "For peak traffic, combine horizontal EC2 Auto Scaling with ElastiCache to offload DB reads. Pre-warm Auto Scaling before the surge — reactive scaling always lags. Add headroom, not just headcount.",
  },

  zone_down: {
    id: "zone_down",
    name: "When the Zone Goes Dark",
    subtitle: "An AZ fails — resilient designs survive",
    cols: 18,
    rows: 11,
    budget: 2800,
    spawnRate: 0.9,
    gates: [{ col: 1, row: 5 }],
    seed: [],
    goalRequests: 90,
    next: "leaky_pipe",
    waves: [
      { name: "Warm-up",       duration: 18, rate: 0.9 },
      { name: "Build pressure", duration: 26, rate: 1.6 },
      { name: "Peak load",     duration: 30, rate: 2.4 },
      { name: "Aftermath",     duration: 22, rate: 1.5 },
    ],
    events: [
      { at: 34, kind: "traffic_spike", duration:  8, warn: 6, magnitude: 1.6 },
      { at: 58, kind: "az_failure",    duration: 14, warn: 8 }, // zone randomized each run
      { at: 86, kind: "cost_audit",    duration: 14, warn: 6, magnitude: 1.5 },
    ],
    slaMaxDropRate: 0.32,
    intro:
      "The park spans three Availability Zones (column bands). Mid-shift, a zone goes DARK — every building there is disabled and routes through it break.\n\nRoute 53 is a GLOBAL service: it stays online even when a zone fails, and you can wire it directly to ALBs or compute in any AZ — no need to chain through an intermediate zone.\n\nTip: RDS Multi-AZ (DB tab) has a synchronous standby and survives AZ failure automatically. RDS Read Replica is cheaper but won't auto-promote.\n\nDesign for resilience: wire Route 53 to endpoints in multiple AZs, spread compute and a Multi-AZ database across zones. Then a cost audit hits. Route 90 to win.",
    examTip:
      "AZ failure is a top exam scenario. Pattern: 3 AZs, Multi-AZ RDS (auto-failover, ~60–120s), Route 53 health checks to shift traffic, and ALBs in each AZ. Never single-AZ a critical workload.",
  },

  // ---- Sprint 3c: Gap-mapped boss levels ----

  // T3.1 — Priority Gap: Gateway VPC Endpoint vs NAT cost
  leaky_pipe: {
    id: "leaky_pipe",
    name: "The Leaky Pipe",
    subtitle: "Stop the money-drain before the auditor arrives",
    cols: 16,
    rows: 9,
    budget: 2000,
    spawnRate: 0.85,
    gates: [{ col: 1, row: 4 }],
    // A NAT Gateway and an S3 bucket are pre-placed. The player must decide
    // whether to wire through the NAT (8× transfer cost) or bypass it with a
    // VPC Endpoint (0.02× transfer cost). A harsh cost audit arrives at t=28.
    seed: [
      { id: "nat_gateway", col: 7, row: 4 },
      { id: "s3",          col: 12, row: 4 },
    ],
    goalRequests: 55,
    next: "raccoons_gate",
    waves: [
      { name: "Trickle",      duration: 20, rate: 0.8 },
      { name: "Steady flow",  duration: 28, rate: 1.4 },
      { name: "Afternoon rush", duration: 28, rate: 1.8 },
      { name: "Late surge",   duration: 20, rate: 1.5 },
    ],
    events: [
      { at: 28, kind: "cost_audit", duration: 18, warn: 7, magnitude: 2.5 },
      { at: 58, kind: "traffic_spike", duration: 10, warn: 6, magnitude: 1.8 },
    ],
    slaMaxDropRate: 0.35,
    // Win requires the route to go through VPC Endpoint and reach S3 as the sink.
    // A plain ALB→EC2→RDS path does not fulfill the lesson.
    winRequires: {
      sinkIs: ["s3", "kinesis_firehose"],
      pathContainsAll: ["vpc_endpoint"],
      requirementHint: "Route must reach S3 via VPC Endpoint — bypass the NAT Gateway",
    },
    intro:
      "A NAT Gateway and an S3 bucket are already on the board. You need to route guests from the gate through compute to S3 — but watch your bill.\n\nNAT Gateway has ×8 data-transfer cost per hop. Every packet crossing it is 8× more expensive than a plain wire. VPC Endpoint (Gateway type) routes the same traffic inside AWS with near-zero cost.\n\nThe auditor arrives early (⚠ cost audit inbound). If you're running NAT, you'll feel it. Replace or bypass the NAT Gateway with a VPC Endpoint and wire it into the path instead.\n\n⚠ WIN CONDITION: route must reach S3 via VPC Endpoint.\n\nCheck the 'Net' tab in the palette. Route 55 to win.",
    examTip:
      "Gateway VPC Endpoints (S3, DynamoDB) have zero data-transfer cost — no per-GB charge. NAT Gateway charges $0.045/GB processed. On SAA-C03, when a private subnet needs S3/DynamoDB access, Gateway Endpoint is always the cost-optimal answer.",
  },

  // T3.5 — Priority Gap: DDoS resilience (Shield / WAF / CloudFront)
  raccoons_gate: {
    id: "raccoons_gate",
    name: "Raccoons at the Gate",
    subtitle: "A DDoS wave is incoming — deploy your defences",
    cols: 18,
    rows: 10,
    budget: 3200,
    spawnRate: 0.9,
    gates: [{ col: 1, row: 5 }],
    seed: [],
    goalRequests: 80,
    next: "replay_or_gone",
    waves: [
      { name: "Normal traffic", duration: 22, rate: 0.9  },
      { name: "Rising noise",   duration: 20, rate: 1.3  },
      { name: "DDoS wave",      duration: 30, rate: 2.0  },
      { name: "Sustained attack", duration: 24, rate: 1.7 },
    ],
    // Two large traffic spikes simulate the DDoS. Without WAF/Shield the spike
    // multiplier floods every building; with them most of the excess is absorbed.
    events: [
      { at: 30, kind: "traffic_spike", duration: 14, warn: 8, magnitude: 2.8 },
      { at: 62, kind: "traffic_spike", duration: 12, warn: 6, magnitude: 2.5 },
      { at: 82, kind: "cost_audit",    duration: 10, warn: 5, magnitude: 1.4 },
    ],
    slaMaxDropRate: 0.35,
    // Win requires at least WAF or Shield in the active route.
    winRequires: {
      pathContainsAny: ["waf", "shield"],
      requirementHint: "Deploy WAF or Shield in your route to win — unprotected builds can't win here",
    },
    intro:
      "Threat intel: a DDoS wave is headed your way — two large traffic spikes will hit the park.\n\nWithout protection, the multiplier floods your compute and databases; queues fill and guests drop. AWS WAF (Security tab) absorbs 50% of any spike multiplier excess. Shield Advanced absorbs 75%. Place them before the first wave hits.\n\nTip: Wire CloudFront in front of your ALB — it also has lower data-transfer cost and very high throughput, so it absorbs volume before it reaches your origin.\n\n⚠ WIN CONDITION: route must include WAF or Shield.\n\nRoute 80 to win.",
    examTip:
      "DDoS defense in depth: Shield Advanced at the account level, WAF rules on CloudFront/ALB, CloudFront to absorb volumetric traffic at the edge. Shield Advanced includes AWS DRT (DDoS Response Team) support.",
  },

  // T3.3 — Priority Gap: Kinesis Streams (replayable) vs Kinesis Firehose (no replay)
  replay_or_gone: {
    id: "replay_or_gone",
    name: "Replay or It's Gone",
    subtitle: "IoT stream processing — choose your pipeline carefully",
    cols: 18,
    rows: 10,
    budget: 2600,
    spawnRate: 0.85,
    gates: [{ col: 1, row: 5 }],
    seed: [],
    goalRequests: 70,
    next: "single_writer",
    waves: [
      { name: "Sensor warm-up",  duration: 18, rate: 0.8 },
      { name: "Data burst",      duration: 26, rate: 1.6 },
      { name: "Peak telemetry",  duration: 30, rate: 2.2 },
      { name: "Wind-down",       duration: 18, rate: 1.3 },
    ],
    events: [
      { at: 32, kind: "traffic_spike", duration: 12, warn: 7, magnitude: 2.0 },
      { at: 60, kind: "az_failure",    duration: 12, warn: 8 }, // zone randomized each run
      { at: 78, kind: "cost_audit",    duration: 10, warn: 5, magnitude: 1.3 },
    ],
    slaMaxDropRate: 0.35,
    // Win requires Kinesis Streams in the path — a plain EC2→RDS setup won't do.
    winRequires: {
      pathContainsAll: ["kinesis_streams"],
      requirementHint: "Route must include Kinesis Data Streams — this is a streaming pipeline, not a request/response app",
    },
    intro:
      "You're processing a high-volume IoT telemetry stream. Two very different services handle it — choose wisely.\n\nKinesis Data Streams (Compute tab): replayable event stream. 24-hour default retention, up to 365 days. Downstream consumers can re-read data if processing fails. Use this for real-time analytics where replay matters.\n\nKinesis Firehose (Data tab): reliable, high-throughput delivery to S3. No replay — once the data is delivered, the stream is gone. Use this as the final sink into your data lake.\n\nAn AZ failure hits late in the shift. Design your pipeline to survive it: Streams in compute, Firehose as the final sink to S3.\n\n⚠ WIN CONDITION: route must include Kinesis Data Streams.\n\nRoute 70 to win.",
    examTip:
      "Kinesis Streams: replayable, multiple consumers, shard-based scaling. Firehose: delivery pipeline only, no replay, managed scaling, near-real-time (60s buffer). When the question mentions replay or re-processing: Streams. When it mentions delivery to S3/Redshift: Firehose.",
  },

  // T3.4 — Priority Gap: Aurora Serverless v2 (vertical) vs Aurora Limitless (horizontal)
  single_writer: {
    id: "single_writer",
    name: "Single Writer's Burden",
    subtitle: "The write throughput ceiling is closing in",
    cols: 18,
    rows: 11,
    budget: 3500,
    spawnRate: 1.0,
    gates: [{ col: 1, row: 5 }],
    seed: [],
    goalRequests: 100,
    next: "mesh_bridge",
    waves: [
      { name: "Baseline",        duration: 16, rate: 0.8  },
      { name: "Growth",          duration: 22, rate: 1.4  },
      { name: "Scaling pressure", duration: 28, rate: 2.2  },
      { name: "Ceiling test",    duration: 26, rate: 3.0  },
      { name: "Sustained peak",  duration: 20, rate: 2.5  },
    ],
    events: [
      { at: 38, kind: "traffic_spike", duration: 12, warn: 7, magnitude: 2.2 },
      { at: 68, kind: "traffic_spike", duration: 14, warn: 7, magnitude: 2.8 },
      { at: 90, kind: "cost_audit",    duration: 12, warn: 5, magnitude: 1.4 },
    ],
    slaMaxDropRate: 0.30,
    // Win requires Aurora SV2 or Aurora Limitless as the sink — plain RDS won't handle
    // the peak write load and doesn't teach the SV2 vs Limitless decision.
    winRequires: {
      sinkIs: ["aurora_sv2", "aurora_limitless"],
      requirementHint: "Sink must be Aurora Serverless v2 or Aurora Limitless — RDS cannot handle these write volumes",
    },
    intro:
      "Write traffic is about to overwhelm a single database. You need to choose the right scaling strategy before the ceiling hits.\n\nAurora Serverless v2 (DB tab): vertical auto-scaling. Handles traffic spikes by scaling ACUs up automatically — up to 2× base throughput. One writer. Best for unpredictable workloads with moderate peaks.\n\nAurora Limitless (DB tab): horizontal sharding — breaks the single-writer ceiling by distributing writes across shard nodes. Handles extreme throughput. Very expensive; only reach for it when v2's ceiling is genuinely insufficient.\n\nThe wave peaks at 3× rate. Plan your database strategy early — once queues overflow, it's hard to recover.\n\n⚠ WIN CONDITION: database must be Aurora Serverless v2 or Aurora Limitless.\n\nRoute 100 to win.",
    examTip:
      "Aurora SV2 = vertical scaling (more ACUs, same single writer). Aurora Limitless = horizontal sharding (distributed writes). On SAA-C03: if the bottleneck is a single writer's I/O ceiling, Limitless. If it's unpredictable load on a single instance, SV2.",
  },
  // T3.2 — Priority Gap: many-VPC connectivity (Transit Gateway vs Peering mesh).
  // Uses Phase 5 typed connections: the win requires a Transit Gateway hop in the
  // route (pick the TGW wire type — press C or the picker), teaching hub-and-spoke
  // over an N² peering mesh.
  mesh_bridge: {
    id: "mesh_bridge",
    name: "Mesh vs Bridge",
    subtitle: "Wire many networks without an N² peering tangle",
    cols: 18,
    rows: 11,
    budget: 3200,
    spawnRate: 0.95,
    gates: [{ col: 1, row: 5 }],
    // Three network anchors pre-seeded in different AZ bands (left/middle/right).
    // The player routes guests across them and on to a database — the clean answer
    // is a Transit Gateway hub rather than peering every pair.
    seed: [
      { id: "alb", col: 6, row: 3 },
      { id: "ec2", col: 11, row: 7 },
    ],
    goalRequests: 80,
    next: "private_lines",
    waves: [
      { name: "Warm-up",        duration: 18, rate: 0.9 },
      { name: "Cross-VPC flow", duration: 28, rate: 1.5 },
      { name: "Peak mesh",      duration: 30, rate: 2.2 },
      { name: "Wind-down",      duration: 18, rate: 1.3 },
    ],
    events: [
      { at: 34, kind: "cost_audit",   duration: 14, warn: 6, magnitude: 1.6 },
      { at: 64, kind: "traffic_spike", duration: 12, warn: 6, magnitude: 1.9 },
    ],
    slaMaxDropRate: 0.32,
    // Win requires a Transit Gateway hop somewhere in the active route.
    winRequires: {
      edgeTypeAny: ["tgw"],
      requirementHint: "Route must cross a Transit Gateway hop — select the TGW wire type (press C or the picker) and wire your VPCs through the hub",
    },
    intro:
      "Several network segments need to talk to each other and reach a database. With VPC Peering you'd wire every pair — that's an N² mesh that explodes as you add VPCs, and peering is non-transitive (A↔B and B↔C does NOT give A↔C).\n\nTransit Gateway is the hub: attach each VPC once and it routes transitively between all of them. Fewer connections, scales to thousands of attachments.\n\nPick the connection type in the build bar (or press C to cycle): VPC · Peering · TGW · PrivateLink. Wire your route through a Transit Gateway hop.\n\n⚠ WIN CONDITION: the route must cross a Transit Gateway (TGW) connection.\n\nRoute 80 to win.",
    examTip:
      "Transit Gateway = transitive, hub-and-spoke, scales to thousands of VPCs ($0.02/GB processed + attachment/hr). VPC Peering = 1:1, no processing fee, but non-transitive and an N² mesh at scale. On SAA-C03: many VPCs that must interconnect → Transit Gateway.",
  },

  // === PHASE 6 — SAA-C03 curriculum coverage ===

  // T6.1 — Domain: Secure. Reach a private database with zero public exposure:
  // PrivateLink (interface endpoint), never the NAT/public path.
  private_lines: {
    id: "private_lines",
    name: "Private Lines",
    subtitle: "Reach the database privately — no public hop",
    cols: 16,
    rows: 9,
    budget: 2600,
    spawnRate: 0.9,
    gates: [{ col: 1, row: 4 }],
    // A NAT Gateway (the tempting public path) and a DynamoDB sink are seeded.
    // The lesson: expose the DB privately over PrivateLink instead of routing
    // out through NAT. (Win forbids a nat_gateway hop.)
    seed: [
      { id: "nat_gateway", col: 8, row: 2 },
      { id: "dynamodb",    col: 12, row: 4 },
    ],
    goalRequests: 60,
    next: "locked_buckets",
    waves: [
      { name: "Quiet",         duration: 20, rate: 0.8 },
      { name: "Steady flow",   duration: 28, rate: 1.4 },
      { name: "Compliance audit", duration: 26, rate: 1.7 },
      { name: "Wind-down",     duration: 18, rate: 1.2 },
    ],
    events: [
      { at: 30, kind: "cost_audit", duration: 16, warn: 6, magnitude: 1.8 },
    ],
    slaMaxDropRate: 0.34,
    // Win requires the route to reach the DB over a PrivateLink edge, with no
    // NAT/public hop anywhere on the path.
    winRequires: {
      edgeTypeAny: ["privatelink"],
      pathExcludes: ["nat_gateway"],
      requirementHint: "Expose the database over PrivateLink (press C → PLINK, wire compute → DB) and keep the NAT Gateway out of the route",
    },
    intro:
      "Security review: this database must NOT be reachable over the public internet. A NAT Gateway is on the board — the tempting (and wrong) answer is to route out through it.\n\nPrivateLink exposes a single service privately via an interface endpoint (ENI). Traffic stays on the AWS private network — no public exposure, and no cross-AZ penalty.\n\nPick the connection type (press C to cycle, or the picker): wire your compute to the database with a PrivateLink (PLINK) connection. Leave the NAT Gateway out of the path.\n\n⚠ WIN CONDITION: route reaches the DB over a PrivateLink edge, with no NAT/public hop.\n\nRoute 60 to win.",
    examTip:
      "PrivateLink (interface endpoint, per-hour + per-GB) privately exposes ONE service — yours, a partner's, or on-prem — with no internet exposure. Gateway endpoints (free) cover only S3 + DynamoDB. NAT Gateway routes to the public internet and bills $0.045/GB. Private data path → PrivateLink or a Gateway endpoint, never NAT.",
  },

  // T6.2 — Domain: Secure. Serve a private S3 bucket only through CloudFront
  // (OAC) — no public bucket, no NAT/public path.
  locked_buckets: {
    id: "locked_buckets",
    name: "Locked Buckets",
    subtitle: "Private S3, served only through the CDN",
    cols: 16,
    rows: 9,
    budget: 2600,
    spawnRate: 0.95,
    gates: [{ col: 1, row: 4 }],
    seed: [
      { id: "s3",          col: 12, row: 4 },
      { id: "nat_gateway", col: 8, row: 6 },
    ],
    goalRequests: 65,
    next: null, // end of the campaign chain (for now)
    waves: [
      { name: "Warm-up",      duration: 18, rate: 0.9 },
      { name: "Content rush",  duration: 28, rate: 1.6 },
      { name: "Viral spike",   duration: 26, rate: 2.1 },
      { name: "Wind-down",    duration: 16, rate: 1.2 },
    ],
    events: [
      { at: 32, kind: "traffic_spike", duration: 12, warn: 6, magnitude: 2.0 },
      { at: 58, kind: "cost_audit",    duration: 12, warn: 5, magnitude: 1.5 },
    ],
    slaMaxDropRate: 0.34,
    // Win: S3 served via CloudFront (OAC), no public/NAT hop in the route.
    winRequires: {
      sinkIs: ["s3"],
      pathContainsAll: ["cloudfront"],
      pathExcludes: ["nat_gateway"],
      requirementHint: "Serve S3 through CloudFront (OAC) — put CloudFront in the route, keep the NAT Gateway out",
    },
    intro:
      "Your S3 bucket holds private content. Exposing it publicly is a breach waiting to happen — and routing through the NAT Gateway is expensive and still public.\n\nThe pattern: keep the bucket private and serve it only through CloudFront with Origin Access Control (OAC). CloudFront caches at the edge (cheap, fast) and is the single, controlled door to the bucket.\n\nWire the route through CloudFront to S3. Keep the NAT Gateway out of the path.\n\n⚠ WIN CONDITION: reach S3 via CloudFront, with no NAT/public hop.\n\nRoute 65 to win.",
    examTip:
      "CloudFront + OAC (Origin Access Control) locks an S3 bucket to CloudFront-only access — the bucket stays private, no public reads. Enforce encryption at rest (SSE-S3/SSE-KMS) and block public access. Signed URLs/cookies gate private content. This cuts origin load and egress cost too.",
  },

  // ---- Sandbox (not in LEVEL_ORDER — accessed via dedicated title button) ----
  sandbox: {
    id: "sandbox",
    name: "Sandbox",
    subtitle: "Free build — no win condition, no time limit",
    cols: 20,
    rows: 12,
    budget: 9999,
    spawnRate: 0.55,
    gates: [{ col: 1, row: 6 }],
    seed: [],
    goalRequests: 0,
    next: null,
    waves: [{ name: "Endless flow", duration: 99999, rate: 1.0 }],
    events: [],
    slaMaxDropRate: 0.55,
    intro:
      "Sandbox mode — no goals, no time limit, no loss conditions. Build any architecture you like and watch the traffic flow.\n\nAll 18 services are available. Experiment freely: try NAT vs VPC Endpoint cost, watch Shield absorb spikes, test Aurora SV2 auto-scaling under load.\n\nPress Cash Out (top-right) to return to the menu. The AWS bill still runs, so you'll see how different architectures affect your burn rate — experiment!",
    examTip:
      "Use this mode to explore service combinations without pressure. Build the same path with NAT Gateway vs VPC Endpoint and compare burn rates, or stress-test Aurora SV2's auto-scaling by wiring many packets through it.",
  },
};

// Campaign order (drives unlock chain + level-select on the title screen).
export const LEVEL_ORDER = [
  "first_light",
  "rush_hour",
  "zone_down",
  "leaky_pipe",
  "raccoons_gate",
  "replay_or_gone",
  "single_writer",
  "mesh_bridge",
  "private_lines",
  "locked_buckets",
];

export const FIRST_LEVEL = "first_light";

export function getLevel(id) {
  return LEVELS[id] || LEVELS[FIRST_LEVEL];
}
