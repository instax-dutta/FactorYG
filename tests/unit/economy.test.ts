import { describe, expect, it } from "vitest";
import { createMachineRuntime } from "../../src/sim/machines";
import { createInitialState } from "../../src/sim/initialState";
import { getCurrencyPerSecond, sellResource } from "../../src/sim/economy";
import { createSnapshot } from "../../src/sim/snapshot";
import { SimulationStore } from "../../src/sim/store";
import { advanceSimulation } from "../../src/sim/tick";
import type { Entity, RenderEvent, ResourceId, SimulationState } from "../../src/sim/types";

describe("sellResource", () => {
  it("sells a resource at its canonical base value and updates lifetime currency", () => {
    const state = createInitialState();

    const sale = sellResource("copperOre", 1, state);

    expect(sale.state).not.toBe(state);
    expect(sale).toMatchObject({ resource: "copperOre", amount: 1, currency: 1 });
    expect(sale.state.currency).toBe(501);
    expect(sale.state.lifetimeCurrency).toBe(1);
    expect(state.currency).toBe(500);
    expect(state.lifetimeCurrency).toBe(0);
  });

  it("applies the permanent sell multiplier to the canonical resource value", () => {
    const state = createInitialState();
    state.prestige.permanentMultipliers.sellValue = 2.5;

    const sale = sellResource("coal", 2, state);

    expect(sale.currency).toBe(10);
    expect(sale.state.currency).toBe(510);
    expect(sale.state.lifetimeCurrency).toBe(10);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "is a no-op for invalid amount %s",
    (amount) => {
      const state = createInitialState();

      const sale = sellResource("copperOre", amount, state);

      expect(sale).toEqual({ state, resource: "copperOre", amount: 0, currency: 0 });
    },
  );

  it("is a no-op for an unknown resource", () => {
    const state = createInitialState();

    const sale = sellResource("unobtanium" as ResourceId, 1, state);

    expect(sale).toEqual({ state, resource: "unobtanium", amount: 0, currency: 0 });
  });
});

describe("depot sales", () => {
  it("debits delivered input once and emits one positioned sale event", () => {
    const depot = createEntity("depot-test", "depot", 7, 9);
    const state = createDepotState(depot, 2);
    const events: RenderEvent[] = [];

    const first = advanceSimulation(state, 1, events);
    const second = advanceSimulation(first, 1, events);

    expect(first.grid.machines[depot.id]?.input).toEqual({});
    expect(first.currency).toBe(502);
    expect(first.lifetimeCurrency).toBe(2);
    expect(second.grid.machines[depot.id]?.input).toEqual({});
    expect(second.currency).toBe(502);
    expect(second.lifetimeCurrency).toBe(2);
    expect(events.filter((event) => event.type === "saleCompleted")).toEqual([
      {
        type: "saleCompleted",
        entityId: depot.id,
        resource: "copperOre",
        currency: 2,
        worldX: 480,
        worldY: 608,
      },
    ]);
    expect(state.grid.machines[depot.id]?.input).toEqual({ copperOre: 2 });
  });

  it("debits multiple resource inputs exactly once in one tick", () => {
    const depot = createEntity("depot-test", "depot", 1, 1);
    const state = createDepotState(depot, 1);
    state.grid.machines[depot.id].input = { copperOre: 1, ironOre: 1 };
    const events: RenderEvent[] = [];

    const first = advanceSimulation(state, 1, events);
    const second = advanceSimulation(first, 1, events);

    expect(first.grid.machines[depot.id]?.input).toEqual({});
    expect(first.currency).toBe(502);
    expect(first.lifetimeCurrency).toBe(2);
    expect(second.currency).toBe(502);
    expect(second.lifetimeCurrency).toBe(2);
    expect(events.filter((event) => event.type === "saleCompleted")).toHaveLength(2);
  });

  it("retains raw items that are not connected to a depot", () => {
    const extractor = createEntity("extractor-test", "extractor", 10, 10, 0, "copperOre");
    const state = createInitialState();
    state.grid.entities = [extractor];
    state.grid.machines[extractor.id] = createMachineRuntime(extractor);
    const events: RenderEvent[] = [];

    const next = advanceSimulation(state, 20, events);

    expect(next.grid.machines[extractor.id]?.output).toEqual({ copperOre: 1 });
    expect(next.currency).toBe(500);
    expect(next.lifetimeCurrency).toBe(0);
    expect(events.some((event) => event.type === "saleCompleted")).toBe(false);
  });
});

describe("currency rate accounting", () => {
  it("initializes runtime tick and sample bookkeeping outside the snapshot", () => {
    const state = createInitialState();

    expect(state.tickCount).toBe(0);
    expect(state.currencySamples).toEqual([]);
    expect(createSnapshot(state)).not.toHaveProperty("tickCount");
    expect(createSnapshot(state)).not.toHaveProperty("currencySamples");
  });

  it("returns zero until a full 100-tick window exists", () => {
    const depot = createEntity("depot-test", "depot", 1, 1);
    const state = createDepotState(depot, 1);

    const afterSale = advanceSimulation(state, 1);

    expect(afterSale.tickCount).toBe(1);
    expect(afterSale.currencySamples).toEqual([{ tick: 1, amount: 1 }]);
    expect(getCurrencyPerSecond(afterSale)).toBe(0);
    expect(createSnapshot(afterSale).currencyPerSecond).toBe(0);
  });

  it("computes the rate from the latest ten-second window", () => {
    const depot = createEntity("depot-test", "depot", 1, 1);
    const state = createDepotState(depot, 1);

    const afterSale = advanceSimulation(state, 1);
    const afterWindow = advanceSimulation(afterSale, 99);

    expect(afterWindow.tickCount).toBe(100);
    expect(getCurrencyPerSecond(afterWindow)).toBe(0.1);
    expect(createSnapshot(afterWindow).currencyPerSecond).toBe(0.1);
  });

  it("prunes samples outside the latest 100 ticks", () => {
    const depot = createEntity("depot-test", "depot", 1, 1);
    const state = createDepotState(depot, 1);
    const afterWindow = advanceSimulation(advanceSimulation(state, 1), 99);
    afterWindow.grid.machines[depot.id] = {
      ...afterWindow.grid.machines[depot.id],
      input: { copperOre: 1 },
    };

    const next = advanceSimulation(afterWindow, 1);

    expect(next.tickCount).toBe(101);
    expect(next.currencySamples).toEqual([{ tick: 101, amount: 1 }]);
    expect(getCurrencyPerSecond(next)).toBe(0.1);
  });

  it("returns zero after all sale samples age out", () => {
    const depot = createEntity("depot-test", "depot", 1, 1);
    const state = createDepotState(depot, 1);
    const afterWindow = advanceSimulation(advanceSimulation(state, 1), 99);

    const aged = advanceSimulation(afterWindow, 100);

    expect(aged.tickCount).toBe(200);
    expect(aged.currencySamples).toEqual([]);
    expect(getCurrencyPerSecond(aged)).toBe(0);
  });

  it("publishes a new store snapshot when the computed rate changes", () => {
    const depot = createEntity("depot-test", "depot", 1, 1);
    const state = createDepotState(depot, 1);
    const store = new SimulationStore(state);
    const initialSnapshot = store.getSnapshot();

    store.advanceTicks(100);

    expect(store.getSnapshot()).not.toBe(initialSnapshot);
    expect(store.getSnapshot().currencyPerSecond).toBe(0.1);
  });
});

function createDepotState(depot: Entity, amount: number): SimulationState {
  const state = createInitialState();
  state.grid.entities = [depot];
  state.grid.machines[depot.id] = createMachineRuntime(depot);
  state.grid.machines[depot.id].input = { copperOre: amount };
  return state;
}

function createEntity(
  id: string,
  type: Entity["type"],
  x: number,
  y: number,
  rotation: Entity["rotation"] = 0,
  resourceNode?: ResourceId,
): Entity {
  return {
    id,
    type,
    x,
    y,
    rotation,
    level: 1,
    ...(resourceNode === undefined ? {} : { resourceNode }),
  };
}
