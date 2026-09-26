import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UNLOCKS } from "../../src/content/unlocks";
import {
  applyUnlock,
  canUnlock,
  canResetPrestige,
  getPermanentMultipliers,
  performPrestige,
} from "../../src/sim/commands";
import {
  NEW_GAME_TIMESTAMP,
  PRESTIGE_PRODUCTION_BONUS_PER_POINT,
  PRESTIGE_SELL_BONUS_PER_POINT,
  PRESTIGE_THRESHOLD,
  STARTING_CURRENCY,
} from "../../src/sim/constants";
import { sellResource } from "../../src/sim/economy";
import { createInitialState, createResetState } from "../../src/sim/initialState";
import { getExtractorRate } from "../../src/sim/machines";
import { calculatePrestigePoints, canPrestige } from "../../src/sim/prestige";
import { SimulationStore } from "../../src/sim/store";
import { loadSave, saveToStorage, serializeSave, type SaveStorage } from "../../src/persistence/save";
import type { Entity, PrestigeState, SimulationState } from "../../src/sim/types";

const AWARDED_POINTS = 2;
const ELIGIBLE_LIFETIME = 4 * PRESTIGE_THRESHOLD;
const REBUILT_MULTIPLIERS = {
  productionSpeed: 1 + AWARDED_POINTS * PRESTIGE_PRODUCTION_BONUS_PER_POINT,
  sellValue: 1 + AWARDED_POINTS * PRESTIGE_SELL_BONUS_PER_POINT,
};

const commandsSource = readFileSync(resolve(process.cwd(), "src", "sim", "commands.ts"), "utf8");
const storeSource = readFileSync(resolve(process.cwd(), "src", "sim", "store.ts"), "utf8");

describe("an ineligible prestige reset", () => {
  it("rejects a state one unit below the threshold and mutates nothing", () => {
    const state = eligibleState(PRESTIGE_THRESHOLD - 1);
    const before = structuredClone(state);

    const application = performPrestige(state);

    expect(application.result).toEqual({ ok: false, reason: "insufficientLifetimeCurrency" });
    expect(application.changed).toBe(false);
    expect(application.awardedPoints).toBeUndefined();
    expect(application.notification).toBeUndefined();
    expect(application.state).toBe(state);
    expect(application.state).toEqual(before);
  });

  it("rejects a fresh new game, which has no lifetime currency at all", () => {
    const state = createInitialState();

    expect(canPrestige(state)).toBe(false);
    const application = performPrestige(state);

    expect(application.result).toEqual({ ok: false, reason: "insufficientLifetimeCurrency" });
    expect(application.changed).toBe(false);
    expect(application.state).toBe(state);
    expect(state.prestige.points).toBe(0);
  });

  it("publishes nothing and keeps the same snapshot for a rejected reset", () => {
    const store = new SimulationStore(eligibleState(PRESTIGE_THRESHOLD - 1));
    const listener = vi.fn();
    const before = store.getSnapshot();
    store.subscribe(listener);

    const result = store.dispatch({ type: "prestige" });

    expect(result).toEqual({ ok: false, reason: "insufficientLifetimeCurrency" });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);

    const save = store.getSaveGame();

    expect(save.currency).toBe(7_500);
    expect(save.grid.entities).toHaveLength(3);
    expect(save.prestige.totalPrestiges).toBe(0);
  });

  it("reports the refusal through the shared preflight accessor as well", () => {
    const store = new SimulationStore(eligibleState(PRESTIGE_THRESHOLD - 1));

    expect(store.canResetPrestige()).toEqual({ ok: false, reason: "insufficientLifetimeCurrency" });
    expect(canResetPrestige(eligibleState(PRESTIGE_THRESHOLD - 1))).toEqual(
      store.canResetPrestige(),
    );
  });
});

