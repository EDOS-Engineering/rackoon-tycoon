// catalog.js — Data-driven AWS service catalog.
// Each service is a pure data record: id, label, emoji, brand color, stats
// (cost/throughput/latency), a "role" used for routing/topology rules, and a
// short tooltip blurb tying it back to the real AWS service.
//
// Optional gameplay-effect fields (all default to 1 / false / undefined if absent):
//   transferCostMul  — multiplier on BILL.transferPerHop for data crossing this tile
//                      (NAT Gateway = 8×; VPC Endpoint = 0.02×; default = 1)
//   attackMitigation — fraction of a traffic-spike spawnMultiplier excess absorbed
//                      (WAF = 0.5, Shield = 0.75; default = 0)
//   azResilient      — if true, tile is NOT disabled by an AZ failure event
//                      (RDS Multi-AZ has a synchronous standby; default = false)
//   autoScale        — if true, effective throughput scales with demand up to 2×
//                      (Aurora Serverless v2; default = false)
//   replayable       — narrative flag for Kinesis Streams (tooltip/teach only)
//   dependsOn        — structural dependency on another service that must be
//                      present on the board for this tile to function. Shape:
//                      { anyOf: [serviceId...], hint } — models real AWS topology
//                      (e.g. an RDS Read Replica replicates from a source primary
//                      and cannot exist standalone). A tile whose dependency is
//                      unmet is flagged invalid: it carries no traffic and can't
//                      be a routing sink until the dependency is satisfied.
//   validSinks       — for a fronting service that only fronts specific backends
//                      (Gateway VPC Endpoint serves S3 + DynamoDB only). Restricts
//                      which sink ids it may be wired to.
//
// ROLES drive the request path. A valid round-trip is:
//   GATE  ->  (any wired compute/edge tiles)  ->  SINK  ->  back to GATE
// Roles:
//   gate    — Route 53 entry/exit. Spawns requests; round-trip must return here.
//   edge    — load balancer / cache / CDN / network pass-through.
//   compute — EC2/ASG, Lambda, Kinesis Streams.
//   storage — S3 object store (acts as a valid sink too).
//   sink    — databases (RDS, DynamoDB, Firehose). The request's destination.

export const ROLE = {
  GATE: "gate",
  EDGE: "edge",
  COMPUTE: "compute",
  STORAGE: "storage",
  SINK: "sink",
};

