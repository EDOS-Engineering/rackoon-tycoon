// audio.js — Procedural Web Audio synthesis. Zero runtime deps.
// All sounds are synthesized in real time; no audio files are loaded.
// AudioContext is lazy-initialized on the first play() call to respect the
// browser autoplay policy (the context must be created inside a user gesture
// handler, or resumed after one).
//
// Sound kinds: "place" | "wire" | "erase" | "alert" | "spike" | "azFail" |
//              "win"   | "lose"  | "packet"

export class AudioEngine {
  constructor() {
    this._ctx = null;
    this.muted = false;
  }

  // Call once inside a click / keydown handler to unlock the context.
  resume() {
    try {
      if (this._ctx && this._ctx.state === "suspended") this._ctx.resume();
    } catch (_) {}
  }

  play(kind) {
    if (this.muted) return;
    try {
      const ctx = this._ctx || this._init();
      this.resume();
      if (ctx.state !== "running") return;
      SOUNDS[kind]?.(ctx);
    } catch (_) {}
  }

  _init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("no AudioContext");
    this._ctx = new Ctx();
    return this._ctx;
  }
}

// Singleton used by the level scene.
export const audio = new AudioEngine();

// ---------------------------------------------------------------------------
// Synthesis primitives
// ---------------------------------------------------------------------------

// Create an oscillator + gain envelope scheduled at `at` seconds from now.
// Returns the gain node so callers can add frequency ramps before commit.
function note(ctx, type, freq, gain, attack, decay, at = 0) {
  const t = ctx.currentTime + at;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(ctx.destination);
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(g);
  o.start(t);
  o.stop(t + attack + decay + 0.01);
  return { o, g, t };
}

// ---------------------------------------------------------------------------
// Sound library
// ---------------------------------------------------------------------------
const SOUNDS = {
  // Short click-pop on building placement.
  place(ctx) {
    const { o } = note(ctx, "square", 600, 0.15, 0.005, 0.09);
    o.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08);
  },

  // Rising bloop when a wire is committed.
  wire(ctx) {
    const { o } = note(ctx, "sine", 280, 0.13, 0.005, 0.14);
    o.frequency.exponentialRampToValueAtTime(560, ctx.currentTime + 0.14);
  },

  // Descending pop when a building is erased.
  erase(ctx) {
    const { o } = note(ctx, "triangle", 500, 0.10, 0.005, 0.11);
    o.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.11);
  },

  // Double-beep cost-audit warning.
  alert(ctx) {
    for (const at of [0, 0.14]) {
      const { o } = note(ctx, "sine", 660, 0.10, 0.01, 0.11, at);
    }
  },

  // Aggressive buzzy warning for traffic spike.
  spike(ctx) {
    const { o } = note(ctx, "sawtooth", 110, 0.10, 0.01, 0.4);
    // LFO tremolo
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfoG.gain.value = 35;
    lfo.frequency.value = 9;
    lfo.connect(lfoG);
    lfoG.connect(o.frequency);
    lfo.start(ctx.currentTime);
    lfo.stop(ctx.currentTime + 0.45);
  },

  // Low, descending thunk for AZ failure.
  azFail(ctx) {
    const { o } = note(ctx, "square", 220, 0.12, 0.005, 0.5);
    o.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.5);
  },

  // Ascending C-E-G-C arpeggio on win.
  win(ctx) {
    [523, 659, 784, 1047].forEach((f, i) => {
      const at = i * 0.12;
      note(ctx, "sine", f, 0.12, 0.01, 0.26, at);
    });
  },

  // Sad glide-down on lose.
  lose(ctx) {
    const { o } = note(ctx, "sawtooth", 440, 0.13, 0.02, 0.7);
    o.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.7);
  },

  // Tiny high ping when a packet completes a round-trip.
  packet(ctx) {
    note(ctx, "sine", 1400, 0.04, 0.002, 0.06);
  },
};
