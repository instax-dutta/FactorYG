import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRESTIGE_PRODUCTION_BONUS_PER_POINT,
  PRESTIGE_SELL_BONUS_PER_POINT,
  PRESTIGE_THRESHOLD,
} from "../../src/content/balance";
import { canResetPrestige, getPermanentMultipliers, performPrestige } from "../../src/sim/commands";
import { sellResource } from "../../src/sim/economy";
import { createInitialState, createResetState } from "../../src/sim/initialState";
import { getExtractorRate } from "../../src/sim/machines";
import {
  permanentMultipliersForPoints,
  repairPermanentMultipliers,
} from "../../src/sim/prestige";
import {
  loadSave,
  loadSaveWithOfflineResult,
  serializeSave,
  type SaveStorage,
} from "../../src/persistence/save";
import { SimulationStore } from "../../src/sim/store";
import type { BankedPrestige, Entity, PrestigeState, SimulationState } from "../../src/sim/types";

const commandsSource = readFileSync(resolve(process.cwd(), "src", "sim", "commands.ts"), "utf8");
const prestigeSource = readFileSync(resolve(process.cwd(), "src", "sim", "prestige.ts"), "utf8");
const saveSource = readFileSync(resolve(process.cwd(), "src", "persistence", "save.ts"), "utf8");
const initialStateSource = readFileSync(
  resolve(process.cwd(), "src", "sim", "initialState.ts"),
  "utf8",
);
const snapshotSource = readFileSync(resolve(process.cwd(), "src", "sim", "snapshot.ts"), "utf8");

const SAVE_KEY = "factor-y:save";
const BANKED_POINTS = 12;
const STALE_PRODUCTION = 1 + BANKED_POINTS * 0.1;
const STALE_SELL = 1 + BANKED_POINTS * 0.2;
const TWO_POINT_LIFETIME = 4 * PRESTIGE_THRESHOLD;
const AWARDED_POINTS = 2;

const EXPECTED_PRODUCTION = 1 + BANKED_POINTS * PRESTIGE_PRODUCTION_BONUS_PER_POINT;
const EXPECTED_SELL = 1 + BANKED_POINTS * PRESTIGE_SELL_BONUS_PER_POINT;

function memoryStorage(): SaveStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();

  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function staleSave(): SimulationState {
  const state = createInitialState();
  state.lifetimeCurrency = 0;
  state.prestige.points = BANKED_POINTS;
  state.prestige.totalPrestiges = 1;
  state.prestige.permanentMultipliers = {
    productionSpeed: STALE_PRODUCTION,
    sellValue: STALE_SELL,
  };
  return state;
}

function staleSavedSave(): SimulationState {
  const state = staleSave();
  state.productionChains = {
    "chain-entity-1": {
      id: "chain-entity-1",
      outputResource: "copperIngot",
      steadyStateThroughput: 1,
      sellValue: 6,
    },
  };
  state.lastSavedAt = 1_000;
  return state;
}

function extractor(): Entity {
  return { id: "entity-1", type: "extractor", x: 40, y: 37, rotation: 0, level: 1, resourceNode: "copperOre" };
}

