import { MACHINES } from "../content/machines";
import { RECIPES } from "../content/recipes";
import { RESOURCES } from "../content/resources";
import { GRID_HEIGHT, GRID_WIDTH } from "../sim/constants";
import {
  hasPrestigedForExpansion,
  isAlignedGridDimension,
  isGridGrowth,
  isValidGridDimension,
} from "../sim/grid";
import type {
  BeltCell,
  Entity,
  GridDimensions,
  MachineRuntime,
  MachineType,
  ResourceId,
  Rotation,
  SaveGame,
} from "../sim/types";

export type SaveFailureReason =
  | "malformedJson"
  | "unsupportedVersion"
  | "invalidSave"
  | "storageUnavailable"
  | "storageError";

export interface SaveFailure {
  ok: false;
  reason: SaveFailureReason;
  message: string;
}

export interface SaveMigrationSuccess {
  ok: true;
  save: SaveGame;
  migrated: boolean;
}

export type MigrationResult = SaveMigrationSuccess | SaveFailure;
export type SaveMigration = (raw: unknown) => MigrationResult;

type UnknownRecord = Record<string, unknown>;

type ValidationResult =
  | { ok: true; value: SaveGame }
  | SaveFailure;

const MACHINE_IDS = new Set(Object.keys(MACHINES));
const RESOURCE_IDS = new Set(Object.keys(RESOURCES));
const RECIPE_IDS = new Set(Object.keys(RECIPES));
const ROTATIONS = new Set<number>([0, 90, 180, 270]);
const STARTING_PLOT: GridDimensions = { width: GRID_WIDTH, height: GRID_HEIGHT };

export function migrateVersion1(raw: unknown): MigrationResult {
  const validation = validateSaveGame(raw);
  if (!validation.ok) {
    return validation;
  }

  const defaulted = withBlockedProducerDefaults(validation.value);
  return { ok: true, save: defaulted.save, migrated: defaulted.changed };
}

function withBlockedProducerDefaults(save: SaveGame): { save: SaveGame; changed: boolean } {
  const machines = save.grid.machines as UnknownRecord;
  const entityIds = Object.keys(machines).sort();
  const needsDefault = entityIds.some(
    (entityId) => typeof (machines[entityId] as UnknownRecord).alreadyNotifiedBlocked !== "boolean",
  );
  if (!needsDefault) {
    return { save, changed: false };
  }

  const normalized: Record<string, MachineRuntime> = {};
  for (const entityId of entityIds) {
    const runtime = machines[entityId] as MachineRuntime;
    setMachineRuntime(normalized, entityId, {
      ...runtime,
      alreadyNotifiedBlocked: runtime.alreadyNotifiedBlocked === true,
    });
  }

  return { save: { ...save, grid: { ...save.grid, machines: normalized } }, changed: true };
}

function setMachineRuntime(
  machines: Record<string, MachineRuntime>,
  entityId: string,
  runtime: MachineRuntime,
): void {
  Object.defineProperty(machines, entityId, {
    configurable: true,
    enumerable: true,
    value: runtime,
    writable: true,
  });
}

export const SAVE_MIGRATIONS: Record<number, SaveMigration> = {
  1: migrateVersion1,
};

export const MIGRATIONS = SAVE_MIGRATIONS;

export function registerSaveMigration(version: number, migration: SaveMigration): () => void {
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError("Save migration version must be a positive integer.");
  }
  if (Object.hasOwn(SAVE_MIGRATIONS, version)) {
    throw new Error(`Save migration version ${version} is already registered.`);
  }

  SAVE_MIGRATIONS[version] = migration;
  return () => {
    if (SAVE_MIGRATIONS[version] === migration) {
      delete SAVE_MIGRATIONS[version];
    }
  };
}

export function migrateSave(raw: unknown): MigrationResult {
  let candidate = raw;

  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw) as unknown;
    } catch {
      return failure("malformedJson", "Save data is not valid JSON.");
    }
  }

  if (!isRecord(candidate)) {
    return failure("invalidSave", "Save data must be an object.");
  }

  if (!Object.hasOwn(candidate, "version")) {
    return failure("invalidSave", "Save data is missing a version.");
  }

  const sourceVersion = candidate.version;
  if (typeof sourceVersion !== "number" || !Number.isInteger(sourceVersion)) {
    return failure("invalidSave", "Save version must be an integer.");
  }

  const migration = Object.hasOwn(SAVE_MIGRATIONS, sourceVersion)
    ? SAVE_MIGRATIONS[sourceVersion]
    : undefined;
  if (migration === undefined) {
    return failure("unsupportedVersion", `Save version ${String(sourceVersion)} is not supported.`);
  }

  return migration(candidate);
}

