import { describe, expect, it } from "vitest";
import {
  GRID_EXPANSION_COST,
  PRESTIGE_PRODUCTION_BONUS_PER_POINT,
  PRESTIGE_SELL_BONUS_PER_POINT,
} from "../../src/content/balance";
import { canExpandGrid } from "../../src/sim/commands";
import {
  migrateSave,
  registerSaveMigration,
  SAVE_MIGRATIONS,
  validateSaveGame,
  type MigrationResult,
  type SaveMigration,
} from "../../src/persistence/migrate";
import {
  loadSave,
  loadSaveWithOfflineResult,
  loadSaveWithResult,
  parseSave,
  serializeSave,
  type SaveStorage,
} from "../../src/persistence/save";
import { GRID_HEIGHT, GRID_WIDTH, SAVE_KEY } from "../../src/sim/constants";
import { sellResource } from "../../src/sim/economy";
import { hasGridExpansionRights, isInsideGrid } from "../../src/sim/grid";
import { createInitialState } from "../../src/sim/initialState";
import { permanentMultipliersForPoints } from "../../src/sim/prestige";
import type { SaveGame } from "../../src/sim/types";

const BANKED_POINTS = 12;
const DERIVED_PRODUCTION_SPEED = 1 + BANKED_POINTS * PRESTIGE_PRODUCTION_BONUS_PER_POINT;
const DERIVED_SELL_VALUE = 1 + BANKED_POINTS * PRESTIGE_SELL_BONUS_PER_POINT;
const STALE_PRODUCTION_SPEED = 3;
const STALE_SELL_VALUE = 5;
const EXPANDED = 96;
const SAVE_FIELDS = [
  "version",
  "lastSavedAt",
  "currency",
  "lifetimeCurrency",
  "prestige",
  "unlocked",
  "grid",
  "productionChains",
] as const;

