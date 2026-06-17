// rng.js — Tiny seedable PRNG (mulberry32) for the simulation (Phase 7, R2).
//
// Sim-path randomness (incident scheduling, drop decisions, demand jitter) must
// be seedable so a run is reproducible and the headless harness can balance
// curves deterministically. Cosmetic randomness (sparks, packet wiggle) can keep
// using Math.random — it never affects the simulation outcome.
//
//   const rng = makeRng(12345);   // fixed seed → deterministic
//   const rng = makeRng();        // time-seeded → varied per run
//   rng();           // float in [0, 1)
//   rng.int(n);      // integer in [0, n)
//   rng.pick(arr);   // a random element
//   rng.range(a, b); // float in [a, b)

export function makeRng(seed = (Date.now() ^ (Math.random() * 0x100000000)) >>> 0) {
  let a = seed >>> 0;
  const rng = function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.seed = seed >>> 0;
  return rng;
}