export function validateSaveGame(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return failure("invalidSave", "Save data must be an object.");
  }

  if (input.version !== 1) {
    return failure("unsupportedVersion", `Save version ${String(input.version)} is not supported.`);
  }

  if (!isFiniteNonNegativeNumber(input.lastSavedAt)) {
    return invalidField("lastSavedAt");
  }

  if (!isFiniteNonNegativeNumber(input.currency) || !isFiniteNonNegativeNumber(input.lifetimeCurrency)) {
    return invalidField("currency or lifetimeCurrency");
  }

  const prestige = input.prestige;
  if (!isRecord(prestige) || !isFiniteNonNegativeNumber(prestige.points) || !isFiniteNonNegativeNumber(prestige.totalPrestiges)) {
    return invalidField("prestige");
  }

  const multipliers = prestige.permanentMultipliers;
  if (
    !isRecord(multipliers) ||
    !isFinitePositiveNumber(multipliers.productionSpeed) ||
    !isFinitePositiveNumber(multipliers.sellValue)
  ) {
    return invalidField("prestige.permanentMultipliers");
  }

  const unlocked = input.unlocked;
  if (
    !isRecord(unlocked) ||
    !Array.isArray(unlocked.machines) ||
    !Array.isArray(unlocked.recipes) ||
    !isKnownIdList(unlocked.machines, MACHINE_IDS) ||
    !isKnownIdList(unlocked.recipes, RECIPE_IDS)
  ) {
    return invalidField("unlocked");
  }

  const grid = input.grid;
  if (!isRecord(grid) || !validateGrid(grid, prestige.totalPrestiges)) {
    return invalidField("grid");
  }

  const productionChains = input.productionChains;
  if (!isRecord(productionChains) || !validateProductionChains(productionChains)) {
    return invalidField("productionChains");
  }

  return { ok: true, value: input as unknown as SaveGame };
}

function validateGrid(grid: UnknownRecord, totalPrestiges: number): boolean {
  if (
    !isValidGridDimension(grid.width) ||
    !isValidGridDimension(grid.height) ||
    !isAlignedGridDimension(grid.width) ||
    !isAlignedGridDimension(grid.height) ||
    grid.tileSizePx !== 64 ||
    !Array.isArray(grid.nodes) ||
    !Array.isArray(grid.entities) ||
    !isRecord(grid.machines) ||
    !isRecord(grid.belts)
  ) {
    return false;
  }

  if (!claimsEarnedPlot(grid.width, grid.height, totalPrestiges)) {
    return false;
  }

  const width = grid.width;
  const height = grid.height;
  const nodes: unknown[] = grid.nodes;
  const entities: unknown[] = grid.entities;
  const nodeIds = new Set<string>();
  const nodeCoordinates = new Set<string>();
  const entityIds = new Set<string>();
  const entityCoordinates = new Set<string>();

  for (const node of nodes) {
    if (
      !isRecord(node) ||
      !isNonEmptyString(node.id) ||
      !isKnownResource(node.resource) ||
      !isGridCoordinate(node.x, width, height) ||
      !isGridCoordinate(node.y, width, height) ||
      nodeIds.has(node.id) ||
      nodeCoordinates.has(`${String(node.x)},${String(node.y)}`)
    ) {
      return false;
    }
    nodeIds.add(node.id);
    nodeCoordinates.add(`${String(node.x)},${String(node.y)}`);
  }

  const entityById = new Map<string, Entity>();
  for (const entity of entities) {
    if (!isValidEntity(entity, width, height, entityIds, entityCoordinates)) {
      return false;
    }
    entityIds.add(entity.id);
    entityCoordinates.add(`${entity.x},${entity.y}`);
    entityById.set(entity.id, entity);
  }

  const machines: UnknownRecord = grid.machines;
  for (const [entityId, runtime] of Object.entries(machines)) {
    const entity = entityById.get(entityId);
    if (entity === undefined || entity.type === "belt" || !isValidMachineRuntime(entityId, runtime)) {
      return false;
    }
  }

  const belts: UnknownRecord = grid.belts;
  for (const [entityId, belt] of Object.entries(belts)) {
    const entity = entityById.get(entityId);
    if (entity === undefined || entity.type !== "belt" || !isValidBeltCell(entityId, belt)) {
      return false;
    }
  }

  for (const [entityId, entity] of entityById) {
    const hasMachine = Object.hasOwn(machines, entityId);
    const hasBelt = Object.hasOwn(belts, entityId);
    if (entity.type === "belt" ? !hasBelt || hasMachine : !hasMachine || hasBelt) {
      return false;
    }
  }

  return true;
}

