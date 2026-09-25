import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";

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

  it("does not publish when a command does not mutate state", () => {
    const store = new SimulationStore(createInitialState());
    const listener = vi.fn();
    store.subscribe(listener);

    const result = store.dispatch({ type: "setPlacementMode", machine: "extractor" });
    store.dispatch({ type: "setPlacementMode", machine: "extractor" });

    expect(result).toEqual({ ok: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("schedules and stops logical ticks independently of Phaser", () => {
    vi.useFakeTimers();

    try {
      const store = new SimulationStore(createInitialState());
      const advanceTicks = vi.spyOn(store, "advanceTicks");

      store.start();
      expect(advanceTicks).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(advanceTicks).toHaveBeenCalledTimes(1);

      store.start();
      vi.advanceTimersByTime(100);
      expect(advanceTicks).toHaveBeenCalledTimes(2);

      store.stop();
      vi.advanceTimersByTime(300);
      expect(advanceTicks).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
