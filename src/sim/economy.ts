import { getResource } from "../content/resources";
import type { ResourceId, SimulationState } from "./types";

export interface SaleResult {
  state: SimulationState;
  resource: ResourceId;
  amount: number;
  currency: number;
}

export function sellResource(
  resource: ResourceId,
  amount: number,
  state: SimulationState,
): SaleResult {
  const definition = getResource(resource);
  const normalizedAmount = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  if (definition === undefined || normalizedAmount === 0) {
    return { state, resource, amount: 0, currency: 0 };
  }

  const currency =
    definition.sellValue *
    normalizedAmount *
    state.prestige.permanentMultipliers.sellValue;

  return {
    state: {
      ...state,
      currency: state.currency + currency,
      lifetimeCurrency: state.lifetimeCurrency + currency,
    },
    resource,
    amount: normalizedAmount,
    currency,
  };
}

export function getCurrencyPerSecond(state: SimulationState): number {
  void state;
  return 0;
}
