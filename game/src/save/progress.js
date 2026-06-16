// progress.js — Campaign progress + best scores + level unlocks (T2.5).
// Sits on top of the localStorage wrapper (storage.js). Stores one JSON blob:
//   {
//     unlocked: { levelId: true, ... },     // which levels are playable
//     best:     { levelId: {score,stars,routed} },  // best result per level
//   }
// The first level is always unlocked. Beating a level (>=1 star) unlocks its
// `next` level (declared in levels.js). Everything is defensive: a missing or
// corrupt blob falls back to a fresh profile so the game never wedges on save.

import { load, save } from "./storage.js";

const KEY = "progress";

function fresh() {
  return { unlocked: {}, best: {} };
}

export function loadProgress() {
  const p = load(KEY, null);
  if (!p || typeof p !== "object") return fresh();
  if (!p.unlocked) p.unlocked = {};
  if (!p.best) p.best = {};
  return p;
}

export function saveProgress(p) {
  save(KEY, p);
}

// Ensure a level is marked unlocked (idempotent).
export function unlock(levelId) {
  const p = loadProgress();
  if (!p.unlocked[levelId]) {
    p.unlocked[levelId] = true;
    saveProgress(p);
  }
}

export function isUnlocked(levelId, firstLevelId) {
  if (levelId === firstLevelId) return true; // intro is always open
  const p = loadProgress();
  return !!p.unlocked[levelId];
}

// Best result for a level, or null.
export function bestFor(levelId) {
  const p = loadProgress();
  return p.best[levelId] || null;
}

// Record a finished run. Returns { newBest, unlockedNext } so the results screen
// can celebrate. `result` = { score, stars, routed, won, nextLevelId }.
export function recordResult(levelId, result) {
  const p = loadProgress();
  const prev = p.best[levelId];
  const newBest = !prev || result.score > (prev.score || 0);
  if (newBest) {
    p.best[levelId] = {
      score: result.score,
      stars: result.stars,
      routed: result.routed,
    };
  }

  let unlockedNext = false;
  if (result.won && result.nextLevelId) {
    if (!p.unlocked[result.nextLevelId]) {
      p.unlocked[result.nextLevelId] = true;
      unlockedNext = true;
    }
  }
  saveProgress(p);
  return { newBest, unlockedNext };
}

// Total stars earned across the campaign (for the title screen flourish).
export function totalStars() {
  const p = loadProgress();
  let n = 0;
  for (const k in p.best) n += p.best[k].stars || 0;
  return n;
}
