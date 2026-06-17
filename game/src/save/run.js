// run.js — Persist + resume an in-progress company (freerun) run (Phase 7, R6).
//
// The campaign saves only results (progress.js); a free-run company is different
// — it's a single long-lived run you step away from and come back to. This stores
// one snapshot blob (produced by Simulation.snapshot()) under a fixed key, so the
// title screen can offer "Resume" and the level scene can save on the way out.
//
// Defensive throughout: a missing/corrupt/wrong-version blob reads as "no run".

import { load, save, clear } from "./storage.js";

const KEY = "run";
const VERSION = 1;

// Persist a Simulation.snapshot() blob. Returns true on success.
export function saveRun(snapshot) {
  if (!snapshot || snapshot.v !== VERSION) return false;
  return save(KEY, snapshot);
}

// Load the saved run snapshot, or null if there isn't a valid one.
export function loadRun() {
  const snap = load(KEY, null);
  if (!snap || typeof snap !== "object" || snap.v !== VERSION) return null;
  if (!Array.isArray(snap.buildings) || !snap.economy) return null;
  return snap;
}

// True if a resumable run exists.
export function hasRun() {
  return loadRun() != null;
}

// Discard the saved run (on bankruptcy, on cash-out, or a fresh start).
export function clearRun() {
  clear(KEY);
}
