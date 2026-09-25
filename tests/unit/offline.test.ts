import { describe, expect, it, vi } from "vitest";
import { NEW_GAME_TIMESTAMP, SAVE_KEY } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import {
  applyOfflineProgress,
  calculateOfflineProgress,
  shouldShowOfflineSummary,
} from "../../src/sim/offline";
import { createSnapshot } from "../../src/sim/snapshot";
import { SimulationStore } from "../../src/sim/store";
import type { OfflineSummary, SaveGame, SimulationState } from "../../src/sim/types";
import {
  loadSave,
  loadSaveWithOfflineResult,
  parseSave,
  saveToStorage,
  serializeSave,
} from "../../src/persistence/save";
import type { SaveStorage } from "../../src/persistence/save";

class FakeStorage implements SaveStorage {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
    this.writes.push({ key, value });
  }
}

describe("calculateOfflineProgress", () => {
  it("treats a new-game timestamp as zero elapsed even when chains exist", () => {
    const save = createSave(NEW_GAME_TIMESTAMP, {
      copper: createChain("copper", "copperIngot", 2, 6),
    });

    expect(calculateOfflineProgress(save, 500_000)).toEqual(zeroSummary());
  });

  it("returns zero elapsed and earnings when the clock has not advanced", () => {
    const save = createSave(12_000, {
      copper: createChain("copper", "copperIngot", 2, 6),
    });

    expect(calculateOfflineProgress(save, 12_000)).toEqual(zeroSummary());
  });

  it("clamps negative and future save timestamps to zero elapsed", () => {
    const negative = createSave(-10_000, {
      copper: createChain("copper", "copperIngot", 1, 6),
    });
    const future = createSave(100_000, {
      copper: createChain("copper", "copperIngot", 1, 6),
    });

    expect(calculateOfflineProgress(negative, 61_000)).toEqual(zeroSummary());
    expect(calculateOfflineProgress(future, 61_000)).toEqual(zeroSummary());
  });

  it("keeps the modal hidden at 59 and 60 seconds and shows it at 61 seconds", () => {
    expect(shouldShowOfflineSummary(createSummary(59, 59, 59))).toBe(false);
    expect(shouldShowOfflineSummary(createSummary(60, 60, 60))).toBe(false);
    expect(shouldShowOfflineSummary(createSummary(61, 61, 61))).toBe(true);
  });

  it("requires positive earnings and chain units for a meaningful summary", () => {
    expect(
      shouldShowOfflineSummary({
        elapsedSeconds: 61,
        cappedSeconds: 61,
        earnedCurrency: 0,
        chainUnits: { copperIngot: 1 },
      }),
    ).toBe(false);
    expect(
      shouldShowOfflineSummary({
        elapsedSeconds: 61,
        cappedSeconds: 61,
        earnedCurrency: 10,
        chainUnits: {},
      }),
    ).toBe(false);
  });

  it("caps elapsed offline time at exactly 43,200 seconds", () => {
    const save = createSave(1_000, {
      copper: createChain("copper", "copperIngot", 1, 2),
    });

    const summary = calculateOfflineProgress(save, 50_000_000);

    expect(summary).toEqual({
      elapsedSeconds: 49_999,
      cappedSeconds: 43_200,
      earnedCurrency: 86_400,
      chainUnits: { copperIngot: 43_200 },
    });
  });

  it("aggregates every chain with sell multipliers and repeated output resources", () => {
    const save = createSave(1_000, {
      copperPrimary: createChain("copperPrimary", "copperIngot", 1.5, 6),
      copperSecondary: createChain("copperSecondary", "copperIngot", 0.5, 4),
      iron: createChain("iron", "ironIngot", 0.25, 10),
    });
    save.prestige.permanentMultipliers.sellValue = 2;

    const summary = calculateOfflineProgress(save, 101_000);

    expect(summary).toEqual({
      elapsedSeconds: 100,
      cappedSeconds: 100,
      earnedCurrency: 2_700,
      chainUnits: {
        copperIngot: 200,
        ironIngot: 25,
      },
    });
  });

  it("produces byte-stable chain-unit ordering and totals for equivalent chain maps", () => {
    const first = createSave(1_000, {
      zeta: createChain("zeta", "copperIngot", 0.1, 1),
      beta: createChain("beta", "ironIngot", 0.5, 4),
      alpha: createChain("alpha", "copperIngot", 0.2, 2),
    });
    const second = createSave(1_000, {
      alpha: createChain("alpha", "copperIngot", 0.2, 2),
      beta: createChain("beta", "ironIngot", 0.5, 4),
      zeta: createChain("zeta", "copperIngot", 0.1, 1),
    });

    const firstSummary = calculateOfflineProgress(first, 11_000);
    const secondSummary = calculateOfflineProgress(second, 11_000);

    expect(firstSummary).toEqual({
      elapsedSeconds: 10,
      cappedSeconds: 10,
      earnedCurrency: 25,
      chainUnits: {
        copperIngot: 3,
        ironIngot: 5,
      },
    });
    expect(Object.keys(firstSummary.chainUnits)).toEqual(["copperIngot", "ironIngot"]);
    expect(JSON.stringify(firstSummary)).toBe(JSON.stringify(secondSummary));
  });

  it("ignores chains with non-finite throughput or sell values", () => {
    const save = createSave(1_000, {
      invalidThroughput: createChain("invalidThroughput", "copperIngot", Number.NaN, 6),
      invalidSell: createChain("invalidSell", "ironIngot", 1, Number.POSITIVE_INFINITY),
    });

    expect(calculateOfflineProgress(save, 61_000)).toEqual({
      elapsedSeconds: 60,
      cappedSeconds: 60,
      earnedCurrency: 0,
      chainUnits: {},
    });
  });
});

