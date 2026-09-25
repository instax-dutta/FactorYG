import { getMachine } from "../content/machines";
import type { Entity, MachineRuntime, ResourceId, SimulationState } from "./types";

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

  const speedMultiplier = Math.max(
    1,
    Math.floor(state.prestige.permanentMultipliers.productionSpeed * entity.level),
  );
  const processTicks = Math.max(1, Math.floor(definition.defaultProcessTicks / speedMultiplier));
  const outputAmount = getResourceAmount(runtime.output, entity.resourceNode);
  if (outputAmount >= definition.outputBuffer) {
    return {
      ...runtime,
      progressTicks: processTicks,
      active: false,
    };
  }

  const progressTicks = runtime.progressTicks + 1;
  if (progressTicks < processTicks) {
    return {
      ...runtime,
      progressTicks,
      active: true,
    };
  }

  return {
    ...runtime,
    progressTicks: 0,
    output: {
      ...runtime.output,
      [entity.resourceNode]: outputAmount + 1,
    },
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
  const remaining = Math.max(0, current - Math.max(0, amount));
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
  const definition = getMachine(entity.type);
  if (definition === undefined || !canAcceptResource(entity, resource)) {
    return false;
  }

  if (definition.bufferMode === "shared") {
    return getTotalAmount(runtime.input) < (definition.storageCapacity ?? definition.inputBuffer);
  }

  return getResourceAmount(runtime.input, resource) < definition.inputBuffer;
}

export function getTotalAmount(values: Partial<Record<ResourceId, number>>): number {
  return Object.values(values).reduce((total, amount) => total + (amount ?? 0), 0);
}
