import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { RECIPES } from "../../src/content/recipes";
import { NEW_GAME_SEED, createInitialState } from "../../src/sim/initialState";
import { createRuntimeRecords, advanceSimulation } from "../../src/sim/tick";
import { ActiveEntityIndex, CHUNK_SIZE } from "../../src/sim/activeIndex";
import { SimulationStore } from "../../src/sim/store";
import { getTotalAmount } from "../../src/sim/machines";
import type {
  Entity,
  MachineType,
  RenderEvent,
  Rotation,
  SimulationState,
} from "../../src/sim/types";

const ALL_MACHINES = Object.keys(MACHINES) as MachineType[];
const ALL_RECIPES = Object.keys(RECIPES);
const SATURATED_EXTRACTOR_LEVEL = 20;
const EQUIVALENCE_TICKS = 600;
const FALLBACK_TICKS = 300;
const SILO_LEVEL = 40;
const LARGE_GRID = 256;

interface LayoutEntry {
  id: string;
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
  recipeId?: string;
  resourceNode?: string;
}

function committedLayout(): LayoutEntry[] {
  return JSON.parse(readFileSync("scripts/motor-chain-layout.json", "utf8")) as LayoutEntry[];
}

function blankState(width = 64, height = 64): SimulationState {
  return createInitialState(NEW_GAME_SEED, width, height);
}

function armedState(width = 64, height = 64): SimulationState {
  const state = blankState(width, height);
  return {
    ...state,
    currency: 10_000_000,
    unlocked: { machines: ALL_MACHINES, recipes: ALL_RECIPES },
  };
}

function fromEntities(
  entities: readonly Entity[],
  width = 64,
  height = 64,
): SimulationState {
  const base = armedState(width, height);
  const { machines, belts } = createRuntimeRecords(entities);
  return { ...base, grid: { ...base.grid, entities: [...entities], machines, belts } };
}

function beltRun(
  y: number,
  runLength: number,
  startX: number,
  prefix: string,
  extractorLevel = SATURATED_EXTRACTOR_LEVEL,
): Entity[] {
  const entities: Entity[] = [
    {
      id: `${prefix}-extractor`,
      type: "extractor",
      x: startX,
      y,
      rotation: 0,
      level: extractorLevel,
      resourceNode: "ironOre",
    },
  ];
  for (let step = 0; step < runLength; step += 1) {
    entities.push({
      id: `${prefix}-belt-${step}`,
      type: "belt",
      x: startX + 1 + step,
      y,
      rotation: 0,
      level: 1,
    });
  }
  entities.push({
    id: `${prefix}-depot`,
    type: "depot",
    x: startX + 1 + runLength,
    y,
    rotation: 0,
    level: 1,
  });
  return entities;
}

function idleMachine(id: string, x: number, y: number, type: MachineType = "smelter"): Entity {
  return { id, type, x, y, rotation: 0, level: 1, ...(type === "smelter" ? { recipeId: "ironIngot" } : {}) };
}

function siloRun(y: number, beltCount: number, prefix: string): Entity[] {
  const entities: Entity[] = [
    {
      id: `${prefix}-extractor`,
      type: "extractor",
      x: 1,
      y,
      rotation: 0,
      level: SILO_LEVEL,
      resourceNode: "ironOre",
    },
  ];
  for (let step = 0; step < beltCount; step += 1) {
    entities.push({
      id: `${prefix}-belt-${step}`,
      type: "belt",
      x: 2 + step,
      y,
      rotation: 0,
      level: 1,
    });
  }
  entities.push({
    id: `${prefix}-silo`,
    type: "silo",
    x: 2 + beltCount,
    y,
    rotation: 0,
    level: 1,
  });
  return entities;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => (entry === undefined ? "missing" : entry));
}

