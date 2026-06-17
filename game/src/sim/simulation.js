// simulation.js — The pure simulation core (Phase 7, R1).
//
// This is the headless, deterministic heart of a level: it owns the economy +
// wave + event + load + packet state and advances it one fixed step at a time.
// It performs NO rendering, NO audio, and reads NO input. Anything the outside
// world needs to react to (a sound cue, a floating "+$" label, an outcome flip)
// is pushed onto an `emitted` queue that the host (LevelScene, or the headless
// harness) drains after each step. That separation is what lets the same code
// run under a browser at 60fps AND fast-run under Node for balancing/tests.
//
// State lifted verbatim out of LevelScene (no behaviour change): the host now
// holds a `Simulation` and reads/writes its fields through delegating accessors,
// so the renderer and input handlers are untouched.
//
//   sim.recomputeRoute()  — refresh route validity when topology changed
//   sim.step(dt)          — advance one scaled timestep (waves/bill/spawn/packets/outcome)
//   sim.drainEmitted()    — pull and clear queued side-effect events
//
// Building runtime fields (b.load, b.disabled, b.invalid, b.activity, …) are
// still written onto the Building instances so the renderer reads them directly.

import { Grid } from "../grid/grid.js";
import { findRoundTrip, gateHasRoute } from "../grid/pathfind.js";
import { Packet } from "../entities/packet.js";
import { getConn } from "../services/connections.js";
import { SINK_ROLES, ROLE, SERVICES } from "../services/catalog.js";
import { BillMeter, BILL } from "../economy/billing.js";
import { Economy } from "../economy/economy.js";
import { WaveScheduler } from "../waves/scheduler.js";
import { DemandModel } from "../waves/demand.js";
import { LoadModel } from "../waves/load.js";
import { EventDirector, zoneOfColumn } from "../waves/events.js";
import { evaluate, OUTCOME } from "../economy/scoring.js";
import { MilestoneSet } from "./milestones.js";
import { RealismTracker } from "./realism.js";

// Run modes (R6): a bounded campaign "scenario" (binary win/lose), or an endless
// "freerun" company that runs until bankruptcy/quit and is judged on milestones.
export const MODE = { SCENARIO: "scenario", FREERUN: "freerun" };

export class Simulation {
  // `opts`: { level, grid, gateKeys, rng, budget }. The grid arrives pre-seeded
  // (gates + any pre-placed buildings) so the host owns placement; the sim owns
  // everything that moves.
  constructor({ level, grid, gateKeys, rng, budget }) {
    this.level = level;
    this.grid = grid;
    this.gateKeys = gateKeys;
    this._rng = rng;

    // Economy ledger (R4) owns budget/revenue/lost behind named ops; success/
    // failed are request counters the win evaluation reads, so they stay here.
    this.economy = new Economy(budget);
    this.success = 0;
    this.failed = 0;

    // Sim clock (seconds of compressed sim time elapsed since the shift began).
    // Drives the continuous demand curve; advanced in step().
    this.simTime = 0;

    // Sim systems (all driven by the shared seedable rng).
    this.bill = new BillMeter();
    this.waves = new WaveScheduler(level.waves);
    // R3 (T7.1): a level may supply a continuous `demand{}` spec for a living
    // economy (diurnal/weekly/seasonal + compounding growth). When present it is
    // the source of truth for the spawn-rate multiplier; the WaveScheduler stays
    // for legacy `waves[]` levels and for phase/progress + win bookkeeping.
    this.demand = level.demand ? new DemandModel(level.demand) : null;
    // R5: a level may also supply a `deck{}` for unscripted, escalating incidents
    // drawn over time (on top of any scripted `events[]`).
    this.events = new EventDirector(level.events, level.cols, rng, level.deck);
    this.loadModel = new LoadModel(rng);

    // Run mode + milestones (R6). Freerun is the endless "company" mode; its
    // success is measured by ticking off business milestones, not a binary goal.
    this.mode = level.mode === MODE.FREERUN ? MODE.FREERUN : MODE.SCENARIO;
    this.milestones = new MilestoneSet(level.milestones || []);
    this.milestonesComplete = false; // flips true the first time all are met
    this.peakConcurrent = 0; // high-water mark of packets in flight (company stat)

    // T7.6 operational realism: latency-SLO compliance, blast radius, RTO/RPO.
    // `sloMs` is the per-request latency objective (a tile's served latency must
    // land under it). Defaults to a reasonable target so the metric is always live.
    this.sloMs = level.sloMs != null ? level.sloMs : 60;
    this.realism = new RealismTracker();

    // Outcome + resilience tracking.
    this.outcome = OUTCOME.PLAYING; // PLAYING | WIN | LOSE
    this.outcomeReason = null;
    this._eventsSurvived = 0; // events whose window we fully cleared while alive
    this._eventsCleared = new Set();
    this._reqHint = null; // set when goal met but winRequires unsatisfied

    // Packets in flight + spawn accumulator.
    this.packets = [];
    this._spawnAcc = 0;

    // Cached route validity (recomputed when topology changes).
    this.routeOk = false;
    this._routeDirty = true;

    // Sandbox revenue reinvestment fraction (host slider writes this).
    this._reinvestRate = 0.5;

    // Side-effect queue drained by the host each frame: { kind:'sound', name }
    // or { kind:'float', x, y, text, good }.
    this.emitted = [];
  }

