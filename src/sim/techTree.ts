import type { MachineType } from './machines';
import type { RecipeId } from './recipes';

/** What a player is allowed to build and craft. Persisted in the save (spec §8). */
export interface UnlockState {
  machines: MachineType[];
  recipes: RecipeId[];
}

export interface TechNode {
  /** A machine type, or the item id of a recipe, so one table serves both. */
  id: string;
  kind: 'machine' | 'recipe';
  label: string;
  /** TUNE_AFTER_PLAYABLE. */
  cost: number;
  /** Nodes that must be unlocked first. */
  requires: readonly string[];
}

/**
 * The tree from spec §7's tiers, opened up in the order the chain needs it:
 * assemble before the components, components before the products. Costs are
 * stubs: early income is single-digit per ingot, so the first unlock is a few
 * minutes of playing.
 */
export const TECH_NODES: readonly TechNode[] = [
  { id: 'refinedStone', kind: 'recipe', label: 'Refined Stone', cost: 40, requires: [] },
  { id: 'assembler', kind: 'machine', label: 'Assembler', cost: 75, requires: [] },
  { id: 'wire', kind: 'recipe', label: 'Wire', cost: 100, requires: ['assembler'] },
  { id: 'gear', kind: 'recipe', label: 'Gear', cost: 100, requires: ['assembler'] },
  { id: 'plate', kind: 'recipe', label: 'Plate', cost: 120, requires: ['assembler', 'refinedStone'] },
  { id: 'silo', kind: 'machine', label: 'Storage Silo', cost: 150, requires: ['assembler'] },
  { id: 'circuit', kind: 'recipe', label: 'Circuit', cost: 400, requires: ['wire', 'gear'] },
  { id: 'frame', kind: 'recipe', label: 'Frame', cost: 500, requires: ['plate', 'gear'] },
  { id: 'motor', kind: 'recipe', label: 'Motor', cost: 1000, requires: ['circuit', 'frame'] },
];

export type UnlockRefusal =
  | 'unknown'
  | 'already-unlocked'
  | 'missing-prerequisite'
  | 'insufficient-currency';

export type UnlockCheck = { ok: true } | { ok: false; reason: UnlockRefusal };

export type UnlockResult =
  | { ok: true; state: UnlockState; currency: number }
  | { ok: false; reason: UnlockRefusal; state: UnlockState; currency: number };

/**
 * What a fresh save starts with: the Phase 1 machines plus the smelter and the
 * two ingot recipes, per the plan's slice 2.6.
 *
 * `depot` is an addition to the plan's list — with nothing to sell to, the game
 * is not playable from its own starting set, and the specs one the player starts
 * on has to reach a depot to earn anything at all.
 */
export function startingUnlocks(): UnlockState {
  return {
    machines: ['extractor', 'belt', 'crossing', 'splitter', 'depot', 'smelter'],
    recipes: ['copperIngot', 'ironIngot'],
  };
}

/** The sandbox state: everything open, which is what a bare `Simulation` gets. */
export const ALL_UNLOCKED: UnlockState = {
  machines: ['extractor', 'belt', 'crossing', 'splitter', 'depot', 'smelter', 'assembler', 'silo'],
  recipes: [
    'copperIngot',
    'ironIngot',
    'refinedStone',
    'wire',
    'gear',
    'plate',
    'circuit',
    'frame',
    'motor',
  ],
};

export function techNode(id: string): TechNode {
  const node = TECH_NODES.find((entry) => entry.id === id);
  if (!node) throw new Error(`unknown tech node: ${id}`);
  return node;
}

export function isMachineUnlocked(state: UnlockState, type: MachineType): boolean {
  return state.machines.includes(type);
}

export function isRecipeUnlocked(state: UnlockState, id: RecipeId): boolean {
  return state.recipes.includes(id);
}

/** A node counts as satisfied whether it is a machine or a recipe. */
function isSatisfied(state: UnlockState, id: string): boolean {
  return state.machines.includes(id as MachineType) || state.recipes.includes(id as RecipeId);
}

export function canUnlock(state: UnlockState, id: string, currency: number): UnlockCheck {
  const node = TECH_NODES.find((entry) => entry.id === id);
  if (!node) return { ok: false, reason: 'unknown' };
  if (isSatisfied(state, id)) return { ok: false, reason: 'already-unlocked' };
  if (!node.requires.every((required) => isSatisfied(state, required))) {
    return { ok: false, reason: 'missing-prerequisite' };
  }
  if (currency < node.cost) return { ok: false, reason: 'insufficient-currency' };
  return { ok: true };
}

/**
 * Buys a node, returning the new state and purse rather than mutating them. A
 * refusal hands both back untouched, so a failed unlock can never cost a player.
 */
export function unlock(state: UnlockState, id: string, currency: number): UnlockResult {
  const check = canUnlock(state, id, currency);
  if (!check.ok) return { ok: false, reason: check.reason, state, currency };

  const node = techNode(id);
  const next: UnlockState =
    node.kind === 'machine'
      ? { ...state, machines: [...state.machines, id as MachineType] }
      : { ...state, recipes: [...state.recipes, id as RecipeId] };

  return { ok: true, state: next, currency: currency - node.cost };
}