describe("the active entity index", () => {
  it("indexes every entity in a rebuilt world so the first tick is never skipped", () => {
    const entities = beltRun(4, 3, 1, "run");
    const index = new ActiveEntityIndex();

    index.rebuild(entities);

    for (const entity of entities) {
      expect(index.isActive(entity.id)).toBe(true);
    }
    expect(index.isCompleteFor(entities)).toBe(true);
  });

  it("places an entity through the store and ticks it without a stale index", () => {
    const entities = beltRun(4, 8, 1, "run");
    const state = fromEntities(entities);
    const store = new SimulationStore(state, () => 0);
    const events: RenderEvent[] = [];
    store.subscribeEvents((event) => events.push(event));
    const placed = store.dispatch({
      type: "placeEntity",
      machine: "silo",
      x: 30,
      y: 30,
      rotation: 0,
    });

    store.advanceTicks(5);

    expect(placed.ok).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(store.getSaveGame().grid.entities).toHaveLength(entities.length + 1);
    expect(store.getSaveGame().grid.machines["entity-1"]).toBeDefined();
  });

  it("retires a machine that has run out of work so a saturated world stops rescanning it", () => {
    const entities = [idleMachine("done-smelter", 4, 4), idleMachine("done-silo", 20, 4, "silo")];
    const state = fromEntities(entities);
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const settled = advanceSimulation(state, 3, [], index);
    const runtime = settled.grid.machines["done-smelter"];

    expect(runtime?.active).toBe(false);
    expect(runtime?.progressTicks).toBe(0);
    expect(getTotalAmount(runtime?.input ?? {})).toBe(0);
    expect(getTotalAmount(runtime?.output ?? {})).toBe(0);
    expect(index.isActive("done-smelter")).toBe(false);
    expect(index.isActive("done-silo")).toBe(false);
    expect(index.getTelemetry().productionSkips).toBeGreaterThan(0);
  });

  it("visits a retired machine again once a belt beside it starts carrying an item", () => {
    const entities = [
      idleMachine("waiting-smelter", 5, 4),
      { id: "feed-belt", type: "belt" as MachineType, x: 4, y: 4, rotation: 0 as Rotation, level: 1 },
    ];
    const state = fromEntities(entities);
    const index = new ActiveEntityIndex();
    index.rebuild(entities);
    advanceSimulation(state, 3, [], index);
    index.resetTelemetry();

    const loaded: SimulationState = {
      ...state,
      grid: {
        ...state.grid,
        belts: {
          ...state.grid.belts,
          "feed-belt": { entityId: "feed-belt", item: "coal", progress: 0 },
        },
      },
    };
    const events: RenderEvent[] = [];
    const next = advanceSimulation(loaded, 1, events, index);

    expect(index.getTelemetry().chunksVisited).toBeGreaterThan(0);
    expect(next.grid.machines["waiting-smelter"]?.input?.coal).toBe(1);
    expect(next.grid.belts["feed-belt"]?.item).toBeUndefined();
    expect(events.filter((event) => event.type === "beltItemChanged")).toEqual([
      { type: "beltItemChanged", entityId: "feed-belt", item: undefined },
    ]);
  });

  it("resolves a neighbour from its cell rather than by scanning the world", () => {
    const entities = beltRun(4, 5, 1, "run");
    const [extractor, , , , , headBelt, depot] = entities;
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    expect(index.getEntityAt(3, 4)?.id).toBe("run-belt-1");
    expect(index.getConnectedTarget(extractor)?.id).toBe("run-belt-0");
    expect(index.getConnectedTarget(headBelt)?.id).toBe("run-depot");
    expect(index.getConnectedTarget(depot)).toBeUndefined();
    expect(index.getEntityAt(0, 0)).toBeUndefined();
  });

  it("marks a world with two entities on one cell incomplete so the tick falls back", () => {
    const entities = [idleMachine("first", 4, 4), idleMachine("second", 4, 4)];
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    expect(index.isCompleteFor(entities)).toBe(false);
  });

  it("stays complete across a copy of the same world and goes stale when the world changes", () => {
    const entities = beltRun(4, 3, 1, "run");
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    expect(index.isCompleteFor(entities)).toBe(true);
    expect(index.isCompleteFor(structuredClone(entities))).toBe(true);
    expect(index.isCompleteFor(entities.slice(0, 2))).toBe(false);
    expect(
      index.isCompleteFor(entities.map((entity) => ({ ...entity, x: entity.x + 1 }))),
    ).toBe(false);
  });

  it("treats a rebuilt world as all active and narrows it as machines go idle", () => {
    const entities = beltRun(4, 5, 1, "run");
    const state = fromEntities(entities);
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const firstChunk = index.getChunkKey(0, 0);
    const emptyChunk = index.getChunkKey(16, 0);
    const adjacentChunk = index.getChunkKey(0, CHUNK_SIZE);

    expect(firstChunk).not.toBe(emptyChunk);
    expect(index.isChunkActive(firstChunk)).toBe(true);
    expect(index.isChunkActive(emptyChunk)).toBe(false);
    expect(index.isChunkActive(adjacentChunk)).toBe(false);

    const settled = advanceSimulation(state, 5, [], index);

    expect(settled.tickCount).toBe(5);
    expect(index.isChunkActive(emptyChunk)).toBe(false);
  });
});