function claimsEarnedPlot(width: number, height: number, totalPrestiges: number): boolean {
  if (!isGridGrowth(STARTING_PLOT, { width, height })) {
    return true;
  }

  return hasPrestigedForExpansion(totalPrestiges);
}

function isValidEntity(
  value: unknown,
  width: number,
  height: number,
  ids: ReadonlySet<string>,
  coordinates: ReadonlySet<string>,
): value is Entity {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !isNonEmptyString(value.id) ||
    ids.has(value.id) ||
    !isKnownMachine(value.type) ||
    !isGridCoordinate(value.x, width, height) ||
    !isGridCoordinate(value.y, width, height) ||
    coordinates.has(`${String(value.x)},${String(value.y)}`) ||
    !isValidRotation(value.rotation) ||
    !isPositiveInteger(value.level)
  ) {
    return false;
  }

  if (value.resourceNode !== undefined && !isKnownResource(value.resourceNode)) {
    return false;
  }

  if (value.recipeId !== undefined && !isKnownRecipe(value.recipeId)) {
    return false;
  }

  return true;
}

function isValidMachineRuntime(entityId: string, value: unknown): value is MachineRuntime {
  return (
    isNonEmptyString(entityId) &&
    isRecord(value) &&
    value.entityId === entityId &&
    isFiniteNonNegativeNumber(value.progressTicks) &&
    isResourceAmountMap(value.input) &&
    isResourceAmountMap(value.output) &&
    typeof value.active === "boolean" &&
    (value.alreadyNotifiedBlocked === undefined ||
      typeof value.alreadyNotifiedBlocked === "boolean")
  );
}

function isValidBeltCell(entityId: string, value: unknown): value is BeltCell {
  return (
    isNonEmptyString(entityId) &&
    isRecord(value) &&
    value.entityId === entityId &&
    (value.item === undefined || isKnownResource(value.item)) &&
    isFiniteNumber(value.progress) &&
    value.progress >= 0 &&
    value.progress <= 1
  );
}

function validateProductionChains(chains: UnknownRecord): boolean {
  for (const [chainId, chain] of Object.entries(chains)) {
    if (
      !isNonEmptyString(chainId) ||
      !isRecord(chain) ||
      chain.id !== chainId ||
      !isKnownResource(chain.outputResource) ||
      !isFiniteNonNegativeNumber(chain.steadyStateThroughput) ||
      !isFiniteNonNegativeNumber(chain.sellValue)
    ) {
      return false;
    }
  }

  return true;
}

function isResourceAmountMap(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([resource, amount]) => isKnownResource(resource) && isFiniteNonNegativeNumber(amount),
  );
}

function isKnownIdList(value: unknown[], knownIds: ReadonlySet<string>): boolean {
  const ids = new Set<string>();
  for (const id of value) {
    if (!isNonEmptyString(id) || !knownIds.has(id) || ids.has(id)) {
      return false;
    }
    ids.add(id);
  }
  return true;
}

function isKnownMachine(value: unknown): value is MachineType {
  return typeof value === "string" && MACHINE_IDS.has(value);
}

function isKnownResource(value: unknown): value is ResourceId {
  return typeof value === "string" && RESOURCE_IDS.has(value);
}

function isKnownRecipe(value: unknown): boolean {
  return typeof value === "string" && RECIPE_IDS.has(value);
}

function isValidRotation(value: unknown): value is Rotation {
  return typeof value === "number" && ROTATIONS.has(value);
}

function isGridCoordinate(value: unknown, width: number, height: number): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < width && (value as number) < height;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !Object.getOwnPropertyNames(value).some(isUnsafeRecordKey)
  );
}

function isUnsafeRecordKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

function failure(reason: SaveFailureReason, message: string): SaveFailure {
  return { ok: false, reason, message };
}

function invalidField(field: string): SaveFailure {
  return failure("invalidSave", `Save field "${field}" is invalid.`);
}
