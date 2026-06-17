// realism.js — Operational-realism tracker (Phase 7, T7.6).
//
// Real architects don't just keep the lights on; they answer to the numbers an
// operations review actually grades. This tracker rolls up four of them from the
// running simulation — pure, deterministic, no rendering:
//
//   - Latency SLO compliance — what fraction of served requests met the latency
//     objective (`sloMs`). A saturated tier blows latency and burns the SLO.
//   - Blast radius — the peak fraction of serving *capacity* an incident took
//     offline at once. Spreading compute/DBs across AZs shrinks it; single-AZ
//     designs light it up.
//   - RTO (Recovery Time Objective) — the longest stretch the service had no
//     working route after having been up (an outage). A DR design that keeps a
//     route through a region failure records ~0.
//   - RPO proxy (data lost) — requests dropped *while in an outage*, i.e. work
//     lost because there was nowhere to serve it.
//
// `scaling warm-up` (the fourth realism axis) lives in the load model, not here:
// auto-scaling capacity ramps toward demand instead of snapping, so a spike
// transiently overloads — which then shows up in this tracker's SLO + latency.

export class RealismTracker {
  constructor() {
    this.sloMet = 0;
    this.sloBreached = 0;
    this.peakBlastRadius = 0; // 0..1, capacity-weighted
    this.worstRtoSec = 0; // longest single outage after service was established
    this.dataLost = 0; // requests dropped during an outage (RPO proxy)
    this._outage = false;
    this._outageT = 0;
    this._everUp = false; // ignore the initial "no route yet" build phase
  }

  // A request finished: did it meet the latency objective? `sloMs <= 0` disables
  // SLO accounting (the metric then reads as fully compliant).
  onComplete(latencyMs, sloMs) {
    if (!(sloMs > 0)) return;
    if (latencyMs <= sloMs) this.sloMet++;
    else this.sloBreached++;
  }

  // Per-tick health update. `routeOk` = a working gate→sink route exists now;
  // `totalCap`/`downCap` are serving capacity totals (throughput-weighted) and
  // the portion currently offline.
  tick(dt, routeOk, totalCap, downCap) {
    if (totalCap > 0) {
      const blast = downCap / totalCap;
      if (blast > this.peakBlastRadius) this.peakBlastRadius = blast;
    }
    if (routeOk) this._everUp = true;
    // Outage bookkeeping only counts once the service has been up at least once,
    // so pre-build "no route yet" time isn't scored as downtime.
    if (this._everUp && !routeOk) {
      this._outage = true;
      this._outageT += dt;
      if (this._outageT > this.worstRtoSec) this.worstRtoSec = this._outageT;
    } else if (routeOk && this._outage) {
      this._outage = false;
      this._outageT = 0;
    }
  }

  // Whether we're currently inside a (post-establishment) outage.
  get inOutage() {
    return this._outage;
  }

  // A request was dropped while there was no working route — lost work (RPO).
  onOutageDrop() {
    this.dataLost++;
  }

  // Fraction of served requests that met the latency SLO (1 when none served yet).
  get sloCompliance() {
    const t = this.sloMet + this.sloBreached;
    return t > 0 ? this.sloMet / t : 1;
  }

  // Snapshot/restore for company-mode save/resume.
  toJSON() {
    return {
      sloMet: this.sloMet,
      sloBreached: this.sloBreached,
      peakBlastRadius: this.peakBlastRadius,
      worstRtoSec: this.worstRtoSec,
      dataLost: this.dataLost,
    };
  }
  restore(s) {
    if (!s) return;
    this.sloMet = s.sloMet || 0;
    this.sloBreached = s.sloBreached || 0;
    this.peakBlastRadius = s.peakBlastRadius || 0;
    this.worstRtoSec = s.worstRtoSec || 0;
    this.dataLost = s.dataLost || 0;
  }
}