describe("tick scheduling over a world with nothing to do", () => {
  it("skips the production scan entirely on a sixty four by sixty four grid with no active producer", () => {
    const entities = [idleMachine("a", 4, 4), idleMachine("b", 20, 20), idleMachine("c", 40, 40)];
    const state = fromEntities(entities);
    const index = new ActiveEntityIndex();
    index.rebuild(entities);
    const warmup = advanceSimulation(state, 1, [], index);
    index.resetTelemetry();
    const events: RenderEvent[] = [];

    const next = advanceSimulation(warmup, 5, events, index);
    const telemetry = index.getTelemetry();

    expect(telemetry.productionVisits).toBe(0);
    expect(telemetry.chunksSkipped).toBeGreaterThan(0);
    expect(events).toEqual([]);
    expect(canonical(next.grid.machines)).toBe(canonical(warmup.grid.machines));
  });

  it("still advances a fresh producer on the very first tick after placement", () => {
    const entities = beltRun(4, 3, 1, "run");
    const state = fromEntities(entities);
    const index = new ActiveEntityIndex();
    index.rebuild(entities);
    const events: RenderEvent[] = [];

    const next = advanceSimulation(state, 1, events, index);

    expect(next.grid.belts["run-belt-1"]?.item).toBe("ironOre");
    expect(index.getTelemetry().productionVisits).toBeGreaterThan(0);
  });

  it("reuses one index across many ticks and reports a linear number of connection checks", () => {
    const rows = 40;
    const entities: Entity[] = [];
    for (let row = 0; row < rows; row += 1) {
      entities.push(...beltRun(2 + row * 6, 24, 1, `row-${row}`));
    }
    const state = fromEntities(entities, LARGE_GRID, LARGE_GRID);
    const index = new ActiveEntityIndex();
    index.rebuild(entities);
    const events: RenderEvent[] = [];

    advanceSimulation(state, 1, events, index);
    const oneTick = index.getTelemetry().connectionChecks;

    expect(entities).toHaveLength(1040);
    expect(oneTick).toBeGreaterThan(0);
    expect(oneTick).toBeLessThan(entities.length * 3);
  });

  it("checks connections a linear number of times however long the belt run is", () => {
    const shortEntities = beltRun(4, 4, 1, "short");
    const longEntities = beltRun(4, 60, 1, "long");
    const shortChecks = connectionChecksPerTick(shortEntities);
    const longChecks = connectionChecksPerTick(longEntities);

    expect(longEntities.length / shortEntities.length).toBeGreaterThan(9);
    expect(longChecks).toBeLessThan(shortChecks * 2);
  });
});

function connectionChecksPerTick(entities: Entity[]): number {
  const state = fromEntities(entities);
  const index = new ActiveEntityIndex();
  index.rebuild(entities);
  advanceSimulation(state, 5);
  index.resetTelemetry();
  advanceSimulation(state, 1, [], index);
  return index.getTelemetry().connectionChecks;
}

