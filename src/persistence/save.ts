import { createInitialState } from "../sim/initialState";
import { SAVE_KEY } from "../sim/constants";
import { getMachine } from "../content/machines";
import { RESOURCES } from "../content/resources";
import { applyOfflineProgress, calculateOfflineProgress } from "../sim/offline";
import type {
  BeltCell,
  Entity,
  MachineRuntime,
  MachineType,
  ProductionChainSummary,
  ResourceId,
  ResourceNode,
  SaveGame,
  SimulationState,
} from "../sim/types";
import {
  migrateSave,
  validateSaveGame,
  type SaveFailureReason,
  type MigrationResult,
} from "./migrate";

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ParseSaveResult =
  | { ok: true; save: SaveGame }
  | { ok: false; reason: SaveFailureReason; message: string };

export interface LoadSaveResult {
  state: SimulationState;
  recovered: boolean;
  source: "storage" | "newGame";
  reason?: SaveFailureReason;
  message?: string;
}

export function projectSaveGame(state: SaveGame): SaveGame {
  return {
    version: 1,
    lastSavedAt: state.lastSavedAt,
    currency: state.currency,
    lifetimeCurrency: state.lifetimeCurrency,
    prestige: {
      points: state.prestige.points,
      totalPrestiges: state.prestige.totalPrestiges,
      permanentMultipliers: {
        productionSpeed: state.prestige.permanentMultipliers.productionSpeed,
        sellValue: state.prestige.permanentMultipliers.sellValue,
      },
    },
    unlocked: {
      machines: [...state.unlocked.machines],
      recipes: [...state.unlocked.recipes],
    },
    grid: {
      width: state.grid.width,
      height: state.grid.height,
      tileSizePx: state.grid.tileSizePx,
      nodes: state.grid.nodes.map((node) => projectNode(node)),
      entities: state.grid.entities.map((entity) => projectEntity(entity)),
      machines: projectMachines(state.grid.machines, state.grid.entities),
      belts: projectBelts(state.grid.belts),
    },
    productionChains: projectProductionChains(state.productionChains),
  };
}

export function serializeSave(state: SaveGame): string {
  const projected = projectSaveGame(state);
  const validation = validateSaveGame(projected);
  if (!validation.ok) {
    throw new TypeError(`Cannot serialize save: ${validation.message}`);
  }

  return JSON.stringify(projected);
}

export function parseSave(raw: unknown): ParseSaveResult {
  const result = migrateSave(raw);
  if (!result.ok) {
    return result;
  }

  return { ok: true, save: projectSaveGame(result.save) };
}

