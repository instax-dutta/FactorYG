import { getMachine } from "../content/machines";
import { getRecipe } from "../content/recipes";
import type {
  Entity,
  MachineRuntime,
  RecipeDefinition,
  ResourceId,
  SimulationState,
} from "./types";

const CYCLE_COMPLETION_EPSILON = 1e-12;

export type SiloRejection = "lockedResource" | "storageFull";

export type SiloAcceptance =
  | { accepted: true; runtime: MachineRuntime }
  | { accepted: false; reason: SiloRejection; runtime: MachineRuntime };

export function createMachineRuntime(entity: Entity): MachineRuntime {
  return {
    entityId: entity.id,
    progressTicks: 0,
    input: {},
    output: {},
    active: false,
  };
}

export function tickExtractor(
  runtime: MachineRuntime,
  entity: Entity,
  state: SimulationState,
): MachineRuntime {
  if (entity.type !== "extractor" || entity.resourceNode === undefined) {
    return runtime;
  }

  const definition = getMachine("extractor");
  if (definition === undefined) {
    return runtime;
  }

  const outputAmount = getResourceAmount(runtime.output, entity.resourceNode);
  if (outputAmount >= definition.outputBuffer) {
    return runtime.active ? { ...runtime, active: false } : runtime;
  }

  const effectiveMultiplier =
    state.prestige.permanentMultipliers.productionSpeed * entity.level;
  const accumulatedProgress =
    runtime.progressTicks + effectiveMultiplier / definition.defaultProcessTicks;
  if (accumulatedProgress < 1 - CYCLE_COMPLETION_EPSILON) {
    return {
      ...runtime,
      progressTicks: accumulatedProgress,
      active: true,
    };
  }

  const remainder = accumulatedProgress - 1;
  return {
    ...runtime,
    progressTicks: Math.abs(remainder) <= CYCLE_COMPLETION_EPSILON ? 0 : remainder,
    output: {
      ...runtime.output,
      [entity.resourceNode]: outputAmount + 1,
    },
    active: false,
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

  if (runtime.progressTicks > 0) {
    if (runtime.progressTicks + 1 < recipe.durationTicks) {
      return { ...runtime, progressTicks: runtime.progressTicks + 1, active: true };
    }

    return setInactive(completeRecipe(runtime, recipe));
  }

  const started = consumeRecipeInputs(runtime, recipe);
  return started === runtime ? runtime : { ...started, progressTicks: 1, active: true };
}

export function canRunRecipe(runtime: MachineRuntime, recipe: RecipeDefinition): boolean {
  const outputBuffer = getRecipeOutputBuffer(recipe);
  if (outputBuffer === undefined) {
    return false;
  }

  return hasRecipeInputs(runtime, recipe) && hasOutputCapacity(runtime, recipe, outputBuffer);
}

export function consumeRecipeInputs(
  runtime: MachineRuntime,
  recipe: RecipeDefinition,
): MachineRuntime {
  if (!canRunRecipe(runtime, recipe)) {
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
  recipe: RecipeDefinition,
): MachineRuntime {
  const outputBuffer = getRecipeOutputBuffer(recipe);
  if (outputBuffer === undefined || !hasOutputCapacity(runtime, recipe, outputBuffer)) {
    return runtime;
  }

  return {
    ...runtime,
    progressTicks: 0,
    output: addResource(runtime.output, recipe.output.resource, recipe.output.amount),
  };
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
  recipe: RecipeDefinition,
  outputBuffer: number,
): boolean {
  const stored = getResourceAmount(runtime.output, recipe.output.resource);
  return stored + recipe.output.amount <= outputBuffer;
}

function getRecipeOutputBuffer(recipe: RecipeDefinition): number | undefined {
  return getMachine(recipe.machine)?.outputBuffer;
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
