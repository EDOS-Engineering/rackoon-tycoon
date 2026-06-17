// milestones.js — Company-mode milestone evaluation (Phase 7, R6 / T7.4).
//
// The campaign uses a binary win/lose (`evaluate` in economy/scoring.js): hit the
// routed goal, or survive the wave set, else bankrupt / SLA breach. A free-run
// "company" has no finish line — it runs until you quit or go broke — so it needs
// a different success model: business *milestones* you tick off over a long run
// (serve N requests, bank $X revenue, weather M incidents, reach day D).
//
// MilestoneSet is a thin, pure evaluator: given the live `metrics` snapshot from
// the simulation, it reports each milestone's current value, whether it's met,
// and overall progress. It owns no state and renders nothing — the scene draws
// the checklist, the sim feeds the numbers. This is the "milestone-based evaluate
// alongside the binary one" the plan calls for.
//
//   milestones: [
//     { id, label, metric, target },   // metric ∈ keys of Simulation.metrics()
//     ...
//   ]
//
// A spec with no milestones evaluates as trivially complete (a pure endless run).

export class MilestoneSet {
  constructor(specs = []) {
    this.specs = Array.isArray(specs) ? specs : [];
  }

  get length() {
    return this.specs.length;
  }

  // Evaluate every milestone against a metrics object, returning a list of
  // { id, label, metric, target, value, done } plus convenience rollups.
  evaluate(metrics) {
    const items = this.specs.map((m) => {
      const value = Number(metrics[m.metric]) || 0;
      return {
        id: m.id,
        label: m.label,
        metric: m.metric,
        target: m.target,
        value,
        done: value >= m.target,
      };
    });
    const doneCount = items.filter((i) => i.done).length;
    return {
      items,
      doneCount,
      total: items.length,
      allDone: items.length > 0 && doneCount === items.length,
      // 0..1 aggregate progress (each milestone contributes equally, capped).
      progress:
        items.length === 0
          ? 1
          : items.reduce((a, i) => a + Math.min(1, i.target > 0 ? i.value / i.target : 1), 0) /
            items.length,
    };
  }

  // The set of milestone ids currently met — handy for persisting which ones a
  // resumed run had already banked.
  achievedIds(metrics) {
    return this.evaluate(metrics).items.filter((i) => i.done).map((i) => i.id);
  }
}
