// telemetry.js — Live operator telemetry + balancing signals (Phase 7, T7.5).
//
// T7.6 added the *outcome* numbers an ops review grades (SLO, blast, RTO/RPO).
// T7.5 is the *operator's instrument panel*: the live signals you read while the
// system runs to decide what to do next — the same four a real on-call engineer
// watches:
//
//   - demand        — where you are on the demand curve right now (+ a short
//                     history for a sparkline), so spikes are visible coming in.
//   - margin ($/s)  — revenue rate minus burn rate: are you making money this
//                     second, or bleeding it?
//   - SLO burn      — how fast you're spending the latency error budget vs the
//                     allowed rate. >1× means you'll blow the SLO if it holds.
//   - headroom      — spare capacity at the busiest tier (1 − peak load): how
//                     much spike you can absorb before something drops.
//
// Pure derivation over the sim's own state; owns only small rolling buffers. It
// reads the Simulation (demand/economy/bill/grid/realism) but mutates nothing in
// it, so it's safe to run headlessly for curve tuning.

import { SINK_ROLES, ROLE } from "../services/catalog.js";

const SAMPLE_DT = 0.25; // seconds of sim time between history samples
const HISTORY = 56; // samples kept for the sparkline (~14s at SAMPLE_DT)
const MARGIN_EASE = 0.5; // EMA time-constant (s) to de-noise the discrete reward stream

export class Telemetry {
  constructor() {
    this.demandNow = 1; // current demand multiplier
    this.marginPerSec = 0; // smoothed revenue-rate − burn-rate
    this.sloBurn = 0; // error-budget burn rate (1× = exactly at budget)
    this.headroom = 1; // 1 − busiest serving-tile load (0 = saturated)
    this.demandHist = []; // recent demandNow samples (oldest→newest)
    this.marginHist = []; // recent marginPerSec samples
    this._sampleAcc = 0;
    this._lastRevenue = 0;
    this._lastSloMet = 0;
    this._lastSloBreached = 0;
  }

  // Advance from the live simulation. `dt` is the same scaled step the sim took.
  update(dt, sim) {
    // Instantaneous demand multiplier (continuous curve, else the wave step).
    this.demandNow = sim.demand ? sim.demand.rateAt(sim.simTime) : sim.waves.multiplier();

    // Margin: revenue rate this step minus the running burn, EMA-smoothed (reward
    // lands in discrete lumps, so the raw rate is spiky).
    const revRate = dt > 0 ? (sim.economy.revenue - this._lastRevenue) / dt : 0;
    this._lastRevenue = sim.economy.revenue;
    const instMargin = revRate - sim.bill.burnRate;
    this.marginPerSec += (instMargin - this.marginPerSec) * Math.min(1, dt / MARGIN_EASE);

    // Headroom: spare capacity at the busiest serving tile (compute + sinks).
    let maxLoad = 0;
    for (const b of sim.grid.buildings.values()) {
      const role = b.service.role;
      if (role !== ROLE.COMPUTE && !SINK_ROLES.has(role)) continue;
      if ((b.load || 0) > maxLoad) maxLoad = b.load || 0;
    }
    this.headroom = Math.max(0, 1 - maxLoad);

    // Sample histories + the windowed SLO burn at a low rate.
    this._sampleAcc += dt;
    if (this._sampleAcc >= SAMPLE_DT) {
      this._sampleAcc = 0;
      push(this.demandHist, this.demandNow);
      push(this.marginHist, this.marginPerSec);

      const dMet = sim.realism.sloMet - this._lastSloMet;
      const dBr = sim.realism.sloBreached - this._lastSloBreached;
      this._lastSloMet = sim.realism.sloMet;
      this._lastSloBreached = sim.realism.sloBreached;
      const served = dMet + dBr;
      const missRate = served > 0 ? dBr / served : 0;
      // Allowed miss fraction = 1 − target (e.g. a 95% SLO budgets 5% misses).
      const allowed = Math.max(0.001, 1 - (sim.sloTarget != null ? sim.sloTarget : 0.95));
      // Decay toward the windowed burn so it eases rather than jumps.
      const inst = missRate / allowed;
      this.sloBurn += (inst - this.sloBurn) * 0.5;
    }
  }

  // A plain snapshot for the HUD / headless balancing.
  snapshot() {
    return {
      demandNow: this.demandNow,
      marginPerSec: this.marginPerSec,
      sloBurn: this.sloBurn,
      headroom: this.headroom,
      demandHist: this.demandHist,
      marginHist: this.marginHist,
    };
  }
}

function push(arr, v) {
  arr.push(v);
  if (arr.length > HISTORY) arr.shift();
}
