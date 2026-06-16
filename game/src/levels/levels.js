// levels.js — Data-driven level definitions.
// Phase 1 shipped "First Light" (a gentle free-build intro). Phase 2 extends the
// same generic record with `waves`, `events`, and win/lose config — without
// touching the engine — and adds two pressure levels. Phase 3 gap-puzzles can
// extend this further (e.g. `requiredService`, tightened topology).
//
// Record shape (all Phase-2 fields optional; sensible defaults apply):
//   id, name, subtitle, cols, rows, budget, spawnRate, gates, seed, intro
//   goalRequests   — routed-request target (a win condition + results goal)
//   next           — id of the level this one unlocks on a win
//   slaMaxDropRate — lose if the drop rate exceeds this (default 0.35)
//   waves          — [{ name, duration, rate }]  spawn-rate timeline (T2.2)
//   events         — [{ at, kind, duration, warn, zone?, magnitude? }] (T2.3)
//
// Event kinds: "az_failure" | "traffic_spike" | "cost_audit" (see waves/events).

export const LEVELS = {
  first_light: {
    id: "first_light",
    name: "First Light",
    subtitle: "Wire your first round-trip",
    cols: 14,
    rows: 9,
    budget: 1200,
    spawnRate: 1.1,
    gates: [{ col: 1, row: 4 }],
    seed: [],
    goalRequests: 30,
    next: "rush_hour",
    // Gentle intro: a soft single ramp, no disruptions. The live bill still
    // ticks (T2.1) so players learn to watch their burn before the stakes rise.
    waves: [
      { name: "Quiet open", duration: 22, rate: 1.0 },
      { name: "First guests", duration: 28, rate: 1.4 },
      { name: "Steady flow", duration: 30, rate: 1.7 },
    ],
    events: [], // no events in the tutorial level
    slaMaxDropRate: 0.5, // forgiving SLA while learning
    intro:
      "Place an ALB, some compute, and a database. Wire the gate → compute → database, then watch the guests flow. Keep an eye on your live AWS bill (top-left burn rate). Reach 30 routed requests.",
  },

  rush_hour: {
    id: "rush_hour",
    name: "Rush Hour",
    subtitle: "Survive the surge without dropping requests",
    cols: 16,
    rows: 10,
    budget: 1600,
    spawnRate: 1.2,
    gates: [{ col: 1, row: 5 }],
    seed: [],
    goalRequests: 70,
    next: "zone_down",
    // Escalating waves climb past a single DB's throughput — players must add
    // caches / parallel compute / a higher-throughput sink (DynamoDB) or watch
    // latency spike and requests drop. One mid-level traffic spike to test it.
    waves: [
      { name: "Warm-up", duration: 18, rate: 1.0 },
      { name: "Morning rush", duration: 26, rate: 2.0 },
      { name: "Peak load", duration: 30, rate: 3.0 },
      { name: "Wind-down", duration: 16, rate: 1.4 },
    ],
    events: [
      { at: 40, kind: "traffic_spike", duration: 9, warn: 6, magnitude: 1.9 },
    ],
    slaMaxDropRate: 0.35,
    intro:
      "Traffic escalates in waves. A single small database will choke — its queue fills, latency climbs, requests drop. Spread load with a cache and parallel compute, or pick a higher-throughput sink. A traffic spike hits mid-shift. Route 70 to win.",
  },

  zone_down: {
    id: "zone_down",
    name: "When the Zone Goes Dark",
    subtitle: "An AZ fails — resilient designs survive",
    cols: 18,
    rows: 11,
    budget: 2000,
    spawnRate: 1.2,
    gates: [{ col: 1, row: 5 }],
    seed: [],
    goalRequests: 90,
    next: null, // end of the Phase-2 set (Phase 3 boss gaps continue from here)
    // The board is split into 3 AZ bands by column. A mid-level AZ failure takes
    // a whole band offline: anything you single-pointed there goes dark. Spread
    // compute + a second DB across zones to keep routing through the outage.
    // A cost audit afterward squeezes the budget — don't over-provision.
    waves: [
      { name: "Warm-up", duration: 16, rate: 1.0 },
      { name: "Build pressure", duration: 26, rate: 2.2 },
      { name: "Peak load", duration: 30, rate: 3.0 },
      { name: "Aftermath", duration: 22, rate: 1.8 },
    ],
    events: [
      { at: 30, kind: "traffic_spike", duration: 8, warn: 5, magnitude: 1.7 },
      { at: 52, kind: "az_failure", duration: 14, warn: 7, zone: 1 },
      { at: 80, kind: "cost_audit", duration: 14, warn: 5, magnitude: 1.6 },
    ],
    slaMaxDropRate: 0.32,
    intro:
      "The park spans three Availability Zones (column bands). Mid-shift, a zone goes DARK — every building there is disabled and routes through it break. Design for resilience: spread compute and a second database across zones so traffic reroutes. Then a cost audit inflates your bill. Route 90 to win.",
  },
};

// Campaign order (drives unlock chain + level-select on the title screen).
export const LEVEL_ORDER = ["first_light", "rush_hour", "zone_down"];

export const FIRST_LEVEL = "first_light";

export function getLevel(id) {
  return LEVELS[id] || LEVELS[FIRST_LEVEL];
}
