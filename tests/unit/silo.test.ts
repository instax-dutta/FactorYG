import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { RECIPES } from "../../src/content/recipes";
import { RESOURCES } from "../../src/content/resources";
import { createInitialState } from "../../src/sim/initialState";
import { canStoreInput, createMachineRuntime, getTotalAmount } from "../../src/sim/machines";
import { advanceSimulation } from "../../src/sim/tick";
import type {
  Entity,
  MachineRuntime,
  RenderEvent,
  ResourceId,
  SimulationState,
} from "../../src/sim/types";

const SILO_CAPACITY: number = MACHINES.silo.storageCapacity;
const RESOURCE_CASES = Object.keys(RESOURCES) as ResourceId[];
const SILO_AT: { x: number; y: number } = { x: 5, y: 5 };
const BELT_AT: { x: number; y: number } = { x: SILO_AT.x - 1, y: SILO_AT.y };
const DOWNSTREAM_AT: { x: number; y: number } = { x: SILO_AT.x + 1, y: SILO_AT.y };
const COPPER_NODE = {
  id: "node-copper-silo",
  resource: "copperOre" as ResourceId,
  x: 8,
  y: 9,
};

describe("silo capacity", () => {
  it("stores exactly 100 units", () => {
    expect(SILO_CAPACITY).toBe(100);
    expect(MACHINES.silo.inputBuffer).toBe(100);
    expect(MACHINES.silo.outputBuffer).toBe(100);
  });

  it("accepts the unit that fills the silo and refuses the one that overflows it", () => {
    const nearlyFull = createSiloRuntime({ input: { copperOre: SILO_CAPACITY - 1 } });
    expect(getTotalAmount(nearlyFull.input)).toBe(99);
    expect(canStoreInput(createSilo(), nearlyFull, "copperOre")).toBe(true);

    const full = createSiloRuntime({
      input: { copperOre: SILO_CAPACITY },
      bufferedResource: "copperOre",
    });
    expect(canStoreInput(createSilo(), full, "copperOre")).toBe(false);
  });

  it("fills to exactly 100 from a belt and then stalls the belt deterministically", () => {
    const belt = createBelt("belt-silo-fill");
    const silo = createSilo({ id: "silo-fill" });
    const state = createState([belt, silo]);
    state.grid.belts[belt.id] = { entityId: belt.id, item: "copperOre", progress: 0.5 };
    state.grid.machines[silo.id] = createSiloRuntime({
      input: { copperOre: SILO_CAPACITY - 1 },
      bufferedResource: "copperOre",
    });

    const fillingEvents: RenderEvent[] = [];
    const filling = advanceSimulation(state, 1, fillingEvents);

    expect(filling.grid.machines[silo.id]?.input).toEqual({ copperOre: 100 });
    expect(filling.grid.machines[silo.id]?.bufferedResource).toBe("copperOre");
    expect(filling.grid.belts[belt.id]?.item).toBeUndefined();
    expect(filling.grid.belts[belt.id]?.progress).toBe(0);
    expect(fillingEvents).toEqual([
      { type: "beltItemChanged", entityId: belt.id, item: undefined },
    ]);

    const stalledBelt = {
      ...filling,
      grid: {
        ...filling.grid,
        belts: {
          ...filling.grid.belts,
          [belt.id]: { entityId: belt.id, item: "copperOre" as ResourceId, progress: 0 },
        },
      },
    };
    const stalledEvents: RenderEvent[] = [];
    const stalled = advanceSimulation(stalledBelt, 1, stalledEvents);

    expect(stalled.grid.machines[silo.id]?.input).toEqual({ copperOre: 100 });
    expect(stalled.grid.belts[belt.id]?.item).toBe("copperOre");
    expect(stalledEvents).toEqual([
      { type: "storageFull", entityId: silo.id, resource: "copperOre" },
    ]);
  });

  it("emits a storage-full notification when a machine output would exceed capacity", () => {
    const smelter = createSmelter({ id: "smelter-silo-overflow", x: SILO_AT.x - 1, y: SILO_AT.y });
    const silo = createSilo({ id: "silo-overflow" });
    const state = createState([smelter, silo]);
    state.grid.machines[smelter.id] = createSmelterRuntime({ output: { copperIngot: 10 } });
    state.grid.machines[silo.id] = createSiloRuntime({
      input: { copperIngot: SILO_CAPACITY - 5 },
      bufferedResource: "copperIngot",
    });

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 1, events);

    expect(next.grid.machines[silo.id]?.input).toEqual({ copperIngot: 95 });
    expect(next.grid.machines[silo.id]?.bufferedResource).toBe("copperIngot");
    expect(next.grid.machines[smelter.id]?.output).toEqual({ copperIngot: 10 });
    expect(events).toEqual([
      { type: "storageFull", entityId: silo.id, resource: "copperIngot" },
    ]);
  });
});