describe("an eligible prestige reset", () => {
  it("clears the currency to the starting value and empties the built world", () => {
    const application = performPrestige(eligibleState());

    expect(application.result).toEqual({ ok: true });
    expect(application.changed).toBe(true);
    expect(application.state.currency).toBe(STARTING_CURRENCY);
    expect(application.state.grid.entities).toEqual([]);
    expect(application.state.grid.machines).toEqual({});
    expect(application.state.grid.belts).toEqual({});
    expect(application.state.lifetimeCurrency).toBe(0);
  });

  it("rebuilds the resource map from the fresh initial world rather than keeping the old one", () => {
    const state = eligibleState();
    state.grid.nodes = createInitialState(99).grid.nodes;

    const reset = performPrestige(state).state;
    const fresh = createInitialState();

    expect(reset.grid.nodes).toEqual(fresh.grid.nodes);
    expect(reset.grid.nodes).not.toEqual(state.grid.nodes);
    expect(reset.grid.nodes.length).toBeGreaterThan(0);
    expect(reset.grid.width).toBe(fresh.grid.width);
    expect(reset.grid.height).toBe(fresh.grid.height);
    expect(reset.grid.tileSizePx).toBe(fresh.grid.tileSizePx);
  });

  it("awards the lifetime points exactly once and increments the prestige count by one", () => {
    const application = performPrestige(eligibleState());

    expect(application.awardedPoints).toBe(AWARDED_POINTS);
    expect(application.awardedPoints).toBe(calculatePrestigePoints(ELIGIBLE_LIFETIME));
    expect(application.state.prestige.points).toBe(AWARDED_POINTS);
    expect(application.state.prestige.totalPrestiges).toBe(1);
  });

  it("leaves the state that was reset untouched", () => {
    const state = eligibleState();

    performPrestige(state);

    expect(state.currency).toBe(7_500);
    expect(state.lifetimeCurrency).toBe(ELIGIBLE_LIFETIME);
    expect(state.grid.entities).toHaveLength(3);
    expect(state.grid.machines["entity-1"]).toBeDefined();
    expect(state.grid.belts["entity-2"]).toBeDefined();
    expect(state.unlocked.machines).toEqual([
      "extractor",
      "belt",
      "depot",
      "smelter",
      "silo",
    ]);
    expect(state.unlocked.recipes).toEqual(["copperIngot"]);
    expect(state.prestige.points).toBe(0);
    expect(state.prestige.totalPrestiges).toBe(0);
  });

  it("publishes one snapshot carrying the rebuilt world and the new points", () => {
    const store = new SimulationStore(eligibleState());
    const listener = vi.fn();
    const before = store.getSnapshot();
    store.subscribe(listener);

    const result = store.dispatch({ type: "prestige" });

    expect(result).toEqual({ ok: true });
    expect(listener).toHaveBeenCalledTimes(1);

    const snapshot = store.getSnapshot();

    expect(snapshot).not.toBe(before);
    expect(snapshot.currency).toBe(STARTING_CURRENCY);
    expect(snapshot.prestigePoints).toBe(AWARDED_POINTS);
    expect(snapshot.prestigeReady).toBe(false);
    expect(snapshot.unlockedMachines).toEqual(["extractor", "belt", "depot"]);
    expect(snapshot.unlockedRecipes).toEqual([]);
    expect(snapshot.selectedEntity).toBeUndefined();
    expect(snapshot.notifications.map((notification) => notification.id)).toEqual(["prestige-1"]);
  });
});

describe("unlocks across a reset", () => {
  it("restores the free starting set instead of the paid unlocks", () => {
    const before = eligibleState();
    expect(before.unlocked.machines).toContain("smelter");
    expect(before.unlocked.recipes).toEqual(["copperIngot"]);

    const reset = performPrestige(before).state;

    expect(reset.unlocked).toEqual({ machines: UNLOCKS.machines, recipes: UNLOCKS.recipes });
  });

  it("makes a paid machine and its recipe purchasable again rather than already unlocked", () => {
    const reset = performPrestige(eligibleState()).state;
    const rebuildCost =
      UNLOCKS.machineUnlocks.smelter.cost + UNLOCKS.recipeUnlocks.copperIngot.cost;

    expect(canUnlock(reset, { kind: "machine", machine: "smelter" })).toEqual({ ok: true });
    expect(canUnlock(reset, { kind: "machine", machine: "silo" })).toEqual({ ok: true });
    expect(canUnlock(reset, { kind: "recipe", recipeId: "copperIngot" })).toEqual({
      ok: false,
      reason: "prerequisiteLocked",
    });

    const withSmelter = applyUnlock(
      earnCurrency(reset, rebuildCost),
      { kind: "machine", machine: "smelter" },
    );

    expect(withSmelter.result).toEqual({ ok: true });
    expect(withSmelter.state.currency).toBeGreaterThanOrEqual(
      UNLOCKS.recipeUnlocks.copperIngot.cost,
    );
    expect(canUnlock(withSmelter.state, { kind: "recipe", recipeId: "copperIngot" })).toEqual({
      ok: true,
    });
  });

  it("requires the paid machine to be purchased again before it can be built", () => {
    const store = new SimulationStore(eligibleState());
    store.dispatch({ type: "prestige" });

    expect(
      store.dispatch({ type: "placeEntity", machine: "silo", x: 30, y: 30, rotation: 0 }),
    ).toEqual({ ok: false, reason: "lockedMachine" });
    expect(store.dispatch({ type: "unlockMachine", machine: "silo" })).toEqual({ ok: true });
    expect(
      store.dispatch({ type: "placeEntity", machine: "silo", x: 30, y: 30, rotation: 0 }),
    ).toEqual({ ok: true });
  });
});

