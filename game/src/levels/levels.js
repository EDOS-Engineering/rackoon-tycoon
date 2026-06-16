// levels.js — Data-driven level definitions.
// Phase 1 ships one hand-tuned "First Light" level (a free-build sandbox with a
// budget and a fixed gate). The shape here is intentionally generic so Phase 2
// can add waves/win-conditions and Phase 3 can add gap puzzles by extending the
// same record (e.g. `waves`, `events`, `requiredService`).

export const LEVELS = {
  first_light: {
    id: "first_light",
    name: "First Light",
    subtitle: "Wire your first round-trip",
    cols: 14,
    rows: 9,
    budget: 1200,
    // Requests per second spawned at the gate once a route exists.
    spawnRate: 1.1,
    // Gate(s) placed by the level (col,row). Requests enter & exit here.
    gates: [{ col: 1, row: 4 }],
    // Optional pre-placed buildings to seed the board (none — let the player build).
    seed: [],
    // Phase-1 "goal" shown on the results screen (informational target).
    goalRequests: 30,
    intro:
      "Place an ALB, some compute, and a database. Wire the gate → compute → database, then watch the guests flow. Reach 30 routed requests.",
  },
};

export function getLevel(id) {
  return LEVELS[id] || LEVELS.first_light;
}
