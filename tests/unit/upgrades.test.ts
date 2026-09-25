import { describe, expect, it } from "vitest";
import { MACHINES, getMachineUpgradeCost } from "../../src/content/machines";
import { RECIPES } from "../../src/content/recipes";
import { canUpgrade, upgradeEntity } from "../../src/sim/commands";
import { createInitialState } from "../../src/sim/initialState";
import {
  createMachineRuntime,
  getExtractorRate,
  getOutputCapacity,
  getProcessDurationTicks,
  getUpgradeCost,
  tickExtractor,
  tickProcessor,
} from "../../src/sim/machines";
import { advanceSimulation } from "../../src/sim/tick";
import type {
  Entity,
  MachineRuntime,
  MachineType,
  ResourceId,
  SimulationState,
} from "../../src/sim/types";

const COPPER_NODE = {
  id: "node-copper-upgrade",
  resource: "copperOre" as ResourceId,
  x: 30,
  y: 31,
};
const EXTRACTOR_COST = MACHINES.extractor.cost;
const SMELTER_COST = MACHINES.smelter.cost;
const EXTRACTOR_INTERVAL = MACHINES.extractor.defaultProcessTicks;
const SMELTER_OUTPUT_BUFFER = MACHINES.smelter.outputBuffer;
const COPPER_INGOT_DURATION = RECIPES.copperIngot.durationTicks;
const FUNDED_CURRENCY = 10_000;

describe("upgrade cost table", () => {
  it("prices a level with baseCost * level * level from the machine table", () => {
    expect(getMachineUpgradeCost("smelter", 1)).toBe(SMELTER_COST);
    expect(getMachineUpgradeCost("smelter", 2)).toBe(SMELTER_COST * 4);
    expect(getMachineUpgradeCost("smelter", 2)).toBe(1_000);
    expect(getMachineUpgradeCost("smelter", 3)).toBe(SMELTER_COST * 9);
    expect(getMachineUpgradeCost("extractor", 2)).toBe(EXTRACTOR_COST * 4);
  });

  it("rises strictly at every level for every machine", () => {
    const types = Object.keys(MACHINES) as MachineType[];

    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      const costs = [1, 2, 3, 4, 5].map((level) => getMachineUpgradeCost(type, level));

      expect(costs).toEqual([...costs].sort((left, right) => left - right));
      expect(new Set(costs).size).toBe(costs.length);
      expect(costs.every((cost) => cost > 0)).toBe(true);
    }
  });

  it("treats a level below one as level one so an upgrade is never free", () => {
    const levelOne = getMachineUpgradeCost("silo", 1);

    expect(getMachineUpgradeCost("silo", 0)).toBe(levelOne);
    expect(getMachineUpgradeCost("silo", -2)).toBe(levelOne);
    expect(getMachineUpgradeCost("silo", Number.NaN)).toBe(levelOne);
    expect(getMachineUpgradeCost("silo", 1.5)).toBe(getMachineUpgradeCost("silo", 1));
  });

  it("reads the level from the selected entity", () => {
    expect(getUpgradeCost(createExtractor())).toBe(EXTRACTOR_COST);
    expect(getUpgradeCost(createExtractor({ level: 2 }))).toBe(EXTRACTOR_COST * 4);
    expect(getUpgradeCost(createSmelter())).toBe(SMELTER_COST);
    expect(getUpgradeCost(createSmelter({ level: 3 }))).toBe(SMELTER_COST * 9);
  });
});

