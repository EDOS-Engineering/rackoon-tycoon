// scoring.js — Win/lose evaluation + score + star rating (T2.4).
//
// LOSE when either:
//   - budget hits zero (the bill drained you), or
//   - the drop rate breaches the level's SLA (too many requests dropped).
// WIN when either:
//   - the wave set is survived (scheduler finished) with budget intact, or
//   - the routed-request goal is reached.
//
// SCORE blends three normalized factors in [0,1], the SAA-C03 pillars made
// playable:
//   - uptime         = routed / (routed + dropped)            (reliability)
//   - costEfficiency = revenue vs. money + bill spent          (cost-optimized)
//   - resilience     = survived events / events faced, plus an
//                      AZ-spread bonus for not single-pointing  (resilience)
// score = round( 1000 * uptime * (0.5 + 0.5*costEff) * (0.6 + 0.4*resilience) ).
// Stars (0..3) are thresholded off the final score, gated so a loss caps at 1.

export const OUTCOME = { PLAYING: "playing", WIN: "win", LOSE: "lose" };

// Evaluate live win/lose. `s` carries the running counters + config.
//   { budget, success, failed, slaMaxDropRate, goalRequests,
//     wavesFinished, minRequestsForWin }
export function evaluate(s) {
  // Lose: bankrupt.
  if (s.budget <= 0) return { outcome: OUTCOME.LOSE, reason: "bankrupt" };

  // Lose: SLA breach (only once enough traffic has been seen to be fair).
  const handled = s.success + s.failed;
  if (handled >= 12) {
    const dropRate = s.failed / handled;
    if (dropRate > (s.slaMaxDropRate ?? 0.35)) {
      return { outcome: OUTCOME.LOSE, reason: "sla" };
    }
  }

  // Win: reached the routed goal.
  if (s.goalRequests && s.success >= s.goalRequests) {
    return { outcome: OUTCOME.WIN, reason: "goal" };
  }
  // Win: survived the wave set (with a little traffic to prove it ran).
  if (s.wavesFinished && s.success >= (s.minRequestsForWin ?? 1)) {
    return { outcome: OUTCOME.WIN, reason: "survived" };
  }

  return { outcome: OUTCOME.PLAYING, reason: null };
}

// Compute the final score + stars + the three factor values for display.
//   stats: { success, failed, revenue, lost, billTotal, startBudget,
//            eventsFaced, eventsSurvived, azSpread, outcome }
export function score(stats) {
  const handled = stats.success + stats.failed;
  const uptime = handled > 0 ? stats.success / handled : 0;

  // Cost efficiency: what fraction of "value generated" you kept after the bill
  // and losses. Guard against divide-by-zero on a no-op run.
  const earned = stats.revenue || 0;
  const spent = (stats.billTotal || 0) + (stats.lost || 0);
  const costEff = earned + spent > 0 ? earned / (earned + spent) : 0;

  // Resilience: survived-event ratio, nudged by AZ spread (0..1) so designs that
  // distribute compute/DBs across zones score better.
  const evFaced = stats.eventsFaced || 0;
  const evRatio = evFaced > 0 ? (stats.eventsSurvived || 0) / evFaced : 1;
  const resilience = clamp01(0.7 * evRatio + 0.3 * (stats.azSpread || 0));

  let raw = 1000 * uptime * (0.5 + 0.5 * costEff) * (0.6 + 0.4 * resilience);
  if (stats.outcome === OUTCOME.LOSE) raw *= 0.5; // a loss is a poor run
  const value = Math.max(0, Math.round(raw));

  let stars = 0;
  if (value >= 750) stars = 3;
  else if (value >= 500) stars = 2;
  else if (value >= 250) stars = 1;
  if (stats.outcome === OUTCOME.LOSE) stars = Math.min(stars, 1);
  if (stats.outcome === OUTCOME.WIN) stars = Math.max(stars, 1);

  return {
    value,
    stars,
    factors: {
      uptime,
      costEfficiency: costEff,
      resilience,
    },
  };
}

// AZ-spread metric: 0 when everything sits in one zone, up to 1 when the
// player's compute+sink buildings are evenly distributed across all AZ bands.
// `zoneCounts` is an array of building counts per zone.
export function azSpread(zoneCounts) {
  const used = zoneCounts.filter((n) => n > 0).length;
  if (zoneCounts.length <= 1) return 1;
  return used <= 1 ? 0 : (used - 1) / (zoneCounts.length - 1);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