describe("the version-1 path is total over the shapes Phase 3 added", () => {
  it("carries a base save through unchanged, from a fixture wider than any real run", () => {
    expect(migrateFixture(generousBaseSave())).toEqual(generousBaseSave());
  });

  it("carries an expanded plot through unchanged at the size the save itself claims", () => {
    const fixture = expandedGridSave();

    const migrated = migrateFixture(fixture);

    expect(migrated).toEqual(fixture);
    expect(migrated["grid"]).toMatchObject({ width: EXPANDED, height: EXPANDED });
  });

  it("carries a post-prestige save through unchanged with its banked points, from a fixture wider than any real run", () => {
    const fixture = generousPostPrestigeSave();

    const migrated = migrateFixture(fixture);

    expect(migrated).toEqual(fixture);
    expect(migrated.prestige).toEqual({
      points: BANKED_POINTS,
      totalPrestiges: 2,
      permanentMultipliers: {
        productionSpeed: DERIVED_PRODUCTION_SPEED,
        sellValue: DERIVED_SELL_VALUE,
      },
    });
  });

  it("carries an expanded post-prestige save through unchanged, leaving unknown keys for the projection to drop", () => {
    const fixture = expandedPostPrestigeSave();

    const migrated = migrateFixture(fixture);

    expect(pickSaveFields(migrated)).toEqual(pickSaveFields(fixture));
    expect(migrated).toHaveProperty("notifications");
  });

  it("keeps the built world, the expanded area, and the chain summaries of that save", () => {
    const loaded = loadSave(storageWith(expandedPostPrestigeSave()));

    expect(loaded.grid.width).toBe(EXPANDED);
    expect(loaded.grid.entities.filter((entity) => entity.x >= GRID_WIDTH)).toHaveLength(3);
    expect(Object.keys(loaded.productionChains)).toEqual(["chain-entity-1", "chain-entity-4"]);
    expect(loaded.grid.belts["entity-5"]).toEqual({
      entityId: "entity-5",
      item: "copperIngot",
      progress: 0.75,
    });
  });

  it("reports a current save as unmigrated, because the version-1 path only fills legacy gaps", () => {
    for (const fixture of [
      generousBaseSave(),
      expandedGridSave(),
      generousPostPrestigeSave(),
      expandedPostPrestigeSave(),
    ]) {
      const result = migrateSave(structuredClone(fixture));

      expect(result).toMatchObject({ ok: true, migrated: false });
    }
  });

  it("loads an expanded plot at its earned size rather than clamping it to the starting one", () => {
    const state = loadSave(storageWith(expandedGridSave()));

    expect(state.grid.width).toBe(EXPANDED);
    expect(state.grid.height).toBe(EXPANDED);
    expect(state.grid.nodes).toContainEqual({
      id: "node-expanded-coal",
      resource: "coal",
      x: 95,
      y: 95,
    });
    expect(state.grid.entities).toContainEqual({
      id: "entity-6",
      type: "extractor",
      x: 95,
      y: 95,
      rotation: 180,
      level: 1,
      resourceNode: "coal",
    });
    expect(isInsideGrid({ x: 95, y: 95 }, state.grid.width, state.grid.height)).toBe(true);
  });

  it("round-trips an expanded plot through serialize and load without a version bump", () => {
    const storage = storageWith(expandedGridSave());

    saveAndReload(storage);

    expect(parseSave(storage.read()).ok).toBe(true);
    const reloaded = loadSave(storage);
    expect(reloaded.grid.width).toBe(EXPANDED);
    expect(reloaded.grid.height).toBe(EXPANDED);
    expect(reloaded.grid.entities).toHaveLength(6);
  });

  it("survives a load with the prestige multipliers the banked points bought", () => {
    const state = loadSave(storageWith(generousPostPrestigeSave()));

    expect(state.prestige).toEqual({
      points: BANKED_POINTS,
      totalPrestiges: 2,
      permanentMultipliers: {
        productionSpeed: DERIVED_PRODUCTION_SPEED,
        sellValue: DERIVED_SELL_VALUE,
      },
    });
  });

  it("prices the loaded run by the surviving multipliers rather than by a fresh-game pair", () => {
    const state = loadSave(storageWith(generousPostPrestigeSave()));

    expect(sellResource("copperIngot", 4, state).currency).toBe(4 * 6 * DERIVED_SELL_VALUE);
    expect(state.prestige.permanentMultipliers.sellValue).toBeGreaterThan(1);
  });

  it("rejects an unsupported version 3 without throwing", () => {
    const raw = structuredClone(expandedPostPrestigeSave());
    raw.version = 3;

    expect(() => migrateSave(raw)).not.toThrow();
    expect(migrateSave(raw)).toMatchObject({ ok: false, reason: "unsupportedVersion" });
    expect(parseSave(JSON.stringify(raw))).toMatchObject({
      ok: false,
      reason: "unsupportedVersion",
    });
  });
});

describe("a rejected save is never rewritten", () => {
  it("recovers to a new game in memory while leaving the stored value byte for byte alone", () => {
    const corrupt = JSON.stringify({ version: 3, currency: 4321 });
    const storage = new FakeStorage();
    storage.seed(corrupt);

    const result = loadSaveWithResult(storage);

    expect(result).toMatchObject({
      recovered: true,
      source: "newGame",
      reason: "unsupportedVersion",
    });
    expect(result.state).toEqual(createInitialState());
    expect(storage.read()).toBe(corrupt);
    expect(storage.writes).toEqual([]);
  });

  it("does not write a repaired save on the offline load path either", () => {
    const corrupt = JSON.stringify({ version: 1, currency: "not-a-number" });
    const storage = new FakeStorage();
    storage.seed(corrupt);

    const result = loadSaveWithOfflineResult(storage, 5_000);

    expect(result).toMatchObject({ recovered: true, source: "newGame" });
    expect(storage.read()).toBe(corrupt);
    expect(storage.writes).toEqual([]);
  });

  it("re-recovers from the same untouched value on every reload", () => {
    const corrupt = JSON.stringify({ version: 1, grid: { width: 100_000 } });
    const storage = new FakeStorage();
    storage.seed(corrupt);

    const first = loadSaveWithResult(storage);
    const second = loadSaveWithResult(storage);

    expect(first.reason).toBe(second.reason);
    expect(storage.read()).toBe(corrupt);
    expect(storage.writes).toEqual([]);
  });
});