describe("permanent multipliers", () => {
  it("derives production speed and sell value from the awarded points", () => {
    const reset = performPrestige(eligibleState()).state;

    expect(getPermanentMultipliers(reset)).toEqual(REBUILT_MULTIPLIERS);
    expect(getPermanentMultipliers(reset).productionSpeed).toBeGreaterThan(1);
    expect(getPermanentMultipliers(reset).sellValue).toBeGreaterThan(1);
  });

  it("stores the same multipliers in the state, so the simulation and the getter cannot disagree", () => {
    const reset = performPrestige(eligibleState()).state;

    expect(reset.prestige.permanentMultipliers).toEqual(getPermanentMultipliers(reset));
  });

  it("exposes the same multipliers through the store", () => {
    const store = new SimulationStore(eligibleState());
    store.dispatch({ type: "prestige" });

    expect(store.getPermanentMultipliers()).toEqual(REBUILT_MULTIPLIERS);
    expect(getPermanentMultipliers(store.getSaveGame())).toEqual(REBUILT_MULTIPLIERS);
  });

  it("applies the rebuilt production speed to the extractor rate", () => {
    const before = eligibleState();
    const extractor = before.grid.entities[0];
    const reset = performPrestige(before).state;

    const rateBefore = getExtractorRate(extractor, before);
    const rateAfter = getExtractorRate(extractor, reset);

    expect(rateBefore).toBeGreaterThan(0);
    expect(rateAfter).toBeCloseTo(rateBefore * REBUILT_MULTIPLIERS.productionSpeed, 10);
  });

  it("applies the rebuilt sell value to a real sale", () => {
    const before = eligibleState();
    const reset = performPrestige(before).state;

    const saleBefore = sellResource("copperIngot", 4, before);
    const saleAfter = sellResource("copperIngot", 4, reset);

    expect(saleBefore.currency).toBe(24);
    expect(saleAfter.currency).toBeCloseTo(24 * REBUILT_MULTIPLIERS.sellValue, 10);
  });

  it("reads zero points as no bonus at all", () => {
    expect(getPermanentMultipliers(createInitialState())).toEqual({
      productionSpeed: 1,
      sellValue: 1,
    });
  });
});