// Master catalog. Keyed by id. `placeable` services appear in the build palette;
// the gate is placed by the level, not the palette.
export const SERVICES = {
  // ---- Gate (placed by level) ----
  route53: {
    id: "route53",
    label: "Route 53",
    short: "Gate",
    emoji: "🛂",
    role: ROLE.GATE,
    color: "#8e7bef",
    cost: 0,
    throughput: 999,
    latency: 1,
    placeable: false,
    blurb:
      "Route 53 — global DNS front gate. Immune to AZ failures, and traffic from the gate carries no inter-AZ charge (it's the internet edge). Wire it to any ALB or compute tile across the grid.",
    examTip:
      "Route 53 + health checks = multi-region active-active or active-passive failover. Combine latency-based routing with health checks for automatic region failover.",
  },

  // ---- Net / Edge ----
  alb: {
    id: "alb",
    label: "App Load Balancer",
    short: "ALB",
    emoji: "⚖️",
    role: ROLE.EDGE,
    color: "#ff9f1c",
    cost: 90,
    throughput: 40,
    latency: 3,
    placeable: true,
    blurb:
      "Application Load Balancer — distributes traffic across targets at L7. Cheap throughput multiplier; place between Route 53 and compute.",
    examTip:
      "ALB = L7 (HTTP/HTTPS), path/host-based routing, sticky sessions. NLB = L4, TCP/UDP, static IPs. Use NLB for non-HTTP or when you need a static IP.",
  },

  cloudfront: {
    id: "cloudfront",
    label: "CloudFront",
    short: "CDN",
    emoji: "☁️",
    role: ROLE.EDGE,
    color: "#ff6b6b",
    cost: 80,
    throughput: 120,
    latency: 1,
    transferCostMul: 0.2,
    placeable: true,
    blurb:
      "CloudFront CDN — global edge cache. High throughput and 80% cheaper data-transfer than a plain wire. Place before ALB to absorb traffic and cut egress costs.",
    examTip:
      "CloudFront + OAC (Origin Access Control) restricts S3 to CloudFront-only. Signed URLs/cookies control access to private content. Reduces origin load and egress costs.",
  },

  nat_gateway: {
    id: "nat_gateway",
    label: "NAT Gateway",
    short: "NAT-GW",
    emoji: "🌐",
    role: ROLE.EDGE,
    color: "#f77f00",
    cost: 100,
    throughput: 50,
    latency: 3,
    transferCostMul: 8,
    placeable: true,
    blurb:
      "NAT Gateway — routes private subnets to the internet. 8× data-transfer cost per hop. This is the 'leaky pipe' — replace with a VPC Endpoint for traffic destined for S3 or DynamoDB.",
    examTip:
      "NAT Gateway charges $0.045/GB processed. For S3/DynamoDB traffic from private subnets, a Gateway VPC Endpoint is free — always prefer it to avoid the NAT data-processing charge.",
  },

  vpc_endpoint: {
    id: "vpc_endpoint",
    label: "VPC Endpoint",
    short: "VPCE",
    emoji: "🔗",
    role: ROLE.EDGE,
    color: "#4cc9f0",
    cost: 25,
    throughput: 80,
    latency: 1,
    transferCostMul: 0.02,
    validSinks: ["s3", "dynamodb"],
    placeable: true,
    blurb:
      "VPC Endpoint (Gateway) — private path to S3/DynamoDB inside AWS. Near-zero data-transfer cost. Only fronts S3 or DynamoDB (the two Gateway-endpoint services). Replaces NAT Gateway for AWS-internal traffic and plugs the money leak.",
    examTip:
      "Gateway endpoints (S3, DynamoDB) are free — no per-hour or per-GB charge. Interface endpoints (PrivateLink) cost per-hour + per-GB. On SAA-C03: Gateway endpoint always wins over NAT for those two services.",
  },

  cache: {
    id: "cache",
    label: "ElastiCache",
    short: "Cache",
    emoji: "⚡",
    role: ROLE.EDGE,
    color: "#48cae4",
    cost: 70,
    throughput: 60,
    latency: 1,
    placeable: true,
    blurb:
      "ElastiCache — in-memory cache. Slashes latency for hot reads before they hit the DB. Pair with RDS to offload read traffic.",
    examTip:
      "ElastiCache Redis: persistence, pub/sub, sorted sets, multi-AZ. Memcached: simpler, multi-threaded, no persistence. Use Redis for session stores and leaderboards; Memcached for pure caching.",
  },

  // ---- Security ----
  waf: {
    id: "waf",
    label: "AWS WAF",
    short: "WAF",
    emoji: "🛡️",
    role: ROLE.EDGE,
    color: "#e63946",
    cost: 60,
    throughput: 80,
    latency: 2,
    attackMitigation: 0.5,
    placeable: true,
    blurb:
      "AWS WAF — web application firewall. Cuts the effective spawn rate during traffic spikes and DDoS events by 50%. Wire before your ALB.",
    examTip:
      "WAF attaches to CloudFront, ALB, API Gateway, or AppSync. Use Managed Rule Groups (AWS or Marketplace) for OWASP Top 10 coverage without writing rules. Shield + WAF = layered DDoS defense.",
  },

  shield: {
    id: "shield",
    label: "AWS Shield",
    short: "Shield",
    emoji: "🔰",
    role: ROLE.EDGE,
    color: "#2d6a4f",
    cost: 300,
    throughput: 999,
    latency: 0,
    attackMitigation: 0.75,
    placeable: true,
    blurb:
      "AWS Shield Advanced — premium DDoS protection. Absorbs 75% of any traffic spike excess, protecting upstream services. Expensive but essential during a DDoS wave.",
    examTip:
      "Shield Standard is free and always-on. Shield Advanced ($3,000/month) adds DRT access, real-time metrics, cost protection during attacks, and advanced anomaly detection.",
  },

  // ---- Compute ----
  ec2: {
    id: "ec2",
    label: "EC2 / Auto Scaling",
    short: "EC2",
    emoji: "🖥️",
    role: ROLE.COMPUTE,
    color: "#ff7b54",
    cost: 120,
    throughput: 30,
    latency: 6,
    placeable: true,
    blurb:
      "EC2 + Auto Scaling Group — workhorse fleet. Steady throughput; add more EC2 tiles to scale horizontally.",
    examTip:
      "Auto Scaling Groups span multiple AZs automatically. Use Launch Templates (not Configurations). Target Tracking policies respond to CloudWatch metrics for scale-out/in.",
  },

  lambda: {
    id: "lambda",
    label: "Lambda",
    short: "Lambda",
    emoji: "λ",
    role: ROLE.COMPUTE,
    color: "#ffb347",
    cost: 60,
    throughput: 25,
    latency: 4,
    placeable: true,
    blurb:
      "Lambda — serverless functions. Pay-per-use; bursts well with no idle cost. Lower throughput than EC2 but cheaper for spiky workloads.",
    examTip:
      "Lambda cold starts: worst with Java/.NET, better with Node/Python. Provisioned Concurrency eliminates cold starts for latency-sensitive workloads. Max 15-min timeout.",
  },

  kinesis_streams: {
    id: "kinesis_streams",
    label: "Kinesis Streams",
    short: "Streams",
    emoji: "🌊",
    role: ROLE.COMPUTE,
    color: "#7209b7",
    cost: 90,
    throughput: 100,
    latency: 2,
    replayable: true,
    placeable: true,
    blurb:
      "Kinesis Data Streams — replayable event stream. 24h default retention (up to 365 days). Use when downstream consumers need to re-read data. High throughput for analytics pipelines.",
    examTip:
      "1 shard = 1 MB/s write, 2 MB/s read. Data persists for replay unlike SQS. Enhanced fan-out = 2 MB/s per consumer. Use Streams when multiple consumers need different processing speeds.",
  },

  // ---- Data / Storage ----
  kinesis_firehose: {
    id: "kinesis_firehose",
    label: "Kinesis Firehose",
    short: "Firehose",
    emoji: "🚒",
    role: ROLE.SINK,
    color: "#f72585",
    cost: 50,
    throughput: 120,
    latency: 6,
    placeable: true,
    blurb:
      "Kinesis Firehose — reliable delivery to S3/Redshift. Very high throughput but NO replay: once delivered the stream is gone. Pair with Streams if you need replay upstream.",
    examTip:
      "Firehose buffers data (60s or 1 MB default) before delivery — it is near-real-time, not real-time. Destinations: S3, Redshift, OpenSearch, Splunk. Fully managed; no shard management.",
  },

  s3: {
    id: "s3",
    label: "S3",
    short: "S3",
    emoji: "🪣",
    role: ROLE.STORAGE,
    color: "#7ed957",
    cost: 25,
    throughput: 80,
    latency: 5,
    placeable: true,
    blurb:
      "S3 — durable object storage. Valid request destination for static/object reads. Cheapest sink; combine with Firehose for streaming data lakes.",
    examTip:
      "S3 storage classes: Standard → IA → One Zone-IA → Glacier Instant → Glacier Flexible → Deep Archive (cost descending, retrieval time ascending). Use S3 Lifecycle policies to automate transitions.",
  },

  // ---- Database ----
  rds: {
    id: "rds",
    label: "RDS",
    short: "RDS",
    emoji: "🛢️",
    role: ROLE.SINK,
    color: "#577590",
    cost: 150,
    throughput: 20,
    latency: 9,
    placeable: true,
    blurb:
      "RDS — managed relational database. Standard single-AZ instance. Upgrade to Multi-AZ for automatic failover or add a Read Replica for cheap read offloading.",
    examTip:
      "RDS Multi-AZ = synchronous replication, automatic failover, NO read scaling. Read Replica = asynchronous, readable, manual promotion. Multi-AZ → high availability; Read Replica → read scaling.",
  },

  rds_multiaz: {
    id: "rds_multiaz",
    label: "RDS Multi-AZ",
    short: "RDS-MAZ",
    emoji: "🔄",
    role: ROLE.SINK,
    color: "#1d3557",
    cost: 280,
    throughput: 20,
    latency: 9,
    azResilient: true,
    placeable: true,
    blurb:
      "RDS Multi-AZ — synchronous standby in a second AZ. Auto-promotes on AZ failure. Does NOT improve throughput (same single-writer). Worth the cost for critical OLTP workloads.",
    examTip:
      "RDS Multi-AZ standby is NOT readable — it only promotes during failover. Failover takes 60–120 seconds. For readable standbys use Aurora Multi-AZ, which has up to 15 readable replicas.",
  },

  rds_replica: {
    id: "rds_replica",
    label: "RDS Read Replica",
    short: "Replica",
    emoji: "📖",
    role: ROLE.SINK,
    color: "#457b9d",
    cost: 130,
    throughput: 20,
    latency: 9,
    dependsOn: {
      anyOf: ["rds", "rds_multiaz"],
      hint: "Read Replica needs a source RDS primary on the board — it replicates from a primary and cannot stand alone. Place an RDS or RDS Multi-AZ first.",
    },
    placeable: true,
    blurb:
      "RDS Read Replica — asynchronous read-only copy of a source RDS primary (can be in a different AZ). Requires a primary RDS on the board. Offloads reads cheaply but does NOT auto-promote on AZ failure. Same-AZ replica = free cross-AZ read traffic.",
    examTip:
      "Read Replicas have asynchronous lag — not for RPO=0 scenarios. Can be promoted manually (takes time). Cross-region replicas enable disaster recovery. Max 5 replicas per source RDS instance.",
  },

  dynamodb: {
    id: "dynamodb",
    label: "DynamoDB",
    short: "DDB",
    emoji: "🧊",
    role: ROLE.SINK,
    color: "#4361ee",
    cost: 110,
    throughput: 70,
    latency: 2,
    placeable: true,
    blurb:
      "DynamoDB — managed NoSQL. Very high throughput with single-digit millisecond latency. Pairs well with DAX for hot-key caching.",
    examTip:
      "DynamoDB On-Demand vs Provisioned: On-Demand for unpredictable traffic (no capacity planning); Provisioned + Auto Scaling for predictable, cost-optimized. DDB TTL auto-expires items for free.",
  },

  aurora_sv2: {
    id: "aurora_sv2",
    label: "Aurora Serverless v2",
    short: "Aur-SV2",
    emoji: "🔆",
    role: ROLE.SINK,
    color: "#06d6a0",
    cost: 180,
    throughput: 45,
    latency: 5,
    autoScale: true,
    placeable: true,
    blurb:
      "Aurora Serverless v2 — vertical auto-scaling (ACUs). Handles spikes by scaling up automatically, up to 2× base throughput. One writer; best for unpredictable workloads. Cannot scale past a ceiling.",
    examTip:
      "Aurora SV2 scales in-place (no failover) from minimum to maximum ACUs. Still a single writer — it scales vertically. When the single-writer ceiling is the problem, Limitless (horizontal sharding) is the answer.",
  },

  aurora_limitless: {
    id: "aurora_limitless",
    label: "Aurora Limitless",
    short: "Limitless",
    emoji: "♾️",
    role: ROLE.SINK,
    color: "#118ab2",
    cost: 350,
    throughput: 200,
    latency: 4,
    placeable: true,
    blurb:
      "Aurora Limitless — horizontal sharding (distributed writer). Breaks the single-writer ceiling by sharding across nodes. Very high cost; use only when Serverless v2 auto-scaling ceiling is hit.",
    examTip:
      "Aurora Limitless uses distributed transactions across shard nodes. Choose it only when write throughput genuinely exceeds a single writer's maximum ACU ceiling. Cost is significantly higher than SV2.",
  },
};

