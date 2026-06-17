// economy.js — The money ledger (Phase 7, R4 / T7.2).
//
// Before this, the three money quantities — `budget` (cash left), `revenue`
// (gross earned), `lost` (goodwill/credits burned on SLA misses) — were plain
// fields on the Simulation, mutated inline in five different places (the running
// bill, per-hop transfer, request reward, drop penalty, build/erase). That made
// the rules (clamp at zero, how reinvestment works) easy to get subtly wrong in
// one spot and not another.
//
// Economy concentrates every mutation behind named operations with one set of
// invariants:
//   - the budget never goes negative (a spend that would overdraw lands at $0);
//   - credits (refunds, reinvested revenue) only ever add;
//   - revenue and lost are monotonic running totals.
//
// It is the home for the compounding-economy mechanics that R3's demand curve
// pairs with — `reinvest` is here now; revenue growth / customer churn hang off
// the same ledger next (T7.2 cont.). Pure + headless-testable.

// Sim-depth: reserved-capacity plans (the SAA "commitment risk" lesson). Buying
// one pays an UPFRONT lump now (sunk) and discounts that role's running cost for
// a term (in in-game days). It pays off only if you run enough matching capacity
// long enough — over-commit (or cash out early / scale down) and you lose the
// upfront. Reservations are a company/freerun mechanic.
export const RESERVATION_PLANS = {
  compute: { id: "compute", label: "Reserve Compute", role: "compute", upfront: 45, discountPct: 0.35, termDays: 12 },
  database: { id: "database", label: "Reserve Database", role: "sink", upfront: 60, discountPct: 0.4, termDays: 12 },
};

export class Economy {
  constructor(startBudget) {
    this.startBudget = startBudget;
    this.budget = startBudget; // cash remaining
    this.revenue = 0; // gross revenue earned (running total)
    this.lost = 0; // goodwill/credits burned on dropped requests (running total)
    this.spent = 0; // gross hard-money spent from the budget (running total)
    // Reserved-capacity commitments: { role, discountPct, untilDay, upfront }.
    this.reservations = [];
    this.reservationSpend = 0; // upfront $ committed to reservations (sunk)
    this.reservationSaved = 0; // running-cost $ saved by active reservations
  }

  // Can the player afford a hard cost (building placement)?
  canAfford(cost) {
    return cost <= this.budget;
  }

  // Spend hard money from the budget (building cost, running bill, data
  // transfer). Clamps at $0 and returns the amount actually charged.
  spend(amount) {
    if (!(amount > 0)) return 0;
    const charged = Math.min(amount, this.budget);
    this.budget -= charged;
    this.spent += charged;
    return charged;
  }

  // Add cash back to the budget (a building refund). Returns the amount credited.
  credit(amount) {
    if (!(amount > 0)) return 0;
    this.budget += amount;
    return amount;
  }

  // Semantic alias for the running infrastructure bill (per-tick) — same as
  // spend(), named for the call site so the intent reads clearly.
  chargeBill(amount) {
    return this.spend(amount);
  }

  // Semantic alias for a per-hop data-transfer charge.
  chargeTransfer(amount) {
    return this.spend(amount);
  }

  // Book a completed request's reward as revenue, and (in sandbox/company mode)
  // reinvest a fraction of it back into the budget. Returns the reward.
  earn(reward, reinvestRate = 0) {
    if (!(reward > 0)) return 0;
    this.revenue += reward;
    if (reinvestRate > 0) {
      const back = Math.round(reward * reinvestRate);
      if (back > 0) this.credit(back);
    }
    return reward;
  }

  // Book the cost of a dropped request (an SLA miss). Returns the penalty.
  penalize(amount) {
    if (!(amount > 0)) return 0;
    this.lost += amount;
    return amount;
  }

  // ---- Reserved capacity (commitment risk) --------------------------------
  // Is a reservation currently active for this role?
  hasReservation(role) {
    return this.reservations.some((r) => r.role === role);
  }

  // Buy a reservation plan (RESERVATION_PLANS entry) as of in-game day `nowDay`.
  // Pays the upfront (sunk) and discounts the role for `termDays`. Returns true on
  // success; false if unaffordable or already reserved for that role.
  buyReservation(plan, nowDay) {
    if (!plan || this.hasReservation(plan.role)) return false;
    if (!this.canAfford(plan.upfront)) return false;
    this.spend(plan.upfront);
    this.reservationSpend += plan.upfront;
    this.reservations.push({
      role: plan.role,
      discountPct: plan.discountPct,
      untilDay: nowDay + plan.termDays,
      upfront: plan.upfront,
    });
    return true;
  }

  // Drop reservations whose term has elapsed (called each step with the clock).
  expireReservations(nowDay) {
    if (this.reservations.length === 0) return;
    this.reservations = this.reservations.filter((r) => r.untilDay > nowDay);
  }

  // Map of role -> discount fraction for the active reservations (for billing).
  roleDiscount() {
    const m = {};
    for (const r of this.reservations) m[r.role] = r.discountPct;
    return m;
  }
}
