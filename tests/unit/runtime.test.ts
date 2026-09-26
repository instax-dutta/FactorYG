// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_KEY } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import { serializeSave } from "../../src/persistence/save";
import type { SimulationState } from "../../src/sim/types";
import { createBrowserSimulationRuntime } from "../../src/app/runtime";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("browser simulation runtime", () => {
  it("loads, credits, anchors, and persists a saved state without serializing the summary", () => {
    const save = createPersistedState();
    window.localStorage.setItem(SAVE_KEY, serializeSave(save));

    const first = createBrowserSimulationRuntime(71_000);
    const firstSnapshot = first.store.getSnapshot();
    const raw = window.localStorage.getItem(SAVE_KEY);
    const second = createBrowserSimulationRuntime(71_000);

    expect(firstSnapshot.currency).toBe(710);
    expect(firstSnapshot.offlineSummary).toEqual({
      elapsedSeconds: 61,
      cappedSeconds: 61,
      earnedCurrency: 610,
      chainUnits: { copperIngot: 61 },
    });
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("offlineSummary");
    expect(JSON.parse(raw ?? "{}")).toMatchObject({
      currency: 710,
      lifetimeCurrency: 810,
      lastSavedAt: 71_000,
    });
    expect(second.store.getSnapshot().currency).toBe(710);
    expect(second.store.getSnapshot().offlineSummary).toEqual({
      elapsedSeconds: 0,
      cappedSeconds: 0,
      earnedCurrency: 0,
      chainUnits: {},
    });
  });

  it("creates a fresh runtime when no browser window is available", () => {
    vi.stubGlobal("window", undefined);

    const runtime = createBrowserSimulationRuntime(71_000);

    expect(runtime.store.getSnapshot().currency).toBe(500);
    expect(runtime.store.getSnapshot().offlineSummary).toBeUndefined();
  });
});

function createPersistedState(): SimulationState {
  const state = createInitialState();
  state.lastSavedAt = 10_000;
  state.currency = 100;
  state.lifetimeCurrency = 200;
  state.prestige.permanentMultipliers.sellValue = 2;
  state.productionChains = {
    copper: {
      id: "copper",
      outputResource: "copperIngot",
      steadyStateThroughput: 1,
      sellValue: 5,
    },
  };
  return state;
}