  // Money lives in the ledger; expose it as fields for the renderer/HUD + the
  // win evaluation that read `sim.budget/revenue/lost`.
  get budget() { return this.economy.budget; }
  set budget(v) { this.economy.budget = v; }
  get revenue() { return this.economy.revenue; }
  get lost() { return this.economy.lost; }

  emit(e) {
    this.emitted.push(e);
  }

  drainEmitted() {
    const e = this.emitted;
    this.emitted = [];
    return e;
  }

  // Recompute route validity (and reconcile structural-dependency flags) when the
  // topology has changed. Cheap no-op when nothing is dirty, so the host can call
  // it every frame — including during the briefing, so the indicator stays live.
  recomputeRoute() {
    if (!this._routeDirty) return;
    for (const b of this.grid.buildings.values()) b.invalid = !this._dependencyMet(b);
    const blocked = (key) => this._isKeyDisabled(key);
    this.routeOk = this.gateKeys.some((gk) => gateHasRoute(this.grid, gk, blocked));
    this._routeDirty = false;
  }

  // Advance one (already difficulty-scaled) timestep: tick systems, spawn against
  // the current wave/spike rate, recompute per-building load, move packets, then
  // evaluate the outcome. Emits sounds/floats; never touches render or audio.
  step(dt) {
    this.simTime += dt;
    this._tickSystems(dt);

    // Spawn loop (rate scaled by the demand curve + any traffic spike).
    if (this.routeOk) {
      // WAF / Shield tiles on the board reduce the effective spike multiplier.
      // Each attackMitigation value absorbs that fraction of the spike excess.
      let spikeMul = this.events.spawnMultiplier();
      if (spikeMul > 1) {
        for (const b of this.grid.buildings.values()) {
          if (!b.disabled && b.service.attackMitigation) {
            spikeMul = 1 + (spikeMul - 1) * (1 - b.service.attackMitigation);
          }
        }
      }
      // Continuous demand curve (R3) when the level defines one, else the legacy
      // scripted wave multiplier.
      const baseMul = this.demand ? this.demand.rateAt(this.simTime) : this.waves.multiplier();
      const rate = this.level.spawnRate * baseMul * spikeMul;
      this._spawnAcc += dt * rate;
      while (this._spawnAcc >= 1) {
        this._spawnAcc -= 1;
        this._spawnPacket();
      }
    } else {
      this._spawnAcc = 0;
    }

    // Per-building load / overload from in-flight demand (T2.2).
    this.loadModel.measure(this.grid, this.packets);
    this.loadModel.update(this.grid, dt);

    // Advance packets, then evaluate win/lose.
    this._updatePackets(dt);
    if (this.packets.length > this.peakConcurrent) this.peakConcurrent = this.packets.length;

    // T7.6: blast radius + RTO. Sum serving capacity (compute + sinks) and the
    // portion currently offline (capacity-weighted), and feed route availability
    // so a sustained no-route stretch after the service was up scores as downtime.
    let totalCap = 0;
    let downCap = 0;
    for (const b of this.grid.buildings.values()) {
      const role = b.service.role;
      if (role !== ROLE.COMPUTE && !SINK_ROLES.has(role)) continue;
      const cap = Math.max(1, b.service.throughput);
      totalCap += cap;
      if (b.disabled) downCap += cap;
    }
    this.realism.tick(dt, this.routeOk, totalCap, downCap);

    this._checkOutcome();
  }