describe("the award applies once", () => {
  it("does not compound across repeated reads of the multipliers", () => {
    const reset = performPrestige(eligibleState()).state;

    const first = getPermanentMultipliers(reset);
    const second = getPermanentMultipliers(reset);
    const third = getPermanentMultipliers(reset);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(reset.prestige.points).toBe(AWARDED_POINTS);
  });

  it("does not compound across ticks, reads, or a second refused dispatch", () => {
    const store = new SimulationStore(eligibleState());
    store.dispatch({ type: "prestige" });
    const first = store.getPermanentMultipliers();

    store.advanceTicks(200);
    const afterTicks = store.getPermanentMultipliers();

    expect(afterTicks).toEqual(first);
    expect(store.getSnapshot().prestigePoints).toBe(AWARDED_POINTS);
    expect(store.getSaveGame().prestige.totalPrestiges).toBe(1);

    const repeated = store.dispatch({ type: "prestige" });

    expect(repeated).toEqual({ ok: false, reason: "insufficientLifetimeCurrency" });
    expect(store.getPermanentMultipliers()).toEqual(first);
    expect(store.getSnapshot().prestigePoints).toBe(AWARDED_POINTS);
    expect(store.getSaveGame().prestige.totalPrestiges).toBe(1);
  });

  it("rejects a second reset of the same state object without touching it", () => {
    const reset = performPrestige(eligibleState()).state;
    const before = structuredClone(reset);

    const again = performPrestige(reset);

    expect(again.result).toEqual({ ok: false, reason: "insufficientLifetimeCurrency" });
    expect(again.changed).toBe(false);
    expect(again.state).toBe(reset);
    expect(again.state).toEqual(before);
  });

  it("rejects a second reset that was handed extra lifetime currency without spending it", () => {
    const reset = performPrestige(eligibleState()).state;
    const refilled = { ...reset, lifetimeCurrency: ELIGIBLE_LIFETIME };
    const before = structuredClone(refilled);

    const again = performPrestige(refilled);

    expect(again.result).toEqual({ ok: true });
    expect(again.state.prestige.points).toBe(AWARDED_POINTS * 2);
    expect(again.state.prestige.totalPrestiges).toBe(2);
    expect(again.state.currency).toBe(STARTING_CURRENCY);
    expect(again.state.lifetimeCurrency).toBe(0);
    expect(getPermanentMultipliers(again.state)).toEqual({
      productionSpeed: 1 + 2 * AWARDED_POINTS * PRESTIGE_PRODUCTION_BONUS_PER_POINT,
      sellValue: 1 + 2 * AWARDED_POINTS * PRESTIGE_SELL_BONUS_PER_POINT,
    });
    expect(refilled.prestige.points).toBe(before.prestige.points);
    expect(refilled.prestige.totalPrestiges).toBe(before.prestige.totalPrestiges);
  });
});

describe("two consecutive prestige resets", () => {
  it("awards once per reset, counting from the points already banked", () => {
    const first = performPrestige(eligibleState());
    const second = performPrestige(earnLifetimeCurrency(first.state, ELIGIBLE_LIFETIME));

    expect(first.state.prestige.points).toBe(AWARDED_POINTS);
    expect(first.state.prestige.totalPrestiges).toBe(1);
    expect(second.state.prestige.points).toBe(AWARDED_POINTS * 2);
    expect(second.state.prestige.totalPrestiges).toBe(2);
    expect(second.state.prestige.permanentMultipliers).toEqual({
      productionSpeed: 1 + 2 * AWARDED_POINTS * PRESTIGE_PRODUCTION_BONUS_PER_POINT,
      sellValue: 1 + 2 * AWARDED_POINTS * PRESTIGE_SELL_BONUS_PER_POINT,
    });
  });

  it("rebuilds the world a second time instead of compounding the first run", () => {
    const first = performPrestige(eligibleState());
    const second = performPrestige(earnLifetimeCurrency(first.state, ELIGIBLE_LIFETIME));

    expect(second.state.currency).toBe(STARTING_CURRENCY);
    expect(second.state.lifetimeCurrency).toBe(0);
    expect(second.state.grid.entities).toEqual([]);
    expect(second.state.grid.machines).toEqual({});
    expect(second.state.grid.belts).toEqual({});
    expect(second.state.unlocked).toEqual({ machines: UNLOCKS.machines, recipes: UNLOCKS.recipes });
    expect(second.state.notifications.map((notification) => notification.id)).toEqual([
      "prestige-2",
    ]);
  });

  it("is driven through the store across two full runs", () => {
    const store = new SimulationStore(eligibleState());

    expect(store.dispatch({ type: "prestige" })).toEqual({ ok: true });
    expect(store.getSaveGame().prestige.totalPrestiges).toBe(1);
    expect(store.getSnapshot().prestigeReady).toBe(false);

    const second = new SimulationStore(earnLifetimeCurrency(store.getSaveGame(), ELIGIBLE_LIFETIME));

    expect(second.dispatch({ type: "prestige" })).toEqual({ ok: true });
    expect(second.getSaveGame().prestige.totalPrestiges).toBe(2);
    expect(second.getSaveGame().prestige.points).toBe(AWARDED_POINTS * 2);
  });
});