describe("upgrade command", () => {
  it("debits the table price and raises the level in one transition", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);

    const application = upgradeEntity(state, state.grid.entities[0].id);

    expect(application.result).toEqual({ ok: true });
    expect(application.changed).toBe(true);
    expect(application.state.currency).toBe(FUNDED_CURRENCY - SMELTER_COST);
    expect(application.state.grid.entities[0].level).toBe(2);
    expect(state.currency).toBe(FUNDED_CURRENCY);
    expect(state.grid.entities[0].level).toBe(1);
  });

  it("charges the level being left, so every step is dearer than the last", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);

    const first = upgradeEntity(state, state.grid.entities[0].id);
    const second = upgradeEntity(first.state, first.state.grid.entities[0].id);

    expect(first.state.currency).toBe(FUNDED_CURRENCY - SMELTER_COST);
    expect(second.state.currency).toBe(FUNDED_CURRENCY - SMELTER_COST - SMELTER_COST * 4);
    expect(second.state.grid.entities[0].level).toBe(3);
  });

  it("mutates neither currency nor the entity when the currency is insufficient", () => {
    const state = createState([createExtractor()], EXTRACTOR_COST - 1);
    const before = structuredClone(state);

    const application = upgradeEntity(state, state.grid.entities[0].id);

    expect(application.result).toEqual({ ok: false, reason: "insufficientCurrency" });
    expect(application.changed).toBe(false);
    expect(application.state).toBe(state);
    expect(state.currency).toBe(before.currency);
    expect(state.grid.entities).toEqual(before.grid.entities);
    expect(state.grid.entities[0].level).toBe(1);
  });

  it("accepts an upgrade at the exact price", () => {
    const state = createState([createExtractor()], EXTRACTOR_COST);

    const application = upgradeEntity(state, state.grid.entities[0].id);

    expect(application.result).toEqual({ ok: true });
    expect(application.state.currency).toBe(0);
  });

  it("refuses an unknown entity and changes nothing", () => {
    const state = createState([createExtractor()], FUNDED_CURRENCY);

    const application = upgradeEntity(state, "entity-missing");

    expect(application.result).toEqual({ ok: false, reason: "entityNotFound" });
    expect(application.changed).toBe(false);
    expect(application.state).toBe(state);
    expect(state.currency).toBe(FUNDED_CURRENCY);
  });

  it("shares one validator between the preflight and the commit", () => {
    const state = createState([createExtractor()], EXTRACTOR_COST - 1);

    expect(canUpgrade(state, state.grid.entities[0].id)).toEqual({
      ok: false,
      reason: "insufficientCurrency",
    });
    expect(canUpgrade(state, "entity-missing")).toEqual({ ok: false, reason: "entityNotFound" });

    const funded = createState([createExtractor()], FUNDED_CURRENCY);
    expect(canUpgrade(funded, funded.grid.entities[0].id)).toEqual({ ok: true });
  });

  it("never exposes a level without its debit or a debit without its level", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const observed: Array<{ currency: number; level: number }> = [];

    let current = state;
    for (let step = 0; step < 3; step += 1) {
      const application = upgradeEntity(current, current.grid.entities[0].id);
      if (!application.changed) {
        break;
      }
      current = application.state;
      observed.push({
        currency: current.currency,
        level: current.grid.entities[0].level,
      });
    }

    expect(observed.map((entry) => entry.level)).toEqual([2, 3, 4]);
    expect(observed.map((entry) => entry.currency)).toEqual([
      FUNDED_CURRENCY - SMELTER_COST,
      FUNDED_CURRENCY - SMELTER_COST - SMELTER_COST * 4,
      FUNDED_CURRENCY - SMELTER_COST - SMELTER_COST * 4 - SMELTER_COST * 9,
    ]);
  });

  it("leaves other entities, buffers, and belts untouched", () => {
    const smelter = createSmelter();
    const belt: Entity = {
      id: "belt-upgrade",
      type: "belt",
      x: 5,
      y: 5,
      rotation: 0,
      level: 1,
    };
    const state = createState([smelter, belt], FUNDED_CURRENCY);
    state.grid.machines[smelter.id] = {
      ...createMachineRuntime(smelter),
      input: { copperOre: 1 },
      output: { copperIngot: 2 },
    };
    state.grid.belts[belt.id] = { entityId: belt.id, item: "copperOre", progress: 0.5 };
    const before = structuredClone(state);

    const application = upgradeEntity(state, smelter.id);

    expect(application.state.grid.machines[smelter.id]).toEqual(before.grid.machines[smelter.id]);
    expect(application.state.grid.belts).toEqual(before.grid.belts);
    expect(application.state.grid.entities[1]).toBe(belt);
    expect(application.state.grid.nodes).toEqual(before.grid.nodes);
    expect(state).toEqual(before);
  });
});

