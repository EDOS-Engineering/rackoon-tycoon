// incidents.js — A seeded incident deck (Phase 7, R5 / T7.3).
//
// The scripted `events[]` timeline is great for a hand-authored boss level, but a
// living, long-running system needs *unscripted* trouble: incidents that arrive
// on their own schedule, weighted by likelihood, telegraphed before they hit,
// escalating over time, and spaced by cooldowns so the same kind doesn't chain.
//
// IncidentDeck is the draw engine. It holds NO world state and renders nothing —
// each tick the EventDirector asks `maybeDraw(t, activeCount)` and, when the deck
// decides it's time, gets back a fully-rolled incident descriptor (kind, warn,
// duration, magnitude) which the director schedules into its normal
// warn→active→done lifecycle. Because the drawn incidents are ordinary `events`
// entries, every existing query (isTileDisabled / spawnMultiplier / billMultiplier
// / banner / spotInterrupted) and the scoring's resilience count work unchanged.
//
// All randomness flows through the shared seedable rng, so a deck run is exactly
// reproducible and headless-balanceable.
//
//   deck: {
//     firstAt,        // earliest seconds before the first incident (default 12)
//     baseInterval,   // mean seconds between incidents at the start (default 18)
//     intervalDecay,  // interval ×= decay each draw — escalation (default 0.9)
//     minInterval,    // floor on the gap between incidents (default 8)
//     warn,           // default telegraph lead time (default 5)
//     jitter,         // ± fraction randomization on each interval (default 0.3)
//     cooldown,       // default per-kind min seconds between draws (default 12)
//     maxActive,      // ceiling on concurrent active incidents (default 2)
//     severityPerDraw,// growth of rolled magnitude per draw, capped (default 0.06)
//     severityCap,    // ceiling on that severity growth (default 0.6)
//     cards: [        // weighted incident kinds; ranges roll uniformly
//       { kind, weight, duration:[lo,hi], magnitude:[lo,hi]?, warn?, cooldown? },
//     ],
//   }

const DECK_DEFAULTS = {
  firstAt: 12,
  baseInterval: 18,
  intervalDecay: 0.9,
  minInterval: 8,
  warn: 5,
  jitter: 0.3,
  cooldown: 12,
  maxActive: 2,
  severityPerDraw: 0.06,
  severityCap: 0.6,
};

// A sensible default mix if a deck spec omits its own cards.
const DEFAULT_CARDS = [
  { kind: "traffic_spike", weight: 3, duration: [6, 10], magnitude: [1.5, 2.2] },
  { kind: "az_failure", weight: 2, duration: [8, 14] },
  { kind: "cost_audit", weight: 2, duration: [10, 16], magnitude: [1.4, 1.8] },
];

export class IncidentDeck {
  constructor(spec = {}, rng = Math.random) {
    this.s = { ...DECK_DEFAULTS, ...spec };
    this._rng = rng;
    this._cards = spec.cards && spec.cards.length ? spec.cards : DEFAULT_CARDS;
    this._drawCount = 0;
    this._lastByKind = {}; // kind -> sim time it was last drawn (cooldown)
    // Time of the next *possible* draw.
    this._next = this.s.firstAt + this._jit(this.s.firstAt);
  }

  // Symmetric ± jitter as a fraction of `base`.
  _jit(base) {
    return (this._rng() * 2 - 1) * this.s.jitter * base;
  }

  // Uniform roll over a [lo,hi] range; a bare number passes through; a fallback
  // covers a missing field.
  _roll(v, fallback) {
    if (Array.isArray(v)) return v[0] + this._rng() * (v[1] - v[0]);
    return v != null ? v : fallback;
  }

  // Called every director tick. Returns a rolled incident descriptor to schedule,
  // or null. `activeCount` lets the deck hold back while the board is already
  // under fire (keeps the difficulty from spiking into the unwinnable).
  maybeDraw(t, activeCount = 0) {
    if (t < this._next) return null;
    if (activeCount >= this.s.maxActive) {
      // Board's busy — re-check after a short delay instead of dumping on more.
      this._next = t + this.s.minInterval;
      return null;
    }
    const card = this._pick(t);
    // Schedule the next possible draw. Escalation: the interval shrinks with each
    // incident drawn, floored at minInterval, then jittered.
    this._drawCount++;
    const interval = Math.max(
      this.s.minInterval,
      this.s.baseInterval * Math.pow(this.s.intervalDecay, this._drawCount)
    );
    this._next = t + interval + this._jit(interval);
    if (!card) return null;
    this._lastByKind[card.kind] = t;
    return this._instantiate(card, t);
  }

  // Weighted pick over the cards not currently on cooldown (falling back to the
  // full set if everything is cooling down).
  _pick(t) {
    const eligible = this._cards.filter((c) => {
      const last = this._lastByKind[c.kind];
      const cd = c.cooldown != null ? c.cooldown : this.s.cooldown;
      return last == null || t - last >= cd;
    });
    const pool = eligible.length ? eligible : this._cards;
    const total = pool.reduce((a, c) => a + (c.weight || 1), 0);
    let r = this._rng() * total;
    for (const c of pool) {
      r -= c.weight || 1;
      if (r <= 0) return c;
    }
    return pool[pool.length - 1];
  }

  // Roll a concrete incident from a card. Severity (magnitude) grows slowly with
  // the draw count so a long run gets meaner. Telegraphed: `at` is `warn` seconds
  // in the future, leaving the lead time for the warning banner.
  _instantiate(card, t) {
    const warn = card.warn != null ? card.warn : this.s.warn;
    const sevMul = 1 + Math.min(this.s.severityCap, this._drawCount * this.s.severityPerDraw);
    const ev = { kind: card.kind, warn, state: "pending", _drawn: true };
    ev.duration = this._roll(card.duration, 8);
    if (card.magnitude != null) ev.magnitude = this._roll(card.magnitude, 1.5) * sevMul;
    ev.at = t + warn;
    return ev;
  }
}