// Palette groups — drives the category-tab palette UI.
// Each group appears as a tab; its `ids` are shown in the service row.
export const PALETTE_GROUPS = [
  { id: "net",      label: "Net",      ids: ["alb", "cloudfront", "nat_gateway", "vpc_endpoint", "cache"] },
  { id: "compute",  label: "Compute",  ids: ["ec2", "lambda", "kinesis_streams"] },
  { id: "data",     label: "Data",     ids: ["kinesis_firehose", "s3"] },
  { id: "database", label: "DB",       ids: ["rds", "rds_multiaz", "rds_replica", "dynamodb", "aurora_sv2", "aurora_limitless"] },
  { id: "security", label: "Security", ids: ["waf", "shield"] },
];

// Flat ordered list (all placeable services) — kept for smoke tests / iteration.
export const PALETTE_ORDER = PALETTE_GROUPS.flatMap((g) => g.ids);

// Roles that a completed request may terminate at (its "database/sink").
export const SINK_ROLES = new Set([ROLE.SINK, ROLE.STORAGE]);

// Connection rule: which role can wire to which. Symmetric helper below.
// Kept permissive (build/route focus); Phase 5 typed-connections tighten this.
// Disallowed: gate<->gate and sink<->sink direct links (forces real topology).
const CONNECT = {
  [ROLE.GATE]:    new Set([ROLE.EDGE, ROLE.COMPUTE]),
  [ROLE.EDGE]:    new Set([ROLE.GATE, ROLE.EDGE, ROLE.COMPUTE, ROLE.STORAGE, ROLE.SINK]),
  [ROLE.COMPUTE]: new Set([ROLE.GATE, ROLE.EDGE, ROLE.COMPUTE, ROLE.STORAGE, ROLE.SINK]),
  [ROLE.STORAGE]: new Set([ROLE.EDGE, ROLE.COMPUTE]),
  [ROLE.SINK]:    new Set([ROLE.EDGE, ROLE.COMPUTE]),
};

export function canConnect(roleA, roleB) {
  const a = CONNECT[roleA];
  const b = CONNECT[roleB];
  if (!a || !b) return false;
  return a.has(roleB) && b.has(roleA);
}

// Service-level wire legality: role compatibility plus per-service constraints
// that model real AWS topology. Order-independent (wires are undirected).
//   - Gateway VPC Endpoint may only front the sinks in its `validSinks` list
//     (S3, DynamoDB) — it cannot provide a private path to RDS/Aurora/etc.
export function canWire(svcA, svcB) {
  if (!svcA || !svcB) return false;
  if (!canConnect(svcA.role, svcB.role)) return false;
  const vpceViolation = (front, back) =>
    front.validSinks &&
    SINK_ROLES.has(back.role) &&
    !front.validSinks.includes(back.id);
  if (vpceViolation(svcA, svcB) || vpceViolation(svcB, svcA)) return false;
  return true;
}

export function getService(id) {
  return SERVICES[id] || null;
}
