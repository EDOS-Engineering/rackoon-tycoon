// theme.js — Rackoon Tycoon brand palette + shared visual constants.
// Single source of truth for colors so the whole game stays cohesive.
// "Cozy-industrial": warm dark workshop background, neon belts, googly-eye services.

export const PALETTE = {
  // Backgrounds (dark workshop floor)
  bgDeep: "#11161d",
  bgFloor: "#1a212b",
  bgPanel: "#202a36",
  bgPanelHi: "#2a3645",

  // Grid
  gridLine: "#27323f",
  gridLineHi: "#33445a",
  tileEmpty: "#1d2530",
  tileHover: "#2f3e50",
  tileValid: "#234a35",
  tileInvalid: "#4a2630",

  // Brand
  raccoonFur: "#5b6470",
  raccoonFurDark: "#3c434d",
  raccoonMask: "#1b1f25",
  raccoonStripe: "#2a2f37",
  cream: "#e7e0d0",

  // Accents (the "neon belt" energy)
  accent: "#ffb347", // warm amber — primary brand accent
  accent2: "#48cae4", // cool cyan — secondary / data
  good: "#7ed957",
  bad: "#ff5e5e",
  warn: "#ffd166",
  guest: "#ffd166", // request packet color

  // Text
  text: "#e8edf2",
  textDim: "#9fb0c0",
  textFaint: "#5e6e7e",

  // Wires
  wire: "#48cae4",
  wireGlow: "rgba(72,202,228,0.35)",
};

// Eye whites/pupils for the googly-eye sprite style.
export const EYE = {
  white: "#f7f7f5",
  pupil: "#15181d",
  shine: "#ffffff",
};

export const FONT = {
  ui: "600 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  uiSmall: "500 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  uiBig: "700 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  title: "800 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
};

export const BRAND = {
  name: "Rackoon Tycoon",
  tagline: "Build your cloud empire. Tame the traffic.",
  mascot: "Rocky",
};
