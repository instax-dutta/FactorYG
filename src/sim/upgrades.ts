/**
 * Per-machine upgrades: spend credits to make one machine faster (spec §8's
 * `level`, which every saved entity already carries).
 *
 * TUNE_AFTER_PLAYABLE: these numbers are stubs. Early income is single-digit
 * credits per ingot, so the first level is a couple of minutes of play.
 */
export const MAX_MACHINE_LEVEL = 5;
export const UPGRADE_BASE_COST = 60;
/** Each level costs this much more than the last. */
export const UPGRADE_COST_GROWTH = 1.9;
/** Each level adds this much of the machine's base speed. */
export const UPGRADE_SPEED_STEP = 0.25;

import type { MachineType } from './machines';
import { RECIPES } from './recipes';

export type UpgradeRefusal = 'max-level' | 'insufficient-currency';

export type UpgradeCheck = { ok: true; cost: number } | { ok: false; reason: UpgradeRefusal };

export type UpgradeResult =
  | { ok: true; level: number; currency: number }
  | { ok: false; reason: UpgradeRefusal; level: number; currency: number };

function assertLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error(`invalid machine level: ${level}`);
  }
  return level;
}

/**
 * Progress per tick for a machine at this level. Level 1 is exactly the speed
 * machines have always run at, so existing factories and saves are unchanged:
 * every upgrade is a multiplier on top of that baseline.
 */
export function speedMultiplierFor(level: number): number {
  return 1 + (assertLevel(level) - 1) * UPGRADE_SPEED_STEP;
}

/** Machine types that craft: derived from the recipe table, not a list here. */
const CRAFTER_TYPES: ReadonlySet<string> = new Set(
  Object.values(RECIPES)
    .map((recipe) => recipe.machine)
    .filter((machine) => machine !== null),
);

/**
 * Whether a level means anything for this machine type. Exactly the machines
 * `Simulation.advance` accumulates `progress` for: extractors (through
 * `ticksPerItem`) and crafters (through the recipe they run). Everything else
 * moves at a fixed rate — a belt carries one item per tick, a silo releases one
 * per tick, a depot is a sink — so a level would change nothing about them and
 * is not for sale. Note a belt's `ticksPerItem` is its belt-speed figure, not a
 * progress rate, which is why this cannot be read off that field alone.
 */
export function isUpgradeable(type: MachineType): boolean {
  return type === 'extractor' || CRAFTER_TYPES.has(type);
}

/** What the next level costs, or null when the machine is already maxed. */
export function nextUpgradeCost(level: number): number | null {
  assertLevel(level);
  if (level >= MAX_MACHINE_LEVEL) return null;
  // Rounded to whole credits: a price the player cannot pay exactly would be a
  // trap, since the sim spends currency as a number rather than a float purse.
  return Math.round(UPGRADE_BASE_COST * UPGRADE_COST_GROWTH ** (level - 1));
}

export function canUpgrade(level: number, currency: number): UpgradeCheck {
  const cost = nextUpgradeCost(level);
  if (cost === null) return { ok: false, reason: 'max-level' };
  if (currency < cost) return { ok: false, reason: 'insufficient-currency' };
  return { ok: true, cost };
}

/**
 * Buys one level, returning the new level and purse rather than mutating them.
 * A refusal hands both back untouched, so a failed upgrade cannot cost a player.
 */
export function applyUpgrade(level: number, currency: number): UpgradeResult {
  const check = canUpgrade(level, currency);
  if (!check.ok) return { ok: false, reason: check.reason, level, currency };
  return { ok: true, level: level + 1, currency: currency - check.cost };
}
