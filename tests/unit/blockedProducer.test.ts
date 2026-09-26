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
  it("flags a producer once a refusal persists and never touches the goods of either machine", () => {
    const world = createRefusedWorld();

    const next = advanceSimulation(world.state, 2, []);

    expect(next.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(next.grid.machines[world.source.id]?.output).toEqual({ copperIngot: OFFERED });
    expect(next.grid.machines[world.target.id]?.alreadyNotifiedBlocked).toBe(false);
    expect(next.grid.machines[world.target.id]?.input).toEqual({
      copperIngot: MACHINES.assembler.inputBuffer,
    });
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

  it("stays silent on every tick after the one block event", () => {
    const world = createRefusedWorld();

    const transitionEvents: RenderEvent[] = [];
    const blocked = advanceSimulation(world.state, 2, transitionEvents);

    expect(transitionEvents).toEqual([{ type: "blockedFull", entityId: world.source.id }]);

    const repeatEvents: RenderEvent[] = [];
    const repeated = advanceSimulation(blocked, 40, repeatEvents);

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
    const refilled = refillTarget(unblocked, world.source.id, world.target.id);
    const reblocked = advanceSimulation(refilled, 2, reblockedEvents);

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

  it("does not report a first refusal and reports the second one as a block", () => {
    const world = createRefusedWorld();

    const firstEvents: RenderEvent[] = [];
    const first = advanceSimulation(world.state, 1, firstEvents);

    expect(first.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(false);
    expect(first.grid.machines[world.source.id]?.blockedRefusalTicks).toBe(1);
    expect(firstEvents).toEqual([]);

    const secondEvents: RenderEvent[] = [];
    const second = advanceSimulation(first, 1, secondEvents);

    expect(second.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(secondEvents).toEqual([{ type: "blockedFull", entityId: world.source.id }]);
  });

  it("forgets a single refusal that was resolved before it could become a block", () => {
    const world = createRefusedWorld();
    const once = advanceSimulation(world.state, 1, []);
    expect(once.grid.machines[world.source.id]?.blockedRefusalTicks).toBe(1);

    const unblockedEvents: RenderEvent[] = [];
    const unblocked = advanceSimulation(freeTargetInput(once), 1, unblockedEvents);

    expect(unblocked.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(false);
    expect(unblocked.grid.machines[world.source.id]?.blockedRefusalTicks).toBeUndefined();
    expect(unblockedEvents).toEqual([]);

    const secondEvents: RenderEvent[] = [];
    const reblocked = advanceSimulation(
      refillTarget(unblocked, world.source.id, world.target.id),
      2,
      secondEvents,
    );

    expect(reblocked.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(secondEvents).toEqual([{ type: "blockedFull", entityId: world.source.id }]);
  });

  it("keeps the refusal counter bounded while a block lasts", () => {
    const world = createRefusedWorld();

    const next = advanceSimulation(world.state, 400, []);

    expect(next.grid.machines[world.source.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(next.grid.machines[world.source.id]?.blockedRefusalTicks).toBe(2);
  });

  it("never sets the flag when another resource in a mixed buffer still moves", () => {
    const source = createSmelter({ id: "smelter-mixed", x: SOURCE_AT.x, y: SOURCE_AT.y });
    const target = createAssembler({
      id: "assembler-mixed",
      x: TARGET_AT.x,
      y: TARGET_AT.y,
    });
    const state = createState({
      entities: [source, target],
      machines: {
        [source.id]: createSmelterRuntime({
          output: { copperIngot: OFFERED, gear: OFFERED },
        }),
        [target.id]: {
          ...createMachineRuntime(target),
          input: { copperIngot: MACHINES.assembler.inputBuffer },
        },
      },
    });

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 1, events);

    expect(next.grid.machines[source.id]?.output).toEqual({ copperIngot: OFFERED });
    expect(next.grid.machines[target.id]?.input).toEqual({
      copperIngot: MACHINES.assembler.inputBuffer,
      gear: OFFERED,
    });
    expect(next.grid.machines[source.id]?.alreadyNotifiedBlocked).toBe(false);
    expect(next.grid.machines[source.id]?.blockedRefusalTicks).toBeUndefined();
    expect(events.filter((event) => event.type === "blockedFull")).toEqual([]);
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
    const next = advanceSimulation(state, 2, events);

    expect(next.grid.machines[smelter.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(next.grid.machines[smelter.id]?.output).toEqual({ copperIngot: OFFERED });
    expect(next.grid.machines[silo.id]?.input).toEqual({
      copperIngot: MACHINES.silo.storageCapacity,
    });
    expect(events).toEqual([{ type: "blockedFull", entityId: smelter.id }]);
  });
});

describe("a saturated but healthy line", () => {
  it.each([
    [2, 20],
    [3, 20],
    [3, 25],
    [3, 40],
    [5, 20],
    [5, 25],
    [5, 40],
  ])(
    "never calls a %i-belt line into a depot blocked at extractor level %i while it sells",
    (beltCount, level) => {
      const world = createSaturatedLine(beltCount, level);

      const events: RenderEvent[] = [];
      const next = advanceSimulation(world.state, 300, events);

      const sales = events.filter((event) => event.type === "saleCompleted");
      expect(sales.length).toBeGreaterThan(100);
      expect(next.currency).toBeGreaterThan(0);
      expect(events.filter((event) => event.type === "blockedFull")).toEqual([]);
      expect(next.grid.machines[world.extractor.id]?.alreadyNotifiedBlocked).toBe(false);
      expect(next.grid.machines[world.extractor.id]?.blockedRefusalTicks ?? 0).toBeLessThan(2);
    },
  );

  it("still reports a dead-end line as blocked at every level", () => {
    for (const level of [1, 10, 20, 25, 40]) {
      const world = createDeadEndLine(4, level);

      const events: RenderEvent[] = [];
      const next = advanceSimulation(world.state, 300, events);

      expect(events.filter((event) => event.type === "blockedFull")).toEqual([
        { type: "blockedFull", entityId: world.extractor.id },
      ]);
      expect(next.grid.machines[world.extractor.id]?.alreadyNotifiedBlocked).toBe(true);
      expect(next.grid.machines[world.extractor.id]?.output).toEqual({
        copperOre: MACHINES.extractor.outputBuffer * level,
      });
      expect(countBeltItems(next)).toBe(4);
    }
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
  return setTargetInput(state, "assembler-blocked", {});
}

function refillTarget(
  state: SimulationState,
  sourceId: string,
  targetId: string,
): SimulationState {
  return {
    ...setTargetInput(state, targetId, { copperIngot: MACHINES.assembler.inputBuffer }),
    grid: {
      ...state.grid,
      machines: {
        ...state.grid.machines,
        [sourceId]: {
          ...state.grid.machines[sourceId],
          output: { copperIngot: OFFERED },
        },
        [targetId]: {
          ...state.grid.machines[targetId],
          input: { copperIngot: MACHINES.assembler.inputBuffer },
        },
      },
    },
  };
}

function setTargetInput(
  state: SimulationState,
  targetId: string,
  input: Partial<Record<ResourceId, number>>,
): SimulationState {
  const target = state.grid.entities.find((entity) => entity.id === targetId);
  if (target === undefined) {
    throw new Error(`missing target ${targetId}`);
  }

  return {
    ...state,
    grid: {
      ...state.grid,
      machines: {
        ...state.grid.machines,
        [targetId]: { ...state.grid.machines[targetId], input },
      },
    },
  };
}

interface LineWorld {
  readonly state: SimulationState;
  readonly extractor: Entity;
}

function createSaturatedLine(beltCount: number, level: number): LineWorld {
  const extractor = createExtractor("extractor-saturated", 4, 4);
  extractor.level = level;
  const belts = Array.from({ length: beltCount }, (_unused, index) =>
    createBelt(`belt-saturated-${index + 1}`, extractor.x + index + 1, extractor.y),
  );
  const depot = createDepot("depot-saturated", extractor.x + beltCount + 1, extractor.y);

  return { state: createState({ entities: [extractor, ...belts, depot] }), extractor };
}

function createDeadEndLine(beltCount: number, level: number): LineWorld {
  const extractor = createExtractor("extractor-dead-end-level", 4, 4);
  extractor.level = level;
  const belts = Array.from({ length: beltCount }, (_unused, index) =>
    createBelt(`belt-dead-end-level-${index + 1}`, extractor.x + index + 1, extractor.y),
  );

  return { state: createState({ entities: [extractor, ...belts] }), extractor };
}

function createDepot(id: string, x: number, y: number): Entity {
  return { id, type: "depot", x, y, rotation: 0, level: 1 };
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
