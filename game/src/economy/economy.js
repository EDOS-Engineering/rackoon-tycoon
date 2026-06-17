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

export class Economy {
  constructor(startBudget) {
    this.startBudget = startBudget;
    this.budget = startBudget; // cash remaining
    this.revenue = 0; // gross revenue earned (running total)
    this.lost = 0; // goodwill/credits burned on dropped requests (running total)
    this.spent = 0; // gross hard-money spent from the budget (running total)
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
}