describe("silo resource locking", () => {
  it.each(RESOURCE_CASES)("accepts %s on its input port", (resource) => {
    expect(canStoreInput(createSilo(), createSiloRuntime(), resource)).toBe(true);
  });

  it("locks the first accepted resource type as the buffered resource", () => {
    const belt = createBelt("belt-silo-lock");
    const silo = createSilo({ id: "silo-lock" });
    const state = createState([belt, silo]);
    state.grid.belts[belt.id] = { entityId: belt.id, item: "ironOre", progress: 0 };

    const next = advanceSimulation(state, 1, []);

    expect(next.grid.machines[silo.id]?.input).toEqual({ ironOre: 1 });
    expect(next.grid.machines[silo.id]?.bufferedResource).toBe("ironOre");
  });

  it("rejects a different resource while the silo is occupied", () => {
    const occupied = createSiloRuntime({
      input: { copperOre: 5 },
      bufferedResource: "copperOre",
    });

    expect(canStoreInput(createSilo(), occupied, "copperOre")).toBe(true);
    expect(canStoreInput(createSilo(), occupied, "ironOre")).toBe(false);
    expect(canStoreInput(createSilo(), occupied, "motor")).toBe(false);
  });

  it("retains an upstream belt item that the silo cannot accept and emits no notification", () => {
    const belt = createBelt("belt-silo-conflict");
    const silo = createSilo({ id: "silo-conflict" });
    const state = createState([belt, silo]);
    state.grid.belts[belt.id] = { entityId: belt.id, item: "ironOre", progress: 0 };
    state.grid.machines[silo.id] = createSiloRuntime({
      input: { copperOre: 5 },
      bufferedResource: "copperOre",
    });

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 1, events);

    expect(next.grid.machines[silo.id]?.input).toEqual({ copperOre: 5 });
    expect(next.grid.machines[silo.id]?.bufferedResource).toBe("copperOre");
    expect(next.grid.belts[belt.id]?.item).toBe("ironOre");
    expect(next.grid.belts[belt.id]?.progress).toBe(0);
    expect(events).toEqual([]);
  });

  it("holds the lock across every tick until the silo is emptied", () => {
    const silo = createSilo({ id: "silo-lock-hold" });
    const state = createState([silo]);
    state.grid.machines[silo.id] = createSiloRuntime({
      input: { copperOre: 2 },
      bufferedResource: "copperOre",
    });

    const held = advanceSimulation(state, 25, []);

    expect(held.grid.machines[silo.id]?.bufferedResource).toBe("copperOre");
    expect(held.grid.machines[silo.id]?.input).toEqual({ copperOre: 2 });
    expect(canStoreInput(silo, held.grid.machines[silo.id], "coal")).toBe(false);
  });
});

describe("silo storage", () => {
  it("preserves stored units and never runs the recipe pipeline", () => {
    const silo = createSilo({ id: "silo-storage" });
    const state = createState([silo]);
    state.grid.machines[silo.id] = createSiloRuntime({
      input: { copperIngot: 3 },
      bufferedResource: "copperIngot",
    });
    const stateBefore = structuredClone(state);

    const next = advanceSimulation(state, 40, []);

    expect(next.grid.machines[silo.id]?.input).toEqual({ copperIngot: 3 });
    expect(next.grid.machines[silo.id]?.output).toEqual({});
    expect(next.grid.machines[silo.id]?.progressTicks).toBe(0);
    expect(next.grid.machines[silo.id]?.active).toBe(false);
    expect(next.grid.machines[silo.id]?.bufferedResource).toBe("copperIngot");
    expect(state).toEqual(stateBefore);
  });

  it("releases stored units into a connected machine and frees the lock when emptied", () => {
    const silo = createSilo({ id: "silo-retrieve" });
    const neighbor = createSilo({ id: "silo-neighbor", x: DOWNSTREAM_AT.x, y: DOWNSTREAM_AT.y });
    const state = createState([silo, neighbor]);
    state.grid.machines[silo.id] = createSiloRuntime({
      input: { copperIngot: 3 },
      bufferedResource: "copperIngot",
    });

    const next = advanceSimulation(state, 1, []);

    expect(next.grid.machines[neighbor.id]?.input).toEqual({ copperIngot: 3 });
    expect(next.grid.machines[neighbor.id]?.bufferedResource).toBe("copperIngot");
    expect(next.grid.machines[silo.id]?.input).toEqual({});
    expect(next.grid.machines[silo.id]?.bufferedResource).toBeUndefined();
    expect(next.grid.machines[silo.id]?.output).toEqual({});
  });

  it("keeps stored units when a downstream silo is full", () => {
    const silo = createSilo({ id: "silo-blocked" });
    const neighbor = createSilo({ id: "silo-neighbor-full", x: DOWNSTREAM_AT.x, y: DOWNSTREAM_AT.y });
    const state = createState([silo, neighbor]);
    state.grid.machines[silo.id] = createSiloRuntime({
      input: { copperIngot: 3 },
      bufferedResource: "copperIngot",
    });
    state.grid.machines[neighbor.id] = createSiloRuntime({
      input: { copperIngot: SILO_CAPACITY },
      bufferedResource: "copperIngot",
    });

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 1, events);

    expect(next.grid.machines[silo.id]?.input).toEqual({ copperIngot: 3 });
    expect(next.grid.machines[silo.id]?.bufferedResource).toBe("copperIngot");
    expect(next.grid.machines[neighbor.id]?.input).toEqual({ copperIngot: SILO_CAPACITY });
    expect(events).toEqual([
      { type: "storageFull", entityId: neighbor.id, resource: "copperIngot" },
    ]);
  });
});