export function loadSaveWithResult(storage?: SaveStorage): LoadSaveResult {
  if (!isSaveStorage(storage)) {
    return {
      state: createInitialState(),
      recovered: true,
      source: "newGame",
      reason: "storageUnavailable",
      message: "A save storage adapter is unavailable.",
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return {
      state: createInitialState(),
      recovered: true,
      source: "newGame",
      reason: "storageError",
      message: "The save storage adapter could not be read.",
    };
  }

  if (raw === null) {
    return { state: createInitialState(), recovered: false, source: "newGame" };
  }

  const parsed = parseSave(raw);
  if (!parsed.ok) {
    return {
      state: createInitialState(),
      recovered: true,
      source: "newGame",
      reason: parsed.reason,
      message: parsed.message,
    };
  }

  return { state: stateFromSave(parsed.save), recovered: false, source: "storage" };
}

export function loadSave(storage?: SaveStorage): SimulationState {
  return loadSaveWithResult(storage).state;
}

export function loadSaveWithOfflineResult(
  storage: SaveStorage | undefined,
  now: number,
): LoadSaveResult {
  const result = loadSaveWithResult(storage);
  if (result.source !== "storage") {
    return result;
  }

  const summary = calculateOfflineProgress(result.state, now);
  const lastSavedAt =
    Number.isFinite(now) && now >= 0
      ? Math.max(result.state.lastSavedAt, now)
      : result.state.lastSavedAt;
  const state = {
    ...applyOfflineProgress(result.state, summary),
    lastSavedAt,
  };
  saveToStorage(storage, state);

  return {
    ...result,
    state,
  };
}

export function saveToStorage(storage: SaveStorage | undefined, state: SaveGame): void {
  if (!isSaveStorage(storage)) {
    return;
  }

  try {
    storage.setItem(SAVE_KEY, serializeSave(state));
  } catch {
    return;
  }
}

function stateFromSave(save: SaveGame): SimulationState {
  const initial = createInitialState();
  const projected = projectSaveGame(save);

  return {
    ...initial,
    version: projected.version,
    lastSavedAt: projected.lastSavedAt,
    currency: projected.currency,
    lifetimeCurrency: projected.lifetimeCurrency,
    prestige: projected.prestige,
    unlocked: projected.unlocked,
    grid: projected.grid,
    productionChains: projected.productionChains,
    nextEntitySequence: getNextEntitySequence(projected.grid.entities),
    tickCount: 0,
    currencySamples: [],
    pendingRotation: 0,
    notifications: [],
  };
}

function getNextEntitySequence(entities: readonly Entity[]): number {
  let highestSequence = 0;
  for (const entity of entities) {
    const match = /^entity-(\d+)$/.exec(entity.id);
    if (match === null) {
      continue;
    }
    const sequence = Number(match[1]);
    if (Number.isSafeInteger(sequence) && sequence > highestSequence) {
      highestSequence = sequence;
    }
  }

  return highestSequence + 1;
}

function projectNode(node: ResourceNode): ResourceNode {
  return {
    id: node.id,
    resource: node.resource,
    x: node.x,
    y: node.y,
  };
}

function projectEntity(entity: Entity): Entity {
  const projected: Entity = {
    id: entity.id,
    type: entity.type,
    x: entity.x,
    y: entity.y,
    rotation: entity.rotation,
    level: entity.level,
  };

  if (entity.resourceNode !== undefined) {
    projected.resourceNode = entity.resourceNode;
  }
  if (entity.recipeId !== undefined) {
    projected.recipeId = entity.recipeId;
  }

  return projected;
}

function projectMachines(
  machines: Record<string, MachineRuntime>,
  entities: readonly Entity[],
): Record<string, MachineRuntime> {
  const typeByEntityId = new Map(entities.map((entity) => [entity.id, entity.type]));
  const projected: Record<string, MachineRuntime> = {};
  for (const entityId of Object.keys(machines).sort()) {
    const runtime = machines[entityId];
    const input = projectAmounts(runtime.input);
    setRecordValue(projected, entityId, {
      entityId: runtime.entityId,
      progressTicks: runtime.progressTicks,
      input,
      output: projectAmounts(runtime.output),
      active: runtime.active,
      ...projectBufferedResource(
        typeByEntityId.get(entityId),
        runtime.bufferedResource,
        input,
      ),
    });
  }
  return projected;
}

function projectBelts(belts: Record<string, BeltCell>): Record<string, BeltCell> {
  const projected: Record<string, BeltCell> = {};
  for (const entityId of Object.keys(belts).sort()) {
    const belt = belts[entityId];
    setRecordValue(projected, entityId, {
      entityId: belt.entityId,
      progress: belt.progress,
      ...(belt.item === undefined ? {} : { item: belt.item }),
    });
  }
  return projected;
}

function projectProductionChains(
  chains: Record<string, ProductionChainSummary>,
): Record<string, ProductionChainSummary> {
  const projected: Record<string, ProductionChainSummary> = {};
  for (const chainId of Object.keys(chains).sort()) {
    const chain = chains[chainId];
    setRecordValue(projected, chainId, {
      id: chain.id,
      outputResource: chain.outputResource,
      steadyStateThroughput: chain.steadyStateThroughput,
      sellValue: chain.sellValue,
    });
  }
  return projected;
}

function projectAmounts(
  amounts: Partial<Record<string, number>>,
): Partial<Record<string, number>> {
  const projected: Record<string, number> = {};
  for (const resource of Object.keys(amounts).sort()) {
    if (!Object.hasOwn(RESOURCES, resource)) {
      continue;
    }
    const amount = amounts[resource];
    if (amount !== undefined) {
      setRecordValue(projected, resource, amount);
    }
  }
  return projected;
}

function projectBufferedResource(
  entityType: MachineType | undefined,
  bufferedResource: ResourceId | undefined,
  input: Partial<Record<string, number>>,
): { bufferedResource?: ResourceId } {
  if (bufferedResource !== undefined) {
    return Object.hasOwn(RESOURCES, bufferedResource) ? { bufferedResource } : {};
  }

  if (entityType === undefined || getMachine(entityType)?.bufferMode !== "shared") {
    return {};
  }

  for (const resource of Object.keys(input).sort()) {
    if ((input[resource] ?? 0) > 0) {
      return { bufferedResource: resource as ResourceId };
    }
  }

  return {};
}

function setRecordValue<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function isSaveStorage(value: unknown): value is SaveStorage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { getItem?: unknown }).getItem === "function" &&
    typeof (value as { setItem?: unknown }).setItem === "function"
  );
}

export type { MigrationResult };
