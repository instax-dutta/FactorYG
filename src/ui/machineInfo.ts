import { TICK_HZ } from '../config/constants';
import { MACHINES, type MachineType } from '../sim/machines';
import { RECIPES, sellValueFor, type RecipeId } from '../sim/recipes';
import { isUpgradeable, nextUpgradeCost, speedMultiplierFor } from '../sim/upgrades';
import { resourceLabel } from './resourceLabels';
import type { Entity } from '../sim/simulation';
import type { ResourceId } from '../sim/worldgen';

export interface MachineInfo {
  id: string;
  type: MachineType;
  x: number;
  y: number;
  level: number;
  item: ResourceId | null;
  /** The recipe being crafted right now, or null when the machine is idle. */
  recipe: RecipeId | null;
  /** What the machine is holding, so a stalled buffer is visible. */
  buffer: Partial<Record<ResourceId, number>>;
  /** Items per second at the machine's current task, or null when it has none. */
  throughput: number | null;
  grossValuePerSecond: number | null;
  /** Whether this machine has work a level can accelerate at all. */
  upgradeable: boolean;
  /** Credits for the next level, or null when the machine is maxed out. */
  upgradeCost: number | null;
  reachesDepot: boolean;
}

/**
 * Items per second the machine moves while it is doing something. A crafter's
 * rate comes from the recipe it is running, because recipes on the same machine
 * take different times; an idle crafter has no task, so it has no rate.
 */
function throughputFor(entity: Entity, permanentProductionSpeed: number): number | null {
  // Upgrades multiply progress per tick, so the rate the player reads has to
  // carry the same multiplier or the panel would understate an upgraded machine.
  // A machine a level cannot speed up reports its plain rate either way.
  const speed = isUpgradeable(entity.type)
    ? speedMultiplierFor(entity.level) * permanentProductionSpeed
    : 1;
  const ticks = MACHINES[entity.type].ticksPerItem;
  if (ticks !== null) return (TICK_HZ / ticks) * speed;
  if (entity.type === 'silo') return TICK_HZ;
  if (entity.recipe !== null) return (TICK_HZ / RECIPES[entity.recipe].ticks) * speed;
  return null;
}

function outputResourceFor(entity: Entity): ResourceId | null {
  if (entity.type === 'depot') return null;
  if (entity.type === 'extractor') return entity.resourceNode;
  if ((entity.type === 'smelter' || entity.type === 'assembler') && entity.recipe !== null) {
    return RECIPES[entity.recipe].output;
  }
  return entity.item;
}

/**
 * What the inspector's item row says for a machine that holds nothing. A
 * crossing has no state to be empty or idle from — it forwards instantly — so
 * it reads as 'pass-through'; a belt with no cargo is 'empty'; a crafter with
 * no work is 'idle'; a depot is a 'sink'. A held item renders as itself.
 */
export function stateLabel(type: MachineType, item: ResourceId | null): string {
  if (item !== null) return resourceLabel(item);
  if (type === 'crossing') return 'pass-through';
  if (type === 'splitter') return 'splits left/right';
  if (type === 'depot') return 'sink';
  if (type === 'belt') return 'empty';
  return 'idle';
}

/**
 * Pure sim -> UI mapping, read once per throttled push. The buffer is copied
 * because React renders snapshots: the sim keeps ticking underneath, and a live
 * reference would let a later tick rewrite what is already on screen.
 */
export function machineInfoFor(
  entity: Entity,
  reachesDepot: boolean,
  permanentProductionSpeed = 1,
  permanentSellValue = 1,
): MachineInfo {
  const throughput = throughputFor(entity, permanentProductionSpeed);
  const output = outputResourceFor(entity);
  const grossValuePerSecond =
    throughput !== null && output !== null
      ? throughput * sellValueFor(output) * permanentSellValue
      : null;

  return {
    id: entity.id,
    type: entity.type,
    x: entity.x,
    y: entity.y,
    level: entity.level,
    item: entity.item,
    recipe: entity.recipe,
    buffer: { ...entity.inputs },
    throughput,
    grossValuePerSecond,
    upgradeable: isUpgradeable(entity.type),
    upgradeCost: isUpgradeable(entity.type) ? nextUpgradeCost(entity.level) : null,
    reachesDepot,
  };
}
