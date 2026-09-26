import { deepFreeze } from "./freeze";
import type { ResourceTier } from "./types";

export const STARTING_CURRENCY = 500;
export const PRESTIGE_THRESHOLD = 100_000;
export const PRESTIGE_PRODUCTION_BONUS_PER_POINT = 0.125;
export const PRESTIGE_SELL_BONUS_PER_POINT = 0.25;
export const GRID_EXPANSION_COST = 100_000;
export const RAW_SELL_VALUE_CEILING = 2;

export interface SellValueBand {
  readonly min: number;
  readonly max: number;
}

export const SELL_VALUE_BANDS: Readonly<Record<ResourceTier, SellValueBand>> = deepFreeze({
  0: { min: 1, max: RAW_SELL_VALUE_CEILING },
  1: { min: 5, max: 23 },
  2: { min: 24, max: 119 },
  3: { min: 120, max: 600 },
});
