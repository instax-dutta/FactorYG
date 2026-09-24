import { MOTOR_THRESHOLD, SAVE_KEY, SAVE_VERSION } from '../config/constants';
import { BASE_GRID, EXPANSION_STEP, MAX_EXPANSIONS_PER_AXIS } from './expansion';
import { MACHINES, type MachineType, type Rotation } from './machines';
import { inputCapacityFor, RECIPES, type CrafterMachine } from './recipes';
import type { Simulation } from './simulation';
import { startingUnlocks, TECH_NODES } from './techTree';
import { MAX_MACHINE_LEVEL } from './upgrades';
import { resourceNodeAt, type RawResourceId, type ResourceId } from './worldgen';

export interface SaveEntity {
  id: string;
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  /** Only extractors have one, and it is always a raw resource. */
  resourceNode: RawResourceId | null;
  item: ResourceId | null;
  inputs: Partial<Record<ResourceId, number>>;
}

export interface SaveChain {
  steadyStateThroughput: number;
  outputResource: ResourceId;
}

/** Exactly the shape in spec §8. Versioned from day one. */
export interface SaveData {
  version: typeof SAVE_VERSION;
  lastSavedAt: number;
  currency: number;
  prestige: {
    lifetimeMotors: number;
    points: number;
    claimedPoints: number;
    totalPrestiges: number;
    permanentMultipliers: { productionSpeed: number; sellValue: number };
  };
  unlocked: { machines: MachineType[]; recipes: ResourceId[] };
  grid: {
    width: number;
    height: number;
    entities: SaveEntity[];
    expansionsBought: number;
  };
  productionChains: Record<string, SaveChain>;
}

export type SaveLoadResult =
  | { kind: 'empty' }
  | { kind: 'loaded'; save: SaveData }
  | { kind: 'recovered'; raw: string | null };

type LegacySaveEntity = Omit<SaveEntity, 'inputs'> & {
  inputs?: Partial<Record<ResourceId, number>>;
};

interface LegacySaveData {
  version: 1;
  lastSavedAt: number;
  currency: number;
  prestige?: {
    lifetimeMotors?: number;
    points: number;
    totalPrestiges: number;
    permanentMultipliers: { productionSpeed: number; sellValue: number };
  };
  unlocked?: { machines: MachineType[]; recipes: ResourceId[] };
  grid: {
    width: number;
    height: number;
    entities: LegacySaveEntity[];
    expansionsBought?: number;
  };
  productionChains: Record<string, SaveChain>;
}

const MACHINE_TYPES = new Set<MachineType>([
  'extractor',
  'belt',
  'crossing',
  'splitter',
  'smelter',
  'assembler',
  'silo',
  'depot',
]);
const ROTATIONS = new Set<Rotation>([0, 90, 180, 270]);
const RAW_RESOURCE_IDS = new Set<RawResourceId>(['copperOre', 'ironOre', 'coal', 'stone']);
const RESOURCE_IDS = new Set<ResourceId>([
  'copperOre',
  'ironOre',
  'coal',
  'stone',
  'copperIngot',
  'ironIngot',
  'refinedStone',
  'wire',
  'gear',
  'plate',
  'circuit',
  'frame',
  'motor',
]);

export function serializeSim(sim: Simulation, now: number = Date.now()): SaveData {
  const entities = sim.entities().map((entity) => ({
    id: entity.id,
    type: entity.type,
    x: entity.x,
    y: entity.y,
    rotation: entity.rotation,
    level: entity.level,
    resourceNode: entity.resourceNode,
    item: entity.item,
    // Copied, not aliased: a save must be a snapshot of the factory, not a live
    // window onto a sim that keeps ticking underneath it.
    inputs: { ...entity.inputs },
  }));

  const productionChains: Record<string, SaveChain> = {};
  for (const chain of sim.chains()) {
    productionChains[chain.id] = {
      steadyStateThroughput: chain.steadyStateThroughput,
      outputResource: chain.outputResource,
    };
  }

  const prestige = sim.prestigeState();

  return {
    version: SAVE_VERSION,
    lastSavedAt: now,
    currency: sim.currency,
    prestige: {
      lifetimeMotors: sim.lifetimeMotors,
      points: prestige.points,
      claimedPoints: sim.claimedPrestigePoints,
      totalPrestiges: sim.totalPrestiges,
      permanentMultipliers: prestige.permanentMultipliers,
    },
    // The player's actual tech tree, copied so a save cannot alias live state.
    unlocked: {
      machines: [...sim.unlocks().machines],
      recipes: [...sim.unlocks().recipes],
    },
    grid: { width: sim.bounds().width, height: sim.bounds().height, entities, expansionsBought: sim.expansionsBought() },
    productionChains,
  };
}