describe("what a reset preserves", () => {
  it("keeps only the prestige block and discards every other run of state", () => {
    const reset = performPrestige(eligibleState()).state;
    const permanent = expectedPermanentPrestige();

    expect({ ...reset, notifications: [] }).toEqual({
      ...createInitialState(),
      prestige: permanent,
    });
    expect(reset.notifications).toHaveLength(1);
  });

  it("discards the run-scoped fields one by one", () => {
    const state = eligibleState();
    expect(state.productionChains["chain-entity-1"]).toBeDefined();

    const reset = performPrestige(state).state;

    expect(reset.currency).toBe(STARTING_CURRENCY);
    expect(reset.lifetimeCurrency).toBe(0);
    expect(reset.unlocked).toEqual({ machines: UNLOCKS.machines, recipes: UNLOCKS.recipes });
    expect(reset.grid.entities).toEqual([]);
    expect(reset.grid.machines).toEqual({});
    expect(reset.grid.belts).toEqual({});
    expect(reset.productionChains).toEqual({});
    expect(reset.nextEntitySequence).toBe(1);
    expect(reset.tickCount).toBe(0);
    expect(reset.currencySamples).toEqual([]);
    expect(reset.selectedEntityId).toBeUndefined();
    expect(reset.placementMode).toBeUndefined();
    expect(reset.pendingRotation).toBe(0);
    expect(reset.offlineSummary).toBeUndefined();
    expect(reset.lastSavedAt).toBe(NEW_GAME_TIMESTAMP);
  });

  it("reports the award in one notification stamped from the logical clock", () => {
    const reset = performPrestige(eligibleState()).state;
    const notification = reset.notifications[0];

    expect(notification).toEqual({
      id: "prestige-1",
      kind: "success",
      message: `Prestige complete: +${AWARDED_POINTS} prestige points`,
      createdAt: 512,
    });
  });

  it("builds the reset world through the one reset-state constructor", () => {
    const permanent = expectedPermanentPrestige();
    const built = createResetState(permanent);

    expect(built).toEqual({ ...createInitialState(), prestige: permanent });
    expect(built.prestige).not.toBe(permanent);
  });
});

describe("serializing the reset state", () => {
  it("serializes immediately after the dispatch with no dangling world records", () => {
    const store = new SimulationStore(eligibleState());
    const beforeSave = store.getSaveGame();
    expect(beforeSave.grid.entities).toHaveLength(3);

    store.dispatch({ type: "prestige" });

    const serialized = serializeSave(store.getSaveGame());
    const raw = JSON.parse(serialized) as {
      currency: number;
      lifetimeCurrency: number;
      lastSavedAt: number;
      prestige: PrestigeState;
      unlocked: { machines: string[]; recipes: string[] };
      grid: { entities: unknown[]; machines: unknown; belts: unknown };
      productionChains: unknown;
    };

    expect(raw.currency).toBe(STARTING_CURRENCY);
    expect(raw.lifetimeCurrency).toBe(0);
    expect(raw.lastSavedAt).toBe(NEW_GAME_TIMESTAMP);
    expect(raw.prestige.points).toBe(AWARDED_POINTS);
    expect(raw.prestige.totalPrestiges).toBe(1);
    expect(raw.unlocked).toEqual({ machines: UNLOCKS.machines, recipes: [] });
    expect(raw.grid.entities).toEqual([]);
    expect(raw.grid.machines).toEqual({});
    expect(raw.grid.belts).toEqual({});
    expect(raw.productionChains).toEqual({});
  });

  it("round-trips through storage and reloads as the rebuilt run", () => {
    const values = new Map<string, string>();
    const storage: SaveStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    const store = new SimulationStore(eligibleState());
    store.dispatch({ type: "prestige" });

    saveToStorage(storage, store.getSaveGame());

    const reloaded = loadSave(storage);

    expect(reloaded.currency).toBe(STARTING_CURRENCY);
    expect(reloaded.lifetimeCurrency).toBe(0);
    expect(reloaded.grid.entities).toEqual([]);
    expect(reloaded.unlocked).toEqual({ machines: UNLOCKS.machines, recipes: [] });
    expect(reloaded.prestige.totalPrestiges).toBe(1);
    expect(reloaded.prestige.points).toBe(AWARDED_POINTS);
    expect(getPermanentMultipliers(reloaded)).toEqual(REBUILT_MULTIPLIERS);
    expect(reloaded.prestige.permanentMultipliers).toEqual(REBUILT_MULTIPLIERS);
  });
});