describe("applyOfflineProgress", () => {
  it("credits current and lifetime currency once and preserves all other state", () => {
    const state = createPopulatedState();
    const summary = createSummary(61, 61, 61, 50, { copperIngot: 10 });

    const result = applyOfflineProgress(state, summary);

    expect(result).not.toBe(state);
    expect(result.currency).toBe(150);
    expect(result.lifetimeCurrency).toBe(250);
    expect(result.offlineSummary).toEqual(summary);
    expect(result.offlineSummary).not.toBe(summary);
    expect(result.offlineSummary?.chainUnits).not.toBe(summary.chainUnits);
    expect({
      ...result,
      currency: state.currency,
      lifetimeCurrency: state.lifetimeCurrency,
      offlineSummary: state.offlineSummary,
    }).toEqual(state);
    expect(state.currency).toBe(100);
    expect(state.lifetimeCurrency).toBe(200);
  });

  it("safely retains zero earnings and units without changing the economy", () => {
    const state = createPopulatedState();

    const result = applyOfflineProgress(state, zeroSummary());

    expect(result.currency).toBe(100);
    expect(result.lifetimeCurrency).toBe(200);
    expect(result.offlineSummary).toEqual(zeroSummary());
  });

  it("copies the runtime summary into an immutable snapshot", () => {
    const summary = createSummary(61, 61, 61, 50, { copperIngot: 10 });
    const state = applyOfflineProgress(createPopulatedState(), summary);

    const snapshot = createSnapshot(state);

    expect(snapshot.offlineSummary).toEqual(summary);
    expect(snapshot.offlineSummary).not.toBe(summary);
    expect(snapshot.offlineSummary?.chainUnits).not.toBe(summary.chainUnits);
    expect(Object.isFrozen(snapshot.offlineSummary)).toBe(true);
    expect(Object.isFrozen(snapshot.offlineSummary?.chainUnits)).toBe(true);
  });
});