describe("a save claiming a plot the player never earned", () => {
  it("rejects an expanded plot on a run that has never prestiged", () => {
    const forged = expandedGridSave();
    (forged.prestige as Record<string, unknown>).totalPrestiges = 0;

    expect(parseSave(JSON.stringify(forged))).toMatchObject({
      ok: false,
      reason: "invalidSave",
    });
  });

  it("still accepts the starting plot on a run that has never prestiged", () => {
    const base = generousBaseSave();

    expect(parseSave(JSON.stringify(base))).toMatchObject({ ok: true });
  });

  it("recovers a forged expanded save to a new game instead of honouring the plot", () => {
    const forged = expandedGridSave();
    (forged.prestige as Record<string, unknown>).totalPrestiges = 0;
    const storage = storageWith(forged);

    const state = loadSave(storage);

    expect(state.grid.width).toBe(GRID_WIDTH);
    expect(state.grid.height).toBe(GRID_HEIGHT);
    expect(state.prestige.totalPrestiges).toBe(0);
  });

  it("tells the same story as the command layer about who may own a larger plot", () => {
    for (const totalPrestiges of [0, 1, 7]) {
      const candidate = expandedGridSave();
      (candidate.prestige as Record<string, unknown>).totalPrestiges = totalPrestiges;
      const state = createInitialState();
      state.prestige.totalPrestiges = totalPrestiges;
      state.currency = GRID_EXPANSION_COST * 2;

      expect(canExpandGrid(state, EXPANDED, EXPANDED).ok).toBe(hasGridExpansionRights(state));
      expect(parseSave(JSON.stringify(candidate)).ok).toBe(hasGridExpansionRights(state));
    }
  });
});

describe("the persisted multiplier pair is a cache of the rule, not durable data", () => {
  it("migrates a disagreeing pair through untouched, because the migration is not the repricer", () => {
    const stale = generousPostPrestigeSave();
    (stale.prestige as Record<string, unknown>).permanentMultipliers = {
      productionSpeed: STALE_PRODUCTION_SPEED,
      sellValue: STALE_SELL_VALUE,
    };

    expect(migrateFixture(stale)["prestige"]).toEqual({
      points: BANKED_POINTS,
      totalPrestiges: 2,
      permanentMultipliers: {
        productionSpeed: STALE_PRODUCTION_SPEED,
        sellValue: STALE_SELL_VALUE,
      },
    });
  });

  it("reprices a disagreeing pair on load from the points the player banked", () => {
    const stale = generousPostPrestigeSave();
    (stale.prestige as Record<string, unknown>).permanentMultipliers = {
      productionSpeed: STALE_PRODUCTION_SPEED,
      sellValue: STALE_SELL_VALUE,
    };

    const loaded = loadSave(storageWith(stale));

    expect(loaded.prestige.points).toBe(BANKED_POINTS);
    expect(loaded.prestige.permanentMultipliers).toEqual({
      productionSpeed: DERIVED_PRODUCTION_SPEED,
      sellValue: DERIVED_SELL_VALUE,
    });
  });

  it("pins the repriced numbers literally, so retuning a per-point constant is a conscious edit", () => {
    const stale = generousPostPrestigeSave();
    (stale.prestige as Record<string, unknown>).permanentMultipliers = {
      productionSpeed: STALE_PRODUCTION_SPEED,
      sellValue: STALE_SELL_VALUE,
    };

    const loaded = loadSave(storageWith(stale));

    expect(loaded.prestige.permanentMultipliers).toEqual({
      productionSpeed: 2.5,
      sellValue: 4,
    });
  });

  it("names the derivation that makes those literals the only correct pair", () => {
    const stale = generousPostPrestigeSave();
    (stale.prestige as Record<string, unknown>).permanentMultipliers = {
      productionSpeed: STALE_PRODUCTION_SPEED,
      sellValue: STALE_SELL_VALUE,
    };

    const loaded = loadSave(storageWith(stale));

    expect(loaded.prestige.permanentMultipliers).toEqual(permanentMultipliersForPoints(BANKED_POINTS));
  });

  it("reprices an expanded post-prestige save too, so the plot and the price both survive", () => {
    const stale = expandedPostPrestigeSave();
    (stale.prestige as Record<string, unknown>).permanentMultipliers = {
      productionSpeed: STALE_PRODUCTION_SPEED,
      sellValue: STALE_SELL_VALUE,
    };

    const loaded = loadSave(storageWith(stale));

    expect(loaded.grid.width).toBe(EXPANDED);
    expect(loaded.prestige.points).toBe(BANKED_POINTS);
    expect(loaded.prestige.permanentMultipliers).toEqual({
      productionSpeed: DERIVED_PRODUCTION_SPEED,
      sellValue: DERIVED_SELL_VALUE,
    });
  });
});

