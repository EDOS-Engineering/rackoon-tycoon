// scheduler.js — Wave scheduler (T2.2).
// Drives escalating traffic over a level via a timeline of phases. Each phase
// has a duration and a spawn-rate multiplier; the scheduler walks the timeline
// in wall-clock level time and reports the current multiplier + a label/progress
// the HUD can surface. When the timeline finishes, the level's wave set is
// "survived" (a win condition).
//
// Phases are data, supplied by the level (levels.js -> level.waves). A sensible
// default ramp is provided for levels that omit it.
//
// Per-building OVERLOAD is modelled separately in load.js; the scheduler only
// governs *how much* traffic arrives. Events (waves/events.js) can stack an
// extra spike multiplier on top via setEventMultiplier().

// Default ramp if a level provides no `waves`: calm -> busy -> peak -> cooldown.
const DEFAULT_PHASES = [
  { name: "Warm-up", duration: 18, rate: 1.0 },
  { name: "Morning rush", duration: 26, rate: 1.8 },
  { name: "Peak load", duration: 30, rate: 2.8 },
  { name: "Wind-down", duration: 16, rate: 1.3 },
];

export class WaveScheduler {
  constructor(phases) {
    this.phases = phases && phases.length ? phases : DEFAULT_PHASES;
    this.total = this.phases.reduce((s, p) => s + p.duration, 0);
    this.t = 0; // elapsed level time (sec)
    this.eventMul = 1; // transient multiplier from events (spike)
    this.finished = false;
  }

  reset() {
    this.t = 0;
    this.eventMul = 1;
    this.finished = false;
  }

  setEventMultiplier(m) {
    this.eventMul = m;
  }

  // Advance the clock. Returns nothing; read current()/multiplier()/progress().
  tick(dt) {
    if (this.finished) return;
    this.t += dt;
    if (this.t >= this.total) {
      this.t = this.total;
      this.finished = true;
    }
  }

  // The phase active at the current time (the last one once finished).
  current() {
    let acc = 0;
    for (let i = 0; i < this.phases.length; i++) {
      acc += this.phases[i].duration;
      if (this.t < acc) {
        return { index: i, phase: this.phases[i], phaseEnd: acc };
      }
    }
    const last = this.phases.length - 1;
    return { index: last, phase: this.phases[last], phaseEnd: this.total };
  }

  // Effective spawn multiplier (phase rate * any event spike).
  multiplier() {
    return this.current().phase.rate * this.eventMul;
  }

  // 0..1 progress through the entire wave set.
  progress() {
    return this.total > 0 ? Math.min(1, this.t / this.total) : 1;
  }

  // Seconds remaining in the whole wave set.
  remaining() {
    return Math.max(0, this.total - this.t);
  }

  // Seconds left in the current phase (for "next wave in…" telegraphing).
  phaseRemaining() {
    return Math.max(0, this.current().phaseEnd - this.t);
  }
}
