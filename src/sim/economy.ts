import { getResource } from "../content/resources";
import type { CurrencySample, ResourceId, SimulationState } from "./types";

export const CURRENCY_RATE_WINDOW_TICKS = 100;
export const CURRENCY_RATE_WINDOW_SECONDS = 10;

export interface SaleWindowFilter {
  entityId?: string;
  resource?: ResourceId;
}

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
  const multiplier = state.prestige.permanentMultipliers.sellValue;
  const currency = definition === undefined ? 0 : definition.sellValue * normalizedAmount * multiplier;
  if (
    definition === undefined ||
    normalizedAmount === 0 ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    !Number.isFinite(currency) ||
    currency <= 0
  ) {
    return { state, resource, amount: 0, currency: 0 };
  }

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

export function hasFullRateWindow(state: SimulationState): boolean {
  return Number.isFinite(state.tickCount) && state.tickCount >= CURRENCY_RATE_WINDOW_TICKS;
}

export function getWindowedSaleCurrency(
  state: SimulationState,
  filter: SaleWindowFilter = {},
): number {
  if (!Number.isFinite(state.tickCount)) {
    return 0;
  }

  const firstTick = state.tickCount - CURRENCY_RATE_WINDOW_TICKS + 1;
  const total = state.currencySamples.reduce((sum, sample) => {
    if (
      sample.tick < firstTick ||
      sample.tick > state.tickCount ||
      !Number.isFinite(sample.amount) ||
      !isInWindowFilter(sample, filter)
    ) {
      return sum;
    }
    return sum + sample.amount;
  }, 0);

  return Number.isFinite(total) ? total : 0;
}

export function getCurrencyPerSecond(state: SimulationState): number {
  if (!hasFullRateWindow(state)) {
    return 0;
  }

  return getWindowedSaleCurrency(state) / CURRENCY_RATE_WINDOW_SECONDS;
}

function isInWindowFilter(sample: CurrencySample, filter: SaleWindowFilter): boolean {
  if (filter.entityId !== undefined && sample.entityId !== filter.entityId) {
    return false;
  }
  if (filter.resource !== undefined && sample.resource !== filter.resource) {
    return false;
  }
  return true;
}
