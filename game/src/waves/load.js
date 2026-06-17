// load.js — Per-building load + overload model (T2.2).
// A building can only process so many concurrent requests before it saturates:
//   - We measure each building's *demand* = how many in-flight packets are
//     currently routed through it (their path passes over its tile).
//   - capacity = the service's catalog `throughput`.
//   - load = demand / capacity. Below 1.0 the building is healthy.
//   - Above 1.0 it is overloaded: excess requests queue, queue depth pushes
//     latency up, and once the queue exceeds a tolerance the building starts
//     dropping the requests crossing it (SLA breach).
//
// This module owns the per-building runtime state (load/heat/queue/latency) and
// decides, per packet-hop, whether an overloaded building drops that packet. The
// level scene feeds it demand and asks it for drop decisions; rendering reads
// `b.load`/`b.heat` to tint hot buildings.
//
// State lives on the Building instance under `b.load`, `b.heat`, `b.queue`,
// `b.latencyMs`, `b.dropping` so the renderer + tooltips can read it directly.

// Queue (in "requests") a building tolerates before it starts shedding load.
const QUEUE_TOLERANCE = 6;
// How fast the queue fills/drains relative to the overflow each second.
const QUEUE_FILL = 1.0;
const QUEUE_DRAIN = 2.2;
// Heat easing toward the live load (so the color glides, no strobing).
const HEAT_EASE = 6;

export class LoadModel {
  constructor() {
    this._demand = new Map(); // building key -> concurrent packet count
  }

  reset() {
    this._demand.clear();
  }

  // Recompute demand from the live packet list. Each packet contributes 1 unit
  // of demand to every *processing* building (compute/edge/storage/sink) on its
  // remaining path — i.e. the buildings it still has to pass through. The gate
  // is infinite-capacity and excluded.
  measure(grid, packets) {
    this._demand.clear();
    for (const p of packets) {
      if (p.status === "done" || p.status === "dropped") continue;
      const idx = Math.floor(p.t);
      const seen = p._loadSeen || (p._loadSeen = new Set());
      // Count the building the packet currently occupies (and ahead) once.
      for (let i = idx; i < p.path.length; i++) {
        const key = p.path[i];
        // Only bill demand for the tile the packet is *at or entering* this
        // window; counting the whole forward path would multiply-count shared
        // nodes. We attribute to the current node for a stable, fair signal.
        if (i > idx + 1) break;
        const cur = this._demand.get(key) || 0;
        this._demand.set(key, cur + (i === idx ? 1 : 0.5));
      }
    }
  }

  // Update each building's load/heat/queue/latency from current demand.
  update(grid, dt) {
    for (const b of grid.buildings.values()) {
      if (b.service.role === "gate") {
        b.load = 0;
        b.heat = 0;
        b.queue = 0;
        b.latencyMs = b.service.latency;
        b.dropping = false;
        continue;
      }
      // autoScale (Aurora Serverless v2): effective capacity scales with demand
      // up to 2× the base throughput, simulating ACU vertical auto-scaling.
      const baseCap = Math.max(1, b.service.throughput);
      const cap = b.service.autoScale
        ? Math.min(baseCap * 2, Math.max(baseCap, (this._demand.get(keyOf(b)) || 0) * 1.1))
        : baseCap;
      const demand = this._demand.get(keyOf(b)) || 0;
      const load = demand / cap;
      if (b.load == null) b.load = 0;

      // Queue integrates the overflow (load above 1.0); drains when healthy.
      if (b.queue == null) b.queue = 0;
      if (load > 1) {
        b.queue += (load - 1) * cap * QUEUE_FILL * dt;
      } else {
        b.queue = Math.max(0, b.queue - QUEUE_DRAIN * dt);
      }
      b.queue = Math.min(b.queue, QUEUE_TOLERANCE * 2.5);

      // Latency rises with queue depth (base + a millisecond per queued req).
      b.latencyMs = b.service.latency + b.queue * 8;
      // Dropping once the queue blows past tolerance.
      b.dropping = b.queue > QUEUE_TOLERANCE;

      // Live load (incl. queue pressure) for color; heat eases toward it.
      const pressure = load + b.queue / QUEUE_TOLERANCE;
      b.load = pressure;
      const target = Math.min(1.4, pressure);
      b.heat = (b.heat || 0) + (target - (b.heat || 0)) * Math.min(1, HEAT_EASE * dt);
    }
  }

  // Should the building at `key` drop a packet crossing it right now? Overloaded
  // buildings shed a fraction of crossings proportional to how far past
  // tolerance their queue is. Returns true to drop.
  shouldDrop(grid, key) {
    const [c, r] = parseKey(key);
    const b = grid.getBuilding(c, r);
    if (!b || !b.dropping) return false;
    const over = (b.queue - QUEUE_TOLERANCE) / QUEUE_TOLERANCE; // 0..~1.5
    const pDrop = Math.min(0.85, Math.max(0.05, over));
    return Math.random() < pDrop;
  }
}

function keyOf(b) {
  return b.col + "," + b.row;
}
function parseKey(k) {
  const i = k.indexOf(",");
  return [parseInt(k.slice(0, i), 10), parseInt(k.slice(i + 1), 10)];
}