describe("migrations are keyed by source version and never mutate their input", () => {
  it("registers exactly one migration per shipped source version", () => {
    expect(Object.keys(SAVE_MIGRATIONS)).toEqual(["1"]);
  });

  it("hands a registered migration the unvalidated candidate and returns its own verdict object", () => {
    const candidate = { version: 3, currency: "not-a-number" };
    const expected: SaveGame = structuredClone(generousBaseSave()) as unknown as SaveGame;
    let received: unknown;
    let returned: MigrationResult | undefined;
    const cleanup = registerSaveMigration(3, (raw) => {
      received = raw;
      returned = { ok: true, save: expected, migrated: true };
      return returned;
    });

    try {
      const result = migrateSave(candidate);

      expect(received).toBe(candidate);
      expect(result).toBe(returned);
      expect(result).toEqual({ ok: true, save: expected, migrated: true });
    } finally {
      cleanup();
    }

    expect(migrateSave(candidate)).toMatchObject({ ok: false, reason: "unsupportedVersion" });
  });

  it("refuses a duplicate or nonsensical registration rather than shadowing a version", () => {
    const noop: SaveMigration = () => ({
      ok: true,
      save: structuredClone(generousBaseSave()) as unknown as SaveGame,
      migrated: true,
    });

    expect(() => registerSaveMigration(1, noop)).toThrow(/already registered/);
    expect(() => registerSaveMigration(0, noop)).toThrow(TypeError);
    expect(() => registerSaveMigration(1.5, noop)).toThrow(TypeError);
  });

  it("makes the registry entry itself validate, so a bad save fails instead of throwing", () => {
    const result = SAVE_MIGRATIONS[1]({ version: 1, currency: 10 });

    expect(result).toMatchObject({ ok: false, reason: "invalidSave" });
    expect(() => SAVE_MIGRATIONS[1](null)).not.toThrow();
    expect(SAVE_MIGRATIONS[1](null)).toMatchObject({ ok: false, reason: "invalidSave" });
  });

  it("rejects an unknown shape through the same public validator the load path uses", () => {
    expect(validateSaveGame(null)).toMatchObject({ ok: false, reason: "invalidSave" });
    expect(validateSaveGame({ version: 3 })).toMatchObject({
      ok: false,
      reason: "unsupportedVersion",
    });
  });

  it("leaves the input untouched for a save it has nothing to change", () => {
    const input = structuredClone(expandedPostPrestigeSave());
    const before = structuredClone(input);

    const result = migrateSave(input);

    expect(result).toMatchObject({ ok: true, migrated: false });
    expect(input).toEqual(before);
  });

  it("leaves the input untouched while filling a legacy gap, and returns a new save", () => {
    const input = legacySaveWithoutBlockedFlag(expandedGridSave());
    const before = structuredClone(input);

    const result = migrateSave(input);

    expect(result).toMatchObject({ ok: true, migrated: true });
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.save).not.toBe(input);
    expect(input).toEqual(before);
    expect(result.save.grid.machines["entity-1"]?.alreadyNotifiedBlocked).toBe(false);
    expect(result.save.grid.width).toBe(EXPANDED);
  });

  it("defaults the legacy flag on every fixture shape, so no progression path is left behind", () => {
    for (const build of [
      generousBaseSave,
      expandedGridSave,
      generousPostPrestigeSave,
      expandedPostPrestigeSave,
    ]) {
      const result = migrateSave(legacySaveWithoutBlockedFlag(build()));

      expect(result).toMatchObject({ ok: true, migrated: true });
      if (!result.ok) {
        throw new Error(result.message);
      }
      for (const runtime of Object.values(result.save.grid.machines)) {
        expect(runtime.alreadyNotifiedBlocked).toBe(false);
      }
    }
  });
});