function invalidSaveData(): never {
  throw new Error('invalid save data');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeFinite(value) && Number.isInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isExpansionCount(value: unknown): value is number {
  return isNonNegativeInteger(value) && value <= MAX_EXPANSIONS_PER_AXIS;
}

function isMachineType(value: unknown): value is MachineType {
  return typeof value === 'string' && MACHINE_TYPES.has(value as MachineType);
}

function isRotation(value: unknown): value is Rotation {
  return typeof value === 'number' && ROTATIONS.has(value as Rotation);
}

function isResourceId(value: unknown): value is ResourceId {
  return typeof value === 'string' && RESOURCE_IDS.has(value as ResourceId);
}

function isRawResourceId(value: unknown): value is RawResourceId {
  return typeof value === 'string' && RAW_RESOURCE_IDS.has(value as RawResourceId);
}

function isInputs(value: unknown): value is Partial<Record<ResourceId, number>> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([id, count]) => isResourceId(id) && isNonNegativeInteger(count),
    )
  );
}

function isCrafterType(type: MachineType): type is CrafterMachine {
  return type === 'smelter' || type === 'assembler';
}

function hasValidEntityState(entity: LegacySaveEntity): boolean {
  const inputs = entity.inputs ?? {};
  const inputEntries = Object.entries(inputs) as Array<[ResourceId, number]>;
  const inputTotal = inputEntries.reduce((total, [, count]) => total + count, 0);

  if (entity.type === 'extractor') {
    if (entity.resourceNode !== resourceNodeAt(entity.x, entity.y)) return false;
    if (entity.item !== null && entity.item !== entity.resourceNode) return false;
  } else if (entity.resourceNode !== null) {
    return false;
  }

  if ((entity.type === 'crossing' || entity.type === 'depot') && entity.item !== null) return false;
  if (
    isCrafterType(entity.type) &&
    entity.item !== null &&
    RECIPES[entity.item].machine !== entity.type
  ) {
    return false;
  }

  if (entity.type === 'silo') return inputTotal <= MACHINES.silo.bufferSize;
  if (!isCrafterType(entity.type)) return inputTotal === 0;
  const machine = entity.type;
  return (
    inputTotal <= MACHINES[machine].bufferSize &&
    inputEntries.every(([id, count]) => count <= inputCapacityFor(machine, id))
  );
}

function hasValidUnlocks(value: { machines: MachineType[]; recipes: ResourceId[] }): boolean {
  const starting = startingUnlocks();
  const unlocked = new Set<string>([...value.machines, ...value.recipes]);
  if (
    !starting.machines.every((id) => unlocked.has(id)) ||
    !starting.recipes.every((id) => unlocked.has(id))
  ) {
    return false;
  }
  return TECH_NODES.every(
    (node) => !unlocked.has(node.id) || node.requires.every((required) => unlocked.has(required)),
  );
}

function isEntity(
  value: unknown,
  width: number,
  height: number,
  requireInputs: boolean,
): value is LegacySaveEntity {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!isMachineType(value.type)) return false;
  if (!isNonNegativeInteger(value.x) || value.x >= width) return false;
  if (!isNonNegativeInteger(value.y) || value.y >= height) return false;
  if (!isRotation(value.rotation)) return false;
  if (!isPositiveInteger(value.level) || value.level > MAX_MACHINE_LEVEL) return false;
  if (value.resourceNode !== null && !isRawResourceId(value.resourceNode)) return false;
  if (value.item !== null && !isResourceId(value.item)) return false;
  if (requireInputs) return isInputs(value.inputs);
  return value.inputs === undefined || isInputs(value.inputs);
}

function isUnlocks(
  value: unknown,
): value is { machines: MachineType[]; recipes: ResourceId[] } {
  if (
    !isRecord(value) ||
    !Array.isArray(value.machines) ||
    !value.machines.every(isMachineType) ||
    !Array.isArray(value.recipes) ||
    !value.recipes.every(isResourceId)
  ) {
    return false;
  }
  return hasValidUnlocks({ machines: value.machines, recipes: value.recipes });
}

