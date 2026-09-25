import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { createInitialState } from "../../src/sim/initialState";
import { createMachineRuntime, tickExtractor } from "../../src/sim/machines";
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

describe("extractor production", () => {
  it("produces no output before the locked 20-tick interval", () => {
    const entity = createExtractor();
    let runtime = createMachineRuntime(entity);

    for (let tick = 1; tick < EXTRACTOR_INTERVAL; tick += 1) {
      runtime = tickExtractor(runtime, entity, createState());
    }

    expect(runtime.progressTicks).toBe(19);
    expect(runtime.output).toEqual({});
  });

  it("produces one configured resource and resets progress at tick 20", () => {
    const entity = createExtractor();
    const runtime = createRuntime(entity, { progressTicks: EXTRACTOR_INTERVAL - 1 });

    const result = tickExtractor(runtime, entity, createState());

    expect(result.output).toEqual({ copperOre: 1 });
    expect(result.progressTicks).toBe(0);
  });

  it("starts a fresh interval after repeated production", () => {
    const entity = createExtractor();
    let runtime = createRuntime(entity, { progressTicks: EXTRACTOR_INTERVAL - 1 });

    runtime = tickExtractor(runtime, entity, createState());
    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBe(0);
    runtime = { ...runtime, output: {} };

    for (let tick = 1; tick < EXTRACTOR_INTERVAL; tick += 1) {
      runtime = tickExtractor(runtime, entity, createState());
    }
    runtime = tickExtractor(runtime, entity, createState());

    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBe(0);
  });

  it("applies the entity level as a production-speed multiplier", () => {
    const entity = createExtractor({ level: 2 });
    let runtime = createMachineRuntime(entity);
    const fasterInterval = EXTRACTOR_INTERVAL / 2;

    for (let tick = 1; tick < fasterInterval; tick += 1) {
      runtime = tickExtractor(runtime, entity, createState());
    }
    expect(runtime.output).toEqual({});

    runtime = tickExtractor(runtime, entity, createState());

    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBe(0);
  });

  it("applies the permanent production-speed multiplier", () => {
    const state = createState();
    state.prestige.permanentMultipliers.productionSpeed = 2;
    const entity = createExtractor();
    let runtime = createMachineRuntime(entity);
    const fasterInterval = EXTRACTOR_INTERVAL / 2;

    for (let tick = 1; tick < fasterInterval; tick += 1) {
      runtime = tickExtractor(runtime, entity, state);
    }
    expect(runtime.output).toEqual({});

    runtime = tickExtractor(runtime, entity, state);

    expect(runtime.output).toEqual({ copperOre: 1 });
    expect(runtime.progressTicks).toBe(0);
  });

  it("is a no-op when the extractor has no resource node", () => {
    const entity = createExtractor({ resourceNode: undefined });
    const runtime = createRuntime(entity, { progressTicks: 7, active: true });
    const state = createState();
    const stateBefore = structuredClone(state);

    const result = tickExtractor(runtime, entity, state);

    expect(result).toBe(runtime);
    expect(state).toEqual(stateBefore);
  });

  it("holds a full output buffer at capacity without duplication", () => {
    const entity = createExtractor();
    const runtime = createRuntime(entity, {
      progressTicks: EXTRACTOR_INTERVAL - 1,
      output: { copperOre: MACHINES.extractor.outputBuffer, ironOre: 3 },
      active: true,
    });

    const result = tickExtractor(runtime, entity, createState());

    expect(result.output).toEqual({
      copperOre: MACHINES.extractor.outputBuffer,
      ironOre: 3,
    });
    expect(result.progressTicks).toBe(EXTRACTOR_INTERVAL);
  });

  it("emits machine state events when active transitions through advanceSimulation", () => {
    const entity = createExtractor();
    const state = createState([entity], {
      [entity.id]: createMachineRuntime(entity),
    });
    const events: RenderEvent[] = [];

    const started = advanceSimulation(state, 1, events);
    expect(started.grid.machines[entity.id]?.active).toBe(true);
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

    advanceSimulation(completed, EXTRACTOR_INTERVAL, events);
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
    const depotRuntime = createRuntime(depot, { progressTicks: 4, active: true });
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
  state.grid.nodes = [COPPER_NODE];
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
