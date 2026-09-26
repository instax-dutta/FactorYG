import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { RECIPES } from "../../src/content/recipes";
import { RESOURCES } from "../../src/content/resources";
import { TILE_SIZE_PX } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import {
  canStoreInput,
  createMachineRuntime,
  getInputRoom,
  getResourceAmount,
  getTotalAmount,
} from "../../src/sim/machines";
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

  it("fills to exactly 100 from a belt, notifies once, and then stalls the belt deterministically", () => {
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
      storageFullEvent(silo.id, SILO_AT, "copperOre"),
    ]);

    const stalledBelt = withBeltItem(filling, belt.id, "copperOre");
    const stalledEvents: RenderEvent[] = [];
    const stalled = advanceSimulation(stalledBelt, 1, stalledEvents);

    expect(stalled.grid.machines[silo.id]?.input).toEqual({ copperOre: 100 });
    expect(stalled.grid.belts[belt.id]?.item).toBe("copperOre");
    expect(stalledEvents).toEqual([]);

    const repeatEvents: RenderEvent[] = [];
    const repeated = advanceSimulation(stalled, 10, repeatEvents);

    expect(repeated.grid.machines[silo.id]?.input).toEqual({ copperOre: 100 });
    expect(repeatEvents).toEqual([]);
  });

  it("refuses a machine output that would exceed capacity, keeps every unit in the smelter, and reports the smelter blocked", () => {
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
    expect(next.grid.machines[smelter.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(next.grid.machines[silo.id]?.alreadyNotifiedBlocked).toBe(false);
    expect(events).toEqual([{ type: "blockedFull", entityId: smelter.id }]);
  });

  it("conserves every unit when a full silo pushes at one occupied belt cell", () => {
    const silo = createSilo({ id: "silo-belt-drain" });
    const belt = createBelt("belt-silo-drain", { x: DOWNSTREAM_AT.x, y: DOWNSTREAM_AT.y });
    const state = createState([silo, belt]);
    state.grid.machines[silo.id] = createSiloRuntime({
      input: { copperIngot: SILO_CAPACITY },
      bufferedResource: "copperIngot",
    });

    const next = advanceSimulation(state, 1, []);

    expect(countStoredUnits(next)).toBe(SILO_CAPACITY);
    expect(next.grid.belts[belt.id]?.item).toBe("copperIngot");
    expect(next.grid.machines[silo.id]?.input).toEqual({ copperIngot: SILO_CAPACITY - 1 });
  });

  it("conserves every unit when a smelter with a full output buffer pushes to a belt", () => {
    const smelter = createSmelter({
      id: "smelter-belt-drain",
      x: SILO_AT.x,
      y: SILO_AT.y,
    });
    const belt = createBelt("belt-smelter-drain", { x: DOWNSTREAM_AT.x, y: DOWNSTREAM_AT.y });
    const state = createState([smelter, belt]);
    state.grid.machines[smelter.id] = createSmelterRuntime({
      output: { copperIngot: MACHINES.smelter.outputBuffer },
    });

    const next = advanceSimulation(state, 1, []);

    expect(countStoredUnits(next)).toBe(MACHINES.smelter.outputBuffer);
    expect(next.grid.machines[smelter.id]?.output).toEqual({
      copperIngot: MACHINES.smelter.outputBuffer - 1,
    });
    expect(next.grid.belts[belt.id]?.item).toBe("copperIngot");
  });

  it("conserves every unit while a smelter drains one unit per tick along a belt line", () => {
    const total = MACHINES.smelter.outputBuffer;
    const smelter = createSmelter({ id: "smelter-belt-line", x: SILO_AT.x, y: SILO_AT.y });
    const belts = Array.from({ length: total }, (_unused, index) =>
      createBelt(`belt-line-${index + 1}`, {
        x: DOWNSTREAM_AT.x + index,
        y: DOWNSTREAM_AT.y,
      }),
    );
    const state = createState([smelter, ...belts]);
    state.grid.machines[smelter.id] = createSmelterRuntime({ output: { copperIngot: total } });

    let current = state;
    let ticks = 0;
    while (
      getResourceAmount(current.grid.machines[smelter.id]?.output, "copperIngot") > 0 &&
      ticks < total * 3
    ) {
      current = advanceSimulation(current, 1, []);
      ticks += 1;
      expect(countStoredUnits(current)).toBe(total);
    }

    expect(current.grid.machines[smelter.id]?.output).toEqual({});
    expect(
      belts.filter((belt) => current.grid.belts[belt.id]?.item !== undefined),
    ).toHaveLength(total);
  });
});

