import { expansionCostFor, MAX_EXPANSIONS_PER_AXIS } from '../sim/expansion';

/**
 * Pure view model for the Expand control (BuildPanel footer). Mirrors the
 * tech-tree panel pattern: statuses and numbers only, no DOM.
 */
export interface ExpansionView {
  /** The next step's price, or null once the plot is maxed. */
  price: number | null;
  affordable: boolean;
  maxed: boolean;
  /** Side length after the next purchase. */
  nextSize: number;
}

export function expansionView(state: {
  currency: number;
  width: number;
  height: number;
  expansionsBought: number;
}): ExpansionView {
  const maxed = state.expansionsBought >= MAX_EXPANSIONS_PER_AXIS;
  const price = maxed ? null : expansionCostFor(state.expansionsBought);
  return {
    price,
    affordable: price !== null && state.currency >= price,
    maxed,
    nextSize: state.width + 16,
  };
}