function isMultipliers(
  value: unknown,
): value is { productionSpeed: number; sellValue: number } {
  return (
    isRecord(value) &&
    isNonNegativeFinite(value.productionSpeed) &&
    isNonNegativeFinite(value.sellValue)
  );
}

function isLegacyPrestige(
  value: unknown,
): value is NonNullable<LegacySaveData['prestige']> {
  return (
    isRecord(value) &&
    (value.lifetimeMotors === undefined || isNonNegativeFinite(value.lifetimeMotors)) &&
    isNonNegativeInteger(value.points) &&
    isNonNegativeInteger(value.totalPrestiges) &&
    isMultipliers(value.permanentMultipliers)
  );
}

function isV2Prestige(value: unknown): value is SaveData['prestige'] {
  return (
    isRecord(value) &&
    isNonNegativeFinite(value.lifetimeMotors) &&
    isNonNegativeInteger(value.points) &&
    isNonNegativeInteger(value.claimedPoints) &&
    value.claimedPoints <= value.points &&
    isNonNegativeInteger(value.totalPrestiges) &&
    isMultipliers(value.permanentMultipliers)
  );
}

function isProductionChains(value: unknown): value is Record<string, SaveChain> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([id, chain]) =>
        id.length > 0 &&
        isRecord(chain) &&
        isNonNegativeFinite(chain.steadyStateThroughput) &&
        isResourceId(chain.outputResource),
    )
  );
}

function assertV1Save(raw: unknown): asserts raw is LegacySaveData {
  if (!isRecord(raw) || raw.version !== 1) invalidSaveData();
  if (!isNonNegativeFinite(raw.lastSavedAt) || !isNonNegativeFinite(raw.currency)) invalidSaveData();
  if (raw.prestige !== undefined && !isLegacyPrestige(raw.prestige)) invalidSaveData();
  if (raw.unlocked !== undefined && !isUnlocks(raw.unlocked)) invalidSaveData();
  if (!isRecord(raw.grid)) invalidSaveData();
  const { width, height, entities, expansionsBought } = raw.grid;
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) invalidSaveData();
  if (expansionsBought !== undefined && !isExpansionCount(expansionsBought)) invalidSaveData();
  const expectedSize = BASE_GRID.width + EXPANSION_STEP * (expansionsBought ?? 0);
  if (width !== expectedSize || height !== BASE_GRID.height + EXPANSION_STEP * (expansionsBought ?? 0)) {
    invalidSaveData();
  }
  if (!Array.isArray(entities) || !entities.every((entity) => isEntity(entity, width, height, false))) {
    invalidSaveData();
  }
  if (!isProductionChains(raw.productionChains)) invalidSaveData();
}

function assertV2Save(raw: unknown): asserts raw is SaveData {
  if (!isRecord(raw) || raw.version !== SAVE_VERSION) invalidSaveData();
  if (!isNonNegativeFinite(raw.lastSavedAt) || !isNonNegativeFinite(raw.currency)) invalidSaveData();
  if (!isV2Prestige(raw.prestige) || !isUnlocks(raw.unlocked)) invalidSaveData();
  if (!isRecord(raw.grid)) invalidSaveData();
  const { width, height, entities, expansionsBought } = raw.grid;
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) invalidSaveData();
  if (!isExpansionCount(expansionsBought)) invalidSaveData();
  const expectedSize = BASE_GRID.width + EXPANSION_STEP * expansionsBought;
  if (width !== expectedSize || height !== BASE_GRID.height + EXPANSION_STEP * expansionsBought) {
    invalidSaveData();
  }
  if (!Array.isArray(entities) || !entities.every((entity) => isEntity(entity, width, height, true))) {
    invalidSaveData();
  }
  const entityIds = new Set<string>();
  const occupiedCells = new Set<string>();
  for (const entity of entities) {
    if (entityIds.has(entity.id) || occupiedCells.has(`${entity.x},${entity.y}`)) invalidSaveData();
    if (!hasValidEntityState(entity)) invalidSaveData();
    entityIds.add(entity.id);
    occupiedCells.add(`${entity.x},${entity.y}`);
  }
  if (!isProductionChains(raw.productionChains)) invalidSaveData();
}

