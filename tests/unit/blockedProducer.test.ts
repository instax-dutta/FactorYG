import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { createInitialState } from "../../src/sim/initialState";
import { createMachineRuntime, getTotalAmount } from "../../src/sim/machines";
import { advanceSimulation } from "../../src/sim/tick";
import type {
  Entity,
  MachineRuntime,
  RenderEvent,
  ResourceId,
  SimulationState,
} from "../../src/sim/types";

const SOURCE_AT = { x: 5, y: 5 };
const TARGET_AT = { x: SOURCE_AT.x + 1, y: SOURCE_AT.y };
const COPPER_NODE = {
  id: "node-copper-blocked",
  resource: "copperOre" as ResourceId,
  x: 9,
  y: 9,
};
const OFFERED = MACHINES.smelter.outputBuffer;

interface BlockedWorld {
  readonly state: SimulationState;
  readonly source: Entity;
  readonly target: Entity;
}

describe("blocked producer feedback", () => {
  it("flags a producer the moment a connected target refuses every unit it offers", () => {
    const world = createRefusedWorld();

    const next = advanceSimulation(world.state, 1, []);

    expect(
      next.grid.machines[world.source.id]?.alreadyNotifiedBlocked,
    ).toBe(true);
    expect(next.grid.machines[world.target.id]?.alreadyNotifiedBlocked).toBe(false);
  });

  it("keeps every refused unit in the producer and never moves the target", () => {
    const world = createRefusedWorld();
    const stateBefore = structuredClone(world.state);

    const next = advanceSimulation(world.state, 5, []);

    expect(next.grid.machines[world.source.id]?.output).toEqual({ copperIngot: OFFERED });
    expect(next.grid.machines[world.target.id]?.input).toEqual({
      copperIngot: MACHINES.assembler.inputBuffer,
    });
    expect(next.grid.machines[world.target.id]?.alreadyNotifiedBlocked).toBe(false);
    expect(world.state).toEqual(stateBefore);
  });

  it("emits one blocked event on the transition and stays silent on every later tick", () => {
    const world = createRefusedWorld();

    const firstEvents: RenderEvent[] = [];
    const first = advanceSimulation(world.state, 1, firstEvents);

    expect(firstEvents).toEqual([{ type: "blockedFull", entityId: world.source.id }]);

    const repeatEvents: RenderEvent[] = [];
    const repeated = advanceSimulation(first, 40, repeatEvents);

    expect(repeated.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(repeatEvents).toEqual([]);
  });

  it("emits exactly one blocked event across a long blocked run and never repeats it", () => {
    const world = createRefusedWorld();

    const events: RenderEvent[] = [];
    const next = advanceSimulation(world.state, 250, events);

    const blockedEvents = events.filter((event) => event.type === "blockedFull");
    expect(blockedEvents).toEqual([{ type: "blockedFull", entityId: world.source.id }]);
    expect(next.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(true);
  });

  it("clears the flag when the flow resumes and reports the block again on the next refusal", () => {
    const world = createRefusedWorld();
    const blocked = advanceSimulation(world.state, 3, []);
    expect(blocked.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(true);

    const unblockedEvents: RenderEvent[] = [];
    const unblocked = advanceSimulation(freeTargetInput(blocked), 1, unblockedEvents);

    expect(unblocked.grid.machines[world.source.id]?.output).toEqual({});
    expect(unblocked.grid.machines[world.target.id]?.input).toEqual({
      copperIngot: OFFERED,
    });
    expect(unblocked.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(false);
    expect(unblockedEvents).toEqual([]);

    const reblockedEvents: RenderEvent[] = [];
    const refilled = {
      ...unblocked,
      grid: {
        ...unblocked.grid,
        machines: {
          ...unblocked.grid.machines,
          [world.source.id]: {
            ...unblocked.grid.machines[world.source.id],
            output: { copperIngot: OFFERED },
          },
          [world.target.id]: {
            ...unblocked.grid.machines[world.target.id],
            input: { copperIngot: MACHINES.assembler.inputBuffer },
          },
        },
      },
    } as SimulationState;
    const reblocked = advanceSimulation(refilled, 1, reblockedEvents);

    expect(reblockedEvents).toEqual([{ type: "blockedFull", entityId: world.source.id }]);
    expect(reblocked.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(true);
  });

  it("never flags a producer that has no connected target", () => {
    const source = createSmelter({ id: "smelter-lonely" });
    const state = createState({
      entities: [source],
      machines: { [source.id]: createSmelterRuntime({ output: { copperIngot: OFFERED } }) },
    });

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 30, events);

    expect(next.grid.machines[source.id]?.output).toEqual({ copperIngot: OFFERED });
    expect(next.grid.machines[source.id]?.alreadyNotifiedBlocked).toBe(false);
    expect(events.filter((event) => event.type === "blockedFull")).toEqual([]);
  });

  it("stops reporting a block once the refusing target is demolished", () => {
    const world = createRefusedWorld();
    const blocked = advanceSimulation(world.state, 3, []);
    expect(blocked.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(true);

    const afterDemolition: SimulationState = {
      ...blocked,
      grid: {
        ...blocked.grid,
        entities: blocked.grid.entities.filter((entity) => entity.id !== world.target.id),
        machines: Object.fromEntries(
          Object.entries(blocked.grid.machines).filter(([entityId]) => entityId !== world.target.id),
        ),
      },
    };

    const next = advanceSimulation(afterDemolition, 1, []);

    expect(next.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(false);
    expect(next.grid.machines[world.source.id]?.output).toEqual({ copperIngot: OFFERED });
  });

  it("reports a producer blocked at a full silo without reporting the silo itself as a producer", () => {
    const smelter = createSmelter({ id: "smelter-near-silo", x: SOURCE_AT.x, y: SOURCE_AT.y });
    const silo = createSilo({ id: "silo-blocked-target", x: TARGET_AT.x, y: TARGET_AT.y });
    const state = createState({
      entities: [smelter, silo],
      machines: {
        [smelter.id]: createSmelterRuntime({ output: { copperIngot: OFFERED } }),
        [silo.id]: createSiloRuntime({
          input: { copperIngot: MACHINES.silo.storageCapacity },
          bufferedResource: "copperIngot",
        }),
      },
    });

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 1, events);

    expect(next.grid.machines[smelter.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(next.grid.machines[smelter.id]?.output).toEqual({ copperIngot: OFFERED });
    expect(next.grid.machines[silo.id]?.input).toEqual({
      copperIngot: MACHINES.silo.storageCapacity,
    });
    expect(events).toEqual([{ type: "blockedFull", entityId: smelter.id }]);
  });
});

describe("clogged belt lines", () => {
  it("jams a dead-end belt line solid without losing an item or needing belt state", () => {
    const beltCount = 4;
    const extractor = createExtractor("extractor-dead-end", 6, 6);
    const belts = Array.from({ length: beltCount }, (_unused, index) =>
      createBelt(`belt-dead-end-${index + 1}`, extractor.x + index + 1, extractor.y),
    );
    const state = createState({ entities: [extractor, ...belts] });

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 200, events);

    const filledBelts = belts.filter((belt) => next.grid.belts[belt.id]?.item !== undefined);
    expect(filledBelts).toHaveLength(beltCount);
    expect(next.grid.machines[extractor.id]?.output).toEqual({ copperOre: 1 });
    expect(next.grid.machines[extractor.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(events.filter((event) => event.type === "blockedFull")).toEqual([
      { type: "blockedFull", entityId: extractor.id },
    ]);
    expect(getTotalAmount(next.grid.machines[extractor.id]?.output ?? {})).toBe(1);
    expect(countBeltItems(next)).toBe(beltCount);
  });

  it("keeps every belt in a fully occupied line exactly where it was", () => {
    const belts = [
      createBelt("belt-jam-head", 1, 1),
      createBelt("belt-jam-middle", 2, 1),
      createBelt("belt-jam-tail", 3, 1),
    ];
    const state = createState({
      entities: belts,
      beltItems: {
        "belt-jam-head": "copperOre",
        "belt-jam-middle": "ironOre",
        "belt-jam-tail": "coal",
      },
    });

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 5, events);

    expect(next.grid.belts["belt-jam-head"]?.item).toBe("copperOre");
    expect(next.grid.belts["belt-jam-middle"]?.item).toBe("ironOre");
    expect(next.grid.belts["belt-jam-tail"]?.item).toBe("coal");
    expect(countBeltItems(next)).toBe(3);
    expect(events).toEqual([]);
  });
});

function countBeltItems(state: SimulationState): number {
  return Object.values(state.grid.belts).filter((belt) => belt.item !== undefined).length;
}

function createRefusedWorld(): BlockedWorld {
  const source = createSmelter({ id: "smelter-blocked", x: SOURCE_AT.x, y: SOURCE_AT.y });
  const target = createAssembler({ id: "assembler-blocked", x: TARGET_AT.x, y: TARGET_AT.y });
  const state = createState({
    entities: [source, target],
    machines: {
      [source.id]: createSmelterRuntime({ output: { copperIngot: OFFERED } }),
      [target.id]: {
        ...createMachineRuntime(target),
        input: { copperIngot: MACHINES.assembler.inputBuffer },
      },
    },
  });

  return { state, source, target };
}

function freeTargetInput(state: SimulationState): SimulationState {
  const target = state.grid.entities.find((entity) => entity.id === "assembler-blocked");
  if (target === undefined) {
    throw new Error("missing refusing assembler");
  }

  return {
    ...state,
    grid: {
      ...state.grid,
      machines: {
        ...state.grid.machines,
        [target.id]: { ...state.grid.machines[target.id], input: {} },
      },
    },
  };
}

function createSmelter(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "smelter-blocked-test",
    type: "smelter",
    x: SOURCE_AT.x,
    y: SOURCE_AT.y,
    rotation: 0,
    level: 1,
    recipeId: "copperIngot",
    ...overrides,
  };
}

function createSmelterRuntime(overrides: Partial<MachineRuntime> = {}): MachineRuntime {
  return { ...createMachineRuntime(createSmelter()), ...overrides };
}

function createAssembler(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "assembler-blocked-test",
    type: "assembler",
    x: TARGET_AT.x,
    y: TARGET_AT.y,
    rotation: 0,
    level: 1,
    recipeId: "gear",
    ...overrides,
  };
}

function createSilo(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "silo-blocked-test",
    type: "silo",
    x: SOURCE_AT.x,
    y: SOURCE_AT.y,
    rotation: 0,
    level: 1,
    ...overrides,
  };
}

function createSiloRuntime(overrides: Partial<MachineRuntime> = {}): MachineRuntime {
  return { ...createMachineRuntime(createSilo()), ...overrides };
}

function createExtractor(id: string, x: number, y: number): Entity {
  return {
    id,
    type: "extractor",
    x,
    y,
    rotation: 0,
    level: 1,
    resourceNode: COPPER_NODE.resource,
  };
}

function createBelt(id: string, x: number, y: number): Entity {
  return { id, type: "belt", x, y, rotation: 0, level: 1 };
}

interface WorldFixture {
  readonly entities: Entity[];
  readonly machines?: Record<string, MachineRuntime>;
  readonly beltItems?: Record<string, ResourceId>;
  readonly recipeIds?: string[];
}

function createState(fixture: WorldFixture): SimulationState {
  const state = createInitialState(9182);
  state.grid.nodes = [COPPER_NODE];
  state.grid.entities = fixture.entities;
  state.grid.machines = { ...fixture.machines };
  state.grid.belts = {};
  state.unlocked.recipes = [...(fixture.recipeIds ?? ["copperIngot", "gear"])];
  for (const entity of fixture.entities) {
    if (entity.type === "belt") {
      state.grid.belts[entity.id] = {
        entityId: entity.id,
        progress: 0.5,
        ...(fixture.beltItems?.[entity.id] === undefined
          ? {}
          : { item: fixture.beltItems[entity.id] }),
      };
    } else if (!Object.hasOwn(state.grid.machines, entity.id)) {
      state.grid.machines[entity.id] = createMachineRuntime(entity);
    }
  }
  return state;
}
