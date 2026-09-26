import { getMachine, getMachineUpgradeCost, getUpgradeLevel } from "../content/machines";
import { getRecipe } from "../content/recipes";
import type {
  Entity,
  MachineDefinition,
  MachineRuntime,
  RecipeDefinition,
  ResourceId,
  SimulationState,
} from "./types";

const CYCLE_COMPLETION_EPSILON = 1e-12;
const MIN_PROCESS_DURATION_TICKS = 1;

export type SiloRejection = "lockedResource" | "storageFull";

export type SiloAcceptance =
  | { accepted: true; runtime: MachineRuntime }
  | { accepted: false; reason: SiloRejection; runtime: MachineRuntime };

export function getUpgradeCost(entity: Entity): number {
  return getMachineUpgradeCost(entity.type, entity.level);
}

export function getExtractorRate(entity: Entity, state: SimulationState): number {
  const definition = getExtractorDefinition(entity);
  if (definition === undefined) {
    return 0;
  }

  const effectiveMultiplier =
    state.prestige.permanentMultipliers.productionSpeed * getUpgradeLevel(entity.level);
  return Math.max(0, effectiveMultiplier / definition.defaultProcessTicks);
}

export function getProcessDurationTicks(entity: Entity, recipe: RecipeDefinition): number {
  return Math.max(
    MIN_PROCESS_DURATION_TICKS,
    Math.ceil(recipe.durationTicks / getUpgradeLevel(entity.level)),
  );
}

export function getOutputCapacity(entity: Entity): number {
  const definition = getMachine(entity.type);
  if (definition === undefined) {
    return 0;
  }

  return definition.outputBuffer * getUpgradeLevel(entity.level);
}

export function createMachineRuntime(entity: Entity): MachineRuntime {
  return {
    entityId: entity.id,
    progressTicks: 0,
    input: {},
    output: {},
    active: false,
    alreadyNotifiedBlocked: false,
  };
}

export function tickExtractor(
  runtime: MachineRuntime,
  entity: Entity,
  state: SimulationState,
): MachineRuntime {
  const definition = getExtractorDefinition(entity);
  const resource = entity.resourceNode;
  if (definition === undefined || resource === undefined) {
    return runtime;
  }

  const outputAmount = getResourceAmount(runtime.output, resource);
  const capacity = getOutputCapacity(entity);
  const room = capacity - outputAmount;
  if (room <= 0) {
    return runtime.active ? { ...runtime, active: false } : runtime;
  }

  const accumulatedProgress = runtime.progressTicks + getExtractorRate(entity, state);
  const completedCycles =
    accumulatedProgress >= 1 - CYCLE_COMPLETION_EPSILON
      ? Math.floor(accumulatedProgress + CYCLE_COMPLETION_EPSILON)
      : 0;
  if (completedCycles <= 0) {
    return {
      ...runtime,
      progressTicks: accumulatedProgress,
      active: true,
    };
  }

  return {
    ...runtime,
    progressTicks: Math.min(Math.max(0, accumulatedProgress - Math.min(completedCycles, room)), capacity),
    output: addResource(runtime.output, resource, Math.min(completedCycles, room)),
    active: true,
  };
}

export function tickProcessor(
  runtime: MachineRuntime,
  entity: Entity,
  state: SimulationState,
): MachineRuntime {
  const recipe = getProcessorRecipe(entity, state);
  if (recipe === undefined) {
    return abandonRun(runtime);
  }

  const durationTicks = getProcessDurationTicks(entity, recipe);
  if (runtime.progressTicks > 0) {
    if (runtime.progressTicks + 1 < durationTicks) {
      return { ...runtime, progressTicks: runtime.progressTicks + 1, active: true };
    }

    return setInactive(completeRecipe(runtime, entity, recipe));
  }

  const started = consumeRecipeInputs(runtime, entity, recipe);
  return started === runtime ? runtime : { ...started, progressTicks: 1, active: true };
}

export function canRunRecipe(
  runtime: MachineRuntime,
  entity: Entity,
  recipe: RecipeDefinition,
): boolean {
  return hasRecipeInputs(runtime, recipe) && hasOutputCapacity(runtime, entity, recipe);
}

export function consumeRecipeInputs(
  runtime: MachineRuntime,
  entity: Entity,
  recipe: RecipeDefinition,
): MachineRuntime {
  if (!canRunRecipe(runtime, entity, recipe)) {
    return runtime;
  }

  let input = runtime.input;
  for (const [resource, amount] of recipeEntries(recipe)) {
    input = removeResource(input, resource, amount);
  }

  return { ...runtime, input };
}

export function completeRecipe(
  runtime: MachineRuntime,
  entity: Entity,
  recipe: RecipeDefinition,
): MachineRuntime {
  if (!hasOutputCapacity(runtime, entity, recipe)) {
    return runtime;
  }

  return {
    ...runtime,
    progressTicks: 0,
    output: addResource(runtime.output, recipe.output.resource, recipe.output.amount),
  };
}

function getExtractorDefinition(entity: Entity): MachineDefinition | undefined {
  if (entity.type !== "extractor" || entity.resourceNode === undefined) {
    return undefined;
  }

  return getMachine(entity.type);
}

