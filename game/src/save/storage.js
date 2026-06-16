// storage.js — Thin localStorage wrapper for save/load.
// Phase 1 only persists a couple of light things (best score, last layout could
// come later). Kept defensive: any storage failure (private mode, quota) is
// swallowed so the game never crashes over a save.

const PREFIX = "rackoon.";

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (_e) {
    return false;
  }
}

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (_e) {
    return fallback;
  }
}

export function clear(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (_e) {
    /* ignore */
  }
}
