// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { SAVE_KEY } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import type { SaveStorage } from "../../src/persistence/save";
import { createRuntimeAutosave, projectRuntimeSave } from "../../src/app/runtime";
import type { ResourceId, SaveGame, SimulationState } from "../../src/sim/types";

const COPPER_NODE = { x: 40, y: 37 };

function createMemoryStorage(): SaveStorage & { setCount: number } {
  const values = new Map<string, string>();
  const storage = {
    setCount: 0,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
      storage.setCount += 1;
    },
  };
  return storage;
}

function readSave(storage: SaveStorage): SaveGame {
  const raw = storage.getItem(SAVE_KEY);
  if (raw === null) {
    throw new Error("Expected a persisted save");
  }
  return JSON.parse(raw) as SaveGame;
}

function createStore(): SimulationStore {
  return new SimulationStore(createInitialState(1337));
}

function buildChain(store: SimulationStore, resource: ResourceId): void {
  const results = [
    store.dispatch({
      type: "placeEntity",
      machine: "extractor",
      x: COPPER_NODE.x,
      y: COPPER_NODE.y,
      rotation: 0,
      resourceNode: resource,
    }),
    store.dispatch({
      type: "placeEntity",
      machine: "belt",
      x: COPPER_NODE.x + 1,
      y: COPPER_NODE.y,
      rotation: 0,
    }),
    store.dispatch({
      type: "placeEntity",
      machine: "depot",
      x: COPPER_NODE.x + 2,
      y: COPPER_NODE.y,
      rotation: 0,
    }),
  ];
  for (const result of results) {
    if (!result.ok) {
      throw new Error(`Failed to place raw chain part: ${result.reason ?? "unknown"}`);
    }
  }
}

describe("store save projection", () => {
  it("exposes a decoupled SaveGame view of runtime state", () => {
    const store = createStore();
    store.dispatch({ type: "setPlacementMode", machine: "extractor" });
    store.advanceTicks(3);

    const save = store.getSaveGame();

    expect(save.currency).toBe(500);
    expect(save.grid.entities).toEqual([]);

    save.currency = 1;
    save.grid.entities.push({
      id: "entity-1",
      type: "belt",
      x: 1,
      y: 1,
      rotation: 0,
      level: 1,
    });

    expect(store.getSaveGame().currency).toBe(500);
    expect(store.getSaveGame().grid.entities).toEqual([]);
  });

  it("projects the save without runtime-only fields and anchors lastSavedAt", () => {
    const state: SimulationState = createInitialState(1337);
    state.tickCount = 42;
    state.nextEntitySequence = 7;
    state.selectedEntityId = "entity-1";
    state.placementMode = "belt";
    state.pendingRotation = 90;
    state.currencySamples = [{ tick: 1, amount: 5 }];
    state.notifications = [{ id: "n1", kind: "info", message: "hi", createdAt: 3 }];
    state.offlineSummary = {
      elapsedSeconds: 120,
      cappedSeconds: 120,
      earnedCurrency: 10,
      chainUnits: { copperIngot: 120 },
    };

    const projection = projectRuntimeSave(state, 5_000);

    expect(projection.lastSavedAt).toBe(5_000);
    expect(Object.keys(projection).sort()).toEqual([
      "currency",
      "grid",
      "lastSavedAt",
      "lifetimeCurrency",
      "prestige",
      "productionChains",
      "unlocked",
      "version",
    ]);
    expect(Object.keys(projection.grid).sort()).toEqual([
      "belts",
      "entities",
      "height",
      "machines",
      "nodes",
      "tileSizePx",
      "width",
    ]);
  });

  it("keeps lastSavedAt monotonic when the clock is behind the save", () => {
    const state: SimulationState = createInitialState(1337);
    state.lastSavedAt = 9_000;

    expect(projectRuntimeSave(state, 1_000).lastSavedAt).toBe(9_000);
    expect(projectRuntimeSave(state, Number.NaN).lastSavedAt).toBe(9_000);
  });

  it("refreshes production chains on the runtime save path", () => {
    const store = createStore();
    buildChain(store, "copperOre");
    store.advanceTicks(200);

    const save = store.getSaveGame();
    const projection = projectRuntimeSave(save, 5_000);

    expect(save.productionChains).toEqual({});
    expect(Object.keys(projection.productionChains)).toEqual(["chain-entity-1"]);
    expect(projection.productionChains["chain-entity-1"]).toEqual({
      id: "chain-entity-1",
      outputResource: "copperOre",
      steadyStateThroughput: 0.5,
      sellValue: 1,
    });
  });
});

