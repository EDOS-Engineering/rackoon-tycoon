// pathfind.js — BFS over the wire graph for request routing.
// A request must travel: GATE -> ... -> SINK -> ... -> GATE (round-trip).
// We compute the shortest hop path from the gate to the *nearest reachable*
// sink/storage building, then the return path back to the gate. Because wires
// are undirected, the return is the forward path reversed — but we re-run BFS
// from the sink so future topology changes (one-way logic in later phases) stay
// localized to this module.
//
// Output is a list of tile keys ["c,r", ...] the packet walks through.

import { Grid } from "./grid.js";
import { SINK_ROLES } from "../services/catalog.js";

// Breadth-first search returning a map of cameFrom for path reconstruction.
// `goalTest(key, building)` returns true when `key` is an acceptable goal.
// `isBlocked(key)` (optional) lets the caller exclude tiles from routing — used
// in Phase 2 so an AZ-failure event disables every tile in the failed zone and
// requests must reroute around it.
function bfs(grid, startKey, goalTest, isBlocked) {
  const cameFrom = new Map();
  cameFrom.set(startKey, null);
  const queue = [startKey];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    const [c, r] = Grid.parseKey(cur);
    const b = grid.getBuilding(c, r);
    if (cur !== startKey && b && goalTest(cur, b)) {
      return reconstruct(cameFrom, startKey, cur);
    }
    for (const nk of grid.neighbors(cur)) {
      if (cameFrom.has(nk)) continue;
      if (isBlocked && nk !== startKey && isBlocked(nk)) continue;
      cameFrom.set(nk, cur);
      queue.push(nk);
    }
  }
  return null;
}

function reconstruct(cameFrom, startKey, goalKey) {
  const path = [];
  let cur = goalKey;
  while (cur != null) {
    path.push(cur);
    if (cur === startKey) break;
    cur = cameFrom.get(cur);
  }
  path.reverse();
  return path;
}

// Find a full round-trip path from a gate tile, or null if no sink is reachable.
// Returns { path: ["c,r"...], sinkKey } where path includes the return to gate.
// `isBlocked(key)` (optional) excludes disabled tiles (e.g. an AZ failure).
export function findRoundTrip(grid, gateKey, isBlocked) {
  const [gc, gr] = Grid.parseKey(gateKey);
  const gate = grid.getBuilding(gc, gr);
  if (!gate) return null;

  // Leg 1: gate -> nearest sink/storage (skipping blocked tiles).
  const toSink = bfs(
    grid,
    gateKey,
    (key, b) => SINK_ROLES.has(b.service.role),
    isBlocked
  );
  if (!toSink) return null;
  const sinkKey = toSink[toSink.length - 1];

  // Leg 2: sink -> back to this exact gate.
  const back = bfs(grid, sinkKey, (key, b) => key === gateKey, isBlocked);
  if (!back) return null;

  // Stitch: drop the duplicated sink node at the seam.
  const full = toSink.concat(back.slice(1));
  return { path: full, sinkKey };
}

// Quick reachability check used by the HUD to show "topology OK?" without
// building a full packet. Returns true if any sink is reachable from the gate.
export function gateHasRoute(grid, gateKey, isBlocked) {
  return findRoundTrip(grid, gateKey, isBlocked) != null;
}
