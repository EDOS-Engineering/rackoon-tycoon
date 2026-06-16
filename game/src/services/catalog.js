// catalog.js — Data-driven AWS service catalog.
// Each service is a pure data record: id, label, emoji, brand color, stats
// (cost/throughput/latency), a "role" used for routing/topology rules, and a
// short tooltip blurb tying it back to the real AWS service. Phase 2 will read
// `cost`/`throughput` for the live AWS bill + overload mechanics; Phase 1 uses
// `cost` for budget gating and shows the rest in tooltips.
//
// ROLES drive the request path. A valid round-trip is:
//   GATE  ->  (any wired compute/edge tiles)  ->  SINK  ->  back to GATE
// Roles:
//   gate    — Route 53 entry/exit. Spawns requests; round-trip must return here.
//   edge    — load balancer / cache / CDN style pass-through.
//   compute — EC2/ASG, Lambda. Processes requests.
//   storage — S3 object store (acts as a valid sink too).
//   sink    — databases (RDS, DynamoDB). The request's destination.

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
      "Route 53 — DNS front gate. Guests (requests) enter and must exit here for a complete round-trip.",
  },

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
      "Application Load Balancer — spreads traffic across targets. Cheap throughput multiplier at L7.",
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
      "ElastiCache — in-memory cache. Slashes latency for hot reads before they ever hit the DB.",
  },

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
      "EC2 + Auto Scaling Group — your workhorse fleet. Steady throughput; scales with the wave (Phase 2).",
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
      "Lambda — serverless functions. Pay-per-use compute; bursts well, no idle cost.",
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
      "S3 — object storage. Durable, cheap. Valid request destination for static/object reads.",
  },

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
      "RDS — managed relational database. A request SINK: trips must reach a database and return.",
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
      "DynamoDB — managed NoSQL. A request SINK with very high throughput and single-digit latency.",
  },
};

// Ordered list for the build palette (gate excluded — level places it).
export const PALETTE_ORDER = [
  "alb",
  "cache",
  "ec2",
  "lambda",
  "s3",
  "rds",
  "dynamodb",
];

// Roles that a completed request may terminate at (its "database/sink").
export const SINK_ROLES = new Set([ROLE.SINK, ROLE.STORAGE]);

// Connection rule: which role can wire to which. Symmetric helper below.
// Kept permissive in Phase 1 (build/route focus); Phase 3 puzzles tighten this.
// Disallowed today: gate<->gate and sink<->sink direct links (forces real topology).
const CONNECT = {
  [ROLE.GATE]: new Set([ROLE.EDGE, ROLE.COMPUTE]),
  [ROLE.EDGE]: new Set([ROLE.GATE, ROLE.EDGE, ROLE.COMPUTE, ROLE.STORAGE, ROLE.SINK]),
  [ROLE.COMPUTE]: new Set([ROLE.GATE, ROLE.EDGE, ROLE.COMPUTE, ROLE.STORAGE, ROLE.SINK]),
  [ROLE.STORAGE]: new Set([ROLE.EDGE, ROLE.COMPUTE]),
  [ROLE.SINK]: new Set([ROLE.EDGE, ROLE.COMPUTE]),
};

export function canConnect(roleA, roleB) {
  const a = CONNECT[roleA];
  const b = CONNECT[roleB];
  if (!a || !b) return false;
  // Require mutual compatibility so the rule reads the same from either tile.
  return a.has(roleB) && b.has(roleA);
}

export function getService(id) {
  return SERVICES[id] || null;
}