describe("level-adjusted extraction", () => {
  it("doubles the extractor rate at level two", () => {
    const state = createState([createExtractor()], FUNDED_CURRENCY);
    const levelOne = getExtractorRate(createExtractor(), state);

    const application = upgradeEntity(state, state.grid.entities[0].id);
    const upgraded = application.state.grid.entities[0];

    expect(upgraded.level).toBe(2);
    expect(getExtractorRate(upgraded, state)).toBeCloseTo(levelOne * 2, 12);
  });

  it("produces the first unit on the tenth tick once upgraded", () => {
    const state = createState([createExtractor()], FUNDED_CURRENCY);
    const application = upgradeEntity(state, state.grid.entities[0].id);
    const entity = application.state.grid.entities[0];

    const early = tickExtractorTimes(createMachineRuntime(entity), entity, state, 9);
    expect(early.output).toEqual({});
    expect(early.progressTicks).toBeCloseTo(0.9, 10);

    const completed = tickExtractor(early, entity, state);
    expect(completed.output).toEqual({ copperOre: 1 });
    expect(completed.progressTicks).toBeCloseTo(0, 10);
  });

  it("combines the level with the permanent production multiplier", () => {
    const state = createState([createExtractor()], FUNDED_CURRENCY);
    state.prestige.permanentMultipliers.productionSpeed = 0.5;
    const application = upgradeEntity(state, state.grid.entities[0].id);
    const entity = application.state.grid.entities[0];

    const running = tickExtractorTimes(createMachineRuntime(entity), entity, state, 19);

    expect(getExtractorRate(entity, state)).toBeCloseTo(1 / EXTRACTOR_INTERVAL, 12);
    expect(running.output).toEqual({});
    expect(running.progressTicks).toBeCloseTo(0.95, 10);

    const completed = tickExtractor(running, entity, state);
    expect(completed.output).toEqual({ copperOre: 1 });
    expect(completed.progressTicks).toBeCloseTo(0, 10);
  });

  it("reports no extractor rate without a resource node", () => {
    const state = createState([createExtractor()], FUNDED_CURRENCY);
    const entity = createExtractor({ resourceNode: undefined });

    expect(getExtractorRate(entity, state)).toBe(0);
  });
});