describe("a save never carries runtime-only state through a migration", () => {
  it("strips notifications and other runtime fields the save schema does not declare", () => {
    const parsed = parseSave(JSON.stringify(expandedPostPrestigeSave()));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    expect(Object.keys(parsed.save)).toEqual([...SAVE_FIELDS]);
    expect(parsed.save).not.toHaveProperty("notifications");
    expect(parsed.save).not.toHaveProperty("tickCount");
    expect(parsed.save).not.toHaveProperty("selectedEntityId");
    expect(parsed.save).not.toHaveProperty("offlineSummary");
  });

  it("tolerates the extra runtime keys on the raw input without rejecting the save", () => {
    const raw = expandedPostPrestigeSave();

    expect(validateSaveGame(raw)).toMatchObject({ ok: true });
    expect(migrateSave(raw)).toMatchObject({ ok: true });
  });

  it("keeps runtime-only fields out of the grid and machine records it migrates", () => {
    const parsed = parseSave(JSON.stringify(expandedPostPrestigeSave()));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    for (const machine of Object.values(parsed.save.grid.machines)) {
      expect(machine).not.toHaveProperty("blockedRefusalTicks");
    }
    expect(Object.keys(parsed.save.grid)).toEqual([
      "width",
      "height",
      "tileSizePx",
      "nodes",
      "entities",
      "machines",
      "belts",
    ]);
  });
});

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

  public read(): string | null {
    return this.getItem(SAVE_KEY);
  }

  public seed(value: string): void {
    this.values.set(SAVE_KEY, value);
  }
}

function storageWith(save: Record<string, unknown>): FakeStorage {
  const storage = new FakeStorage();
  storage.seed(JSON.stringify(save));
  return storage;
}

function saveAndReload(storage: FakeStorage): void {
  const state = loadSave(storage);
  storage.setItem(SAVE_KEY, serializeSave(state));
}

function migrateFixture(fixture: Record<string, unknown>): Record<string, unknown> {
  const result = migrateSave(structuredClone(fixture));

  expect(result).toMatchObject({ ok: true, migrated: false });
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.save as unknown as Record<string, unknown>;
}

function pickSaveFields(fixture: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of SAVE_FIELDS) {
    picked[field] = structuredClone(fixture[field]);
  }
  return picked;
}

function legacySaveWithoutBlockedFlag(
  fixture: Record<string, unknown> = generousBaseSave(),
): Record<string, unknown> {
  const legacy = structuredClone(fixture);
  const machines = (legacy.grid as Record<string, unknown>).machines as Record<string, unknown>;
  for (const runtime of Object.values(machines)) {
    delete (runtime as Record<string, unknown>).alreadyNotifiedBlocked;
  }
  return legacy;
}

