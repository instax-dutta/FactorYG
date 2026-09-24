import { GRID_H, GRID_W } from '../config/constants';

/**
 * Grid expansion — plan slice 3.2.
 *
 * The plot starts as the fixed 64x64 grid and grows by EXPANSION_STEP on *both*
 * axes per purchase, up to MAX_EXPANSIONS_PER_AXIS buys. Pure rules only: the
 * Simulation owns the purse and the live bounds, exactly like upgrades.ts owns
 * the level curve.
 */

export const EXPANSION_STEP = 16;
export const MAX_EXPANSIONS_PER_AXIS = 4;
export const BASE_EXPANSION_COST = 800;
export const EXPANSION_COST_GROWTH = 2.2;

export interface Bounds {
  width: number;
  height: number;
}

export const BASE_GRID: Bounds = { width: GRID_W, height: GRID_H };

/** Cost of the (expansionsBought + 1)-th expansion; rises each purchase. */
export function expansionCostFor(expansionsBought: number): number {
  return Math.round(BASE_EXPANSION_COST * EXPANSION_COST_GROWTH ** expansionsBought);
}

export type ExpansionResult =
  | { ok: true; bounds: Bounds }
  | { ok: false; reason: 'maxed' };

export function applyExpansion(bounds: Bounds, expansionsBought: number): ExpansionResult {
  if (expansionsBought >= MAX_EXPANSIONS_PER_AXIS) {
    return { ok: false, reason: 'maxed' };
  }
  return {
    ok: true,
    bounds: {
      width: bounds.width + EXPANSION_STEP,
      height: bounds.height + EXPANSION_STEP,
    },
  };
}
