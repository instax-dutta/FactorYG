import { PRESTIGE_THRESHOLD } from "./constants";
import type { SimulationState } from "./types";

export function calculatePrestigePoints(lifetimeCurrency: number): number {
  if (!Number.isFinite(lifetimeCurrency) || lifetimeCurrency <= 0) {
    return 0;
  }

  return Math.floor(Math.sqrt(lifetimeCurrency / PRESTIGE_THRESHOLD));
}

export function canPrestige(state: SimulationState): boolean {
  return (
    Number.isFinite(state.lifetimeCurrency) &&
    state.lifetimeCurrency >= PRESTIGE_THRESHOLD
  );
}