describe("level-adjusted processing", () => {
  it("halves the recipe duration at level two", () => {
    expect(getProcessDurationTicks(RECIPES.copperIngot, 1)).toBe(COPPER_INGOT_DURATION);
    expect(getProcessDurationTicks(RECIPES.copperIngot, 2)).toBe(COPPER_INGOT_DURATION / 2);
    expect(getProcessDurationTicks(RECIPES.copperIngot, 2)).toBe(10);
  });

  it("keeps the effective duration a whole number of recipe ticks", () => {
    for (const level of [1, 2, 3, 7, 20, 100]) {
      const duration = getProcessDurationTicks(RECIPES.motor, level);

      expect(Number.isInteger(duration)).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(1);
      expect(duration).toBeLessThanOrEqual(RECIPES.motor.durationTicks);
    }

    expect(getProcessDurationTicks(RECIPES.motor, 100)).toBe(1);
    expect(getProcessDurationTicks(RECIPES.motor, 1)).toBe(RECIPES.motor.durationTicks);
  });

  it("completes the recipe in half the ticks once upgraded", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const application = upgradeEntity(state, state.grid.entities[0].id);
    const entity = application.state.grid.entities[0];
    const runtime = createRuntime(entity, { input: { copperOre: 1 } });

    const running = tickProcessorTimes(runtime, entity, state, 9);
    expect(running.progressTicks).toBe(9);
    expect(running.output).toEqual({});
    expect(running.input).toEqual({});

    const completed = tickProcessor(running, entity, state);
    expect(completed.output).toEqual({ copperIngot: 1 });
    expect(completed.progressTicks).toBe(0);
    expect(completed.active).toBe(false);
  });

  it("charges inputs once when a run is shortened mid-flight", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const levelOne = state.grid.entities[0];
    const runtime = createRuntime(levelOne, { input: { copperOre: 1 } });

    const started = tickProcessor(runtime, levelOne, state);
    expect(started.progressTicks).toBe(1);
    expect(started.input).toEqual({});

    const application = upgradeEntity(state, levelOne.id);
    const upgraded = application.state.grid.entities[0];
    const inFlight = { ...started, entityId: upgraded.id };

    const completed = tickProcessorTimes(inFlight, upgraded, application.state, 9);
    expect(completed.output).toEqual({ copperIngot: 1 });
    expect(completed.input).toEqual({});

    const afterCompletion = tickProcessorTimes(completed, upgraded, application.state, 20);
    expect(afterCompletion.output).toEqual({ copperIngot: 1 });
    expect(afterCompletion.input).toEqual({});
    expect(afterCompletion.progressTicks).toBe(0);
  });

  it("still discards an in-flight run whose recipe becomes unresolvable", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const application = upgradeEntity(state, state.grid.entities[0].id);
    const entity = application.state.grid.entities[0];
    const running = tickProcessorTimes(
      createRuntime(entity, { input: { copperOre: 1 } }),
      entity,
      application.state,
      3,
    );
    expect(running.progressTicks).toBe(3);

    const relocked: SimulationState = {
      ...application.state,
      unlocked: { ...application.state.unlocked, recipes: [] },
    };
    const abandoned = tickProcessor(running, entity, relocked);

    expect(abandoned.progressTicks).toBe(0);
    expect(abandoned.active).toBe(false);
    expect(abandoned.input).toEqual({});
    expect(abandoned.output).toEqual({});
  });
});

describe("level-adjusted output capacity", () => {
  it("multiplies the machine output capacity by the level", () => {
    expect(getOutputCapacity(createSmelter())).toBe(SMELTER_OUTPUT_BUFFER);
    expect(getOutputCapacity(createSmelter({ level: 2 }))).toBe(SMELTER_OUTPUT_BUFFER * 2);
    expect(getOutputCapacity(createExtractor())).toBe(MACHINES.extractor.outputBuffer);
    expect(getOutputCapacity(createExtractor({ level: 2 }))).toBe(MACHINES.extractor.outputBuffer * 2);
  });

  it("keeps producing into a buffer that is full at level one", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const levelOne = state.grid.entities[0];
    const blocked = createRuntime(levelOne, {
      input: { copperOre: 1 },
      output: { copperIngot: SMELTER_OUTPUT_BUFFER },
    });

    const result = tickProcessor(blocked, levelOne, state);

    expect(result).toBe(blocked);
    expect(result.input).toEqual({ copperOre: 1 });
  });

  it("accepts a full result in the wider buffer after the upgrade", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const application = upgradeEntity(state, state.grid.entities[0].id);
    const entity = application.state.grid.entities[0];
    const full = createRuntime(entity, {
      input: { copperOre: 1 },
      output: { copperIngot: SMELTER_OUTPUT_BUFFER },
    });

    const result = tickProcessor(full, entity, application.state);

    expect(result.progressTicks).toBe(1);
    expect(result.input).toEqual({});
    expect(result.output).toEqual({ copperIngot: SMELTER_OUTPUT_BUFFER });
  });

  it("lets an extractor hold one more unit per level", () => {
    const state = createState([createExtractor()], FUNDED_CURRENCY);
    const application = upgradeEntity(state, state.grid.entities[0].id);
    const entity = application.state.grid.entities[0];
    const runtime = tickExtractorTimes(
      createMachineRuntime(entity),
      entity,
      state,
      20,
    );

    expect(runtime.output).toEqual({ copperOre: 2 });
  });
});

