import { TILE_SIZE_PX } from "./constants";
import { getMachine } from "../content/machines";
import {
  arePortsConnected,
  findConnectedEntity,
  getEntityAt,
  getWorldPortCells,
} from "./connections";
import { CURRENCY_RATE_WINDOW_TICKS, sellResource } from "./economy";
import {
  acceptSiloInput,
  addResource,
  createMachineRuntime,
  getBeltCellCapacity,
  getInputRoom,
  getResourceAmount,
  isStorageFull,
  removeResource,
  tickExtractor,
  tickProcessor,
  withdrawSiloInput,
} from "./machines";
import type {
  BeltCell,
  Entity,
  MachineRuntime,
  MachineType,
  RenderEvent,
  ResourceId,
  SimulationState,
} from "./types";

const PRODUCING_MACHINE_TYPES: ReadonlySet<MachineType> = new Set<MachineType>([
  "extractor",
  "smelter",
  "assembler",
]);

const BLOCKED_REFUSAL_TICKS_REQUIRED = 2;

interface MachineAcceptance {
  runtime: MachineRuntime;
  accepted: number;
}

interface TransferOutcome {
  refused: boolean;
  moved: boolean;
}

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
  const storageFullBefore = new Set<string>();
  for (const entity of state.grid.entities) {
    const runtime = state.grid.machines[entity.id];
    if (runtime !== undefined) {
      activeBefore.set(entity.id, runtime.active);
      if (isStorageFull(entity, runtime)) {
        storageFullBefore.add(entity.id);
      }
    }
  }

  let changed = false;
  for (const entity of state.grid.entities) {
    if (!PRODUCING_MACHINE_TYPES.has(entity.type)) {
      continue;
    }

    const runtime = state.grid.machines[entity.id];
    if (runtime === undefined) {
      continue;
    }

    const nextRuntime =
      entity.type === "extractor"
        ? tickExtractor(runtime, entity, state)
        : tickProcessor(runtime, entity, state);
    if (nextRuntime !== runtime) {
      state.grid.machines[entity.id] = nextRuntime;
      changed = true;
    }
  }

  if (transferMachineOutputs(state, events)) {
    changed = true;
  }
  if (moveBelts(state, events)) {
    changed = true;
  }
  if (depositBeltItems(state, events)) {
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

    if (
      runtime.bufferedResource !== undefined &&
      isStorageFull(entity, runtime) &&
      !storageFullBefore.has(entity.id)
    ) {
      events.push({
        type: "storageFull",
        entityId: entity.id,
        resource: runtime.bufferedResource,
        worldX: entity.x * TILE_SIZE_PX + TILE_SIZE_PX / 2,
        worldY: entity.y * TILE_SIZE_PX + TILE_SIZE_PX / 2,
      });
    }
  }

  return changed;
}

function transferMachineOutputs(state: SimulationState, events: RenderEvent[]): boolean {
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
    const isSilo = entity.type === "silo";
    const stored = isSilo ? runtime.input : runtime.output;
    const outcome: TransferOutcome = { refused: false, moved: false };
    if (target !== undefined) {
      for (const resource of Object.keys(stored) as ResourceId[]) {
        const amount = getResourceAmount(stored, resource);
        if (amount <= 0) {
          continue;
        }

        let transferred: number;
        if (target.type === "belt") {
          const belt = state.grid.belts[target.id];
          if (belt === undefined || belt.item !== undefined) {
            outcome.refused = true;
            continue;
          }

          transferred = Math.min(amount, getBeltCellCapacity(target));
          if (transferred <= 0) {
            outcome.refused = true;
            continue;
          }

          state.grid.belts[target.id] = { ...belt, item: resource, progress: 0 };
          emitBeltItemChanged(events, target.id, resource);
        } else {
          const targetRuntime = state.grid.machines[target.id];
          if (targetRuntime === undefined) {
            outcome.refused = true;
            continue;
          }

          const acceptance = acceptMachineInput(target, targetRuntime, resource, amount);
          if (acceptance.accepted <= 0) {
            outcome.refused = true;
            continue;
          }

          state.grid.machines[target.id] = acceptance.runtime;
          transferred = acceptance.accepted;
        }

        state.grid.machines[entity.id] = isSilo
          ? withdrawSiloInput(runtime, resource, transferred)
          : { ...runtime, output: removeResource(runtime.output, resource, transferred) };
        outcome.moved = true;
        changed = true;
        break;
      }
    }

    if (applyBlockedFlag(state, entity, outcome, events)) {
      changed = true;
    }
  }

  return changed;
}

