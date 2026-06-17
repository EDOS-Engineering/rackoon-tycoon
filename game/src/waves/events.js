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

import { IncidentDeck } from "./incidents.js";

export const EVENT_KIND = {
  AZ_FAILURE: "az_failure",
  TRAFFIC_SPIKE: "traffic_spike",
  COST_AUDIT: "cost_audit",
  SPOT_INTERRUPTION: "spot_interruption",
  REGION_FAILURE: "region_failure",
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
  { at: 52, kind: EVENT_KIND.AZ_FAILURE, duration: 12, warn: 6 }, // zone randomized at runtime
  { at: 78, kind: EVENT_KIND.COST_AUDIT, duration: 14, warn: 5, magnitude: 1.6 },
];

export class EventDirector {
  // `rng` is the seedable sim RNG (defaults to Math.random for back-compat).
  // `deck` (optional, Phase 7 R5) is an IncidentDeck spec: when present the
  // director draws unscripted incidents over time on top of any scripted events.
  constructor(events, cols, rng = Math.random, deck = null) {
    this.cols = cols;
    this._rng = rng;
    // Clone events and assign random zones for AZ failures whose zone was not
    // explicitly pinned. Multiple AZ failures in the same level get distinct
    // zones so the player always faces real multi-AZ pressure.
    const usedZones = new Set();
    this.events = (events && events.length ? events : DEFAULT_EVENTS).map((e) => {
      const ev = { ...e, state: "pending" };
      if (ev.kind === EVENT_KIND.AZ_FAILURE && ev.zone == null) {
        const avail = [];
        for (let z = 0; z < AZ_COUNT; z++) {
          if (!usedZones.has(z)) avail.push(z);
        }
        ev.zone = avail.length > 0
          ? avail[Math.floor(this._rng() * avail.length)]
          : Math.floor(this._rng() * AZ_COUNT);
      }
      if (ev.kind === EVENT_KIND.AZ_FAILURE) usedZones.add(ev.zone);
      // A region failure downs a set of AZ bands (the "primary region"). Default:
      // every band except the last, leaving the last band as the surviving DR region.
      if (ev.kind === EVENT_KIND.REGION_FAILURE && ev.zones == null) {
        ev.zones = [];
        for (let z = 0; z < AZ_COUNT - 1; z++) ev.zones.push(z);
      }
      return ev;
    });
    this.t = 0;
    // R5: optional unscripted incident deck. Lazy import kept at module top.
    this.deck = deck ? new IncidentDeck(deck, rng) : null;
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
    // Draw any unscripted incident due now and schedule it like a normal event
    // (it'll telegraph then activate on subsequent ticks via the loop above).
    if (this.deck) {
      const activeCount = this.events.filter((e) => e.state === "active").length;
      const drawn = this.deck.maybeDraw(this.t, activeCount);
      if (drawn) {
        this._placeDrawn(drawn);
        this.events.push(drawn);
      }
    }
  }

  // Assign a spatial target to a freshly-drawn incident: an AZ failure prefers a
  // zone that isn't already down; a region failure downs every band but the last.
  _placeDrawn(ev) {
    if (ev.kind === EVENT_KIND.AZ_FAILURE && ev.zone == null) {
      const failed = this.failedZones();
      const avail = [];
      for (let z = 0; z < AZ_COUNT; z++) if (!failed.has(z)) avail.push(z);
      ev.zone = avail.length
        ? avail[Math.floor(this._rng() * avail.length)]
        : Math.floor(this._rng() * AZ_COUNT);
    }
    if (ev.kind === EVENT_KIND.REGION_FAILURE && ev.zones == null) {
      ev.zones = [];
      for (let z = 0; z < AZ_COUNT - 1; z++) ev.zones.push(z);
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

  // True if the tile's zone is inside an active region failure (the whole
  // primary region is down). Unlike an AZ failure, Multi-AZ does NOT survive this
  // — only a stack replicated into the surviving DR region (and the global gate).
  isTileInFailedRegion(col, row) {
    const z = zoneOfColumn(col, this.cols);
    for (const e of this._active(EVENT_KIND.REGION_FAILURE)) {
      if ((e.zones || []).includes(z)) return true;
    }
    return false;
  }

  // Set of currently-failed zone indices (for floor tinting) — AZ + region.
  failedZones() {
    const s = new Set();
    for (const e of this._active(EVENT_KIND.AZ_FAILURE)) s.add(e.zone);
    for (const e of this._active(EVENT_KIND.REGION_FAILURE)) {
      for (const z of e.zones || []) s.add(z);
    }
    return s;
  }

  spawnMultiplier() {
    let m = 1;
    for (const e of this._active(EVENT_KIND.TRAFFIC_SPIKE)) m *= e.magnitude || 1.5;
    return m;
  }

  // True while a spot-interruption event is active — Spot compute tiles go offline.
  spotInterrupted() {
    return this._active(EVENT_KIND.SPOT_INTERRUPTION).length > 0;
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
    case EVENT_KIND.SPOT_INTERRUPTION:
      return "⚠ Spot capacity reclamation inbound — Spot instances will be interrupted";
    case EVENT_KIND.REGION_FAILURE:
      return "⚠ Region-wide outage imminent — the entire primary region is going dark";
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
    case EVENT_KIND.SPOT_INTERRUPTION:
      return "🎰 Spot interruption — Spot instances are OFFLINE";
    case EVENT_KIND.REGION_FAILURE:
      return "🛑 PRIMARY REGION DOWN — only the DR region survives. Route 53, fail over!";
    default:
      return "Incident active";
  }
}