describe("level one regression", () => {
  it("keeps the base extractor rate, recipe duration, and output capacity", () => {
    const state = createState([createExtractor(), createSmelter()], FUNDED_CURRENCY);
    const extractor = createExtractor();
    const smelter = createSmelter();

    expect(getExtractorRate(extractor, state)).toBeCloseTo(1 / EXTRACTOR_INTERVAL, 12);
    expect(getProcessDurationTicks(RECIPES.copperIngot, 1)).toBe(COPPER_INGOT_DURATION);
    expect(getOutputCapacity(extractor)).toBe(MACHINES.extractor.outputBuffer);
    expect(getOutputCapacity(smelter)).toBe(SMELTER_OUTPUT_BUFFER);
    expect(getUpgradeCost(extractor)).toBe(EXTRACTOR_COST);
  });

  it("keeps the level one extractor on the full interval", () => {
    const state = createState([createExtractor()], FUNDED_CURRENCY);
    const entity = state.grid.entities[0];

    const early = tickExtractorTimes(createMachineRuntime(entity), entity, state, 19);
    expect(early.output).toEqual({});
    expect(early.progressTicks).toBeCloseTo(0.95, 10);

    const completed = tickExtractor(early, entity, state);
    expect(completed.output).toEqual({ copperOre: 1 });
    expect(completed.progressTicks).toBeCloseTo(0, 10);
  });

  it("keeps the level one recipe on the full duration and charges inputs once", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const entity = state.grid.entities[0];

    const running = tickProcessorTimes(
      createRuntime(entity, { input: { copperOre: 1 } }),
      entity,
      state,
      19,
    );
    expect(running.progressTicks).toBe(COPPER_INGOT_DURATION - 1);
    expect(running.output).toEqual({});
    expect(running.input).toEqual({});

    const completed = tickProcessor(running, entity, state);
    expect(completed.output).toEqual({ copperIngot: 1 });
    expect(completed.progressTicks).toBe(0);
  });

  it("keeps an unupgraded world on the same production numbers after a tick", () => {
    const smelter = createSmelter();
    const state = createState([smelter], FUNDED_CURRENCY);
    state.grid.machines[smelter.id] = {
      ...createMachineRuntime(smelter),
      input: { copperOre: 1 },
    };

    const next = advanceSimulation(state, COPPER_INGOT_DURATION);

    expect(next.grid.machines[smelter.id]?.output).toEqual({ copperIngot: 1 });
    expect(next.grid.machines[smelter.id]?.input).toEqual({});
    expect(next.grid.entities[0].level).toBe(1);
    expect(next.currency).toBe(FUNDED_CURRENCY);
  });
});

function createState(entities: Entity[], currency = FUNDED_CURRENCY): SimulationState {
  const state = createInitialState(1337);
  state.currency = currency;
  state.grid.nodes = [COPPER_NODE];
  state.grid.entities = entities;
  state.unlocked.recipes = ["copperIngot"];
  for (const entity of entities) {
    state.grid.machines[entity.id] = createMachineRuntime(entity);
  }
  return state;
}

function createExtractor(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "extractor-upgrade",
    type: "extractor",
    x: COPPER_NODE.x,
    y: COPPER_NODE.y,
    rotation: 0,
    level: 1,
    resourceNode: COPPER_NODE.resource,
    ...overrides,
  };
}

function createSmelter(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "smelter-upgrade",
    type: "smelter",
    x: 4,
    y: 6,
    rotation: 0,
    level: 1,
    recipeId: "copperIngot",
    ...overrides,
  };
}

function createRuntime(entity: Entity, overrides: Partial<MachineRuntime> = {}): MachineRuntime {
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

function tickProcessorTimes(
  runtime: MachineRuntime,
  entity: Entity,
  state: SimulationState,
  tickCount: number,
): MachineRuntime {
  let nextRuntime = runtime;
  for (let tick = 0; tick < tickCount; tick += 1) {
    nextRuntime = tickProcessor(nextRuntime, entity, state);
  }
  return nextRuntime;
}
