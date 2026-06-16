// events.js — Scheduled disruptions (T2.3).
// Three event kinds, each telegraphed with a warning banner + countdown before
// it hits, then active for a duration:
//   - az_failure  : an Availability Zone goes dark. Every building whose tile
//                   falls in the failed AZ band is disabled (offline) for the
//                   duration — wires through it break, forcing resilient designs
//                   that spread compute/DBs across AZs.
//   - traffic_spike: a burst multiplier stacks onto the wave spawn rate.
//   - cost_audit  : finance comes calling; the running + transfer bill is
//                   multiplied for the duration (squeezes the budget).
//
// AZ model: the grid is divided into N vertical bands ("zones") by column. A
// building's zone is derived from its column. This keeps the AZ concept visible
// and the failure spatially legible.
//
// The EventDirector walks a level's `events` timeline (or a default set), owns
// the warn->active->done lifecycle, and exposes:
//   - isTileDisabled(col,row)  -> true when an AZ failure covers that tile
//   - spawnMultiplier()        -> traffic-spike factor (1 when none)
//   - billMultiplier()         -> cost-audit factor (1 when none)
//   - banner()                 -> {text, kind, countdown, active} for the HUD
//
// Lifecycle states per event: "pending" -> "warning" -> "active" -> "done".

export const EVENT_KIND = {
  AZ_FAILURE: "az_failure",
  TRAFFIC_SPIKE: "traffic_spike",
  COST_AUDIT: "cost_audit",
};

// How many AZ bands the grid is divided into.
export const AZ_COUNT = 3;

export function zoneOfColumn(col, cols) {
  const band = cols / AZ_COUNT;
  return Math.min(AZ_COUNT - 1, Math.floor(col / band));
}

export function zoneColumnRange(zone, cols) {
  const band = cols / AZ_COUNT;
  return [Math.floor(zone * band), Math.floor((zone + 1) * band) - 1];
}

export const AZ_LABELS = ["us-rk-1a", "us-rk-1b", "us-rk-1c"];

// A default escalating event set, timed in level-seconds (used when a level
// omits `events`). Each entry: { at, kind, duration, warn, zone?, magnitude? }.
const DEFAULT_EVENTS = [
  { at: 30, kind: EVENT_KIND.TRAFFIC_SPIKE, duration: 8, warn: 5, magnitude: 1.8 },
  { at: 52, kind: EVENT_KIND.AZ_FAILURE, duration: 12, warn: 6, zone: 1 },
  { at: 78, kind: EVENT_KIND.COST_AUDIT, duration: 14, warn: 5, magnitude: 1.6 },
];

export class EventDirector {
  constructor(events, cols) {
    this.cols = cols;
    this.events = (events && events.length ? events : DEFAULT_EVENTS).map((e) => ({
      ...e,
      state: "pending",
    }));
    this.t = 0;
  }

  reset() {
    this.t = 0;
    for (const e of this.events) e.state = "pending";
  }

  tick(dt) {
    this.t += dt;
    for (const e of this.events) {
      const warnStart = e.at - (e.warn || 5);
      if (e.state === "pending" && this.t >= warnStart) e.state = "warning";
      if ((e.state === "warning" || e.state === "pending") && this.t >= e.at)
        e.state = "active";
      if (e.state === "active" && this.t >= e.at + e.duration) e.state = "done";
    }
  }

  _active(kind) {
    return this.events.filter((e) => e.state === "active" && e.kind === kind);
  }

  // True if any active AZ failure covers this tile's zone.
  isTileDisabled(col, row) {
    const z = zoneOfColumn(col, this.cols);
    for (const e of this._active(EVENT_KIND.AZ_FAILURE)) {
      if (e.zone === z) return true;
    }
    return false;
  }

  // Set of currently-failed zone indices (for floor tinting).
  failedZones() {
    const s = new Set();
    for (const e of this._active(EVENT_KIND.AZ_FAILURE)) s.add(e.zone);
    return s;
  }

  spawnMultiplier() {
    let m = 1;
    for (const e of this._active(EVENT_KIND.TRAFFIC_SPIKE)) m *= e.magnitude || 1.5;
    return m;
  }

  billMultiplier() {
    let m = 1;
    for (const e of this._active(EVENT_KIND.COST_AUDIT)) m *= e.magnitude || 1.5;
    return m;
  }

  // The most urgent banner to show: a warning counting down, else an active
  // event with its remaining time, else null.
  banner() {
    // Prefer an imminent warning (telegraph).
    let warn = null;
    for (const e of this.events) {
      if (e.state === "warning") {
        const cd = e.at - this.t;
        if (!warn || cd < warn.countdown) warn = { e, countdown: cd };
      }
    }
    if (warn) {
      return {
        kind: warn.e.kind,
        active: false,
        countdown: Math.max(0, warn.countdown),
        text: warningText(warn.e, this.cols),
      };
    }
    // Else surface an active event with its time left.
    let act = null;
    for (const e of this.events) {
      if (e.state === "active") {
        const left = e.at + e.duration - this.t;
        if (!act || left < act.countdown) act = { e, countdown: left };
      }
    }
    if (act) {
      return {
        kind: act.e.kind,
        active: true,
        countdown: Math.max(0, act.countdown),
        text: activeText(act.e, this.cols),
      };
    }
    return null;
  }
}

function zoneName(zone) {
  return AZ_LABELS[zone] || "AZ-" + zone;
}

function warningText(e, cols) {
  switch (e.kind) {
    case EVENT_KIND.AZ_FAILURE:
      return "⚠ AZ instability detected in " + zoneName(e.zone) + " — failover imminent";
    case EVENT_KIND.TRAFFIC_SPIKE:
      return "⚠ Traffic spike inbound — a surge of guests is on the way";
    case EVENT_KIND.COST_AUDIT:
      return "⚠ Cost audit scheduled — your bill is about to be scrutinised";
    default:
      return "⚠ Incident inbound";
  }
}

function activeText(e, cols) {
  switch (e.kind) {
    case EVENT_KIND.AZ_FAILURE:
      return "🛑 " + zoneName(e.zone) + " is DOWN — tiles in this zone are offline";
    case EVENT_KIND.TRAFFIC_SPIKE:
      return "🔥 Traffic spike! Requests pouring in";
    case EVENT_KIND.COST_AUDIT:
      return "💸 Cost audit active — running bill inflated";
    default:
      return "Incident active";
  }
}