describe("permanentMultipliersForPoints", () => {
  it("awards no bonus for no points", () => {
    expect(permanentMultipliersForPoints(0)).toEqual({
      productionSpeed: 1,
      sellValue: 1,
    });
  });

  it("derives both multipliers from the banked point count and the balance numbers", () => {
    expect(permanentMultipliersForPoints(BANKED_POINTS)).toEqual({
      productionSpeed: EXPECTED_PRODUCTION,
      sellValue: EXPECTED_SELL,
    });
  });

  it("reads no clock and no random source, so the same points always price the same", () => {
    expect(permanentMultipliersForPoints(BANKED_POINTS)).toEqual(
      permanentMultipliersForPoints(BANKED_POINTS),
    );
  });

  it.each([-1, -0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "prices the unusable point count %p as no bonus rather than a negative or infinite multiplier",
    (points) => {
      expect(permanentMultipliersForPoints(points)).toEqual({
        productionSpeed: 1,
        sellValue: 1,
      });
    },
  );
});

describe("the stored multiplier pair is the one source of truth", () => {
  it("reads the stored pair rather than recomputing it from the point count", () => {
    const state = staleSave();

    expect(getPermanentMultipliers(state)).toEqual({
      productionSpeed: STALE_PRODUCTION,
      sellValue: STALE_SELL,
    });
  });

  it("keeps the simulation and the getter on the same pair when the two disagree", () => {
    const state = staleSave();

    expect(getPermanentMultipliers(state).sellValue).toBe(
      state.prestige.permanentMultipliers.sellValue,
    );
    expect(sellResource("copperIngot", 4, state).currency).toBe(4 * 6 * STALE_SELL);
  });

  it("declares the derivation in exactly one place", () => {
    expect(prestigeSource).toMatch(/export function permanentMultipliersForPoints/);
    expect(
      prestigeSource.match(/1 \+ earned \* PRESTIGE_PRODUCTION_BONUS_PER_POINT/g) ?? [],
    ).toHaveLength(1);
    expect(
      prestigeSource.match(/1 \+ earned \* PRESTIGE_SELL_BONUS_PER_POINT/g) ?? [],
    ).toHaveLength(1);
    expect(commandsSource).not.toMatch(/PRESTIGE_PRODUCTION_BONUS_PER_POINT/);
    expect(commandsSource).not.toMatch(/PRESTIGE_SELL_BONUS_PER_POINT/);
  });

  it("does not re-derive a multiplier inside the command getter", () => {
    const getter = commandsSource.slice(
      commandsSource.indexOf("export function getPermanentMultipliers"),
    );

    expect(getter.slice(0, getter.indexOf("}"))).not.toMatch(
      /PRESTIGE_PRODUCTION_BONUS_PER_POINT|PRESTIGE_SELL_BONUS_PER_POINT/,
    );
    expect(getter.slice(0, getter.indexOf("}"))).toMatch(/state\.prestige\.permanentMultipliers/);
  });

  it("keeps the command layer free of the rule, so the field has a known set of writers", () => {
    expect(commandsSource).not.toMatch(/permanentMultipliersForPoints/);
    expect(initialStateSource).toMatch(/permanentMultipliersForPoints/);
    expect(snapshotSource).toMatch(/permanentMultipliersForPoints/);
    expect(prestigeSource).toMatch(/repairPermanentMultipliers/);
  });

  it("confines the rule to the three modules the simulation contract names", () => {
    const modules = ["commands", "economy", "chains", "grid", "machines", "offline", "placement"]
      .filter((name) =>
        readFileSync(resolve(process.cwd(), "src", "sim", `${name}.ts`), "utf8").includes(
          "permanentMultipliersForPoints",
        ),
      );

    expect(modules).toEqual([]);
  });
});

describe("createResetState is the only writer the reset path has", () => {
  it("ignores a stale pair handed to it and writes the one the rule produces", () => {
    const stale: PrestigeState = {
      points: BANKED_POINTS,
      totalPrestiges: 2,
      permanentMultipliers: { productionSpeed: 7, sellValue: 9 },
    };

    const built = createResetState(stale, { width: 64, height: 64 });

    expect(built.prestige.permanentMultipliers).toEqual({
      productionSpeed: EXPECTED_PRODUCTION,
      sellValue: EXPECTED_SELL,
    });
    expect(built.prestige.points).toBe(BANKED_POINTS);
    expect(built.prestige.totalPrestiges).toBe(2);
  });

  it("prices a reset world the same whether or not the caller supplied a pair", () => {
    const dimensions = { width: 64, height: 64 };
    const stale: PrestigeState = {
      points: BANKED_POINTS,
      totalPrestiges: 1,
      permanentMultipliers: { productionSpeed: 3, sellValue: 3 },
    };
    const bare: BankedPrestige = {
      points: BANKED_POINTS,
      totalPrestiges: 1,
    };

    expect(createResetState(stale, dimensions)).toEqual(createResetState(bare, dimensions));
  });
});

describe("repairPermanentMultipliers", () => {
  it("recomputes a disagreeing pair from the banked point count", () => {
    const repaired = repairPermanentMultipliers(staleSave());

    expect(repaired.prestige.permanentMultipliers).toEqual({
      productionSpeed: EXPECTED_PRODUCTION,
      sellValue: EXPECTED_SELL,
    });
  });

  it("returns the same state object when the stored pair already agrees", () => {
    const state = repairPermanentMultipliers(staleSave());

    expect(repairPermanentMultipliers(state)).toBe(state);
  });

  it("leaves the point count, the prestige count, and the rest of the run untouched", () => {
    const before = staleSave();
    const after = repairPermanentMultipliers(before);

    expect(after.prestige.points).toBe(before.prestige.points);
    expect(after.prestige.totalPrestiges).toBe(before.prestige.totalPrestiges);
    expect(after.currency).toBe(before.currency);
    expect(after.lifetimeCurrency).toBe(before.lifetimeCurrency);
    expect(after.grid).toBe(before.grid);
  });

  it("never mutates the state it repairs", () => {
    const before = staleSave();
    const snapshot = structuredClone(before);

    repairPermanentMultipliers(before);

    expect(before).toEqual(snapshot);
  });
});

describe("loading a save written under older balance numbers", () => {
  it("repairs the pair so the run is priced by the points it banked", () => {
    const storage = memoryStorage();
    storage.setItem("factor-y:save", serializeSave(staleSavedSave()));

    const loaded = loadSave(storage);

    expect(loaded.prestige.points).toBe(BANKED_POINTS);
    expect(loaded.prestige.permanentMultipliers).toEqual({
      productionSpeed: EXPECTED_PRODUCTION,
      sellValue: EXPECTED_SELL,
    });
  });

  it("prices a real sale by the repaired pair rather than the stale one", () => {
    const storage = memoryStorage();
    storage.setItem("factor-y:save", serializeSave(staleSavedSave()));

    const loaded = loadSave(storage);

    expect(sellResource("copperIngot", 4, loaded).currency).toBe(4 * 6 * EXPECTED_SELL);
  });

  it("prices the extractor rate by the repaired pair rather than the stale one", () => {
    const storage = memoryStorage();
    storage.setItem("factor-y:save", serializeSave(staleSavedSave()));

    const loaded = loadSave(storage);

    expect(getExtractorRate(extractor(), loaded)).toBeCloseTo(
      getExtractorRate(extractor(), createInitialState()) * EXPECTED_PRODUCTION,
      10,
    );
  });

  it("pays an offline session at the repaired pair rather than the stale one", () => {
    const storage = memoryStorage();
    storage.setItem(SAVE_KEY, serializeSave(staleSavedSave()));

    const result = loadSaveWithOfflineResult(storage, 2_000);

    expect(result.state.offlineSummary?.earnedCurrency).toBeCloseTo(1 * 6 * EXPECTED_SELL, 10);
  });

  it("rewrites the stored save so the repair is not paid for twice", () => {
    const storage = memoryStorage();
    storage.setItem(SAVE_KEY, serializeSave(staleSavedSave()));

    const result = loadSaveWithOfflineResult(storage, 2_000);

    expect(result.source).toBe("storage");
    expect(result.recovered).toBe(false);
    const rewritten = JSON.parse(storage.values.get(SAVE_KEY) ?? "{}") as {
      prestige: { permanentMultipliers: { productionSpeed: number; sellValue: number } };
    };
    expect(rewritten.prestige.permanentMultipliers).toEqual({
      productionSpeed: EXPECTED_PRODUCTION,
      sellValue: EXPECTED_SELL,
    });
  });

  it("routes the repair through the persistence projection rather than an inline copy", () => {
    expect(saveSource).toMatch(/repairPermanentMultipliers/);
  });

  it("leaves a save that already agrees exactly as it found it", () => {
    const storage = memoryStorage();
    const agreed = staleSave();
    agreed.prestige.permanentMultipliers = {
      productionSpeed: EXPECTED_PRODUCTION,
      sellValue: EXPECTED_SELL,
    };
    storage.setItem(SAVE_KEY, serializeSave(agreed));

    const loaded = loadSave(storage);

    expect(loaded.prestige.permanentMultipliers).toEqual({
      productionSpeed: EXPECTED_PRODUCTION,
      sellValue: EXPECTED_SELL,
    });
  });
});

describe("the preview a player is shown and the award they receive", () => {
  it("previews exactly the pair a reset then stores", () => {
    const store = new SimulationStore({
      ...staleSave(),
      lifetimeCurrency: TWO_POINT_LIFETIME,
    });
    const before = store.getSnapshot();

    expect(canResetPrestige(store.getSaveGame())).toEqual({ ok: true });
    expect(before.prestigeAwardPoints).toBe(AWARDED_POINTS);
    expect(before.prestigeNextMultipliers).toEqual({
      productionSpeed: 1 + (BANKED_POINTS + AWARDED_POINTS) * PRESTIGE_PRODUCTION_BONUS_PER_POINT,
      sellValue: 1 + (BANKED_POINTS + AWARDED_POINTS) * PRESTIGE_SELL_BONUS_PER_POINT,
    });

    expect(store.dispatch({ type: "prestige" })).toEqual({ ok: true });

    expect(store.getPermanentMultipliers()).toEqual(before.prestigeNextMultipliers);
    expect(store.getSaveGame().prestige.permanentMultipliers).toEqual(
      before.prestigeNextMultipliers,
    );
  });

  it("previews the multipliers the very next sale and extraction will actually use", () => {
    const store = new SimulationStore({
      ...staleSave(),
      lifetimeCurrency: TWO_POINT_LIFETIME,
    });
    const preview = store.getSnapshot().prestigeNextMultipliers;

    store.dispatch({ type: "prestige" });
    const reset = store.getSaveGame();

    expect(sellResource("copperIngot", 3, reset).currency).toBe(3 * 6 * preview.sellValue);
    expect(getExtractorRate(extractor(), reset)).toBeCloseTo(
      getExtractorRate(extractor(), createInitialState()) * preview.productionSpeed,
      10,
    );
  });

  it("previews a single-point award on top of points already banked", () => {
    const store = new SimulationStore({
      ...createInitialState(),
      prestige: {
        points: 5,
        totalPrestiges: 1,
        permanentMultipliers: { productionSpeed: 1.625, sellValue: 2.25 },
      },
      lifetimeCurrency: PRESTIGE_THRESHOLD + 1,
    });

    expect(store.getSnapshot().prestigeAwardPoints).toBe(1);
    expect(store.getSnapshot().prestigeNextMultipliers).toEqual({
      productionSpeed: 1 + 6 * PRESTIGE_PRODUCTION_BONUS_PER_POINT,
      sellValue: 1 + 6 * PRESTIGE_SELL_BONUS_PER_POINT,
    });
  });

  it("keeps the award landing once per reset rather than once per read", () => {
    const store = new SimulationStore({
      ...staleSave(),
      lifetimeCurrency: TWO_POINT_LIFETIME,
    });

    expect(store.dispatch({ type: "prestige" })).toEqual({ ok: true });
    const first = store.getPermanentMultipliers();
    store.advanceTicks(200);
    const afterTicks = store.getPermanentMultipliers();

    expect(afterTicks).toEqual(first);
    expect(store.getSaveGame().prestige.totalPrestiges).toBe(2);
    expect(store.getSaveGame().prestige.points).toBe(BANKED_POINTS + AWARDED_POINTS);
  });

  it("leaves the run untouched when a reset is refused, so the stored pair survives", () => {
    const state = staleSave();
    const before = structuredClone(state);

    const application = performPrestige(state);

    expect(application.result).toEqual({ ok: false, reason: "insufficientLifetimeCurrency" });
    expect(application.state).toBe(state);
    expect(state).toEqual(before);
  });
});