function generousBaseSave(): Record<string, unknown> {
  return {
    version: 1,
    lastSavedAt: 1_000,
    currency: 750,
    lifetimeCurrency: 4_200,
    prestige: {
      points: 0,
      totalPrestiges: 0,
      permanentMultipliers: { productionSpeed: 1, sellValue: 1 },
    },
    unlocked: {
      machines: ["extractor", "belt", "depot", "silo"],
      recipes: ["copperIngot"],
    },
    grid: {
      width: 64,
      height: 64,
      tileSizePx: 64,
      nodes: [
        { id: "node-copper", resource: "copperOre", x: 8, y: 8 },
        { id: "node-iron", resource: "ironOre", x: 24, y: 40 },
        { id: "node-coal", resource: "coal", x: 40, y: 12 },
      ],
      entities: [
        {
          id: "entity-1",
          type: "extractor",
          x: 8,
          y: 8,
          rotation: 0,
          level: 1,
          resourceNode: "copperOre",
        },
        { id: "entity-2", type: "belt", x: 9, y: 8, rotation: 90, level: 1 },
        { id: "entity-3", type: "silo", x: 10, y: 8, rotation: 0, level: 1 },
      ],
      machines: {
        "entity-1": {
          entityId: "entity-1",
          progressTicks: 0.5,
          input: {},
          output: { copperOre: 3 },
          active: true,
          alreadyNotifiedBlocked: false,
        },
        "entity-3": {
          entityId: "entity-3",
          progressTicks: 0,
          input: { copperIngot: 12 },
          output: {},
          active: false,
          bufferedResource: "copperIngot",
          alreadyNotifiedBlocked: false,
        },
      },
      belts: {
        "entity-2": { entityId: "entity-2", item: "copperOre", progress: 0.25 },
      },
    },
    productionChains: {
      "chain-entity-1": {
        id: "chain-entity-1",
        outputResource: "copperIngot",
        steadyStateThroughput: 2,
        sellValue: 6,
      },
    },
  };
}

function expandedGridSave(): Record<string, unknown> {
  return {
    version: 1,
    lastSavedAt: 2_000,
    currency: 3_000,
    lifetimeCurrency: 250_000,
    prestige: {
      points: 0,
      totalPrestiges: 1,
      permanentMultipliers: { productionSpeed: 1, sellValue: 1 },
    },
    unlocked: {
      machines: ["extractor", "belt", "depot", "silo", "smelter"],
      recipes: ["copperIngot", "ironIngot"],
    },
    grid: {
      width: EXPANDED,
      height: EXPANDED,
      tileSizePx: 64,
      nodes: [
        { id: "node-copper", resource: "copperOre", x: 8, y: 8 },
        { id: "node-iron", resource: "ironOre", x: 24, y: 40 },
        { id: "node-coal", resource: "coal", x: 40, y: 12 },
        { id: "node-expanded-coal", resource: "coal", x: 95, y: 95 },
      ],
      entities: [
        {
          id: "entity-1",
          type: "extractor",
          x: 8,
          y: 8,
          rotation: 0,
          level: 1,
          resourceNode: "copperOre",
        },
        { id: "entity-2", type: "belt", x: 9, y: 8, rotation: 90, level: 1 },
        { id: "entity-3", type: "silo", x: 10, y: 8, rotation: 0, level: 1 },
        {
          id: "entity-4",
          type: "smelter",
          x: 70,
          y: 72,
          rotation: 270,
          level: 2,
          recipeId: "copperIngot",
        },
        { id: "entity-5", type: "belt", x: 71, y: 72, rotation: 0, level: 1 },
        {
          id: "entity-6",
          type: "extractor",
          x: 95,
          y: 95,
          rotation: 180,
          level: 1,
          resourceNode: "coal",
        },
      ],
      machines: {
        "entity-1": {
          entityId: "entity-1",
          progressTicks: 0.5,
          input: {},
          output: { copperOre: 3 },
          active: true,
          alreadyNotifiedBlocked: false,
        },
        "entity-3": {
          entityId: "entity-3",
          progressTicks: 0,
          input: { copperIngot: 12 },
          output: {},
          active: false,
          bufferedResource: "copperIngot",
          alreadyNotifiedBlocked: true,
        },
        "entity-4": {
          entityId: "entity-4",
          progressTicks: 2,
          input: { copperOre: 6 },
          output: { copperIngot: 1 },
          active: false,
          alreadyNotifiedBlocked: false,
        },
        "entity-6": {
          entityId: "entity-6",
          progressTicks: 0.25,
          input: {},
          output: { coal: 2 },
          active: true,
          alreadyNotifiedBlocked: false,
        },
      },
      belts: {
        "entity-2": { entityId: "entity-2", item: "copperOre", progress: 0.25 },
        "entity-5": { entityId: "entity-5", item: "copperIngot", progress: 0.75 },
      },
    },
    productionChains: {
      "chain-entity-1": {
        id: "chain-entity-1",
        outputResource: "copperIngot",
        steadyStateThroughput: 2,
        sellValue: 6,
      },
    },
  };
}