  // Tick the wave scheduler, event director, and bill meter; reconcile the AZ
  // failure state onto buildings; charge running cost against the budget.
  _tickSystems(dt) {
    this.waves.tick(dt);
    this.events.tick(dt);

    // Reflect cost-audit + traffic state into the bill meter.
    this.bill.auditMul = this.events.billMultiplier();

    // Apply AZ-failure outages to buildings. When the disabled set changes, the
    // route must be recomputed (and in-flight packets on broken paths dropped).
    const spotDown = this.events.spotInterrupted();
    let changed = false;
    for (const b of this.grid.buildings.values()) {
      // Route 53 (global) survives everything. A region failure downs the whole
      // primary region — Multi-AZ does NOT save you there (single-region). An AZ
      // failure is survived by azResilient (Multi-AZ) tiles. Spot tiles also go
      // offline during a spot-interruption event.
      let off;
      if (b.service.role === ROLE.GATE) off = false;
      else if (this.events.isTileInFailedRegion(b.col, b.row)) off = true;
      else if (b.service.azResilient) off = false;
      else off = this.events.isTileDisabled(b.col, b.row);
      if (b.service.spotInterruptible && spotDown) off = true;
      if (off !== b.disabled) {
        b.disabled = off;
        changed = true;
      }
      // Structural dependency (e.g. a Read Replica needs a source primary on the
      // board). Recomputed each tick because placing/removing tiles changes it.
      const invalid = !this._dependencyMet(b);
      if (invalid !== b.invalid) {
        b.invalid = invalid;
        changed = true;
      }
    }
    if (changed) {
      this._routeDirty = true;
      this._dropPacketsOnBrokenPaths();
    }

    // Emit a sound the first time each event enters warning or active state (T4.2).
    for (const e of this.events.events) {
      if ((e.state === "warning" || e.state === "active") && !e._sounded) {
        e._sounded = true;
        if (e.kind === "az_failure" || e.kind === "spot_interruption" || e.kind === "region_failure")
          this.emit({ kind: "sound", name: "azFail" });
        else if (e.kind === "traffic_spike") this.emit({ kind: "sound", name: "spike" });
        else this.emit({ kind: "sound", name: "alert" });
      }
    }

    // Track events we've cleared (their window ended while we were still alive)
    // for the resilience score.
    for (const e of this.events.events) {
      if (e.state === "done" && !this._eventsCleared.has(e)) {
        this._eventsCleared.add(e);
        this._eventsSurvived++;
      }
    }

    // Draw down the budget by the running bill (transfer is billed per-hop in
    // _updatePackets). Game-over on depletion is handled in _checkOutcome().
    this.economy.chargeBill(this.bill.tick(dt, this.grid));
  }

  // True if the tile at this "c,r" key cannot currently carry traffic — either
  // offline (its AZ failed) or structurally invalid (an unmet dependency, e.g. a
  // Read Replica with no source primary). Gate (Route 53) and azResilient
  // services are immune to AZ failures, but still subject to dependency rules.
  _isKeyDisabled(key) {
    const [c, r] = Grid.parseKey(key);
    const b = this.grid.getBuilding(c, r);
    if (b && !this._dependencyMet(b)) return true;
    if (b && b.service.spotInterruptible && this.events.spotInterrupted()) return true;
    // Route 53 (gate) is global and survives AZ + region failures.
    if (b && b.service.role === ROLE.GATE) return false;
    // A region failure downs the whole primary region — Multi-AZ can't save it.
    if (this.events.isTileInFailedRegion(c, r)) return true;
    // An AZ failure is survived by azResilient (Multi-AZ) services.
    if (b && b.service.azResilient) return false;
    return this.events.isTileDisabled(c, r);
  }