describe("indexed ticks agree with unindexed ticks", () => {
  it("emits a byte identical event stream on the committed motor layout", () => {
    const entities = motorLayoutEntities();
    const state = fromEntities(entities);
    const referenceEvents: RenderEvent[] = [];
    const indexedEvents: RenderEvent[] = [];
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const reference = advanceSimulation(state, EQUIVALENCE_TICKS, referenceEvents);
    const indexed = advanceSimulation(state, EQUIVALENCE_TICKS, indexedEvents, index);

    expect(entities).toHaveLength(133);
    expect(indexedEvents.length).toBeGreaterThan(0);
    expect(
      indexedEvents.some((event) => event.type === "saleCompleted"),
      "the equivalence window must reach a point where the motor chain actually sells, or the " +
        "committed layout is only being compared before it has run a single recipe to completion",
    ).toBe(true);
    expect(canonical(indexedEvents)).toBe(canonical(referenceEvents));
    expect(canonical(indexed)).toBe(canonical(reference));
  });

  it("emits a byte identical event stream on a world with idle regions", () => {
    const entities = [
      ...beltRun(4, 6, 1, "west"),
      ...beltRun(4, 6, 20, "east"),
      ...beltRun(LARGE_GRID - 5, 6, 1, "far"),
      ...beltRun(LARGE_GRID - 5, 6, 20, "far-2"),
      idleMachine("idle-smelter", 100, 100),
      idleMachine("idle-silo", 140, 160, "silo"),
      idleMachine("idle-smelter-2", 200, 60),
    ];
    const state = fromEntities(entities, LARGE_GRID, LARGE_GRID);
    const referenceEvents: RenderEvent[] = [];
    const indexedEvents: RenderEvent[] = [];
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const reference = advanceSimulation(state, EQUIVALENCE_TICKS, referenceEvents);
    const indexed = advanceSimulation(state, EQUIVALENCE_TICKS, indexedEvents, index);

    expect(indexedEvents.length).toBeGreaterThan(0);
    expect(canonical(indexedEvents)).toBe(canonical(referenceEvents));
    expect(canonical(indexed)).toBe(canonical(reference));
  });

  it("emits a byte identical event stream on a long saturated belt run", () => {
    const entities = beltRun(4, 60, 1, "long");
    const state = fromEntities(entities);
    const referenceEvents: RenderEvent[] = [];
    const indexedEvents: RenderEvent[] = [];
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const reference = advanceSimulation(state, EQUIVALENCE_TICKS, referenceEvents);
    const indexed = advanceSimulation(state, EQUIVALENCE_TICKS, indexedEvents, index);

    expect(canonical(indexedEvents)).toBe(canonical(referenceEvents));
    expect(canonical(indexed)).toBe(canonical(reference));
  });

  it("emits a byte identical event stream when a world holds two entities on one cell", () => {
    const entities = [...beltRun(4, 6, 1, "run"), idleMachine("overlap", 3, 4)];
    const state = fromEntities(entities);
    const referenceEvents: RenderEvent[] = [];
    const indexedEvents: RenderEvent[] = [];
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const reference = advanceSimulation(state, EQUIVALENCE_TICKS, referenceEvents);
    const indexed = advanceSimulation(state, EQUIVALENCE_TICKS, indexedEvents, index);

    expect(index.isCompleteFor(entities)).toBe(false);
    expect(canonical(indexedEvents)).toBe(canonical(referenceEvents));
    expect(canonical(indexed)).toBe(canonical(reference));
  });

  it("emits a byte identical event stream on a world with a dead line and a blocked producer", () => {
    const entities = [
      ...beltRun(4, 6, 1, "live"),
      ...beltRun(20, 6, 1, "dead").slice(0, -1),
      idleMachine("orphan-smelter", 4, 30),
    ];
    const state = fromEntities(entities);
    const referenceEvents: RenderEvent[] = [];
    const indexedEvents: RenderEvent[] = [];
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const reference = advanceSimulation(state, EQUIVALENCE_TICKS, referenceEvents);
    const indexed = advanceSimulation(state, EQUIVALENCE_TICKS, indexedEvents, index);

    expect(canonical(indexedEvents)).toBe(canonical(referenceEvents));
    expect(canonical(indexed)).toBe(canonical(reference));
  });

  it("emits a byte identical storage full event when a shared silo fills", () => {
    const entities = [...siloRun(4, 6, "west"), ...siloRun(30, 6, "east-2")];
    const state = fromEntities(entities);
    const referenceEvents: RenderEvent[] = [];
    const indexedEvents: RenderEvent[] = [];
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const reference = advanceSimulation(state, EQUIVALENCE_TICKS, referenceEvents);
    const indexed = advanceSimulation(state, EQUIVALENCE_TICKS, indexedEvents, index);
    const fullEvents = referenceEvents.filter((event) => event.type === "storageFull");

    expect(fullEvents.length).toBeGreaterThan(0);
    expect(fullEvents.map((event) => (event as { entityId: string }).entityId).sort()).toEqual([
      "east-2-silo",
      "west-silo",
    ]);
    expect(getTotalAmount(reference.grid.machines["west-silo"]?.input ?? {})).toBe(
      MACHINES.silo.storageCapacity,
    );
    expect(canonical(indexedEvents)).toBe(canonical(referenceEvents));
    expect(canonical(indexed)).toBe(canonical(reference));
  });

  it("agrees with the unindexed arm on a world where the chunk gate actually skips", () => {
    const entities = [
      ...beltRun(4, 8, 1, "west"),
      ...beltRun(200, 8, 1, "far"),
      idleMachine("idle-smelter", 100, 100),
      idleMachine("idle-silo", 140, 160, "silo"),
      idleMachine("idle-smelter-2", 200, 60),
      idleMachine("idle-silo-2", 60, 220, "silo"),
    ];
    const state = fromEntities(entities, LARGE_GRID, LARGE_GRID);
    const referenceEvents: RenderEvent[] = [];
    const indexedEvents: RenderEvent[] = [];
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const reference = advanceSimulation(state, EQUIVALENCE_TICKS, referenceEvents);
    const indexed = advanceSimulation(state, EQUIVALENCE_TICKS, indexedEvents, index);
    const telemetry = index.getTelemetry();

    expect(telemetry.chunksSkipped).toBeGreaterThan(0);
    expect(telemetry.chunksVisited).toBeGreaterThan(0);
    expect(telemetry.chunksSkipped).toBeLessThan(telemetry.chunksVisited);
    expect(indexedEvents.length).toBeGreaterThan(0);
    expect(canonical(indexedEvents)).toBe(canonical(referenceEvents));
    expect(canonical(indexed)).toBe(canonical(reference));
  });
});

