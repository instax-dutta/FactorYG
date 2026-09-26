import {
  PRESTIGE_PRODUCTION_BONUS_PER_POINT,
  PRESTIGE_SELL_BONUS_PER_POINT,
  PRESTIGE_THRESHOLD,
} from "../content/balance";
import type { PermanentMultipliers, SimulationState } from "./types";

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

export function permanentMultipliersForPoints(points: number): PermanentMultipliers {
  const earned = Number.isFinite(points) ? Math.max(0, points) : 0;
  return {
    productionSpeed: 1 + earned * PRESTIGE_PRODUCTION_BONUS_PER_POINT,
    sellValue: 1 + earned * PRESTIGE_SELL_BONUS_PER_POINT,
  };
}

export function repairPermanentMultipliers(state: SimulationState): SimulationState {
  const derived = permanentMultipliersForPoints(state.prestige.points);
  const stored = state.prestige.permanentMultipliers;
  if (
    stored.productionSpeed === derived.productionSpeed &&
    stored.sellValue === derived.sellValue
  ) {
    return state;
  }

  return {
    ...state,
    prestige: {
      ...state.prestige,
      permanentMultipliers: derived,
    },
  };
}