  // True if a building's structural dependency (catalog `dependsOn`) is satisfied
  // by another building present on the board. No dependency → always true.
  // Models real AWS topology: e.g. an RDS Read Replica must have a source primary.
  _dependencyMet(b) {
    const dep = b.service.dependsOn;
    if (!dep || !dep.anyOf || dep.anyOf.length === 0) return true;
    for (const other of this.grid.buildings.values()) {
      if (other === b) continue;
      if (dep.anyOf.includes(other.service.id)) return true;
    }
    return false;
  }

  // In-game days elapsed (company milestones read this). Uses the demand clock's
  // day length when present, else a default compressed day.
  get simDays() {
    const dayLen = (this.demand && this.demand.s.dayLength) || 8;
    return this.simTime / dayLen;
  }

  // The live metrics company milestones are evaluated against. Includes the T7.6
  // operational-realism signals (sloCompliance is "higher is better", so it works
  // directly as a milestone target; blast/RTO/dataLost are surfaced for telemetry
  // + scoring).
  metrics() {
    return {
      success: this.success,
      failed: this.failed,
      revenue: this.economy.revenue,
      lost: this.economy.lost,
      budget: this.economy.budget,
      eventsSurvived: this._eventsSurvived,
      simDays: this.simDays,
      peakConcurrent: this.peakConcurrent,
      sloCompliance: this.realism.sloCompliance,
      peakBlastRadius: this.realism.peakBlastRadius,
      worstRtoSec: this.realism.worstRtoSec,
      dataLost: this.realism.dataLost,
    };
  }

  // Current milestone evaluation (company mode HUD + results read this).
  evaluateMilestones() {
    return this.milestones.evaluate(this.metrics());
  }

  // ---- Save / resume (R6) -------------------------------------------------
  // A freerun company run can be snapshotted to disk and resumed later. The
  // snapshot captures the board (buildings + typed edges), the ledger + counters,
  // the clock, and the seed. Incident/wave timelines are NOT serialized — they
  // restart fresh on resume, which is fine for a casual endless mode.
  snapshot() {
    const buildings = [];
    for (const b of this.grid.buildings.values()) {
      buildings.push({ id: b.service.id, col: b.col, row: b.row });
    }
    const edges = [];
    this.grid.forEachEdge((c1, r1, c2, r2, type) => {
      edges.push({ a: Grid.key(c1, r1), b: Grid.key(c2, r2), type });
    });
    return {
      v: 1,
      levelId: this.level.id,
      mode: this.mode,
      seed: this._rng.seed,
      cols: this.level.cols,
      rows: this.level.rows,
      simTime: this.simTime,
      economy: {
        budget: this.economy.budget,
        revenue: this.economy.revenue,
        lost: this.economy.lost,
        spent: this.economy.spent,
      },
      success: this.success,
      failed: this.failed,
      eventsSurvived: this._eventsSurvived,
      peakConcurrent: this.peakConcurrent,
      realism: this.realism.toJSON(),
      reinvestRate: this._reinvestRate,
      gateKeys: this.gateKeys.slice(),
      buildings,
      edges,
    };
  }

  // Rebuild a grid (+ gate keys) from a snapshot, for the host to hand back into
  // a fresh Simulation before applySnapshot() restores the scalar run state.
  static buildGridFromSnapshot(snap) {
    const grid = new Grid(snap.cols, snap.rows);
    for (const b of snap.buildings || []) {
      const svc = SERVICES[b.id];
      if (svc) grid.place(svc, b.col, b.row);
    }
    for (const e of snap.edges || []) grid.addEdge(e.a, e.b, e.type);
    return { grid, gateKeys: (snap.gateKeys || []).slice() };
  }