function applyBlockedFlag(
  state: SimulationState,
  entity: Entity,
  outcome: TransferOutcome,
  events: RenderEvent[],
): boolean {
  const runtime = state.grid.machines[entity.id];
  if (runtime === undefined) {
    return false;
  }

  const stuck = outcome.refused && !outcome.moved;
  const refusalTicks = stuck
    ? Math.min(
        (runtime.blockedRefusalTicks ?? 0) + 1,
        BLOCKED_REFUSAL_TICKS_REQUIRED,
      )
    : 0;
  const blocked =
    stuck &&
    (refusalTicks >= BLOCKED_REFUSAL_TICKS_REQUIRED || runtime.alreadyNotifiedBlocked);
  if (refusalTicks === runtime.blockedRefusalTicks && blocked === runtime.alreadyNotifiedBlocked) {
    return false;
  }

  state.grid.machines[entity.id] = {
    ...runtime,
    alreadyNotifiedBlocked: blocked,
    ...(refusalTicks === 0 ? { blockedRefusalTicks: undefined } : { blockedRefusalTicks: refusalTicks }),
  };
  if (blocked && !runtime.alreadyNotifiedBlocked) {
    events.push({ type: "blockedFull", entityId: entity.id });
  }

  return true;
}

function acceptMachineInput(
  entity: Entity,
  runtime: MachineRuntime,
  resource: ResourceId,
  amount: number,
): MachineAcceptance {
  if (entity.type === "silo") {
    const acceptance = acceptSiloInput(entity, runtime, resource, amount);
    return {
      runtime: acceptance.runtime,
      accepted: acceptance.accepted ? amount : 0,
    };
  }

  const accepted = Math.min(amount, getInputRoom(entity, runtime, resource));
  if (accepted <= 0) {
    return { runtime, accepted: 0 };
  }

  return { runtime: { ...runtime, input: addResource(runtime.input, resource, accepted) }, accepted };
}

export function moveBelts(state: SimulationState, events: RenderEvent[] = []): boolean {
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
  const movedSources: string[] = [];
  const movedTargets: Array<{ entityId: string; item: ResourceId }> = [];
  let moved = false;

  for (const entity of beltEntities) {
    const item = items.get(entity.id);
    if (item === undefined || item.item === undefined) {
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
    movedSources.push(entity.id);
    movedTargets.push({ entityId: target.id, item: item.item });
    moved = true;
  }

  if (!moved) {
    return false;
  }

  for (const entityId of movedSources) {
    emitBeltItemChanged(events, entityId, undefined);
  }
  for (const target of movedTargets) {
    emitBeltItemChanged(events, target.entityId, target.item);
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

export function depositBeltItems(state: SimulationState, events: RenderEvent[] = []): boolean {
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
      if (belt === undefined || item === undefined || !arePortsConnected(source, target, item)) {
        continue;
      }

      const acceptance = acceptMachineInput(target, runtime, item, 1);
      if (acceptance.runtime === runtime) {
        continue;
      }

      state.grid.machines[target.id] = acceptance.runtime;
      runtime = acceptance.runtime;
      state.grid.belts[source.id] = { ...belt, item: undefined, progress: 0 };
      emitBeltItemChanged(events, source.id, undefined);
      changed = true;
    }
  }

  return changed;
}

function emitBeltItemChanged(
  events: RenderEvent[],
  entityId: string,
  item: ResourceId | undefined,
): void {
  events.push({ type: "beltItemChanged", entityId, item });
}

function sellDepotInputs(state: SimulationState, events: RenderEvent[], tick: number): boolean {
  let changed = false;
    for (const entity of state.grid.entities) {
      if (getMachine(entity.type)?.saleTerminal !== true) {
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
      state.currencySamples.push({ tick, amount: sale.currency, entityId: entity.id, resource });
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