describe("silo coexistence", () => {
  it("keeps extractor, smelter, assembler, belt, and depot behavior unchanged", () => {
    const extractor: Entity = {
      id: "extractor-silo-world",
      type: "extractor",
      x: COPPER_NODE.x,
      y: COPPER_NODE.y,
      rotation: 0,
      level: 1,
      resourceNode: COPPER_NODE.resource,
    };
    const smelter = createSmelter({ id: "smelter-silo-world", x: 12, y: 13 });
    const assembler: Entity = {
      id: "assembler-silo-world",
      type: "assembler",
      x: 14,
      y: 15,
      rotation: 0,
      level: 1,
      recipeId: "gear",
    };
    const belt: Entity = {
      id: "belt-silo-world",
      type: "belt",
      x: 16,
      y: 17,
      rotation: 0,
      level: 1,
    };
    const depot: Entity = {
      id: "depot-silo-world",
      type: "depot",
      x: 18,
      y: 19,
      rotation: 0,
      level: 1,
    };
    const silo = createSilo({ id: "silo-world", x: 20, y: 21 });
    const machines: Record<string, MachineRuntime> = {
      [extractor.id]: createMachineRuntime(extractor),
      [smelter.id]: createSmelterRuntime({ input: { copperOre: 2 } }),
      [assembler.id]: {
        ...createMachineRuntime(assembler),
        input: { ironIngot: 2 },
      },
      [depot.id]: createMachineRuntime(depot),
      [silo.id]: createSiloRuntime({ input: { coal: 4 }, bufferedResource: "coal" }),
    };
    const state = createState(
      [extractor, smelter, assembler, belt, depot, silo],
      machines,
      ["copperIngot", "gear"],
    );
    state.grid.belts[belt.id] = { entityId: belt.id, progress: 0 };
    const stateBefore = structuredClone(state);

    const next = advanceSimulation(state, RECIPES.gear.durationTicks);

    expect(next.grid.machines[extractor.id]?.output).toEqual({ copperOre: 1 });
    expect(next.grid.machines[smelter.id]?.output).toEqual({ copperIngot: 1 });
    expect(next.grid.machines[assembler.id]?.output).toEqual({ gear: 1 });
    expect(next.grid.machines[assembler.id]?.input).toEqual({});
    expect(next.grid.machines[silo.id]?.input).toEqual({ coal: 4 });
    expect(next.grid.machines[silo.id]?.bufferedResource).toBe("coal");
    expect(next.grid.machines[depot.id]).toEqual(stateBefore.grid.machines[depot.id]);
    expect(next.grid.belts).toEqual(stateBefore.grid.belts);
    expect(state).toEqual(stateBefore);
  });
});

function createSilo(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "silo-test",
    type: "silo",
    x: SILO_AT.x,
    y: SILO_AT.y,
    rotation: 0,
    level: 1,
    ...overrides,
  };
}

function createSiloRuntime(overrides: Partial<MachineRuntime> = {}): MachineRuntime {
  return {
    ...createMachineRuntime(createSilo()),
    ...overrides,
  };
}

function createSmelter(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "smelter-silo-test",
    type: "smelter",
    x: 9,
    y: 7,
    rotation: 0,
    level: 1,
    recipeId: "copperIngot",
    ...overrides,
  };
}

function createSmelterRuntime(overrides: Partial<MachineRuntime> = {}): MachineRuntime {
  return {
    ...createMachineRuntime(createSmelter()),
    ...overrides,
  };
}

function createBelt(id: string): Entity {
  return {
    id,
    type: "belt",
    x: BELT_AT.x,
    y: BELT_AT.y,
    rotation: 0,
    level: 1,
  };
}

function createState(
  entities: Entity[],
  machines: Record<string, MachineRuntime> = {},
  unlockedRecipes: string[] = ["copperIngot", "gear"],
): SimulationState {
  const state = createInitialState(4242);
  state.grid.nodes = [COPPER_NODE];
  state.grid.entities = entities;
  state.grid.machines = { ...machines };
  state.unlocked.recipes = [...unlockedRecipes];
  for (const entity of entities) {
    if (entity.type === "belt") {
      state.grid.belts[entity.id] = { entityId: entity.id, progress: 0 };
    } else if (!Object.hasOwn(machines, entity.id)) {
      state.grid.machines[entity.id] = createMachineRuntime(entity);
    }
  }
  return state;
}
