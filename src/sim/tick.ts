import { TILE_SIZE_PX } from "./constants";
import { findConnectedEntity } from "./connections";
import { sellResource } from "./economy";
import {
  addResource,
  canStoreInput,
  createMachineRuntime,
  getResourceAmount,
  removeResource,
  tickExtractor,
} from "./machines";
import type { Entity, MachineRuntime, RenderEvent, ResourceId, SimulationState } from "./types";

export function advanceSimulation(
  state: SimulationState,
  tickCount: number,
  events: RenderEvent[] = [],
): SimulationState {
  if (!Number.isInteger(tickCount) || tickCount <= 0) {
    return state;
  }

  const nextState = structuredClone(state);
  let changed = false;
  for (let tickIndex = 0; tickIndex < tickCount; tickIndex += 1) {
    if (advanceOneTick(nextState, events)) {
      changed = true;
    }
  }

  return changed ? nextState : state;
}

function advanceOneTick(state: SimulationState, events: RenderEvent[]): boolean {
  const activeBefore = new Map<string, boolean>();
  for (const entity of state.grid.entities) {
    const runtime = state.grid.machines[entity.id];
    if (runtime !== undefined) {
      activeBefore.set(entity.id, runtime.active);
    }
  }

  let changed = false;
  for (const entity of state.grid.entities) {
    if (entity.type !== "extractor") {
      continue;
    }

    const runtime = state.grid.machines[entity.id];
    if (runtime === undefined) {
      continue;
    }

    const nextRuntime = tickExtractor(runtime, entity, state);
    if (nextRuntime !== runtime) {
      state.grid.machines[entity.id] = nextRuntime;
      changed = true;
    }
  }

  if (transferMachineOutputs(state)) {
    changed = true;
  }
  if (moveBelts(state)) {
    changed = true;
  }
  if (sellDepotInputs(state, events)) {
    changed = true;
  }

  for (const entity of state.grid.entities) {
    const runtime = state.grid.machines[entity.id];
    if (runtime === undefined) {
      continue;
    }

    const previousActive = activeBefore.get(entity.id);
    if (previousActive !== undefined && previousActive !== runtime.active) {
      events.push({ type: "machineStateChanged", entityId: entity.id, active: runtime.active });
    }
  }

  return changed;
}

function transferMachineOutputs(state: SimulationState): boolean {
  let changed = false;
  for (const entity of state.grid.entities) {
    if (entity.type === "belt" || entity.type === "depot") {
      continue;
    }

    const runtime = state.grid.machines[entity.id];
    if (runtime === undefined) {
      continue;
    }

    const target = findConnectedEntity(entity, state.grid.entities);
    if (target === undefined) {
      continue;
    }

    for (const resource of Object.keys(runtime.output) as ResourceId[]) {
      const amount = getResourceAmount(runtime.output, resource);
      if (amount <= 0) {
        continue;
      }

      if (target.type === "belt") {
        const belt = state.grid.belts[target.id];
        if (belt === undefined || belt.item !== undefined) {
          continue;
        }

        state.grid.belts[target.id] = { ...belt, item: resource, progress: 0 };
      } else {
        const targetRuntime = state.grid.machines[target.id];
        if (targetRuntime === undefined || !canStoreInput(target, targetRuntime, resource)) {
          continue;
        }
        state.grid.machines[target.id] = {
          ...targetRuntime,
          input: addResource(targetRuntime.input, resource, amount),
        };
      }

      state.grid.machines[entity.id] = {
        ...runtime,
        output: removeResource(runtime.output, resource, amount),
      };
      changed = true;
      break;
    }
  }

  return changed;
}

function moveBelts(state: SimulationState): boolean {
  const beltEntities = state.grid.entities.filter((entity) => entity.type === "belt");
  const items = new Map<string, ResourceId>();
  for (const entity of beltEntities) {
    const belt = state.grid.belts[entity.id];
    if (belt?.item !== undefined) {
      items.set(entity.id, belt.item);
    }
  }

  if (items.size === 0) {
    return false;
  }

  for (const entity of beltEntities) {
    const belt = state.grid.belts[entity.id];
    if (belt !== undefined) {
      state.grid.belts[entity.id] = { ...belt, item: undefined, progress: 0 };
    }
  }

  const initiallyOccupied = new Set(items.keys());
  const filled = new Set<string>();
  let changed = false;

  for (const entity of beltEntities) {
    const item = items.get(entity.id);
    if (item === undefined) {
      continue;
    }

    const target = findConnectedEntity(entity, state.grid.entities);
    if (target === undefined) {
      restoreBeltItem(state, entity.id, item);
      continue;
    }

    if (target.type === "belt") {
      const targetBelt = state.grid.belts[target.id];
      if (
        targetBelt === undefined ||
        initiallyOccupied.has(target.id) ||
        filled.has(target.id)
      ) {
        restoreBeltItem(state, entity.id, item);
        continue;
      }

      state.grid.belts[target.id] = { ...targetBelt, item, progress: 0 };
      filled.add(target.id);
      changed = true;
      continue;
    }

    const targetRuntime = state.grid.machines[target.id];
    if (targetRuntime === undefined || !canStoreInput(target, targetRuntime, item)) {
      restoreBeltItem(state, entity.id, item);
      continue;
    }

    state.grid.machines[target.id] = {
      ...targetRuntime,
      input: addResource(targetRuntime.input, item, 1),
    };
    changed = true;
  }

  return changed;
}

function restoreBeltItem(state: SimulationState, entityId: string, item: ResourceId): void {
  const belt = state.grid.belts[entityId];
  if (belt !== undefined) {
    state.grid.belts[entityId] = { ...belt, item, progress: 0 };
  }
}

function sellDepotInputs(state: SimulationState, events: RenderEvent[]): boolean {
  let changed = false;
  for (const entity of state.grid.entities) {
    if (entity.type !== "depot") {
      continue;
    }

    const runtime = state.grid.machines[entity.id];
    if (runtime === undefined) {
      continue;
    }

    for (const resource of Object.keys(runtime.input) as ResourceId[]) {
      const amount = getResourceAmount(runtime.input, resource);
      if (amount <= 0) {
        continue;
      }

      const sale = sellResource(resource, amount, state);
      if (sale.currency <= 0) {
        continue;
      }

      state.currency = sale.state.currency;
      state.lifetimeCurrency = sale.state.lifetimeCurrency;
      state.grid.machines[entity.id] = {
        ...runtime,
        input: removeResource(runtime.input, resource, amount),
      };
      events.push({
        type: "saleCompleted",
        entityId: entity.id,
        resource,
        currency: sale.currency,
        worldX: entity.x * TILE_SIZE_PX + TILE_SIZE_PX / 2,
        worldY: entity.y * TILE_SIZE_PX + TILE_SIZE_PX / 2,
      });
      changed = true;
    }
  }

  return changed;
}

export function createRuntimeRecords(entities: readonly Entity[]): {
  machines: Record<string, MachineRuntime>;
  belts: SimulationState["grid"]["belts"];
} {
  const machines: Record<string, MachineRuntime> = {};
  const belts: SimulationState["grid"]["belts"] = {};
  for (const entity of entities) {
    if (entity.type === "belt") {
      belts[entity.id] = { entityId: entity.id, progress: 0 };
    } else {
      machines[entity.id] = createMachineRuntime(entity);
    }
  }
  return { machines, belts };
}