  // Restore the scalar run state from a snapshot onto an already-built sim (whose
  // grid came from buildGridFromSnapshot).
  applySnapshot(snap) {
    this.simTime = snap.simTime || 0;
    this.economy.budget = snap.economy.budget;
    this.economy.revenue = snap.economy.revenue || 0;
    this.economy.lost = snap.economy.lost || 0;
    this.economy.spent = snap.economy.spent || 0;
    this.success = snap.success || 0;
    this.failed = snap.failed || 0;
    this._eventsSurvived = snap.eventsSurvived || 0;
    this.peakConcurrent = snap.peakConcurrent || 0;
    this.realism.restore(snap.realism);
    this._reinvestRate = snap.reinvestRate != null ? snap.reinvestRate : 0.5;
    this._routeDirty = true;
  }

  // Decide win/lose. Sets outcome + outcomeReason; the host owns the brief
  // end-of-round pause + transition to results.
  _checkOutcome() {
    if (this.outcome !== OUTCOME.PLAYING) return;

    // Freerun (company) mode: there's no routed goal or wave finish — the run is
    // endless. The only failure is bankruptcy; success is measured by milestones,
    // which the player banks by cashing out. We flip a flag when all are met (so
    // the HUD can celebrate) but keep PLAYING so they can keep growing.
    if (this.mode === MODE.FREERUN) {
      if (this.budget <= 0) {
        this.outcome = OUTCOME.LOSE;
        this.outcomeReason = "bankrupt";
        return;
      }
      if (!this.milestonesComplete && this.evaluateMilestones().allDone) {
        this.milestonesComplete = true;
        this.emit({ kind: "sound", name: "win" });
      }
      return;
    }

    const res = evaluate({
      budget: this.budget,
      success: this.success,
      failed: this.failed,
      slaMaxDropRate: this.level.slaMaxDropRate,
      goalRequests: this.level.goalRequests,
      wavesFinished: this.waves.finished,
      minRequestsForWin: 1,
    });
    if (res.outcome === OUTCOME.WIN) {
      // Check level-specific service requirements before accepting the win.
      const reqCheck = this._checkWinRequires();
      if (!reqCheck.ok) {
        // Goal met but build doesn't satisfy the lesson — show a hint, don't win.
        this._reqHint = reqCheck.hint;
        return;
      }
      this._reqHint = null;
    } else {
      // Clear hint whenever not in a "goal met but reqs fail" state.
      if (res.outcome === OUTCOME.PLAYING) this._reqHint = null;
    }
    if (res.outcome !== OUTCOME.PLAYING) {
      this.outcome = res.outcome;
      this.outcomeReason = res.reason;
    }
  }

