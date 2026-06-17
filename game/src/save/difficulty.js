// difficulty.js — Player-selectable difficulty (Phase 3: T3.8).
// Three tiers. The base tier is the current, tuned pace; the two above tighten
// the starting budget and speed the whole round up. The choice is persisted and
// applied per level: levelScene multiplies its starting budget by `budgetMul`
// and scales the sim timestep by `speedMul` (faster waves, spawns, bill, guests).

import { load, save } from "./storage.js";

export const DIFFICULTIES = [
  {
    id: "architect",
    name: "Architect",
    budgetMul: 1.0,
    speedMul: 1.0,
    blurb: "The standard, tuned pace. Recommended for your first runs.",
  },
  {
    id: "senior",
    name: "Senior Architect",
    budgetMul: 0.8,
    speedMul: 1.25,
    blurb: "Leaner budgets and ~25% faster traffic — less slack to react.",
  },
  {
    id: "principal",
    name: "Principal Architect",
    budgetMul: 0.65,
    speedMul: 1.5,
    blurb: "Tight budgets and 50% faster everything. For seasoned architects.",
  },
];

const KEY = "difficulty";

export function getDifficultyId() {
  return load(KEY, "architect");
}

export function setDifficultyId(id) {
  if (DIFFICULTIES.some((d) => d.id === id)) save(KEY, id);
}

export function getDifficulty() {
  const id = getDifficultyId();
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[0];
}
