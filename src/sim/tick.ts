import { TILE_SIZE_PX } from "./constants";
import { getMachine } from "../content/machines";
import { arePortsConnected, getWorldPortCells } from "./connections";
import {
  ActiveEntityIndex,
  PRODUCING_MACHINE_TYPES,
  createFullLookup,
  isQuiescentProducer,
  isQuiescentTransfer,
  type WorldLookup,
} from "./activeIndex";
import { CURRENCY_RATE_WINDOW_TICKS, sellResource } from "./economy";
import { getDrainableEntityIds } from "./chains";
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
  RenderEvent,
  ResourceId,
  SimulationState,
} from "./types";

const BLOCKED_REFUSAL_TICKS_REQUIRED = 2;

interface MachineAcceptance {
  runtime: MachineRuntime;
  accepted: number;
}

interface TransferOutcome {
  refused: boolean;
  moved: boolean;
}

interface TickContext {
  readonly state: SimulationState;
  readonly events: RenderEvent[];
  readonly lookup: WorldLookup;
  readonly index: ActiveEntityIndex | undefined;
  readonly previousRuntimes: Map<string, MachineRuntime>;
}

export function advanceSimulation(
  state: SimulationState,
  tickCount: number,
  events: RenderEvent[] = [],
  index?: ActiveEntityIndex,
): SimulationState {
  if (!Number.isInteger(tickCount) || tickCount <= 0) {
    return state;
  }

  const nextState = structuredClone(state);
  for (let tickIndex = 0; tickIndex < tickCount; tickIndex += 1) {
    nextState.tickCount += 1;
    advanceOneTick(nextState, events, nextState.tickCount, index);
    const firstTick = nextState.tickCount - CURRENCY_RATE_WINDOW_TICKS + 1;
    nextState.currencySamples = nextState.currencySamples.filter(
      (sample) => sample.tick >= firstTick && sample.tick <= nextState.tickCount,
    );
  }

  return nextState;
}

function advanceOneTick(
  state: SimulationState,
  events: RenderEvent[],
  tick: number,
  index?: ActiveEntityIndex,
): boolean {
  const activeIndex = resolveIndex(state.grid.entities, index);
  activeIndex?.refreshActivity(state);
  const context: TickContext = {
    state,
    events,
    lookup: activeIndex ?? createFullLookup(state.grid.entities),
    index: activeIndex,
    previousRuntimes: new Map<string, MachineRuntime>(),
  };

  let changed = false;
  if (produceAll(context)) {
    changed = true;
  }
  if (transferMachineOutputs(context)) {
    changed = true;
  }
  if (moveBeltsWithContext(context)) {
    changed = true;
  }
  if (depositBeltItemsWithContext(context)) {
    changed = true;
  }
  if (sellDepotInputs(context, tick)) {
    changed = true;
  }

  emitRuntimeTransitions(context);
  return changed;
}

function resolveIndex(
  entities: readonly Entity[],
  index: ActiveEntityIndex | undefined,
): ActiveEntityIndex | undefined {
  if (index === undefined || !index.canRebuild()) {
    return undefined;
  }

  if (!index.isCompleteFor(entities)) {
    index.rebuild(entities);
  }
  return index;
}

function produceAll(context: TickContext): boolean {
  const { state, index } = context;
  let changed = false;
  for (const entity of state.grid.entities) {
    if (!PRODUCING_MACHINE_TYPES.has(entity.type)) {
      continue;
    }

    const runtime = state.grid.machines[entity.id];
    if (runtime === undefined) {
      continue;
    }

    if (index !== undefined && isQuiescentProducer(entity, runtime, state)) {
      index.observeProduction(entity, true);
      continue;
    }

    const nextRuntime =
      entity.type === "extractor"
        ? tickExtractor(runtime, entity, state)
        : tickProcessor(runtime, entity, state);
    index?.observeProduction(entity, isQuiescentProducer(entity, nextRuntime, state));
    if (writeRuntime(context, entity, nextRuntime)) {
      changed = true;
    }
  }

  return changed;
}

function transferMachineOutputs(context: TickContext): boolean {
  const { state, lookup, index } = context;
  let changed = false;
  const drainable = getDrainableEntityIds(state);
  for (const entity of state.grid.entities) {
    if (entity.type === "belt" || entity.type === "depot") {
      continue;
    }

    const runtime = state.grid.machines[entity.id];
    if (runtime === undefined) {
      continue;
    }

    if (index !== undefined && isQuiescentTransfer(entity, runtime)) {
      index.retireEntity(entity.id);
      continue;
    }

    const target = lookup.getConnectedTarget(entity);
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
          index?.markDirty(target.id, target.x, target.y);
          emitBeltItemChanged(context.events, target.id, resource);
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

          writeRuntime(context, target, acceptance.runtime);
          transferred = acceptance.accepted;
        }

        const source = state.grid.machines[entity.id] ?? runtime;
        if (
          writeRuntime(
            context,
            entity,
            isSilo
              ? withdrawSiloInput(source, resource, transferred)
              : { ...source, output: removeResource(source.output, resource, transferred) },
          )
        ) {
          changed = true;
        }
        outcome.moved = true;
        break;
      }
    }

    if (applyBlockedFlag(context, entity, outcome, drainable)) {
      changed = true;
    }
  }

  return changed;
}

