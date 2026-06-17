// demand.js — A continuous traffic-demand signal (Phase 7, R3 / T7.1).
//
// The original WaveScheduler steps through a hand-authored list of phases, each
// a flat rate multiplier for a fixed duration. That's fine for a 30-second boss
// level but can't express a *living* business: a day/night rhythm, quieter
// weekends, slow seasonal swings, and a customer base that compounds over time.
//
// DemandModel replaces that step function with one closed-form curve sampled at
// the current sim time. It is PURE and deterministic (a function of `t` and the
// spec) — no RNG, no state — so it fast-runs headlessly and is trivially graphed
// for balancing. The simulation multiplies a level's base `spawnRate` by
// `rateAt(t)` exactly where it used to multiply by `waves.multiplier()`.
//
// Time is compressed (locked design decision): one in-game "day" is `dayLength`
// real seconds, so a multi-week run plays out in a couple of minutes. All the
// period fields below are expressed in those in-game days/hours.
//
//   demand: {
//     dayLength,     // real seconds per in-game day (default 8)
//     base,          // baseline multiplier (default 1)
//     diurnalAmp,    // day/night swing, ± fraction of base (default 0.55)
//     peakHour,      // in-game hour [0..24) of daily peak (default 14)
//     weekendMul,    // weekend demand vs weekday (default 0.75)
//     seasonAmp,     // slow seasonal swing, ± fraction (default 0.15)
//     seasonDays,    // season period in in-game days (default 28)
//     growthPerDay,  // compounding growth per day, e.g. 0.05 = +5%/day (default 0.04)
//     growthCap,     // ceiling on the growth multiplier (default 6)
//     floor,         // never let the sampled rate fall below this (default 0.1)
//   }

const TAU = Math.PI * 2;

const DEFAULTS = {
  dayLength: 8,
  base: 1,
  diurnalAmp: 0.55,
  peakHour: 14,
  weekendMul: 0.75,
  seasonAmp: 0.15,
  seasonDays: 28,
  growthPerDay: 0.04,
  growthCap: 6,
  floor: 0.1,
};

export class DemandModel {
  constructor(spec = {}) {
    this.s = { ...DEFAULTS, ...spec };
  }

  // In-game days elapsed at sim time `t` (seconds), as a real number.
  daysAt(t) {
    return t / this.s.dayLength;
  }

  // In-game hour-of-day [0..24) at sim time `t`.
  hourAt(t) {
    const dayFrac = this.daysAt(t) % 1;
    return dayFrac * 24;
  }

  // Zero-based day index, and whether that day falls on the weekend (a 7-day
  // week; days 5 and 6 are the weekend).
  dayIndexAt(t) {
    return Math.floor(this.daysAt(t));
  }
  isWeekendAt(t) {
    return this.dayIndexAt(t) % 7 >= 5;
  }

  // The compounding growth multiplier alone (no daily/seasonal shape), capped.
  growthAt(t) {
    const g = Math.pow(1 + this.s.growthPerDay, this.daysAt(t));
    return Math.min(this.s.growthCap, g);
  }

  // The full demand multiplier at sim time `t`: base × diurnal × weekday/weekend
  // × seasonal × growth, floored so spawning never fully stops.
  rateAt(t) {
    const s = this.s;
    // Diurnal: a cosine peaking at `peakHour`, swinging ±diurnalAmp.
    const hour = this.hourAt(t);
    const diurnal = 1 + s.diurnalAmp * Math.cos(((hour - s.peakHour) / 24) * TAU);
    // Weekly: weekends scaled down.
    const weekly = this.isWeekendAt(t) ? s.weekendMul : 1;
    // Seasonal: a slow sine over `seasonDays`.
    const season = 1 + s.seasonAmp * Math.sin((this.daysAt(t) / s.seasonDays) * TAU);
    const rate = s.base * diurnal * weekly * season * this.growthAt(t);
    return Math.max(s.floor, rate);
  }

  // A short HUD label describing where we are in the run, e.g.
  // "Day 3 · 14:00 · weekday peak". Used by the scene's wave/phase chip.
  label(t) {
    const day = this.dayIndexAt(t) + 1;
    const hour = Math.floor(this.hourAt(t));
    const hh = String(hour).padStart(2, "0");
    const weekend = this.isWeekendAt(t);
    // Coarse part-of-day phrase keyed off the diurnal cosine.
    const d = this.rateAt(t) / (this.s.base * this.growthAt(t));
    const phase = d >= 1.25 ? "peak" : d >= 0.85 ? "busy" : d >= 0.55 ? "steady" : "quiet";
    return `Day ${day} · ${hh}:00 · ${weekend ? "weekend" : "weekday"} ${phase}`;
  }

  // Fraction through the current in-game day [0..1) — feeds the HUD progress bar.
  dayFraction(t) {
    return this.daysAt(t) % 1;
  }
}
