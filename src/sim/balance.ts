import { TICK_HZ } from '../config/constants';
import { MACHINES } from './machines';
import { RECIPES, sellValueFor, type RecipeId } from './recipes';
import { TECH_NODES } from './techTree';
import type { ResourceId } from './worldgen';

/**
 * Currency per unit at the depot, keyed by item. A view of the recipe table so
 * the balance pass has one place to read the curve from without a second copy
 * of the numbers drifting out of sync. TUNE_AFTER_PLAYABLE.
 */
export const SELL_VALUES: Record<RecipeId, number> = Object.fromEntries(
  (Object.keys(RECIPES) as RecipeId[]).map((id) => [id, sellValueFor(id)]),
) as Record<RecipeId, number>;

/**
 * The measured act-2 income (browser playthrough, PLAYTEST.md §5): four copper
 * lines running into wire assemblers at t≈115s. The one number the tech-cost
 * ladder is priced against, so re-costing the tree is one edit here.
 */
export const ACT2_INCOME_CPS = 23;

/** Total credits to buy every node of the tech tree. */
export const TECH_TOTAL_COST = TECH_NODES.reduce((sum, node) => sum + node.cost, 0);

/**
 * Seconds of act-2 saving needed to buy every tech node. The September 2026
 * tuning pass priced the tree against `ACT2_INCOME_CPS` so the whole ladder is
 * reachable in ~2 minutes of act-2 play; `tests/balance.test.ts` pins it.
 */
export function fullLadderCostSeconds(): number {
  return TECH_TOTAL_COST / ACT2_INCOME_CPS;
}

/**
 * Sequential work-seconds to produce the first Motor: extracting every raw in
 * its dependency tree, smelting each intermediate, then assembling its way up.
 *
 * This is the estimator the balance pass moves, not a wall-clock prediction: it
 * ignores transport, machine count, and parallelism, so a real factory that
 * dedicates one machine per step beats it only by overlapping stages.
 */
export function timeToFirstMotor(): number {
  const crafterTicks: Record<string, number> = { smelter: 0, assembler: 0 };
  const rawCounts: Partial<Record<ResourceId, number>> = {};

  const expand = (item: ResourceId, quantity: number): void => {
    const recipe = RECIPES[item as RecipeId];
    if (!recipe) throw new Error(`unknown resource: ${String(item)}`);

    if (recipe.tier === 0) {
      rawCounts[item] = (rawCounts[item] ?? 0) + quantity;
      return;
    }

    const machine = recipe.machine as string;
    crafterTicks[machine] = (crafterTicks[machine] ?? 0) + quantity * recipe.ticks;
    for (const [input, per] of Object.entries(recipe.inputs)) {
      expand(input as ResourceId, quantity * (per ?? 1));
    }
  };

  expand('motor', 1);

  const extractorTicks = MACHINES.extractor.ticksPerItem ?? 1;
  const rawTicks = Object.values(rawCounts).reduce(
    (total, count) => total + (count ?? 0) * extractorTicks,
    0,
  );
  const craftTicks = Object.values(crafterTicks).reduce((total, ticks) => total + ticks, 0);

  return (craftTicks + rawTicks) / TICK_HZ;
}
