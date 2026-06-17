// billing.js — The live AWS bill (T2.1).
// Models a running cloud bill that draws down the player's budget over time:
//   - Per-tile running cost: every placed building bills its catalog `cost`
//     continuously, expressed as a small per-second burn (cost is a one-off
//     "provision" price in Phase 1; here it doubles as an hourly-style rate).
//   - Data-transfer cost on wires: every packet that crosses a wire this tick
//     adds a tiny egress charge, so sprawling topologies cost more to run — the
//     in-game echo of inter-AZ / NAT data-transfer fees.
//
// The meter is pure bookkeeping: the level scene calls tick(dt, ...) once per
// sim step, subtracts the returned spend from its budget, and reads burnRate /
// breakdown for the HUD + results. No rendering, no input here.

// Tunables. rateDivisor converts a building's provision `cost` into a per-second
// burn (cost / divisor dollars per second). Tuned gentle so a sensible build
// comfortably outlasts a 3–6 min level: a $120 EC2 burns ~$0.9/s, a $0 gate
// nothing. Transfer is a small per-hop egress nibble, not a budget-killer.
export const BILL = {
  rateDivisor: 130, // cost -> $/sec running burn (higher = gentler)
  transferPerHop: 0.015, // base $ per packet per wire hop (scaled by the muls below)
  // Transfer model mirrors real AWS data-transfer billing:
  //   - Intra-AZ traffic between resources is FREE → a plain tile contributes 0.
  //   - Crossing an AZ boundary costs the full penalty below (real inter-AZ is a
  //     hard, deliberate cost; multi-AZ HA trades budget for resilience). This is
  //     an exam lesson, not a softened one — keep chatty tiers in a single AZ.
  //   - A tile's own transferCostMul (NAT ×8, VPCE ×0.02, CloudFront ×0.2) is the
  //     service's data-processing/egress charge and stacks on top, AZ or not.
  crossAzPenalty: 8.0, // per-hop transfer multiplier added when a hop crosses an AZ
  auditMultiplier: 1.0, // mutated by the "cost audit" event
  // Sim-depth: a tile's right-sizing DRIFT (0..1, tracked by the sim) adds up to
  // this fraction of its base running cost as wasted spend — un-tended, over- or
  // under-provisioned resources cost more. Right-sizing (removing idle tiers,
  // matching capacity to demand) keeps it near zero. Core SAA cost lesson.
  driftSurcharge: 0.6,
  // Sim-depth: an autoScale tier bills for the capacity it is actually running,
  // not its base — serverless/ACU pricing. A tier scaled to `cap` bills its base
  // running cost × (1 + scaleBilling × scaleFrac), where scaleFrac = (cap−base)/base
  // (set by the load model). So a low auto-scaling target (big headroom) or a high
  // max-scale ceiling costs real money under load — the policy is a cost↔SLO trade.
  scaleBilling: 1.0,
};

export class BillMeter {
  constructor() {
    this.totalSpent = 0; // running cost billed so far (whole level)
    this.transferSpent = 0; // portion attributable to data transfer
    this.runningSpent = 0; // portion attributable to per-tile running cost
    this.burnRate = 0; // $/sec right now (running + recent transfer)
    this.auditMul = 1; // live cost multiplier from a cost-audit event
    this.roleDiscount = null; // sim-depth: active reservation discounts (role -> frac)
    this._transferAcc = 0; // transfer $ accrued this second (for burn display)
    this._transferWindow = 0; // rolling 1s window of transfer spend
    this._winAcc = 0;
  }

  // Reset for a fresh level.
  reset() {
    this.totalSpent = 0;
    this.transferSpent = 0;
    this.runningSpent = 0;
    this.burnRate = 0;
    this.auditMul = 1;
    this._transferAcc = 0;
    this._transferWindow = 0;
    this._winAcc = 0;
  }

  // Per-tile running burn ($/sec) for the current board, before audit multiplier.
  // Each tile's base burn plus a right-sizing DRIFT surcharge (sim-depth): a tile
  // left over-/under-provisioned (b.drift → 1) wastes up to `driftSurcharge` of
  // its base cost on top.
  static runningBurn(grid, roleDiscount = null) {
    let sum = 0;
    for (const b of grid.buildings.values()) {
      const base = (b.service.cost || 0) / BILL.rateDivisor;
      const drifted = base * (1 + BILL.driftSurcharge * (b.drift || 0)) * scaleMul(b);
      const disc = roleDiscount ? roleDiscount[b.service.role] || 0 : 0;
      sum += drifted * (1 - disc);
    }
    return sum;
  }

  // Running-cost $/sec SAVED by the active reservations (gross − net), for the
  // run report so the player can see whether a commitment paid off.
  static reservationSavings(grid, roleDiscount) {
    if (!roleDiscount) return 0;
    let saved = 0;
    for (const b of grid.buildings.values()) {
      const disc = roleDiscount[b.service.role] || 0;
      if (!disc) continue;
      const drifted = ((b.service.cost || 0) / BILL.rateDivisor) * (1 + BILL.driftSurcharge * (b.drift || 0)) * scaleMul(b);
      saved += drifted * disc;
    }
    return saved;
  }

  // Charge for `hops` worth of data transfer (one packet crossing one wire = 1).
  chargeTransfer(hops) {
    if (!hops) return;
    const amt = hops * BILL.transferPerHop * this.auditMul;
    this.transferSpent += amt;
    this.totalSpent += amt;
    this._transferAcc += amt;
  }

  // Advance the meter one sim step. Returns the dollars billed this step so the
  // caller can subtract from budget. `grid` supplies the running burn.
  tick(dt, grid) {
    // `roleDiscount` (set by the sim from active reservations) shaves matching
    // tiles' running cost while a reservation is live.
    const running = BillMeter.runningBurn(grid, this.roleDiscount) * this.auditMul;
    const runSpend = running * dt;
    this.runningSpent += runSpend;
    this.totalSpent += runSpend;

    // Maintain a rolling ~1s transfer window so the burn-rate readout is steady
    // rather than spiking on each packet.
    this._winAcc += dt;
    this._transferWindow += this._transferAcc;
    this._transferAcc = 0;
    if (this._winAcc >= 1) {
      // burnRate = steady running burn + last second of transfer.
      this.burnRate = running + this._transferWindow;
      this._transferWindow = 0;
      this._winAcc = 0;
    } else if (this.burnRate === 0) {
      this.burnRate = running; // seed before the first window closes
    }

    return runSpend; // transfer is billed instantly in chargeTransfer()
  }

  breakdown() {
    return {
      total: this.totalSpent,
      running: this.runningSpent,
      transfer: this.transferSpent,
    };
  }
}

// Per-tile running-cost multiplier from auto-scaling: an autoScale tier running
// above base capacity bills for the extra. Non-autoscale tiles bill flat (1).
function scaleMul(b) {
  if (!b.service.autoScale) return 1;
  const frac = b.scaleFrac > 0 ? b.scaleFrac : 0;
  return 1 + BILL.scaleBilling * frac;
}