describe("prestige reset wiring", () => {
  it("routes the preflight accessor and the dispatch through the same validator", () => {
    const store = new SimulationStore(eligibleState());

    expect(store.canResetPrestige()).toEqual({ ok: true });
    expect(store.dispatch({ type: "prestige" })).toEqual({ ok: true });
    expect(store.canResetPrestige()).toEqual({ ok: false, reason: "insufficientLifetimeCurrency" });
    expect(store.dispatch({ type: "prestige" })).toEqual(store.canResetPrestige());
  });

  it("keeps the eligibility rule in the prestige module instead of repeating the threshold", () => {
    expect(commandsSource).toMatch(/canPrestige\(state\)/);
    expect(commandsSource).not.toMatch(/lifetimeCurrency\s*>=\s*PRESTIGE_THRESHOLD/);
    expect(storeSource).not.toMatch(/lifetimeCurrency\s*>=\s*PRESTIGE_THRESHOLD/);
  });

  it("routes the store command to the command module rather than resetting inline", () => {
    expect(storeSource).toMatch(/case "prestige":/);
    expect(storeSource).toMatch(/return performPrestige\(this\.#state\)/);
    expect(storeSource).toMatch(/return canResetPrestige\(this\.#state\)/);
  });

  it("builds the reset world from the initial-state module", () => {
    expect(commandsSource).toMatch(/createResetState\(/);
  });
});

function expectedPermanentPrestige(): PrestigeState {
  return {
    points: AWARDED_POINTS,
    totalPrestiges: 1,
    permanentMultipliers: { ...REBUILT_MULTIPLIERS },
  };
}

function entity(
  id: string,
  type: Entity["type"],
  x: number,
  y: number,
  extra: Partial<Entity> = {},
): Entity {
  return { id, type, x, y, rotation: 0, level: 1, ...extra };
}

function eligibleState(lifetimeCurrency = ELIGIBLE_LIFETIME): SimulationState {
  const state = createInitialState();
  const extractor = entity("entity-1", "extractor", 40, 37, { resourceNode: "copperOre" });
  const belt = entity("entity-2", "belt", 41, 37);
  const depot = entity("entity-3", "depot", 42, 37);

  state.grid.entities = [extractor, belt, depot];
  state.grid.machines[extractor.id] = {
    entityId: extractor.id,
    progressTicks: 4,
    input: {},
    output: { copperOre: 1 },
    active: true,
    alreadyNotifiedBlocked: false,
    blockedRefusalTicks: 1,
  };
  state.grid.belts[belt.id] = { entityId: belt.id, item: "copperOre", progress: 0.5 };
  state.unlocked = {
    machines: ["extractor", "belt", "depot", "smelter", "silo"],
    recipes: ["copperIngot"],
  };
  state.currency = 7_500;
  state.lifetimeCurrency = lifetimeCurrency;
  state.productionChains = {
    "chain-entity-1": {
      id: "chain-entity-1",
      outputResource: "copperIngot",
      steadyStateThroughput: 4,
      sellValue: 24,
    },
  };
  state.nextEntitySequence = 4;
  state.tickCount = 512;
  state.currencySamples = [
    { tick: 512, amount: 1_200, entityId: depot.id, resource: "copperIngot" },
  ];
  state.selectedEntityId = extractor.id;
  state.placementMode = "extractor";
  state.pendingRotation = 90;
  state.notifications = [{ id: "notice-1", kind: "info", message: "Welcome", createdAt: 4 }];
  state.offlineSummary = {
    elapsedSeconds: 120,
    cappedSeconds: 120,
    earnedCurrency: 900,
    chainUnits: { copperIngot: 120 },
  };

  return state;
}

function earnLifetimeCurrency(state: SimulationState, target: number): SimulationState {
  return earnBySelling(state, (current) => current.lifetimeCurrency, target);
}

function earnCurrency(state: SimulationState, target: number): SimulationState {
  return earnBySelling(state, (current) => current.currency, target);
}

function earnBySelling(
  state: SimulationState,
  measured: (current: SimulationState) => number,
  target: number,
): SimulationState {
  let current = state;
  let sales = 0;

  while (measured(current) < target && sales < 100_000) {
    current = sellResource("copperIngot", 1, current).state;
    sales += 1;
  }

  expect(measured(current)).toBeGreaterThanOrEqual(target);
  return current;
}
