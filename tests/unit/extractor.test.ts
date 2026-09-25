import { describe, expect, it, vi } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { createInitialState } from "../../src/sim/initialState";
import { createMachineRuntime, tickExtractor } from "../../src/sim/machines";
import { SimulationStore } from "../../src/sim/store";
import { advanceSimulation } from "../../src/sim/tick";
import type {
  Entity,
  MachineRuntime,
  RenderEvent,
  ResourceId,
  SimulationState,
} from "../../src/sim/types";

const EXTRACTOR_INTERVAL = MACHINES.extractor.defaultProcessTicks;
const COPPER_NODE = {
  id: "node-copper-test",
  resource: "copperOre" as ResourceId,
  x: 20,
  y: 21,
};
const IRON_NODE = {
  id: "node-iron-test",
  resource: "ironOre" as ResourceId,
  x: 24,
  y: 25,
};

describe("extractor production", () => {
  it("produces no output before the locked 20-tick interval", () => {
    const entity = createExtractor();
    const runtime = tickExtractorTimes(
      createMachineRuntime(entity),
      entity,
      createState(),
      EXTRACTOR_INTERVAL - 1,
    );

    expect(runtime.progressTicks).toBeCloseTo(0.95, 10);
    expect(runtime.output).toEqual({});
  });

  it("produces one configured resource and resets normalized progress at tick 20", () => {
    const entity = createExtractor();
    const runtime = createRuntime(entity, { progressTicks: 0.95 });

    const result = tickExtractor(runtime, entity, createState());

    expect(result.output).toEqual({ copperOre: 1 });
    expect(result.progressTicks).toBeCloseTo(0, 10);
    expect(result.active).toBe(false);
  });

  it("starts a fresh normalized interval after repeated production", () => {
    const entity = createExtractor();
    let runtime = createRuntime(entity, { progressTicks: 0.95 });

    runtime = tickExtractor(runtime, entity, createState());
    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBeCloseTo(0, 10);
    runtime = { ...runtime, output: {} };

    runtime = tickExtractorTimes(runtime, entity, createState(), EXTRACTOR_INTERVAL - 1);
    expect(runtime.output).toEqual({});
    runtime = tickExtractor(runtime, entity, createState());

    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBeCloseTo(0, 10);
  });

  it("applies the entity level as a production-speed multiplier", () => {
    const entity = createExtractor({ level: 2 });
    let runtime = tickExtractorTimes(
      createMachineRuntime(entity),
      entity,
      createState(),
      EXTRACTOR_INTERVAL / 2 - 1,
    );

    expect(runtime.output).toEqual({});
    expect(runtime.progressTicks).toBeCloseTo(0.9, 10);

    runtime = tickExtractor(runtime, entity, createState());

    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBeCloseTo(0, 10);
  });

  it("applies the permanent production-speed multiplier", () => {
    const state = createState();
    state.prestige.permanentMultipliers.productionSpeed = 2;
    const entity = createExtractor();
    let runtime = tickExtractorTimes(
      createMachineRuntime(entity),
      entity,
      state,
      EXTRACTOR_INTERVAL / 2 - 1,
    );

    expect(runtime.output).toEqual({});
    expect(runtime.progressTicks).toBeCloseTo(0.9, 10);

    runtime = tickExtractor(runtime, entity, state);

    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBeCloseTo(0, 10);
  });

  it("supports a permanent production-speed multiplier of 0.5", () => {
    const state = createState();
    state.prestige.permanentMultipliers.productionSpeed = 0.5;
    const entity = createExtractor();
    let runtime = tickExtractorTimes(
      createMachineRuntime(entity),
      entity,
      state,
      EXTRACTOR_INTERVAL * 2 - 1,
    );

    expect(runtime.output).toEqual({});
    expect(runtime.progressTicks).toBeCloseTo(0.975, 10);

    runtime = tickExtractor(runtime, entity, state);

    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBeCloseTo(0, 10);
  });

  it("combines entity level and permanent decimal speed without losing the remainder", () => {
    const state = createState();
    state.prestige.permanentMultipliers.productionSpeed = 0.5;
    const entity = createExtractor({ level: 3 });
    let runtime = tickExtractorTimes(createMachineRuntime(entity), entity, state, 13);

    expect(runtime.output).toEqual({});
    expect(runtime.progressTicks).toBeCloseTo(0.975, 10);

    runtime = tickExtractor(runtime, entity, state);

    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBeCloseTo(0.05, 10);
  });

  it("is a no-op when the extractor has no resource node", () => {
    const entity = createExtractor({ resourceNode: undefined });
    const runtime = createRuntime(entity, { progressTicks: 0.7, active: true });
    const state = createState();
    const stateBefore = structuredClone(state);

    const result = tickExtractor(runtime, entity, state);

    expect(result).toBe(runtime);
    expect(state).toEqual(stateBefore);
  });

  it("produces the resource from a valid iron node", () => {
    const entity = createExtractor({
      id: "extractor-iron-test",
      x: IRON_NODE.x,
      y: IRON_NODE.y,
      resourceNode: IRON_NODE.resource,
    });
    const state = createState([entity], {
      [entity.id]: createMachineRuntime(entity),
    });

    expect(state.grid.nodes).toContainEqual(IRON_NODE);

    const next = advanceSimulation(state, EXTRACTOR_INTERVAL);

    expect(next.grid.machines[entity.id]?.output).toEqual({ ironOre: 1 });
    expect(next.grid.machines[entity.id]?.output).not.toHaveProperty("copperOre");
  });

  it.each([
    ["integer", 19],
    ["normalized near-threshold", 0.95],
  ])("blocks without advancing %s progress", (_label, progressTicks) => {
    const entity = createExtractor();
    const runtime = createRuntime(entity, {
      progressTicks,
      output: {
        copperOre: MACHINES.extractor.outputBuffer,
        ironOre: 3,
      },
      active: true,
    });

    const result = tickExtractor(runtime, entity, createState());

    expect(result).not.toBe(runtime);
    expect(result.progressTicks).toBe(progressTicks);
    expect(result.output).toEqual({
      copperOre: MACHINES.extractor.outputBuffer,
      ironOre: 3,
    });
    expect(result.active).toBe(false);
  });

  it("preserves blocked machine state while advancing runtime ticks", () => {
    const entity = createExtractor();
    const runtime = createRuntime(entity, {
      progressTicks: 0.95,
      output: { copperOre: MACHINES.extractor.outputBuffer },
      active: false,
    });
    const state = createState([entity], { [entity.id]: runtime });
    const events: RenderEvent[] = [];

    expect(tickExtractor(runtime, entity, state)).toBe(runtime);
    const next = advanceSimulation(state, 1, events);
    expect(next).not.toBe(state);
    expect(next.grid.machines[entity.id]).toEqual(state.grid.machines[entity.id]);
    expect(next.tickCount).toBe(1);
    expect(events).toEqual([]);

    const store = new SimulationStore(state);
    const snapshot = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    store.advanceTicks(1);

    expect(store.getSnapshot()).not.toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("recovers from a blocked near-threshold accumulator after the buffer clears", () => {
    const entity = createExtractor();
    const blocked = createRuntime(entity, {
      progressTicks: 0.95,
      output: { copperOre: MACHINES.extractor.outputBuffer },
      active: false,
    });
    const state = createState();

    expect(tickExtractor(blocked, entity, state)).toBe(blocked);

    const available = { ...blocked, output: {} };
    const result = tickExtractor(available, entity, state);

    expect(result.output).toEqual({ copperOre: 1 });
    expect(result.progressTicks).toBeCloseTo(0, 10);
    expect(result.active).toBe(false);
  });

  it("produces exactly one unit for each completed high-speed cycle", () => {
    const state = createState();
    state.prestige.permanentMultipliers.productionSpeed = 5;
    const entity = createExtractor();
    let runtime = createMachineRuntime(entity);

    runtime = tickExtractorTimes(runtime, entity, state, 4);
    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBeCloseTo(0, 10);

    runtime = { ...runtime, output: {} };
    runtime = tickExtractorTimes(runtime, entity, state, 4);

    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBeCloseTo(0, 10);
  });

  it("emits machine state events when active transitions through advanceSimulation", () => {
    const entity = createExtractor();
    const state = createState([entity], {
      [entity.id]: createMachineRuntime(entity),
    });
    const events: RenderEvent[] = [];

    const started = advanceSimulation(state, 1, events);
    expect(started.grid.machines[entity.id]?.active).toBe(true);
    expect(started.grid.machines[entity.id]?.progressTicks).toBeCloseTo(0.05, 10);
    expect(events).toEqual([
      { type: "machineStateChanged", entityId: entity.id, active: true },
    ]);

    const completed = advanceSimulation(started, EXTRACTOR_INTERVAL - 1, events);
    expect(completed.grid.machines[entity.id]?.active).toBe(false);
    expect(completed.grid.machines[entity.id]?.output).toEqual({ copperOre: 1 });
    expect(events).toEqual([
      { type: "machineStateChanged", entityId: entity.id, active: true },
      { type: "machineStateChanged", entityId: entity.id, active: false },
    ]);

    const blocked = advanceSimulation(completed, EXTRACTOR_INTERVAL, events);
    expect(blocked).not.toBe(completed);
    expect(blocked.tickCount).toBe(40);
    expect(events).toHaveLength(2);
  });

  it("does not mutate unrelated simulation state", () => {
    const extractor = createExtractor();
    const belt: Entity = {
      id: "belt-unrelated",
      type: "belt",
      x: 2,
      y: 3,
      rotation: 90,
      level: 1,
    };
    const depot: Entity = {
      id: "depot-unrelated",
      type: "depot",
      x: 3,
      y: 3,
      rotation: 0,
      level: 1,
    };
    const depotRuntime = createRuntime(depot, { progressTicks: 0.4, active: true });
    const state = createState([extractor, belt, depot], {
      [extractor.id]: createMachineRuntime(extractor),
      [depot.id]: depotRuntime,
    });
    state.grid.belts[belt.id] = { entityId: belt.id, progress: 0.5 };
    state.currency = 321;
    state.lifetimeCurrency = 654;
    state.productionChains = {
      "chain-test": {
        id: "chain-test",
        outputResource: "copperOre",
        steadyStateThroughput: 0.05,
        sellValue: 1,
      },
    };
    const stateBefore = structuredClone(state);
    const events: RenderEvent[] = [];

    const next = advanceSimulation(state, EXTRACTOR_INTERVAL, events);
    const { machines: nextMachines, ...nextGrid } = next.grid;
    const { machines: previousMachines, ...previousGrid } = stateBefore.grid;

    expect(state).toEqual(stateBefore);
    expect(nextGrid).toEqual(previousGrid);
    expect(nextMachines[depot.id]).toEqual(previousMachines[depot.id]);
    expect(next.currency).toBe(stateBefore.currency);
    expect(next.lifetimeCurrency).toBe(stateBefore.lifetimeCurrency);
    expect(next.prestige).toEqual(stateBefore.prestige);
    expect(next.productionChains).toEqual(stateBefore.productionChains);
  });
});

function createState(
  entities: Entity[] = [],
  machines: Record<string, MachineRuntime> = {},
): SimulationState {
  const state = createInitialState(1337);
  state.grid.nodes = [COPPER_NODE, IRON_NODE];
  state.grid.entities = entities;
  state.grid.machines = machines;
  return state;
}

function createExtractor(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "extractor-test",
    type: "extractor",
    x: COPPER_NODE.x,
    y: COPPER_NODE.y,
    rotation: 0,
    level: 1,
    resourceNode: COPPER_NODE.resource,
    ...overrides,
  };
}

function createRuntime(
  entity: Entity,
  overrides: Partial<MachineRuntime> = {},
): MachineRuntime {
  return {
    ...createMachineRuntime(entity),
    ...overrides,
  };
}

function tickExtractorTimes(
  runtime: MachineRuntime,
  entity: Entity,
  state: SimulationState,
  tickCount: number,
): MachineRuntime {
  let nextRuntime = runtime;
  for (let tick = 0; tick < tickCount; tick += 1) {
    nextRuntime = tickExtractor(nextRuntime, entity, state);
  }
  return nextRuntime;
}