describe("offline-aware loading", () => {
  it("leaves normal loadSave free of offline credit", () => {
    const storage = new FakeStorage();
    const save = createSave(10_000, {
      copper: createChain("copper", "copperIngot", 1, 5),
    });
    save.currency = 100;
    save.lifetimeCurrency = 200;
    storage.values.set(SAVE_KEY, serializeSave(save));

    const state = loadSave(storage);

    expect(state.currency).toBe(100);
    expect(state.lifetimeCurrency).toBe(200);
    expect(state.lastSavedAt).toBe(10_000);
    expect(state.offlineSummary).toBeUndefined();
  });

  it("loads, applies offline progress once, and reports the storage result", () => {
    const storage = new FakeStorage();
    const save = createSave(10_000, {
      copper: createChain("copper", "copperIngot", 1, 5),
    });
    save.currency = 100;
    save.lifetimeCurrency = 200;
    save.prestige.permanentMultipliers.sellValue = 2;
    storage.values.set(SAVE_KEY, serializeSave(save));

    const result = loadSaveWithOfflineResult(storage, 71_000);

    expect(result).toMatchObject({ recovered: false, source: "storage" });
    expect(result.state.currency).toBe(710);
    expect(result.state.lifetimeCurrency).toBe(810);
    expect(result.state.lastSavedAt).toBe(71_000);
    expect(result.state.offlineSummary).toEqual({
      elapsedSeconds: 61,
      cappedSeconds: 61,
      earnedCurrency: 610,
      chainUnits: { copperIngot: 61 },
    });
  });

  it("does not double credit after persisting an offline-loaded state", () => {
    const storage = new FakeStorage();
    const save = createSave(10_000, {
      copper: createChain("copper", "copperIngot", 1, 5),
    });
    save.currency = 100;
    save.lifetimeCurrency = 200;
    save.prestige.permanentMultipliers.sellValue = 2;
    storage.values.set(SAVE_KEY, serializeSave(save));

    const first = loadSaveWithOfflineResult(storage, 71_000);
    saveToStorage(storage, first.state);
    const second = loadSaveWithOfflineResult(storage, 132_000);

    expect(second.state.currency).toBe(1_320);
    expect(second.state.lifetimeCurrency).toBe(1_420);
    expect(second.state.offlineSummary?.earnedCurrency).toBe(610);
  });

  it("preserves recovery metadata and does not calculate offline progress for bad data", () => {
    const storage = new FakeStorage();
    storage.values.set(SAVE_KEY, "{bad");

    const result = loadSaveWithOfflineResult(storage, 500_000);

    expect(result).toMatchObject({
      recovered: true,
      source: "newGame",
      reason: "malformedJson",
    });
    expect(result.state).toEqual(createInitialState());
  });
});

describe("offline runtime state", () => {
  it("initializes the runtime summary without serializing it", () => {
    const state = createInitialState();
    state.offlineSummary = createSummary(61, 61, 61, 50, { copperIngot: 10 });

    const parsed = parseSave(serializeSave(state));

    expect(state).toHaveProperty("offlineSummary");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    expect(parsed.save).not.toHaveProperty("offlineSummary");
  });

  it("keeps the summary through simulation and clears and publishes only on dismissal", () => {
    const state = createInitialState();
    state.offlineSummary = createSummary(61, 61, 61, 50, { copperIngot: 10 });
    const store = new SimulationStore(state);
    const listener = vi.fn();
    const initialSnapshot = store.getSnapshot();
    store.subscribe(listener);

    store.advanceTicks(1);
    expect(store.getSnapshot().offlineSummary).toEqual(state.offlineSummary);
    expect(listener).toHaveBeenCalledTimes(1);

    const dismissed = store.dispatch({ type: "dismissOfflineSummary" });
    expect(dismissed).toEqual({ ok: true });
    expect(store.getSnapshot()).not.toBe(initialSnapshot);
    expect(store.getSnapshot().offlineSummary).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);

    store.dispatch({ type: "dismissOfflineSummary" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

function createSave(
  lastSavedAt: number,
  productionChains: SaveGame["productionChains"],
): SimulationState {
  const state = createInitialState();
  state.lastSavedAt = lastSavedAt;
  state.productionChains = productionChains;
  return state;
}

function createChain(
  id: string,
  outputResource: SaveGame["productionChains"][string]["outputResource"],
  steadyStateThroughput: number,
  sellValue: number,
): SaveGame["productionChains"][string] {
  return {
    id,
    outputResource,
    steadyStateThroughput,
    sellValue,
  };
}

function createSummary(
  elapsedSeconds: number,
  cappedSeconds: number,
  units: number,
  earnedCurrency = units,
  chainUnits: OfflineSummary["chainUnits"] = { copperIngot: units },
): OfflineSummary {
  return {
    elapsedSeconds,
    cappedSeconds,
    earnedCurrency,
    chainUnits,
  };
}

function zeroSummary(): OfflineSummary {
  return {
    elapsedSeconds: 0,
    cappedSeconds: 0,
    earnedCurrency: 0,
    chainUnits: {},
  };
}

function createPopulatedState(): SimulationState {
  const state = createInitialState();
  state.currency = 100;
  state.lifetimeCurrency = 200;
  state.lastSavedAt = 12_345;
  state.tickCount = 42;
  state.currencySamples = [{ tick: 42, amount: 10 }];
  state.selectedEntityId = "entity-1";
  state.placementMode = "belt";
  state.pendingRotation = 90;
  state.notifications = [
    { id: "notice-1", kind: "info", message: "Welcome", createdAt: 12_345 },
  ];
  return state;
}