describe("runtime autosave", () => {
  it("writes immediately when a player places a machine and stamps lastSavedAt", () => {
    const storage = createMemoryStorage();
    const store = createStore();
    const autosave = createRuntimeAutosave(store, storage, () => 1_000, {
      listenForLifecycleEvents: false,
    });

    store.dispatch({
      type: "placeEntity",
      machine: "extractor",
      x: COPPER_NODE.x,
      y: COPPER_NODE.y,
      rotation: 0,
      resourceNode: "copperOre",
    });

    const save = readSave(storage);
    expect(autosave.getWriteCount()).toBe(1);
    expect(save.lastSavedAt).toBe(1_000);
    expect(save.currency).toBe(450);
    expect(save.grid.entities).toHaveLength(1);
    expect(JSON.stringify(save)).not.toContain("tickCount");
    expect(JSON.stringify(save)).not.toContain("currencySamples");

    autosave.dispose();
  });

  it("does not write for state that is not part of the save", () => {
    const storage = createMemoryStorage();
    const store = createStore();
    const autosave = createRuntimeAutosave(store, storage, () => 1_000, {
      listenForLifecycleEvents: false,
    });

    store.dispatch({ type: "setPlacementMode", machine: "extractor" });
    store.dispatch({ type: "selectEntity", entityId: "entity-1" });
    store.dispatch({ type: "rotatePlacement" });
    store.dispatch({ type: "dismissNotification", id: "missing" });
    store.dispatch({ type: "dismissOfflineSummary" });

    expect(storage.getItem(SAVE_KEY)).toBeNull();
    expect(autosave.getWriteCount()).toBe(0);

    autosave.dispose();
  });

  it("throttles production progress to one write per interval", () => {
    const storage = createMemoryStorage();
    const store = createStore();
    let clock = 2_000;
    const autosave = createRuntimeAutosave(store, storage, () => clock, {
      minimumIntervalMs: 1_000,
      listenForLifecycleEvents: false,
    });

    buildChain(store, "copperOre");
    expect(autosave.getWriteCount()).toBe(3);

    clock = 2_100;
    store.advanceTicks(1);
    expect(autosave.getWriteCount()).toBe(3);

    clock = 3_100;
    store.advanceTicks(1);
    expect(autosave.getWriteCount()).toBe(4);
    expect(readSave(storage).lastSavedAt).toBe(3_100);

    clock = 3_200;
    store.advanceTicks(1);
    expect(autosave.getWriteCount()).toBe(4);

    autosave.dispose();
  });

  it("flushes pending progress on demand and before the page unloads", () => {
    const storage = createMemoryStorage();
    const store = createStore();
    let clock = 5_000;
    const autosave = createRuntimeAutosave(store, storage, () => clock, {
      minimumIntervalMs: 60_000,
      listenForLifecycleEvents: true,
    });

    store.advanceTicks(1);
    expect(autosave.getWriteCount()).toBe(0);

    buildChain(store, "copperOre");
    expect(autosave.getWriteCount()).toBe(3);

    store.advanceTicks(1);
    expect(autosave.getWriteCount()).toBe(3);

    autosave.flush();
    expect(autosave.getWriteCount()).toBe(4);

    clock = 5_500;
    store.advanceTicks(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(autosave.getWriteCount()).toBe(5);
    expect(readSave(storage).lastSavedAt).toBe(5_500);

    store.dispatch({ type: "demolishEntity", entityId: "entity-3" });
    expect(autosave.getWriteCount()).toBe(6);
    expect(readSave(storage).grid.entities).toHaveLength(2);

    autosave.dispose();
  });

  it("flushes when the tab becomes hidden and stops after disposal", () => {
    const storage = createMemoryStorage();
    const store = createStore();
    let clock = 9_000;
    const autosave = createRuntimeAutosave(store, storage, () => clock, {
      minimumIntervalMs: 60_000,
      listenForLifecycleEvents: true,
    });
    const restoreVisibility = setVisibilityState("visible");

    try {
      buildChain(store, "copperOre");
      expect(autosave.getWriteCount()).toBe(3);

      clock = 9_400;
      store.advanceTicks(1);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(autosave.getWriteCount()).toBe(3);

      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(autosave.getWriteCount()).toBe(4);
      expect(readSave(storage).lastSavedAt).toBe(9_400);

      clock = 9_800;
      store.advanceTicks(1);
      autosave.dispose();
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      expect(autosave.getWriteCount()).toBe(4);
      expect(readSave(storage).lastSavedAt).toBe(9_400);
    } finally {
      restoreVisibility();
      autosave.dispose();
    }
  });

  it("keeps one subscription per store and stops writing after disposal", () => {
    const storage = createMemoryStorage();
    const store = createStore();
    const subscribe = vi.spyOn(store, "subscribe");
    const autosave = createRuntimeAutosave(store, storage, () => 1_000, {
      listenForLifecycleEvents: false,
    });
    const repeated = createRuntimeAutosave(store, storage, () => 1_000, {
      listenForLifecycleEvents: false,
    });

    expect(repeated).toBe(autosave);
    expect(subscribe).toHaveBeenCalledTimes(1);

    buildChain(store, "copperOre");
    expect(autosave.getWriteCount()).toBe(3);

    autosave.dispose();

    store.dispatch({ type: "demolishEntity", entityId: "entity-3" });
    window.dispatchEvent(new Event("pagehide"));
    expect(autosave.getWriteCount()).toBe(3);
    expect(readSave(storage).grid.entities).toHaveLength(3);
  });

  it("does nothing when the storage adapter is unavailable", () => {
    const store = createStore();
    const autosave = createRuntimeAutosave(store, undefined, () => 1_000, {
      listenForLifecycleEvents: false,
    });

    buildChain(store, "copperOre");
    store.advanceTicks(20);

    expect(autosave.getWriteCount()).toBe(0);

    autosave.dispose();
  });
});

function setVisibilityState(value: string): () => void {
  const hadOwn = Object.hasOwn(document, "visibilityState");
  const previous = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  return () => {
    if (hadOwn && previous !== undefined) {
      Object.defineProperty(document, "visibilityState", previous);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
  };
}