function migrateV1ToV2(raw: LegacySaveData): SaveData {
  const points = raw.prestige?.points ?? 0;
  const totalPrestiges = raw.prestige?.totalPrestiges ?? 0;
  const permanentMultipliers = raw.prestige?.permanentMultipliers ?? {
    productionSpeed: 1,
    sellValue: 1,
  };
  const unlocked = raw.unlocked ?? startingUnlocks();

  return {
    version: SAVE_VERSION,
    lastSavedAt: raw.lastSavedAt,
    currency: raw.currency,
    prestige: {
      lifetimeMotors: raw.prestige?.lifetimeMotors ?? points * MOTOR_THRESHOLD,
      points,
      claimedPoints: totalPrestiges === 0 ? 0 : points,
      totalPrestiges,
      permanentMultipliers: { ...permanentMultipliers },
    },
    unlocked: {
      machines: [...unlocked.machines],
      recipes: [...unlocked.recipes],
    },
    grid: {
      width: raw.grid.width,
      height: raw.grid.height,
      expansionsBought: raw.grid.expansionsBought ?? 0,
      entities: raw.grid.entities.map((entity) => ({
        id: entity.id,
        type: entity.type,
        x: entity.x,
        y: entity.y,
        rotation: entity.rotation,
        level: entity.level,
        resourceNode: entity.resourceNode,
        item: entity.item,
        inputs: { ...(entity.inputs ?? {}) },
      })),
    },
    productionChains: {},
  };
}

export function validateSaveData(raw: unknown): SaveData {
  if (!isRecord(raw)) invalidSaveData();
  if (raw.version === 1) {
    assertV1Save(raw);
    const migrated = migrateV1ToV2(raw);
    assertV2Save(migrated);
    return migrated;
  }
  if (raw.version !== SAVE_VERSION) throw new Error('unsupported save version');
  assertV2Save(raw);
  return raw;
}

export function migrateSave(raw: unknown): SaveData {
  return validateSaveData(raw);
}

export function applySave(sim: Simulation, raw: unknown): void {
  const save = validateSaveData(raw);
  sim.reset();
  sim.currency = save.currency;
  // Prestige is restored before the grid so a loaded factory's first tick
  // already runs at the right speed. A save with no counter keeps the motors
  // its banked points imply rather than starting the player at zero.
  sim.lifetimeMotors = save.prestige?.lifetimeMotors ?? (save.prestige?.points ?? 0) * MOTOR_THRESHOLD;
  sim.claimedPrestigePoints =
    save.prestige?.claimedPoints ??
    ((save.prestige?.totalPrestiges ?? 0) === 0 ? 0 : (save.prestige?.points ?? 0));
  sim.totalPrestiges = save.prestige?.totalPrestiges ?? 0;
  // A pre-expansion save has no count: load it at the base plot rather than
  // guessing how much the player had bought.
  sim.restoreBounds(save.grid.width, save.grid.height, save.grid.expansionsBought ?? 0);
  // A save written before the tech tree existed has no `unlocked` block at all,
  // so it falls back to the starting set rather than handing out the whole tree.
  sim.setUnlocks(save.unlocked ?? startingUnlocks());
  for (const entity of save.grid.entities) {
    sim.restoreEntity(entity);
  }
  sim.restoreThroughput(
    Object.entries(save.productionChains).map(([id, chain]) => ({ id, ...chain })),
  );
}

export function saveToStorage(
  sim: Simulation,
  storage: Storage,
  now: number = Date.now(),
): SaveData {
  const save = serializeSim(sim, now);
  storage.setItem(SAVE_KEY, JSON.stringify(save));
  return save;
}

/**
 * Throws the save away. A start-over is only real if the next load is a new
 * player, so this must run before the fresh save is written — and it has to be
 * safe on an empty slot, because a start-over is exactly what a player does
 * when the previous run never got far enough to autosave.
 */
export function clearSave(storage: Storage): void {
  storage.removeItem(SAVE_KEY);
}

export function loadSave(storage: Storage, now: number = Date.now()): SaveLoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return { kind: 'recovered', raw: null };
  }
  if (raw === null) return { kind: 'empty' };
  try {
    return { kind: 'loaded', save: validateSaveData(JSON.parse(raw)) };
  } catch {
    try {
      storage.setItem(`${SAVE_KEY}.corrupt.${now}`, raw);
    } catch {}
    try {
      storage.removeItem(SAVE_KEY);
    } catch {}
    return { kind: 'recovered', raw };
  }
}


