import { TILE_SIZE_PX } from "./constants";
import {
  arePortsConnected,
  findConnectedEntity,
  getEntityAt,
  getWorldPortCells,
} from "./connections";
import { CURRENCY_RATE_WINDOW_TICKS, sellResource } from "./economy";
import {
  addResource,
  canStoreInput,
  createMachineRuntime,
  getResourceAmount,
  removeResource,
  tickExtractor,
} from "./machines";
import type {
  BeltCell,
  Entity,
  MachineRuntime,
  RenderEvent,
  ResourceId,
  SimulationState,
} from "./types";

export function advanceSimulation(
  state: SimulationState,
  tickCount: number,
  events: RenderEvent[] = [],
): SimulationState {
  if (!Number.isInteger(tickCount) || tickCount <= 0) {
    return state;
  }

  const nextState = structuredClone(state);
  for (let tickIndex = 0; tickIndex < tickCount; tickIndex += 1) {
    nextState.tickCount += 1;
    advanceOneTick(nextState, events, nextState.tickCount);
    const firstTick = nextState.tickCount - CURRENCY_RATE_WINDOW_TICKS + 1;
    nextState.currencySamples = nextState.currencySamples.filter(
      (sample) => sample.tick >= firstTick && sample.tick <= nextState.tickCount,
    );
  }

  return nextState;
}

function advanceOneTick(state: SimulationState, events: RenderEvent[], tick: number): boolean {
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
  if (depositBeltItems(state)) {
    changed = true;
  }
  if (sellDepotInputs(state, events, tick)) {
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

export function moveBelts(state: SimulationState): boolean {
  const beltEntities = state.grid.entities.filter((entity) => entity.type === "belt");
  const items = new Map<string, BeltCell>();
  for (const entity of beltEntities) {
    const belt = state.grid.belts[entity.id];
    if (belt?.item !== undefined) {
      items.set(entity.id, belt);
    }
  }

  if (items.size === 0) {
    return false;
  }

  const initiallyOccupied = new Set(items.keys());
  const nextOccupancy = new Map<string, BeltCell>();
  let moved = false;

  for (const entity of beltEntities) {
    const item = items.get(entity.id);
    if (item === undefined) {
      continue;
    }

    const target = findConnectedEntity(entity, state.grid.entities);
    const targetBelt = target?.type === "belt" ? state.grid.belts[target.id] : undefined;
    if (
      target === undefined ||
      targetBelt === undefined ||
      initiallyOccupied.has(target.id) ||
      nextOccupancy.has(target.id)
    ) {
      nextOccupancy.set(entity.id, item);
      continue;
    }

    nextOccupancy.set(target.id, {
      entityId: target.id,
      item: item.item,
      progress: 0,
    });
    moved = true;
  }

  if (!moved) {
    return false;
  }

  for (const entityId of items.keys()) {
    const belt = state.grid.belts[entityId];
    if (belt !== undefined) {
      state.grid.belts[entityId] = { ...belt, item: undefined, progress: 0 };
    }
  }

  for (const [entityId, occupancy] of nextOccupancy) {
    const belt = state.grid.belts[entityId];
    if (belt !== undefined) {
      state.grid.belts[entityId] = {
        ...belt,
        item: occupancy.item,
        progress: occupancy.progress,
      };
    }
  }

  return true;
}

export function depositBeltItems(state: SimulationState): boolean {
  let changed = false;

  for (const target of state.grid.entities) {
    if (target.type === "belt") {
      continue;
    }

    let runtime = state.grid.machines[target.id];
    if (runtime === undefined) {
      continue;
    }

    for (const { port, x, y } of getWorldPortCells(target)) {
      if (port.kind !== "input") {
        continue;
      }

      const source = getEntityAt(state.grid.entities, x, y);
      if (source?.type !== "belt") {
        continue;
      }

      const belt = state.grid.belts[source.id];
      const item = belt?.item;
      if (
        belt === undefined ||
        item === undefined ||
        !arePortsConnected(source, target, item) ||
        !canStoreInput(target, runtime, item)
      ) {
        continue;
      }

      runtime = {
        ...runtime,
        input: addResource(runtime.input, item, 1),
      };
      state.grid.machines[target.id] = runtime;
      state.grid.belts[source.id] = { ...belt, item: undefined, progress: 0 };
      changed = true;
    }
  }

  return changed;
}

function sellDepotInputs(state: SimulationState, events: RenderEvent[], tick: number): boolean {
  let changed = false;
  for (const entity of state.grid.entities) {
    if (entity.type !== "depot") {
      continue;
    }

    let runtime = state.grid.machines[entity.id];
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
      const nextRuntime = {
        ...runtime,
        input: removeResource(runtime.input, resource, amount),
      };
      state.grid.machines[entity.id] = nextRuntime;
      runtime = nextRuntime;
      state.currencySamples.push({ tick, amount: sale.currency });
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