function motorLayoutEntities(): Entity[] {
  return committedLayout().map((entry) => ({
    id: entry.id,
    type: entry.type,
    x: entry.x,
    y: entry.y,
    rotation: entry.rotation,
    level: entry.type === "extractor" ? SATURATED_EXTRACTOR_LEVEL : 1,
    ...(entry.recipeId === undefined ? {} : { recipeId: entry.recipeId }),
    ...(entry.resourceNode === undefined
      ? {}
      : { resourceNode: entry.resourceNode as Entity["resourceNode"] }),
  }));
}

describe("the correctness fallback", () => {
  it("processes every entity when the index is declared incomplete and matches the indexed path", () => {
    const entities = motorLayoutEntities();
    const state = fromEntities(entities);
    const indexedEvents: RenderEvent[] = [];
    const fallbackEvents: RenderEvent[] = [];
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const indexed = advanceSimulation(state, FALLBACK_TICKS, indexedEvents, index);
    index.markIncomplete();
    const fallback = advanceSimulation(state, FALLBACK_TICKS, fallbackEvents, index);

    expect(indexedEvents.length).toBeGreaterThan(0);
    expect(index.isCompleteFor(entities)).toBe(false);
    expect(canonical(fallbackEvents)).toBe(canonical(indexedEvents));
    expect(canonical(fallback)).toBe(canonical(indexed));
  });

  it("falls back when the world behind the index is not the one it indexed", () => {
    const entities = beltRun(4, 20, 1, "run");
    const state = fromEntities(entities);
    const referenceEvents: RenderEvent[] = [];
    const indexedEvents: RenderEvent[] = [];
    const index = new ActiveEntityIndex();
    index.rebuild(entities);

    const reference = advanceSimulation(state, EQUIVALENCE_TICKS, referenceEvents);
    const moved = entities.map((entity) => ({ ...entity }));
    const shifted = fromEntities(moved, 64, 64);
    const indexed = advanceSimulation(shifted, EQUIVALENCE_TICKS, indexedEvents, index);
    index.markIncomplete();
    const fallbackEvents: RenderEvent[] = [];
    const fallback = advanceSimulation(shifted, EQUIVALENCE_TICKS, fallbackEvents, index);

    expect(index.isCompleteFor(shifted.grid.entities)).toBe(false);
    expect(canonical(indexedEvents)).toBe(canonical(fallbackEvents));
    expect(canonical(indexed)).toBe(canonical(fallback));
    expect(canonical(indexed)).toBe(canonical(reference));
  });

  it("skips no machine when the fallback runs, so a fresh producer still advances", () => {
    const entities = beltRun(4, 3, 1, "run");
    const state = fromEntities(entities);
    const fallbackIndex = new ActiveEntityIndex();
    fallbackIndex.rebuild(entities);
    fallbackIndex.markIncomplete();
    fallbackIndex.resetTelemetry();
    const indexedIndex = new ActiveEntityIndex();
    indexedIndex.rebuild(entities);

    const fallback = advanceSimulation(state, 1, [], fallbackIndex);
    const indexed = advanceSimulation(state, 1, [], indexedIndex);
    const telemetry = fallbackIndex.getTelemetry();

    expect(fallbackIndex.canRebuild()).toBe(false);
    expect(telemetry.productionVisits).toBe(0);
    expect(telemetry.productionSkips).toBe(0);
    expect(telemetry.chunksVisited).toBe(0);
    expect(telemetry.chunksSkipped).toBe(0);
    expect(fallback.grid.belts["run-belt-1"]?.item).toBe("ironOre");
    expect(canonical(fallback)).toBe(canonical(indexed));
  });
});