  // Check whether the current routing path satisfies this level's winRequires.
  // Returns { ok: true } or { ok: false, hint: string }.
  _checkWinRequires() {
    const req = this.level.winRequires;
    if (!req) return { ok: true };

    // Find the current best route from the gate.
    const blocked = (key) => this._isKeyDisabled(key);
    let activePath = null;
    let activeSinkKey = null;
    for (const gk of this.gateKeys) {
      const trip = findRoundTrip(this.grid, gk, blocked);
      if (trip) { activePath = trip.path; activeSinkKey = trip.sinkKey; break; }
    }
    if (!activePath) return { ok: false, hint: req.requirementHint || "No valid route" };

    // Collect service ids along the path.
    const pathIds = new Set();
    for (const key of activePath) {
      const [c, r] = Grid.parseKey(key);
      const b = this.grid.getBuilding(c, r);
      if (b) pathIds.add(b.service.id);
    }

    // sinkIs: the sink the path terminates at must be one of the listed ids.
    if (req.sinkIs) {
      const [sc, sr] = Grid.parseKey(activeSinkKey);
      const sink = this.grid.getBuilding(sc, sr);
      if (!sink || !req.sinkIs.includes(sink.service.id)) {
        return { ok: false, hint: req.requirementHint || "Wrong sink service for this challenge" };
      }
    }

    // pathContainsAll: every listed service id must appear in the path.
    if (req.pathContainsAll) {
      for (const id of req.pathContainsAll) {
        if (!pathIds.has(id)) {
          return { ok: false, hint: req.requirementHint || "Required service missing from route" };
        }
      }
    }

    // pathContainsAny: at least one listed service id must appear in the path.
    if (req.pathContainsAny) {
      const has = req.pathContainsAny.some((id) => pathIds.has(id));
      if (!has) {
        return { ok: false, hint: req.requirementHint || "Required service missing from route" };
      }
    }

    // pathExcludes: none of the listed service ids may appear in the path (e.g.
    // "no public/NAT hop"). Forces the lesson's *avoidance* requirement.
    if (req.pathExcludes) {
      for (const id of req.pathExcludes) {
        if (pathIds.has(id)) {
          return { ok: false, hint: req.requirementHint || "Route must avoid a disallowed service" };
        }
      }
    }

    // fanOut: a building of `service` (e.g. SNS) must be wired to at least
    // `minSinks` distinct sink/storage tiles — a structural pub/sub fan-out check
    // (the single-path router can't express one-to-many on its own).
    if (req.fanOut) {
      const { service, minSinks } = req.fanOut;
      let satisfied = false;
      for (const b of this.grid.buildings.values()) {
        if (b.service.id !== service) continue;
        let sinks = 0;
        for (const nk of this.grid.neighbors(Grid.key(b.col, b.row))) {
          const [nc, nr] = Grid.parseKey(nk);
          const nb = this.grid.getBuilding(nc, nr);
          if (nb && SINK_ROLES.has(nb.service.role)) sinks++;
        }
        if (sinks >= (minSinks || 2)) { satisfied = true; break; }
      }
      if (!satisfied) {
        return { ok: false, hint: req.requirementHint || "Fan out to more subscribers" };
      }
    }

    // Edge-type requirements (Phase 5 typed connections): inspect the connection
    // type of each wire the active path traverses. Lets a level demand e.g. a
    // Transit Gateway hop (Mesh vs Bridge) or a PrivateLink hop (private access).
    if (req.edgeTypeAll || req.edgeTypeAny) {
      const edgeTypes = new Set();
      for (let i = 0; i < activePath.length - 1; i++) {
        edgeTypes.add(this.grid.getEdgeType(activePath[i], activePath[i + 1]));
      }
      if (req.edgeTypeAll) {
        for (const t of req.edgeTypeAll) {
          if (!edgeTypes.has(t)) {
            return { ok: false, hint: req.requirementHint || "Required connection type missing from route" };
          }
        }
      }
      if (req.edgeTypeAny && !req.edgeTypeAny.some((t) => edgeTypes.has(t))) {
        return { ok: false, hint: req.requirementHint || "Required connection type missing from route" };
      }
    }

    return { ok: true };
  }

  _spawnPacket() {
    // Pick a gate that currently has a route (around any AZ outage), route from it.
    const blocked = (key) => this._isKeyDisabled(key);
    for (const gk of this.gateKeys) {
      const trip = findRoundTrip(this.grid, gk, blocked);
      if (trip) {
        this.packets.push(new Packet(trip.path, trip.sinkKey, this._rng));
        return;
      }
    }
  }

