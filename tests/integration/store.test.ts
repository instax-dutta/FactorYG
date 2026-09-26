import { describe, expect, it, vi } from "vitest";
import * as constants from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import { createSnapshot } from "../../src/sim/snapshot";
import { SimulationStore } from "../../src/sim/store";
import { loadSave, serializeSave, type SaveStorage } from "../../src/persistence/save";
import type {
  BeltCell,
  Entity,
  MachineRuntime,
  Notification,
  SimulationState,
} from "../../src/sim/types";

describe("createSnapshot", () => {
  it("exports the shared prestige threshold", () => {
    expect(constants).toHaveProperty("PRESTIGE_THRESHOLD", 100_000);
  });

  it("keeps a fresh state not ready for prestige", () => {
    const snapshot = createSnapshot(createInitialState());

    expect(snapshot.prestigeReady).toBe(false);
  });

  it("marks a state at the lifetime currency threshold ready for prestige", () => {
    const state = createInitialState();
    state.lifetimeCurrency = 100_000;

    expect(createSnapshot(state).prestigeReady).toBe(true);
  });

  it("copies and freezes the selected entity", () => {
    const state = createInitialState();
    const entity = createTestEntity();
    state.grid.entities = [entity];
    state.selectedEntityId = entity.id;

    const snapshot = createSnapshot(state);

    expect(snapshot.selectedEntity).toEqual(entity);
    expect(snapshot.selectedEntity).not.toBe(entity);
    expect(Object.isFrozen(snapshot.selectedEntity)).toBe(true);
  });

  it("copies and freezes the notification array", () => {
    const state = createInitialState();
    const notification = createTestNotification();
    state.notifications = [notification];

    const snapshot = createSnapshot(state);

    expect(snapshot.notifications).not.toBe(state.notifications);
    expect(snapshot.notifications[0]).not.toBe(notification);
    expect(Object.isFrozen(snapshot.notifications)).toBe(true);
  });

  it("isolates unlocked arrays from the source state", () => {
    const state = createInitialState();
    const snapshot = createSnapshot(state);

    state.unlocked.machines.push("silo");
    state.unlocked.recipes.push("copperIngot");

    expect(snapshot.unlockedMachines).toEqual(["extractor", "belt", "depot"]);
    expect(snapshot.unlockedRecipes).toEqual([]);
  });
});