describe("machine input room", () => {
  it("reports the exact room a machine has left for one resource", () => {
    const partial = { ...createMachineRuntime(createSmelter()), input: { copperOre: 5 } };

    expect(getInputRoom(createSmelter(), partial, "copperOre")).toBe(5);
    expect(getInputRoom(createSmelter(), partial, "ironOre")).toBe(MACHINES.smelter.inputBuffer);
    expect(getInputRoom(createSmelter(), createMachineRuntime(createSmelter()), "coal")).toBe(
      MACHINES.smelter.inputBuffer,
    );
  });

  it("never reports room for a resource the input ports refuse", () => {
    const smelter = createSmelter();

    expect(getInputRoom(smelter, createMachineRuntime(smelter), "copperIngot")).toBe(0);
    expect(canStoreInput(smelter, createMachineRuntime(smelter), "copperIngot")).toBe(false);
  });

  it("reports a shared room for the locked resource and none for a conflicting one", () => {
    const partial = createSiloRuntime({
      input: { copperOre: 5 },
      bufferedResource: "copperOre",
    });

    expect(getInputRoom(createSilo(), partial, "copperOre")).toBe(SILO_CAPACITY - 5);
    expect(getInputRoom(createSilo(), partial, "ironOre")).toBe(0);
    expect(getInputRoom(createSilo(), createSiloRuntime(), "ironOre")).toBe(SILO_CAPACITY);
  });

  it("clamps a multi-unit machine transfer to the room the target has left", () => {
    const held = MACHINES.assembler.inputBuffer - 5;
    const offered = MACHINES.smelter.outputBuffer;
    const source = createSmelter({ id: "smelter-clamp", x: SILO_AT.x, y: SILO_AT.y });
    const target = createAssembler({
      id: "assembler-clamp",
      x: SILO_AT.x + 1,
      y: SILO_AT.y,
    });
    const state = createState([source, target], {
      [source.id]: createSmelterRuntime({ output: { copperIngot: offered } }),
      [target.id]: {
        ...createMachineRuntime(target),
        input: { copperIngot: held },
      },
    });

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 1, events);

    expect(next.grid.machines[target.id]?.input).toEqual({
      copperIngot: MACHINES.assembler.inputBuffer,
    });
    expect(next.grid.machines[source.id]?.output).toEqual({ copperIngot: offered - 5 });
    expect(countStoredUnits(next)).toBe(held + offered);
    expect(events).toEqual([]);
  });

  it("keeps a full output buffer buffered while the target is partially full", () => {
    const offered = MACHINES.smelter.outputBuffer;
    const source = createSmelter({ id: "smelter-backpressure", x: SILO_AT.x, y: SILO_AT.y });
    const target = createAssembler({
      id: "assembler-backpressure",
      x: SILO_AT.x + 1,
      y: SILO_AT.y,
    });
    const state = createState([source, target], {
      [source.id]: createSmelterRuntime({ output: { copperIngot: offered } }),
      [target.id]: {
        ...createMachineRuntime(target),
        input: { copperIngot: MACHINES.assembler.inputBuffer - 1 },
      },
    });
    const stateBefore = structuredClone(state);

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 3, events);

    expect(next.grid.machines[target.id]?.input).toEqual({
      copperIngot: MACHINES.assembler.inputBuffer,
    });
    expect(next.grid.machines[source.id]?.output).toEqual({ copperIngot: offered - 1 });
    expect(next.grid.machines[source.id]?.active).toBe(false);
    expect(next.grid.machines[source.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(countStoredUnits(next)).toBe(MACHINES.assembler.inputBuffer - 1 + offered);
    expect(events).toEqual([{ type: "blockedFull", entityId: source.id }]);
    expect(state).toEqual(stateBefore);
  });

  it("fully accepts an exact fit and empties the offering machine", () => {
    const offered = MACHINES.smelter.outputBuffer;
    const source = createSmelter({ id: "smelter-exact", x: SILO_AT.x, y: SILO_AT.y });
    const target = createAssembler({
      id: "assembler-exact",
      x: SILO_AT.x + 1,
      y: SILO_AT.y,
    });
    const state = createState([source, target], {
      [source.id]: createSmelterRuntime({ output: { copperIngot: offered } }),
      [target.id]: {
        ...createMachineRuntime(target),
        input: { copperIngot: MACHINES.assembler.inputBuffer - offered },
      },
    });

    const next = advanceSimulation(state, 1, []);

    expect(next.grid.machines[target.id]?.input).toEqual({
      copperIngot: MACHINES.assembler.inputBuffer,
    });
    expect(next.grid.machines[source.id]?.output).toEqual({});
    expect(countStoredUnits(next)).toBe(MACHINES.assembler.inputBuffer);
  });

  it("refuses a transfer that fits no unit, changes no goods, and still reports the source blocked", () => {
    const offered = MACHINES.smelter.outputBuffer;
    const source = createSmelter({ id: "smelter-refused", x: SILO_AT.x, y: SILO_AT.y });
    const target = createAssembler({
      id: "assembler-refused",
      x: SILO_AT.x + 1,
      y: SILO_AT.y,
    });
    const state = createState([source, target], {
      [source.id]: createSmelterRuntime({ output: { copperIngot: offered } }),
      [target.id]: {
        ...createMachineRuntime(target),
        input: { copperIngot: MACHINES.assembler.inputBuffer },
      },
    });
    const stateBefore = structuredClone(state);

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 5, events);

    expect(next.grid.machines[target.id]?.input).toEqual({
      copperIngot: MACHINES.assembler.inputBuffer,
    });
    expect(next.grid.machines[source.id]?.output).toEqual({ copperIngot: offered });
    expect(next.grid.machines).toEqual({
      ...stateBefore.grid.machines,
      [source.id]: { ...stateBefore.grid.machines[source.id], alreadyNotifiedBlocked: true },
    });
    expect(events).toEqual([{ type: "blockedFull", entityId: source.id }]);
  });

  it("never lets a depot sell more units than the silo actually offered", () => {
    const held = MACHINES.depot.inputBuffer - 5;
    const offered = MACHINES.silo.storageCapacity;
    const silo = createSilo({ id: "silo-depot-room", x: SILO_AT.x, y: SILO_AT.y });
    const depot = createDepot({ id: "depot-depot-room", x: SILO_AT.x + 1, y: SILO_AT.y });
    const state = createState([silo, depot], {
      [silo.id]: createSiloRuntime({
        input: { copperIngot: offered },
        bufferedResource: "copperIngot",
      }),
      [depot.id]: {
        ...createMachineRuntime(depot),
        input: { copperIngot: held },
      },
    });
    const stateBefore = structuredClone(state);

    const next = advanceSimulation(state, 1, []);

    const sale = next.currencySamples.at(-1);
    const legitimateSale = RESOURCES.copperIngot.sellValue * offered;
    expect(sale?.amount).toBe(legitimateSale);
    expect(next.currency - stateBefore.currency).toBe(legitimateSale);
    expect(next.grid.machines[silo.id]?.input).toEqual({ copperIngot: offered - 5 });
    expect(next.grid.machines[silo.id]?.bufferedResource).toBe("copperIngot");
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

  it("keeps stored units when a downstream silo is already full and reports the upstream silo blocked", () => {
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
    expect(next.grid.machines[silo.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(next.grid.machines[neighbor.id]?.input).toEqual({ copperIngot: SILO_CAPACITY });
    expect(next.grid.machines[neighbor.id]?.alreadyNotifiedBlocked).toBe(false);
    expect(events).toEqual([{ type: "blockedFull", entityId: silo.id }]);
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

function createAssembler(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "assembler-silo-test",
    type: "assembler",
    x: 11,
    y: 8,
    rotation: 0,
    level: 1,
    ...overrides,
  };
}

function createDepot(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "depot-silo-test",
    type: "depot",
    x: 13,
    y: 9,
    rotation: 0,
    level: 1,
    ...overrides,
  };
}

function createBelt(id: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    type: "belt",
    x: BELT_AT.x,
    y: BELT_AT.y,
    rotation: 0,
    level: 1,
    ...overrides,
  };
}

function withBeltItem(
  state: SimulationState,
  beltId: string,
  item: ResourceId,
): SimulationState {
  const belt = state.grid.belts[beltId];
  if (belt === undefined) {
    return state;
  }

  return {
    ...state,
    grid: {
      ...state.grid,
      belts: { ...state.grid.belts, [beltId]: { ...belt, item, progress: 0 } },
    },
  };
}

function countStoredUnits(state: SimulationState): number {
  let total = 0;
  for (const runtime of Object.values(state.grid.machines)) {
    total += getTotalAmount(runtime.input) + getTotalAmount(runtime.output);
  }
  for (const belt of Object.values(state.grid.belts)) {
    total += belt.item === undefined ? 0 : 1;
  }
  return total;
}

function storageFullEvent(
  entityId: string,
  at: { x: number; y: number },
  resource: ResourceId,
): RenderEvent {
  return {
    type: "storageFull",
    entityId,
    resource,
    worldX: at.x * TILE_SIZE_PX + TILE_SIZE_PX / 2,
    worldY: at.y * TILE_SIZE_PX + TILE_SIZE_PX / 2,
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