  _updatePackets(dt) {
    const live = [];
    for (const p of this.packets) {
      p.update(dt, (key) => {
        const [c, r] = Grid.parseKey(key);
        const b = this.grid.getBuilding(c, r);
        if (b) b.activity = 1; // pulse the building the packet enters
        // ---- T2.1: data-transfer cost, modelled on real AWS billing ----
        //   - Intra-AZ traffic is FREE: a plain tile contributes 0 to the hop.
        //   - A tile's transferCostMul is its own processing/egress charge and
        //     applies regardless of AZ (NAT ×8, VPC Endpoint ×0.02, CloudFront ×0.2).
        //   - Crossing an AZ boundary adds the full cross-AZ penalty (×8). Gate
        //     (Route 53) is the internet edge — hops touching it carry no AZ charge.
        let xferMul = (b && b.service.transferCostMul != null) ? b.service.transferCostMul : 0;
        const idx = Math.floor(p.t);
        const prevKey = idx > 0 ? p.path[idx - 1] : null;
        if (prevKey) {
          const [pc, pr] = Grid.parseKey(prevKey);
          const prevB = this.grid.getBuilding(pc, pr);
          // The wire's connection type adds its standing per-hop processing fee
          // (Phase 5: TGW +2 always; PrivateLink +1.3 but exempt from the
          // cross-AZ penalty since traffic stays private; VPC/Peering +0).
          const conn = getConn(this.grid.getEdgeType(prevKey, key));
          xferMul += conn.hopCost || 0;
          const touchesGate =
            (b && b.service.role === ROLE.GATE) ||
            (prevB && prevB.service.role === ROLE.GATE);
          if (!touchesGate && !conn.crossAzExempt &&
              zoneOfColumn(pc, this.grid.cols) !== zoneOfColumn(c, this.grid.cols)) {
            xferMul += BILL.crossAzPenalty;
          }
        }
        this.bill.chargeTransfer(xferMul);
        this.economy.chargeTransfer(BILL.transferPerHop * xferMul * this.bill.auditMul);

        // ---- T2.2: an overloaded building sheds the request crossing it. ----
        if (b && this.loadModel.shouldDrop(this.grid, key)) {
          p.status = "dropped";
        }
        // A tile that just went offline mid-flight also drops the packet.
        if (b && b.disabled) p.status = "dropped";
      });

      if (p.status === "done") {
        // ---- HOOK: on-complete → revenue, scaled by the latency the request
        // actually experienced (a snappy round-trip pays more than a sluggish
        // one). Latency comes from the sink building's live queue state. ----
        const reward = this._rewardFor(p);
        this.success++;
        // T7.6: did this round-trip meet the latency SLO? (uses the sink's live
        // served latency, the same signal the reward scales on.)
        this.realism.onComplete(this._latencyOf(p), this.sloMs);
        // Book revenue; in sandbox/company mode reinvest a configurable fraction
        // of it straight back into the budget.
        const reinvest = this.level.goalRequests ? 0 : this._reinvestRate;
        this.economy.earn(reward, reinvest);
        this.emit({ kind: "float", x: p.x, y: p.y, text: "+$" + reward, good: true });
      } else if (p.status === "dropped") {
        // ---- HOOK: on-drop → lost (an SLA miss costs goodwill/credits). ----
        const penalty = 6;
        this.economy.penalize(penalty);
        this.failed++;
        // T7.6 RPO proxy: a drop while there's no working route is lost work.
        if (this.realism.inOutage) this.realism.onOutageDrop();
        this.emit({ kind: "float", x: p.x, y: p.y, text: "drop", good: false });
      } else {
        live.push(p);
      }
    }
    this.packets = live;
  }

  // The latency a completed request experienced — the serving sink's live latency
  // (which climbs with its queue under load). Drives both reward and SLO checks.
  _latencyOf(p) {
    const [c, r] = Grid.parseKey(p.sinkKey);
    const sink = this.grid.getBuilding(c, r);
    return sink ? sink.latencyMs || sink.service.latency : 6;
  }

  // Per-request reward: base, reduced as the serving database's latency climbs
  // under load. Healthy DB -> full reward; saturated DB -> a fraction.
  _rewardFor(p) {
    const base = 12;
    const latency = this._latencyOf(p);
    // Map latency ~[2..90]ms to a [1.0..0.35] multiplier.
    const mul = clamp(1 - (latency - 6) / 120, 0.35, 1);
    return Math.max(3, Math.round(base * mul));
  }

  // When a wire/building is removed — or a tile goes offline (AZ failure) — any
  // packet whose remaining path is broken is dropped (a failure) rather than
  // teleporting through a gap.
  _dropPacketsOnBrokenPaths() {
    for (const p of this.packets) {
      if (p.status === "done" || p.status === "dropped") continue;
      const idx = Math.floor(p.t);
      for (let i = idx; i < p.path.length - 1; i++) {
        const brokenEdge = !this.grid.hasEdge(p.path[i], p.path[i + 1]);
        const offline =
          this._isKeyDisabled(p.path[i]) || this._isKeyDisabled(p.path[i + 1]);
        if (brokenEdge || offline) {
          p.status = "dropped";
          break;
        }
      }
    }
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