function applyBlockedFlag(
  context: TickContext,
  entity: Entity,
  outcome: TransferOutcome,
  drainable: ReadonlySet<string>,
): boolean {
  const runtime = context.state.grid.machines[entity.id];
  if (runtime === undefined) {
    return false;
  }

  const stuck = outcome.refused && !outcome.moved && !drainable.has(entity.id);
  const refusalTicks = stuck
    ? Math.min(
        (runtime.blockedRefusalTicks ?? 0) + 1,
        BLOCKED_REFUSAL_TICKS_REQUIRED,
      )
    : 0;
  const blocked =
    stuck &&
    (refusalTicks >= BLOCKED_REFUSAL_TICKS_REQUIRED || runtime.alreadyNotifiedBlocked);
  if (
    refusalTicks === (runtime.blockedRefusalTicks ?? 0) &&
    blocked === runtime.alreadyNotifiedBlocked
  ) {
    return false;
  }

  writeRuntime(context, entity, {
    ...runtime,
    alreadyNotifiedBlocked: blocked,
    ...(refusalTicks === 0 ? { blockedRefusalTicks: undefined } : { blockedRefusalTicks: refusalTicks }),
  });
  if (blocked && !runtime.alreadyNotifiedBlocked) {
    context.events.push({ type: "blockedFull", entityId: entity.id });
  }

  return true;
}

function writeRuntime(
  context: TickContext,
  entity: Entity,
  next: MachineRuntime,
): boolean {
  const entityId = entity.id;
  const previous = context.state.grid.machines[entityId];
  if (previous === next) {
    return false;
  }

  if (previous !== undefined && !context.previousRuntimes.has(entityId)) {
    context.previousRuntimes.set(entityId, previous);
  }
  context.state.grid.machines[entityId] = next;
  context.index?.markDirty(entityId, entity.x, entity.y);
  return true;
}

function emitRuntimeTransitions(context: TickContext): void {
  const { state, events, previousRuntimes } = context;
  if (previousRuntimes.size === 0) {
    return;
  }

  for (const entity of state.grid.entities) {
    const previous = previousRuntimes.get(entity.id);
    if (previous === undefined) {
      continue;
    }

    const runtime = state.grid.machines[entity.id];
    if (runtime === undefined) {
      continue;
    }

    if (previous.active !== runtime.active) {
      events.push({ type: "machineStateChanged", entityId: entity.id, active: runtime.active });
    }

    if (
      runtime.bufferedResource !== undefined &&
      isStorageFull(entity, runtime) &&
      !isStorageFull(entity, previous)
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
  return moveBeltsWithContext({
    state,
    events,
    lookup: createFullLookup(state.grid.entities),
    index: undefined,
    previousRuntimes: new Map<string, MachineRuntime>(),
  });
}

function moveBeltsWithContext(context: TickContext): boolean {
  const { state, events, lookup, index } = context;
  const beltEntities = lookup.getBeltEntities();
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
  const beltById = new Map<string, Entity>();
  for (const entity of beltEntities) {
    beltById.set(entity.id, entity);
  }
  const nextOccupancy = new Map<string, { entity: string; cell: BeltCell }>();
  const movedSources: string[] = [];
  const movedTargets: Array<{ entityId: string; item: ResourceId }> = [];
  let moved = false;

  for (const entity of beltEntities) {
    const item = items.get(entity.id);
    if (item === undefined || item.item === undefined) {
      continue;
    }

    const target = lookup.getConnectedTarget(entity);
    const targetBelt = target?.type === "belt" ? state.grid.belts[target.id] : undefined;
    if (
      target === undefined ||
      targetBelt === undefined ||
      initiallyOccupied.has(target.id) ||
      nextOccupancy.has(target.id)
    ) {
      nextOccupancy.set(entity.id, { entity: entity.id, cell: item });
      continue;
    }

    nextOccupancy.set(target.id, {
      entity: target.id,
      cell: {
        entityId: target.id,
        item: item.item,
        progress: 0,
      },
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

  for (const [entityId, entry] of nextOccupancy) {
    const belt = state.grid.belts[entityId];
    if (belt !== undefined) {
      const occupant = beltById.get(entityId);
      if (occupant !== undefined) {
        index?.markDirty(entityId, occupant.x, occupant.y);
      }
      state.grid.belts[entityId] = {
        ...belt,
        item: entry.cell.item,
        progress: entry.cell.progress,
      };
    }
  }

  return true;
}

export function depositBeltItems(state: SimulationState, events: RenderEvent[] = []): boolean {
  return depositBeltItemsWithContext({
    state,
    events,
    lookup: createFullLookup(state.grid.entities),
    index: undefined,
    previousRuntimes: new Map<string, MachineRuntime>(),
  });
}

function depositBeltItemsWithContext(context: TickContext): boolean {
  const { state, events, lookup, index } = context;
  let changed = false;

  for (const target of state.grid.entities) {
    if (target.type === "belt") {
      continue;
    }

    let runtime = state.grid.machines[target.id];
    if (runtime === undefined) {
      continue;
    }

    if (index !== undefined) {
      const chunk = index.getChunkKey(target.x, target.y);
      if (!index.isChunkActive(chunk)) {
        index.noteChunkSkipped();
        continue;
      }
      index.noteChunkVisited();
    }

    for (const { port, x, y } of getWorldPortCells(target)) {
      if (port.kind !== "input") {
        continue;
      }

      const source = lookup.getEntityAt(x, y);
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

      writeRuntime(context, target, acceptance.runtime);
      runtime = acceptance.runtime;
      state.grid.belts[source.id] = { ...belt, item: undefined, progress: 0 };
      index?.markDirty(source.id, source.x, source.y);
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

function sellDepotInputs(context: TickContext, tick: number): boolean {
  const { state } = context;
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
      writeRuntime(context, entity, nextRuntime);
      runtime = nextRuntime;
      state.currencySamples.push({ tick, amount: sale.currency, entityId: entity.id, resource });
      context.events.push({
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