function generousPostPrestigeSave(): Record<string, unknown> {
  return {
    version: 1,
    lastSavedAt: 3_000,
    currency: 500,
    lifetimeCurrency: 0,
    prestige: {
      points: BANKED_POINTS,
      totalPrestiges: 2,
      permanentMultipliers: {
        productionSpeed: DERIVED_PRODUCTION_SPEED,
        sellValue: DERIVED_SELL_VALUE,
      },
    },
    unlocked: {
      machines: ["extractor", "belt", "depot", "silo"],
      recipes: [],
    },
    grid: {
      width: 64,
      height: 64,
      tileSizePx: 64,
      nodes: [
        { id: "node-copper", resource: "copperOre", x: 20, y: 20 },
        { id: "node-iron", resource: "ironOre", x: 44, y: 36 },
      ],
      entities: [
        {
          id: "entity-1",
          type: "extractor",
          x: 20,
          y: 20,
          rotation: 0,
          level: 1,
          resourceNode: "copperOre",
        },
        { id: "entity-2", type: "belt", x: 21, y: 20, rotation: 90, level: 1 },
      ],
      machines: {
        "entity-1": {
          entityId: "entity-1",
          progressTicks: 0.75,
          input: {},
          output: { copperOre: 1 },
          active: true,
          alreadyNotifiedBlocked: false,
        },
      },
      belts: {
        "entity-2": { entityId: "entity-2", progress: 0 },
      },
    },
    productionChains: {},
  };
}

function expandedPostPrestigeSave(): Record<string, unknown> {
  return {
    ...expandedGridSave(),
    lastSavedAt: 4_000,
    currency: 18_000,
    lifetimeCurrency: 900_000,
    prestige: {
      points: BANKED_POINTS,
      totalPrestiges: 3,
      permanentMultipliers: {
        productionSpeed: DERIVED_PRODUCTION_SPEED,
        sellValue: DERIVED_SELL_VALUE,
      },
    },
    unlocked: {
      machines: ["extractor", "belt", "depot", "silo", "smelter", "assembler"],
      recipes: ["copperIngot", "ironIngot", "refinedStone", "wire", "gear"],
    },
    productionChains: {
      "chain-entity-1": {
        id: "chain-entity-1",
        outputResource: "copperIngot",
        steadyStateThroughput: 4.5,
        sellValue: 6,
      },
      "chain-entity-4": {
        id: "chain-entity-4",
        outputResource: "ironIngot",
        steadyStateThroughput: 1.25,
        sellValue: 18,
      },
    },
    notifications: [
      { id: "notice-1", kind: "info", message: "Prestige complete", createdAt: 4_000 },
    ],
    tickCount: 9_999,
    selectedEntityId: "entity-4",
    offlineSummary: { elapsedMs: 60_000, earnedCurrency: 120 },
  };
}