describe("SimulationStore", () => {
  it("keeps state private and returns the same immutable snapshot until state changes", () => {
    const state = createInitialState();
    const store = new SimulationStore(state);
    const first = store.getSnapshot();
    const second = store.getSnapshot();

    expect("state" in store).toBe(false);
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.unlockedMachines)).toBe(true);
    expect(first.unlockedMachines).not.toBe(state.unlocked.machines);
  });

  it("freezes copied notification records in the snapshot", () => {
    const state = createInitialState();
    state.notifications = [
      {
        id: "notice-1",
        kind: "info",
        message: "Welcome",
        createdAt: 0,
      },
    ];
    const snapshot = new SimulationStore(state).getSnapshot();

    expect(snapshot.notifications[0]).not.toBe(state.notifications[0]);
    expect(Object.isFrozen(snapshot.notifications[0])).toBe(true);
  });

  it("returns a CommandResult and notifies subscribers after a successful mutation", () => {
    const store = new SimulationStore(createInitialState());
    const listener = vi.fn();
    const initialSnapshot = store.getSnapshot();
    store.subscribe(listener);

    const result = store.dispatch({ type: "setPlacementMode", machine: "extractor" });

    expect(result).toEqual({ ok: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(initialSnapshot);
    expect(store.getSnapshot().placementMode).toBe("extractor");
  });

  it("removes an existing entity and publishes a new snapshot", () => {
    const state = createInitialState();
    const entity = createTestEntity();
    state.grid.entities = [entity];
    const store = new SimulationStore(state);
    const listener = vi.fn();
    const initialSnapshot = store.getSnapshot();
    store.subscribe(listener);

    const result = store.dispatch({ type: "demolishEntity", entityId: entity.id });

    expect(result).toEqual({ ok: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(initialSnapshot);
  });

  it("clears selection when the selected entity is demolished", () => {
    const state = createInitialState();
    const entity = createTestEntity();
    state.grid.entities = [entity];
    state.selectedEntityId = entity.id;
    const store = new SimulationStore(state);

    const result = store.dispatch({ type: "demolishEntity", entityId: entity.id });

    expect(result).toEqual({ ok: true });
    expect(store.getSnapshot().selectedEntity).toBeUndefined();
  });

  it("removes machine and belt runtime records for a demolished entity", () => {
    const state = createInitialState();
    const entity = createTestEntity();
    const machine: MachineRuntime = {
      entityId: entity.id,
      progressTicks: 3,
      input: {},
      output: { copperOre: 1 },
      active: true,
      alreadyNotifiedBlocked: false,
    };
    const belt: BeltCell = {
      entityId: entity.id,
      item: "copperOre",
      progress: 0.5,
    };
    state.grid.entities = [entity];
    state.grid.machines[entity.id] = machine;
    state.grid.belts[entity.id] = belt;
    const tick = vi.fn((currentState: SimulationState) => currentState);
    const store = new SimulationStore(state, () => 0, tick);

    store.dispatch({ type: "demolishEntity", entityId: entity.id });
    store.advanceTicks(1);

    expect(tick).toHaveBeenCalledTimes(1);
    const currentState = tick.mock.calls[0]?.[0];
    expect(currentState?.grid.entities).toEqual([]);
    expect(currentState?.grid.machines).not.toHaveProperty(entity.id);
    expect(currentState?.grid.belts).not.toHaveProperty(entity.id);
  });

  it("returns entityNotFound for an unknown demolition target", () => {
    const store = new SimulationStore(createInitialState());

    const result = store.dispatch({ type: "demolishEntity", entityId: "missing" });

    expect(result).toEqual({ ok: false, reason: "entityNotFound" });
  });

  it("does not publish for an unknown demolition target", () => {
    const store = new SimulationStore(createInitialState());
    const listener = vi.fn();
    const initialSnapshot = store.getSnapshot();
    store.subscribe(listener);

    store.dispatch({ type: "demolishEntity", entityId: "missing" });

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(initialSnapshot);
  });

  it("stops notifying after unsubscribe", () => {
    const store = new SimulationStore(createInitialState());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.dispatch({ type: "setPlacementMode", machine: "extractor" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("returns a CommandResult for a deferred command without publishing", () => {
    const store = new SimulationStore(createInitialState());
    const listener = vi.fn();
    const initialSnapshot = store.getSnapshot();
    store.subscribe(listener);

    const result = store.dispatch({ type: "prestige" });

    expect(result).toEqual({ ok: false, reason: "notImplemented" });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(initialSnapshot);
  });

  it("does not publish when a command does not mutate state", () => {
    const store = new SimulationStore(createInitialState());
    const listener = vi.fn();
    store.subscribe(listener);

    const result = store.dispatch({ type: "setPlacementMode", machine: "extractor" });
    store.dispatch({ type: "setPlacementMode", machine: "extractor" });

    expect(result).toEqual({ ok: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("schedules the injected pure tick function and stops independently of Phaser", () => {
    vi.useFakeTimers();

    try {
      let currentTime = 0;
      const tick = vi.fn((state: SimulationState) => state);
      const store = new SimulationStore(createInitialState(), () => currentTime, tick);

      store.start();
      expect(tick).not.toHaveBeenCalled();
      currentTime = 100;
      vi.advanceTimersByTime(100);
      expect(tick).toHaveBeenCalledTimes(1);

      store.start();
      currentTime = 200;
      vi.advanceTimersByTime(100);
      expect(tick).toHaveBeenCalledTimes(2);

      store.stop();
      currentTime = 500;
      vi.advanceTimersByTime(300);
      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a blocked producer across a save and reload", () => {
  it("reports the reloaded machine as blocked so a renderer blinks it without a new event", () => {
    const values = new Map<string, string>();
    const storage: SaveStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    const store = new SimulationStore(createInitialState(1337));
    store.dispatch({
      type: "placeEntity",
      machine: "extractor",
      x: 40,
      y: 37,
      rotation: 0,
      resourceNode: "copperOre",
    });
    for (let index = 0; index < 3; index += 1) {
      store.dispatch({
        type: "placeEntity",
        machine: "belt",
        x: 41 + index,
        y: 37,
        rotation: 0,
      });
    }
    store.advanceTicks(200);

    expect(store.getBlockedMachineIds()).toEqual(["entity-1"]);
    storage.setItem(constants.SAVE_KEY, serializeSave(store.getSaveGame()));
    expect(values.get(constants.SAVE_KEY)).toBeDefined();

    const reloaded = new SimulationStore(loadSave(storage));
    const events: string[] = [];
    reloaded.subscribeEvents((event) => {
      events.push(event.type);
    });

    expect(reloaded.getBlockedMachineIds()).toEqual(["entity-1"]);

    reloaded.advanceTicks(200);

    expect(reloaded.getBlockedMachineIds()).toEqual(["entity-1"]);
    expect(events).not.toContain("blockedFull");
  });

  it("does not persist the refusal counter, because it is debounce bookkeeping", () => {
    const store = new SimulationStore(createInitialState(1337));
    store.dispatch({
      type: "placeEntity",
      machine: "extractor",
      x: 40,
      y: 37,
      rotation: 0,
      resourceNode: "copperOre",
    });
    for (let index = 0; index < 3; index += 1) {
      store.dispatch({
        type: "placeEntity",
        machine: "belt",
        x: 41 + index,
        y: 37,
        rotation: 0,
      });
    }
    store.advanceTicks(200);

    const saved = JSON.parse(serializeSave(store.getSaveGame())) as {
      grid: { machines: Record<string, Record<string, unknown>> };
    };

    expect(saved.grid.machines["entity-1"]?.alreadyNotifiedBlocked).toBe(true);
    expect(saved.grid.machines["entity-1"]).not.toHaveProperty("blockedRefusalTicks");
  });
});

function createTestEntity(): Entity {
  return {
    id: "entity-1",
    type: "belt",
    x: 4,
    y: 5,
    rotation: 0,
    level: 1,
  };
}

function createTestNotification(): Notification {
  return {
    id: "notice-1",
    kind: "info",
    message: "Welcome",
    createdAt: 0,
  };
}