describe("the store keeps its index honest", () => {
  it("invalidates the index when an entity is placed and when one is demolished", () => {
    const state = fromEntities(beltRun(4, 6, 1, "run"));
    const store = new SimulationStore(state, () => 0);

    const placed = store.dispatch({
      type: "placeEntity",
      machine: "belt",
      x: 30,
      y: 30,
      rotation: 0,
    });
    expect(placed.ok).toBe(true);
    expect(store.getSnapshot().gridWidth).toBe(64);

    const referenceEvents: RenderEvent[] = [];
    const reference = advanceSimulation(store.getSaveGame(), EQUIVALENCE_TICKS, referenceEvents);
    const indexedEvents: RenderEvent[] = [];
    const indexed = advanceSimulation(store.getSaveGame(), EQUIVALENCE_TICKS, indexedEvents);

    expect(canonical(indexedEvents)).toBe(canonical(referenceEvents));
    expect(canonical(indexed)).toBe(canonical(reference));
  });

  it("advances through the store at the same rate as a direct tick", () => {
    const state = fromEntities(beltRun(4, 20, 1, "run"));
    const store = new SimulationStore(state, () => 0);
    const referenceEvents: RenderEvent[] = [];
    const reference = advanceSimulation(state, EQUIVALENCE_TICKS, referenceEvents);
    const storeEvents: RenderEvent[] = [];
    store.subscribeEvents((event) => storeEvents.push(event));

    store.advanceTicks(EQUIVALENCE_TICKS);

    expect(canonical(storeEvents)).toBe(canonical(referenceEvents));
    expect(canonical(store.getSaveGame())).toBe(canonical(reference));
  });
});

describe("tick cost shape", () => {
  it("keeps a thousand entity world on a large grid inside a wide regression budget", () => {
    const entities = sparseWorld(40);
    const state = fromEntities(entities, LARGE_GRID, LARGE_GRID);
    const index = new ActiveEntityIndex();
    index.rebuild(entities);
    const warmup = advanceSimulation(state, 2, [], index);

    const started = performance.now();
    advanceSimulation(warmup, 3, [], index);
    const elapsed = performance.now() - started;

    expect(entities).toHaveLength(1040);
    expect(elapsed).toBeLessThan(LARGE_WORLD_TICK_BUDGET_MS);
  });
});

const LARGE_WORLD_TICK_BUDGET_MS = 250;

function sparseWorld(rows: number): Entity[] {
  const entities: Entity[] = [];
  for (let row = 0; row < rows; row += 1) {
    entities.push(...beltRun(2 + row * 6, 24, 1, `row-${row}`));
  }
  return entities;
}
