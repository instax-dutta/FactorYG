import type { ResourceId } from './worldgen';

export type RecipeId = ResourceId;
export type CrafterMachine = 'smelter' | 'assembler';

export interface Recipe {
  id: RecipeId;
  output: ResourceId;
  /** Input resources consumed per output. Raw ores have no inputs. */
  inputs: Partial<Record<ResourceId, number>>;
  /** Spec §7 tier: 0 raw, 1 smelted, 2 components, 3 products. */
  tier: 0 | 1 | 2 | 3;
  /** Machine that runs the recipe; raws are extracted rather than crafted. */
  machine: CrafterMachine | null;
  /** Craft time in ticks (at TICK_HZ). TUNE_AFTER_PLAYABLE. */
  ticks: number;
  /** Currency per unit when sold at a depot. TUNE_AFTER_PLAYABLE. */
  directSell: number;
}

/** Every recipe in spec §7 keys off the item it produces. */
const recipes = {
  // --- Tier 0: raw, extracted from resource nodes -------------------------
  // Deliberately worth almost nothing: processing is where the money is.
  copperOre: { tier: 0, machine: null, ticks: 0, inputs: {}, directSell: 0.4 },
  ironOre: { tier: 0, machine: null, ticks: 0, inputs: {}, directSell: 0.5 },
  coal: { tier: 0, machine: null, ticks: 0, inputs: {}, directSell: 0.3 },
  stone: { tier: 0, machine: null, ticks: 0, inputs: {}, directSell: 0.25 },

  // --- Tier 1: smelter ----------------------------------------------------
  copperIngot: { tier: 1, machine: 'smelter', ticks: 20, inputs: { copperOre: 1 }, directSell: 5 },
  ironIngot: { tier: 1, machine: 'smelter', ticks: 20, inputs: { ironOre: 1, coal: 1 }, directSell: 7 },
  refinedStone: { tier: 1, machine: 'smelter', ticks: 20, inputs: { stone: 1 }, directSell: 3 },

  // --- Tier 2: assembler --------------------------------------------------
  wire: { tier: 2, machine: 'assembler', ticks: 30, inputs: { copperIngot: 2 }, directSell: 45 },
  gear: { tier: 2, machine: 'assembler', ticks: 30, inputs: { ironIngot: 2 }, directSell: 60 },
  plate: { tier: 2, machine: 'assembler', ticks: 30, inputs: { ironIngot: 1, refinedStone: 1 }, directSell: 55 },

  // --- Tier 3: assembler, sold at the depot -------------------------------
  circuit: { tier: 3, machine: 'assembler', ticks: 30, inputs: { wire: 1, gear: 1 }, directSell: 400 },
  frame: { tier: 3, machine: 'assembler', ticks: 30, inputs: { plate: 2, gear: 1 }, directSell: 600 },
  motor: { tier: 3, machine: 'assembler', ticks: 30, inputs: { circuit: 1, frame: 1 }, directSell: 1500 },
} as const satisfies Record<RecipeId, Omit<Recipe, 'id' | 'output'>>;

export const RECIPES: Record<RecipeId, Recipe> = Object.fromEntries(
  Object.entries(recipes).map(([id, recipe]) => [id, { id, output: id, ...recipe }]),
) as Record<RecipeId, Recipe>;

export function recipeFor(resource: ResourceId): Recipe {
  const recipe = RECIPES[resource as RecipeId];
  if (!recipe) throw new Error(`unknown resource: ${String(resource)}`);
  return recipe;
}

export function sellValueFor(resource: ResourceId): number {
  return recipeFor(resource).directSell;
}

/** Recipes a given crafter can run, in declaration order. */
export function recipesFor(machine: CrafterMachine): Recipe[] {
  return Object.values(RECIPES).filter((recipe) => recipe.machine === machine);
}

/**
 * The most of `item` any of this machine's recipes needs at once. Zero means
 * the machine has no use for it, which is how input type-checking works
 * without hardcoding per-machine item lists.
 */
export function inputCapacityFor(machine: CrafterMachine, item: ResourceId): number {
  let capacity = 0;
  for (const recipe of recipesFor(machine)) {
    capacity = Math.max(capacity, recipe.inputs[item] ?? 0);
  }
  return capacity;
}

/**
 * The recipe a machine can run with what it is holding, or null.
 * First match in declaration order wins: a smelter holding ore for two
 * different recipes always runs the same one, so behaviour is predictable
 * without a recipe-switching UI (which spec §6 rules out for v1).
 */
export function matchRecipe(
  machine: CrafterMachine,
  held: Partial<Record<ResourceId, number>>,
  /** Tech tree gate: a locked recipe is invisible to the machine. */
  isAllowed: (id: RecipeId) => boolean = () => true,
): Recipe | null {
  const allowed = (recipe: Recipe): boolean =>
    isAllowed(recipe.id) &&
    Object.entries(recipe.inputs).every(
      ([input, quantity]) => (held[input as ResourceId] ?? 0) >= (quantity ?? 1),
    );

  const candidates = recipesFor(machine);

  // Prefer a recipe that consumes EVERY DISTINCT resource the machine holds.
  // Both directions matter: the recipe must be craftable from what is held,
  // and no held resource may be left over. Without this, an assembler holding
  // {ironIngot: 2, refinedStone: 1} picked gear (declared first, craftable,
  // but blind to the stone) and the refinedStone sat there forever: the player
  // delivered it for plates, downstream starved, and every belt stayed busy —
  // the act-3 stall the browser playthrough caught. A leftover can never be
  // crafted by this machine anyway, so preferring the match that uses it can
  // only help.
  const heldKinds = Object.keys(held).filter((input) => (held[input as ResourceId] ?? 0) > 0);
  const full = candidates.find(
    (recipe) =>
      allowed(recipe) && heldKinds.every((input) => recipe.inputs[input as ResourceId] !== undefined),
  );
  if (full) return full;

  return candidates.find(allowed) ?? null;
}

/** Deducts a recipe's inputs from a machine's held resources, in place. */
export function consumeInputs(
  held: Partial<Record<ResourceId, number>>,
  inputs: Partial<Record<ResourceId, number>>,
): void {
  for (const [input, quantity] of Object.entries(inputs)) {
    const key = input as ResourceId;
    const remaining = (held[key] ?? 0) - (quantity ?? 1);
    if (remaining > 0) held[key] = remaining;
    else delete held[key];
  }
}
