import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import type { ResourceId } from "../../src/sim/types";

const COPPER_NODE = { x: 20, y: 21, resource: "copperOre" as ResourceId };

function buildChain(store: SimulationStore): void {
  expect(
    store.dispatch({
      type: "placeEntity",
      machine: "extractor",
      x: COPPER_NODE.x,
      y: COPPER_NODE.y,
      rotation: 0,
      resourceNode: COPPER_NODE.resource,
    }),
  ).toEqual({ ok: true });
  expect(
    store.dispatch({
      type: "placeEntity",
      machine: "belt",
      x: COPPER_NODE.x + 1,
      y: COPPER_NODE.y,
      rotation: 0,
    }),
  ).toEqual({ ok: true });
  expect(
    store.dispatch({
      type: "placeEntity",
      machine: "depot",
      x: COPPER_NODE.x + 2,
      y: COPPER_NODE.y,
      rotation: 0,
    }),
  ).toEqual({ ok: true });
}

describe("Phase 0 raw production", () => {
  it("builds an Extractor -> Belt -> Depot chain through public commands and sells an item", () => {
    const store = new SimulationStore(createInitialState());

    buildChain(store);
    const postBuildSnapshot = store.getSnapshot();
    const postBuildCurrency = postBuildSnapshot.currency;

    store.advanceTicks(25);

    expect(store.getSnapshot().currency).toBeGreaterThan(postBuildCurrency);
  });

  it("rejects a second placement on an occupied cell without publishing", () => {
    const store = new SimulationStore(createInitialState());
    const listener = vi.fn();
    store.subscribe(listener);

    buildChain(store);
    const snapshotAfterBuild = store.getSnapshot();
    listener.mockClear();

    const result = store.dispatch({
      type: "placeEntity",
      machine: "belt",
      x: COPPER_NODE.x + 1,
      y: COPPER_NODE.y,
      rotation: 0,
    });

    expect(result).toEqual({ ok: false, reason: "occupied" });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(snapshotAfterBuild);
  });
});
