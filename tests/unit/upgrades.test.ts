import { describe, expect, it, vi } from "vitest";
import { MACHINES, getMachineUpgradeCost, isLevelAffected } from "../../src/content/machines";
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
import { SimulationStore } from "../../src/sim/store";
import { advanceSimulation, createRuntimeRecords } from "../../src/sim/tick";
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
const EXTRACTOR_ID = "extractor-upgrade";
const SMELTER_ID = "smelter-upgrade";
const LEVEL_AFFECTED_TYPES: MachineType[] = ["extractor", "smelter", "assembler"];

describe("upgrade cost table", () => {
  it("prices a level with baseCost * level * level from the machine table", () => {
    expect(getMachineUpgradeCost("smelter", 1)).toBe(SMELTER_COST);
    expect(getMachineUpgradeCost("smelter", 2)).toBe(SMELTER_COST * 4);
    expect(getMachineUpgradeCost("smelter", 2)).toBe(1_000);
    expect(getMachineUpgradeCost("smelter", 3)).toBe(SMELTER_COST * 9);
    expect(getMachineUpgradeCost("extractor", 2)).toBe(EXTRACTOR_COST * 4);
  });

  it("rises strictly at every level for every machine a level can affect", () => {
    const types = (Object.keys(MACHINES) as MachineType[]).filter(isLevelAffected);

    expect(types).toEqual(LEVEL_AFFECTED_TYPES);
    for (const type of types) {
      const costs = [1, 2, 3, 4, 5].map((level) => getMachineUpgradeCost(type, level));

      expect(costs).toEqual([...costs].sort((left, right) => left - right));
      expect(new Set(costs).size).toBe(costs.length);
      expect(costs.every((cost) => cost > 0)).toBe(true);
    }
  });

  it("reads a level below one as level one and floors a fractional level", () => {
    const levelOne = getMachineUpgradeCost("extractor", 1);

    expect(getMachineUpgradeCost("extractor", 0)).toBe(levelOne);
    expect(getMachineUpgradeCost("extractor", -2)).toBe(levelOne);
    expect(getMachineUpgradeCost("extractor", Number.NaN)).toBe(levelOne);
    expect(getMachineUpgradeCost("extractor", 1.9)).toBe(levelOne);
    expect(getMachineUpgradeCost("extractor", 2.9)).toBe(getMachineUpgradeCost("extractor", 2));
  });

  it("reads the level from the selected entity", () => {
    expect(getUpgradeCost(createExtractor())).toBe(EXTRACTOR_COST);
    expect(getUpgradeCost(createExtractor({ level: 2 }))).toBe(EXTRACTOR_COST * 4);
    expect(getUpgradeCost(createSmelter())).toBe(SMELTER_COST);
    expect(getUpgradeCost(createSmelter({ level: 3 }))).toBe(SMELTER_COST * 9);
  });
});