function getProcessorRecipe(
  entity: Entity,
  state: SimulationState,
): RecipeDefinition | undefined {
  if (entity.recipeId === undefined || !state.unlocked.recipes.includes(entity.recipeId)) {
    return undefined;
  }

  const recipe = getRecipe(entity.recipeId);
  return recipe !== undefined && recipe.machine === entity.type ? recipe : undefined;
}

function hasRecipeInputs(runtime: MachineRuntime, recipe: RecipeDefinition): boolean {
  return recipeEntries(recipe).every(
    ([resource, amount]) => amount <= 0 || getResourceAmount(runtime.input, resource) >= amount,
  );
}

function hasOutputCapacity(
  runtime: MachineRuntime,
  entity: Entity,
  recipe: RecipeDefinition,
): boolean {
  const stored = getResourceAmount(runtime.output, recipe.output.resource);
  return stored + recipe.output.amount <= getOutputCapacity(entity);
}

function recipeEntries(recipe: RecipeDefinition): Array<[ResourceId, number]> {
  return Object.entries(recipe.inputs) as Array<[ResourceId, number]>;
}

function setInactive(runtime: MachineRuntime): MachineRuntime {
  return runtime.active ? { ...runtime, active: false } : runtime;
}

function abandonRun(runtime: MachineRuntime): MachineRuntime {
  if (runtime.progressTicks === 0 && !runtime.active) {
    return runtime;
  }

  return {
    ...runtime,
    progressTicks: 0,
    active: false,
  };
}

export function getResourceAmount(
  values: Partial<Record<ResourceId, number>>,
  resource: ResourceId,
): number {
  return values[resource] ?? 0;
}

export function addResource(
  values: Partial<Record<ResourceId, number>>,
  resource: ResourceId,
  amount: number,
): Partial<Record<ResourceId, number>> {
  if (amount <= 0) {
    return { ...values };
  }

  return {
    ...values,
    [resource]: getResourceAmount(values, resource) + amount,
  };
}

export function removeResource(
  values: Partial<Record<ResourceId, number>>,
  resource: ResourceId,
  amount: number,
): Partial<Record<ResourceId, number>> {
  const current = getResourceAmount(values, resource);
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const remaining = Math.max(0, current - safeAmount);
  const next = { ...values };
  if (remaining === 0) {
    delete next[resource];
  } else {
    next[resource] = remaining;
  }
  return next;
}

export function canAcceptResource(entity: Entity, resource: ResourceId): boolean {
  const definition = getMachine(entity.type);
  return definition?.ports.some(
    (port) => port.kind === "input" && (port.accepts === undefined || port.accepts.includes(resource)),
  ) ?? false;
}

export function canStoreInput(entity: Entity, runtime: MachineRuntime, resource: ResourceId): boolean {
  return getInputRoom(entity, runtime, resource) > 0;
}

export function getInputRoom(
  entity: Entity,
  runtime: MachineRuntime,
  resource: ResourceId,
): number {
  const definition = getMachine(entity.type);
  if (definition === undefined || !canAcceptResource(entity, resource)) {
    return 0;
  }

  if (definition.bufferMode === "shared") {
    if (isSiloResourceLocked(runtime, resource)) {
      return 0;
    }

    return Math.max(0, (getStorageCapacity(entity) ?? 0) - getTotalAmount(runtime.input));
  }

  return Math.max(0, definition.inputBuffer - getResourceAmount(runtime.input, resource));
}

export function acceptSiloInput(
  entity: Entity,
  runtime: MachineRuntime,
  resource: ResourceId,
  amount: number,
): SiloAcceptance {
  if (isSiloResourceLocked(runtime, resource)) {
    return { accepted: false, reason: "lockedResource", runtime };
  }

  if (getTotalAmount(runtime.input) + amount > (getStorageCapacity(entity) ?? 0)) {
    return { accepted: false, reason: "storageFull", runtime };
  }

  return {
    accepted: true,
    runtime: {
      ...runtime,
      input: addResource(runtime.input, resource, amount),
      bufferedResource: resource,
    },
  };
}

export function withdrawSiloInput(
  runtime: MachineRuntime,
  resource: ResourceId,
  amount: number,
): MachineRuntime {
  const input = removeResource(runtime.input, resource, amount);
  return {
    ...runtime,
    input,
    ...(getTotalAmount(input) === 0 ? { bufferedResource: undefined } : {}),
  };
}

export function isStorageFull(entity: Entity, runtime: MachineRuntime): boolean {
  const capacity = getStorageCapacity(entity);
  return capacity !== undefined && getTotalAmount(runtime.input) >= capacity;
}

export function getBeltCellCapacity(entity: Entity): number {
  return getMachine(entity.type)?.inputBuffer ?? 0;
}

function isSiloResourceLocked(runtime: MachineRuntime, resource: ResourceId): boolean {
  return (
    runtime.bufferedResource !== undefined &&
    runtime.bufferedResource !== resource &&
    getTotalAmount(runtime.input) > 0
  );
}

function getStorageCapacity(entity: Entity): number | undefined {
  const definition = getMachine(entity.type);
  if (definition === undefined || definition.bufferMode !== "shared") {
    return undefined;
  }

  return definition.storageCapacity ?? definition.inputBuffer;
}

export function getTotalAmount(values: Partial<Record<ResourceId, number>>): number {
  return Object.values(values).reduce((total, amount) => total + (amount ?? 0), 0);
}