describe("machine type gate", () => {
  it("treats only extractors and recipe machines as level-affected", () => {
    expect(isLevelAffected("extractor")).toBe(true);
    expect(isLevelAffected("smelter")).toBe(true);
    expect(isLevelAffected("assembler")).toBe(true);
    expect(isLevelAffected("belt")).toBe(false);
    expect(isLevelAffected("depot")).toBe(false);
    expect(isLevelAffected("silo")).toBe(false);
    expect(isLevelAffected("not-a-machine")).toBe(false);
  });

  it.each(["belt", "depot", "silo"] as const)(
    "refuses a %s upgrade and changes nothing",
    (type) => {
      const entity = createConsumer(type);
      const state = createState([entity], FUNDED_CURRENCY);
      const before = structuredClone(state);

      expect(canUpgrade(state, entity.id)).toEqual({ ok: false, reason: "unsupportedMachine" });

      const application = upgradeEntity(state, entity.id);

      expect(application.result).toEqual({ ok: false, reason: "unsupportedMachine" });
      expect(application.changed).toBe(false);
      expect(application.state).toBe(state);
      expect(application.notification).toBeUndefined();
      expect(state.currency).toBe(before.currency);
      expect(state.grid.entities[0].level).toBe(1);
    },
  );

  it("reports the machine gate before the balance", () => {
    const state = createState([createConsumer("belt")], 0);

    expect(canUpgrade(state, state.grid.entities[0].id)).toEqual({
      ok: false,
      reason: "unsupportedMachine",
    });
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

  it("moves the level and the balance together in one committed state", () => {
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

  it("mutates neither currency nor the entity when the currency is insufficient", () => {
    const state = createState([createExtractor()], EXTRACTOR_COST - 1);
    const before = structuredClone(state);

    const application = upgradeEntity(state, state.grid.entities[0].id);

    expect(application.result).toEqual({ ok: false, reason: "insufficientCurrency" });
    expect(application.changed).toBe(false);
    expect(application.state).toBe(state);
    expect(application.notification).toBeUndefined();
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
    expect(application.notification).toBeUndefined();
    expect(state.currency).toBe(FUNDED_CURRENCY);
  });

  it("commits a success notification keyed by the entity and the logical tick", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    state.tickCount = 42;

    const application = upgradeEntity(state, state.grid.entities[0].id);

    expect(application.notification).toEqual({
      id: `upgrade-${SMELTER_ID}`,
      kind: "success",
      message: "Upgraded smelter to level 2",
      createdAt: 42,
    });
    expect(application.state.notifications).toEqual([application.notification]);
    expect(state.notifications).toEqual([]);
  });

  it("writes a whole level for a fractional level and charges the normalized price", () => {
    const state = createState([createSmelter({ level: 1.5 })], FUNDED_CURRENCY);

    const application = upgradeEntity(state, state.grid.entities[0].id);

    expect(application.result).toEqual({ ok: true });
    expect(application.state.grid.entities[0].level).toBe(2);
    expect(Number.isInteger(application.state.grid.entities[0].level)).toBe(true);
    expect(application.state.currency).toBe(FUNDED_CURRENCY - SMELTER_COST);
  });

  it("leaves other entities, buffers, and belts untouched", () => {
    const smelter = createSmelter();
    const belt = createConsumer("belt", { id: "belt-upgrade" });
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

describe("store integration", () => {
  it("applies an upgrade through the command route and publishes one snapshot", () => {
    const store = new SimulationStore(createState([createExtractor()], FUNDED_CURRENCY));
    store.dispatch({ type: "selectEntity", entityId: EXTRACTOR_ID });
    const listener = vi.fn();
    const before = store.getSnapshot();
    store.subscribe(listener);

    expect(store.dispatch({ type: "upgradeEntity", entityId: EXTRACTOR_ID })).toEqual({ ok: true });
    expect(listener).toHaveBeenCalledTimes(1);

    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.currency).toBe(FUNDED_CURRENCY - EXTRACTOR_COST);
    expect(after.selectedEntity?.level).toBe(2);
    expect(after.notifications).toHaveLength(1);
    expect(after.notifications[0]).toMatchObject({
      id: `upgrade-${EXTRACTOR_ID}`,
      kind: "success",
    });
    expect(before.currency).toBe(FUNDED_CURRENCY);
    expect(before.selectedEntity?.level).toBe(1);
  });

  it("agrees with the shared preflight for every rejection reason", () => {
    const store = new SimulationStore(createState([createConsumer("belt")], 0));

    expect(store.canUpgrade("belt-upgrade")).toEqual({ ok: false, reason: "unsupportedMachine" });
    expect(store.canUpgrade("entity-missing")).toEqual({ ok: false, reason: "entityNotFound" });
    expect(store.dispatch({ type: "upgradeEntity", entityId: "belt-upgrade" })).toEqual({
      ok: false,
      reason: "unsupportedMachine",
    });

    const poor = new SimulationStore(createState([createExtractor()], EXTRACTOR_COST - 1));
    expect(poor.canUpgrade(EXTRACTOR_ID)).toEqual({ ok: false, reason: "insufficientCurrency" });
    expect(poor.dispatch({ type: "upgradeEntity", entityId: EXTRACTOR_ID })).toEqual({
      ok: false,
      reason: "insufficientCurrency",
    });
  });

  it("publishes no snapshot and no notification for a rejected upgrade", () => {
    const store = new SimulationStore(createState([createExtractor()], EXTRACTOR_COST - 1));
    const listener = vi.fn();
    const before = store.getSnapshot();
    store.subscribe(listener);

    expect(store.dispatch({ type: "upgradeEntity", entityId: EXTRACTOR_ID })).toEqual({
      ok: false,
      reason: "insufficientCurrency",
    });
    expect(store.dispatch({ type: "upgradeEntity", entityId: "entity-missing" })).toEqual({
      ok: false,
      reason: "entityNotFound",
    });

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().currency).toBe(EXTRACTOR_COST - 1);
    expect(store.getSnapshot().notifications).toEqual([]);
  });

  it("keeps a successful upgrade in the save projection", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const store = new SimulationStore(state);
    const runtimeBefore = state.grid.machines[SMELTER_ID];

    expect(store.dispatch({ type: "upgradeEntity", entityId: SMELTER_ID })).toEqual({ ok: true });

    const save = store.getSaveGame();
    expect(save.grid.entities[0].level).toBe(2);
    expect(save.currency).toBe(FUNDED_CURRENCY - SMELTER_COST);
    expect(save.grid.machines[SMELTER_ID]).toEqual(runtimeBefore);
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

  it("keeps raising the extractor rate above the table interval", () => {
    const state = createState([createExtractor({ level: 40 })], FUNDED_CURRENCY);
    const entity = state.grid.entities[0];

    expect(getExtractorRate(createExtractor({ level: 20 }), state)).toBe(1);
    expect(getExtractorRate(entity, state)).toBe(2);
  });

  it("emits more than one unit per tick above the table interval", () => {
    const state = createState([createExtractor({ level: 40 })], FUNDED_CURRENCY);
    const entity = state.grid.entities[0];
    let runtime = createMachineRuntime(entity);

    for (let tick = 1; tick <= 3; tick += 1) {
      runtime = tickExtractor(runtime, entity, state);

      expect(runtime.output).toEqual({ copperOre: tick * 2 });
      expect(runtime.progressTicks).toBeLessThan(1);
      expect(runtime.active).toBe(true);
    }
  });

  it("emits only as many units per tick as the output buffer can accept", () => {
    const state = createState([createExtractor({ level: 40 })], FUNDED_CURRENCY);
    const entity = state.grid.entities[0];
    const capacity = getOutputCapacity(entity);
    const nearlyFull = createRuntime(entity, { output: { copperOre: capacity - 1 } });

    const result = tickExtractor(nearlyFull, entity, state);

    expect(result.output).toEqual({ copperOre: capacity });
    expect(result.progressTicks).toBeLessThan(1);
    expect(result.active).toBe(true);
  });

  it("pauses progress while the output buffer is full and resumes from the saved remainder", () => {
    const state = createState([createExtractor({ level: 40 })], FUNDED_CURRENCY);
    const entity = state.grid.entities[0];
    const blocked = createRuntime(entity, {
      progressTicks: 0.5,
      output: { copperOre: getOutputCapacity(entity) },
      active: true,
    });

    const stillBlocked = tickExtractor(blocked, entity, state);

    expect(stillBlocked.progressTicks).toBe(0.5);
    expect(stillBlocked.output).toEqual({ copperOre: getOutputCapacity(entity) });
    expect(stillBlocked.active).toBe(false);

    const resumed = tickExtractor({ ...stillBlocked, output: {} }, entity, state);

    expect(resumed.output).toEqual({ copperOre: 2 });
    expect(resumed.progressTicks).toBeCloseTo(0.5, 10);
    expect(resumed.active).toBe(true);
  });

  it("keeps a high level extractor producing more than one unit per tick through the tick loop", () => {
    const state = createState([createExtractor({ level: 40 })], FUNDED_CURRENCY);
    const entity = state.grid.entities[0];

    const next = advanceSimulation(state, 3);

    expect(next.grid.machines[entity.id]?.output).toEqual({ copperOre: 6 });
    expect(next.grid.machines[entity.id]?.progressTicks).toBeLessThan(1);
  });

  it("reports no extractor rate without a resource node", () => {
    const state = createState([createExtractor()], FUNDED_CURRENCY);
    const entity = createExtractor({ resourceNode: undefined });

    expect(getExtractorRate(entity, state)).toBe(0);
  });
});

describe("level-adjusted processing", () => {
  it("halves the recipe duration at level two", () => {
    expect(getProcessDurationTicks(createSmelter(), RECIPES.copperIngot)).toBe(COPPER_INGOT_DURATION);
    expect(getProcessDurationTicks(createSmelter({ level: 2 }), RECIPES.copperIngot)).toBe(
      COPPER_INGOT_DURATION / 2,
    );
    expect(getProcessDurationTicks(createSmelter({ level: 2 }), RECIPES.copperIngot)).toBe(10);
  });

  it("keeps the effective duration a whole number of recipe ticks", () => {
    for (const level of [1, 2, 3, 7, 20, 100]) {
      const duration = getProcessDurationTicks(createSmelter({ level }), RECIPES.motor);

      expect(Number.isInteger(duration)).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(1);
      expect(duration).toBeLessThanOrEqual(RECIPES.motor.durationTicks);
    }

    expect(getProcessDurationTicks(createSmelter({ level: 100 }), RECIPES.motor)).toBe(1);
    expect(getProcessDurationTicks(createSmelter(), RECIPES.motor)).toBe(RECIPES.motor.durationTicks);
  });

  it("completes the recipe in half the ticks once upgraded", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const application = upgradeEntity(state, state.grid.entities[0].id);
    const entity = application.state.grid.entities[0];
    const runtime = createRuntime(entity, { input: { copperOre: 1 } });

    const running = tickProcessorTimes(runtime, entity, state, 9);
    expect(running.progressTicks).toBe(9);
    expect(running.output).toEqual({});

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

    const completed = tickProcessorTimes(started, upgraded, application.state, 9);
    expect(completed.output).toEqual({ copperIngot: 1 });
    expect(completed.input).toEqual({});

    const afterCompletion = tickProcessorTimes(completed, upgraded, application.state, 20);
    expect(afterCompletion.output).toEqual({ copperIngot: 1 });
    expect(afterCompletion.input).toEqual({});
    expect(afterCompletion.progressTicks).toBe(0);
  });

  it("discards an in-flight run when the recipe becomes unresolvable and charges the next run again", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const entity = state.grid.entities[0];
    const running = tickProcessorTimes(
      createRuntime(entity, { input: { copperOre: 2 } }),
      entity,
      state,
      3,
    );
    expect(running.progressTicks).toBe(3);
    expect(running.input).toEqual({ copperOre: 1 });

    const relocked: SimulationState = {
      ...state,
      unlocked: { ...state.unlocked, recipes: [] },
    };
    const abandoned = tickProcessor(running, entity, relocked);

    expect(abandoned.progressTicks).toBe(0);
    expect(abandoned.active).toBe(false);
    expect(abandoned.input).toEqual({ copperOre: 1 });

    const relockedAgain: SimulationState = {
      ...state,
      grid: {
        ...state.grid,
        machines: { ...state.grid.machines, [entity.id]: abandoned },
      },
      unlocked: { ...state.unlocked, recipes: ["copperIngot"] },
    };
    const repaid = tickProcessor(abandoned, entity, relockedAgain);

    expect(repaid.progressTicks).toBe(1);
    expect(repaid.active).toBe(true);
    expect(repaid.input).toEqual({});
  });
});

describe("level-adjusted output capacity", () => {
  it("multiplies the machine output capacity by the level", () => {
    expect(getOutputCapacity(createSmelter())).toBe(SMELTER_OUTPUT_BUFFER);
    expect(getOutputCapacity(createSmelter({ level: 2 }))).toBe(SMELTER_OUTPUT_BUFFER * 2);
    expect(getOutputCapacity(createExtractor())).toBe(MACHINES.extractor.outputBuffer);
    expect(getOutputCapacity(createExtractor({ level: 2 }))).toBe(MACHINES.extractor.outputBuffer * 2);
  });

  it("refuses to start a run whose result cannot fit the level one buffer", () => {
    const state = createState([createSmelter()], FUNDED_CURRENCY);
    const levelOne = state.grid.entities[0];
    const blocked = createRuntime(levelOne, {
      input: { copperOre: 1 },
      output: { copperIngot: SMELTER_OUTPUT_BUFFER },
    });

    const result = tickProcessor(blocked, levelOne, state);

    expect(result).toBe(blocked);
    expect(result.progressTicks).toBe(0);
    expect(result.input).toEqual({ copperOre: 1 });
    expect(result.output).toEqual({ copperIngot: SMELTER_OUTPUT_BUFFER });
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
    expect(getProcessDurationTicks(smelter, RECIPES.copperIngot)).toBe(COPPER_INGOT_DURATION);
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
  const records = createRuntimeRecords(entities);
  state.grid.machines = records.machines;
  state.grid.belts = records.belts;
  return state;
}

function createExtractor(overrides: Partial<Entity> = {}): Entity {
  return {
    id: EXTRACTOR_ID,
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
    id: SMELTER_ID,
    type: "smelter",
    x: 4,
    y: 6,
    rotation: 0,
    level: 1,
    recipeId: "copperIngot",
    ...overrides,
  };
}

function createConsumer(
  type: "belt" | "depot" | "silo",
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id: `${type}-upgrade`,
    type,
    x: 8,
    y: 9,
    rotation: 0,
    level: 1,
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
