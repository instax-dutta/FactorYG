import { describe, expect, it } from "vitest";
import { SAVE_KEY } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import { canStoreInput } from "../../src/sim/machines";
import type { SaveGame, SimulationState } from "../../src/sim/types";
import * as persistenceMigrations from "../../src/persistence/migrate";
import { migrateSave } from "../../src/persistence/migrate";
import type { MigrationResult, SaveMigration } from "../../src/persistence/migrate";
import {
  loadSave,
  loadSaveWithResult,
  parseSave,
  projectSaveGame,
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

describe("save serialization", () => {
  it("round-trips a save through JSON without losing persisted fields", () => {
    const state = createStateWithEntities();
    const result = parseSave(serializeSave(state));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.save.version).toBe(1);
    expect(result.save.lastSavedAt).toBe(1234);
    expect(result.save.currency).toBe(987.5);
    expect(result.save.lifetimeCurrency).toBe(2000);
    expect(result.save.prestige).toEqual({
      points: 3,
      totalPrestiges: 1,
      permanentMultipliers: { productionSpeed: 1.5, sellValue: 2 },
    });
    expect(result.save.unlocked).toEqual({
      machines: ["extractor", "belt", "depot", "silo"],
      recipes: ["copperIngot"],
    });
    expect(result.save.grid.width).toBe(64);
    expect(result.save.grid.height).toBe(64);
    expect(result.save.grid.tileSizePx).toBe(64);
    expect(result.save.grid.nodes).toEqual(state.grid.nodes);
    expect(result.save.grid.machines).toEqual(state.grid.machines);
    expect(result.save.grid.belts).toEqual(state.grid.belts);
    expect(result.save.productionChains).toEqual(state.productionChains);
  });

  it("projects only SaveGame fields and excludes runtime-only state", () => {
    const state = createStateWithEntities();
    state.tickCount = 42;
    state.currencySamples = [{ tick: 42, amount: 10 }];
    state.selectedEntityId = "entity-1";
    state.placementMode = "belt";
    state.notifications = [
      { id: "notice-1", kind: "info", message: "hello", createdAt: 1234 },
    ];

    const parsed = parseSave(serializeSave(state));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }

    expect(Object.keys(parsed.save)).toEqual([
      "version",
      "lastSavedAt",
      "currency",
      "lifetimeCurrency",
      "prestige",
      "unlocked",
      "grid",
      "productionChains",
    ]);
    expect(Object.keys(parsed.save.grid)).toEqual([
      "width",
      "height",
      "tileSizePx",
      "nodes",
      "entities",
      "machines",
      "belts",
    ]);
    expect(parsed.save).not.toHaveProperty("tickCount");
    expect(parsed.save).not.toHaveProperty("currencySamples");
    expect(parsed.save).not.toHaveProperty("selectedEntityId");
    expect(parsed.save).not.toHaveProperty("placementMode");
    expect(parsed.save).not.toHaveProperty("notifications");
  });

  it("preserves entity coordinates and rotation", () => {
    const state = createStateWithEntities();

    const parsed = parseSave(serializeSave(state));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }

    expect(parsed.save.grid.entities).toEqual([
      {
        id: "entity-1",
        type: "belt",
        x: 7,
        y: 9,
        rotation: 270,
        level: 2,
      },
      {
        id: "entity-2",
        type: "extractor",
        x: 10,
        y: 11,
        rotation: 90,
        level: 1,
        resourceNode: "copperOre",
      },
      {
        id: "entity-3",
        type: "silo",
        x: 12,
        y: 13,
        rotation: 180,
        level: 1,
      },
    ]);
  });

  it("is deterministic and does not mutate the source state", () => {
    const state = createStateWithEntities();
    const before = structuredClone(state);

    const first = serializeSave(state);
    const second = serializeSave(state);

    expect(first).toBe(second);
    expect(state).toEqual(before);
  });

  it("rejects non-finite persisted values before serialization and storage writes", () => {
    const nanState = createStateWithEntities();
    nanState.currency = Number.NaN;
    const nanStorage = new FakeStorage();

    expect(() => serializeSave(nanState)).toThrow(TypeError);
    expect(() => saveToStorage(nanStorage, nanState)).not.toThrow();
    expect(nanStorage.writes).toHaveLength(0);

    const infiniteState = createStateWithEntities();
    infiniteState.lifetimeCurrency = Number.POSITIVE_INFINITY;
    const infiniteStorage = new FakeStorage();

    expect(() => serializeSave(infiniteState)).toThrow(TypeError);
    expect(() => saveToStorage(infiniteStorage, infiniteState)).not.toThrow();
    expect(infiniteStorage.writes).toHaveLength(0);
  });
});

describe("save graph integrity and projection", () => {
  it("rejects dangling machine and belt record keys", () => {
    const machineSave = toSaveObject(createStateWithEntities());
    const machineGrid = machineSave.grid as Record<string, unknown>;
    const machines = machineGrid.machines as Record<string, unknown>;
    const machineRuntime = machines["entity-2"] as Record<string, unknown>;
    machines.ghost = { ...machineRuntime, entityId: "ghost" };

    const beltSave = toSaveObject(createStateWithEntities());
    const beltGrid = beltSave.grid as Record<string, unknown>;
    const belts = beltGrid.belts as Record<string, unknown>;
    const beltRuntime = belts["entity-1"] as Record<string, unknown>;
    belts.ghost = { ...beltRuntime, entityId: "ghost" };

    expectInvalidSave(machineSave);
    expectInvalidSave(beltSave);
  });

  it("enforces the machine and belt partition for every entity", () => {
    const missingMachine = toSaveObject(createStateWithEntities());
    const missingMachineGrid = missingMachine.grid as Record<string, unknown>;
    delete (missingMachineGrid.machines as Record<string, unknown>)["entity-2"];

    const nonBeltWithBelt = toSaveObject(createStateWithEntities());
    const nonBeltGrid = nonBeltWithBelt.grid as Record<string, unknown>;
    (nonBeltGrid.belts as Record<string, unknown>)["entity-2"] = {
      entityId: "entity-2",
      progress: 0,
    };

    const missingBelt = toSaveObject(createStateWithEntities());
    const missingBeltGrid = missingBelt.grid as Record<string, unknown>;
    delete (missingBeltGrid.belts as Record<string, unknown>)["entity-1"];

    const beltWithMachine = toSaveObject(createStateWithEntities());
    const beltGrid = beltWithMachine.grid as Record<string, unknown>;
    const machines = beltGrid.machines as Record<string, unknown>;
    const machineRuntime = machines["entity-2"] as Record<string, unknown>;
    machines["entity-1"] = { ...machineRuntime, entityId: "entity-1" };

    expectInvalidSave(missingMachine);
    expectInvalidSave(nonBeltWithBelt);
    expectInvalidSave(missingBelt);
    expectInvalidSave(beltWithMachine);
  });

  it("rejects runtime records whose entityId does not match their key", () => {
    const save = toSaveObject(createStateWithEntities());
    const grid = save.grid as Record<string, unknown>;
    const machines = grid.machines as Record<string, unknown>;
    const machineRuntime = machines["entity-2"] as Record<string, unknown>;
    machineRuntime.entityId = "entity-1";

    expectInvalidSave(save);
  });

  it("projects only explicit node and nested record fields", () => {
    const state = createStateWithEntities();
    Object.assign(state.grid.nodes[0], { unknownNodeField: "node" });
    Object.assign(state.grid.entities[0], { unknownEntityField: "entity" });
    Object.assign(state.grid.machines["entity-2"], { unknownMachineField: "machine" });
    Object.assign(state.grid.machines["entity-2"].input, { unknownAmountField: 1 });
    Object.assign(state.grid.belts["entity-1"], { unknownBeltField: "belt" });
    Object.assign(state.productionChains.copper, { unknownChainField: "chain" });

    const projected = projectSaveGame(state);

    expect(Object.keys(projected.grid.nodes[0])).toEqual(["id", "resource", "x", "y"]);
    expect(projected.grid.nodes[0]).not.toHaveProperty("unknownNodeField");
    expect(projected.grid.entities[0]).not.toHaveProperty("unknownEntityField");
    expect(projected.grid.machines["entity-2"]).not.toHaveProperty("unknownMachineField");
    expect(projected.grid.machines["entity-2"].input).not.toHaveProperty("unknownAmountField");
    expect(projected.grid.belts["entity-1"]).not.toHaveProperty("unknownBeltField");
    expect(projected.productionChains.copper).not.toHaveProperty("unknownChainField");
  });

  it("deep-copies projected nested data", () => {
    const state = createStateWithEntities();
    const projected = projectSaveGame(state);

    projected.grid.nodes[0].x = 63;
    projected.grid.machines["entity-2"].output.copperOre = 99;
    projected.grid.belts["entity-1"].item = "coal";
    projected.productionChains.copper.sellValue = 999;

    expect(state.grid.nodes[0].x).not.toBe(63);
    expect(state.grid.machines["entity-2"].output.copperOre).toBe(2);
    expect(state.grid.belts["entity-1"].item).toBe("ironOre");
    expect(state.productionChains.copper.sellValue).toBe(6);
  });

  it("derives the buffered resource of a legacy shared-storage machine that lacks it", () => {
    const legacy = legacySaveWithoutBufferedResource();

    const parsed = parseSave(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }

    const runtime = parsed.save.grid.machines["entity-3"];
    expect(runtime?.input).toEqual({ copperIngot: 42 });
    expect(runtime?.bufferedResource).toBe("copperIngot");
  });

  it("keeps a migrated silo single-resource and refuses a different resource while occupied", () => {
    const parsed = parseSave(JSON.stringify(legacySaveWithoutBufferedResource()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }

    const silo = parsed.save.grid.entities.find((entity) => entity.id === "entity-3");
    const runtime = parsed.save.grid.machines["entity-3"];
    expect(silo).toBeDefined();
    expect(runtime).toBeDefined();
    if (silo === undefined || runtime === undefined) {
      throw new Error("missing migrated silo");
    }

    expect(canStoreInput(silo, runtime, "copperIngot")).toBe(true);
    expect(canStoreInput(silo, runtime, "coal")).toBe(false);
    expect(canStoreInput(silo, runtime, "motor")).toBe(false);
  });

  it("derives the buffered resource deterministically for a legacy silo holding several types", () => {
    const legacy = legacySaveWithoutBufferedResource();
    const machines = (legacy.grid as Record<string, unknown>).machines as Record<string, unknown>;
    (machines["entity-3"] as Record<string, unknown>).input = { copperIngot: 5, coal: 3 };

    const first = parseSave(JSON.stringify(legacy));
    const second = parseSave(JSON.stringify(legacy));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("migration failed");
    }

    expect(first.save.grid.machines["entity-3"]?.bufferedResource).toBe("coal");
    expect(second.save.grid.machines["entity-3"]?.bufferedResource).toBe("coal");
  });

  it("never derives a buffered resource for a machine without shared storage", () => {
    const legacy = legacySaveWithoutBufferedResource();
    const machines = (legacy.grid as Record<string, unknown>).machines as Record<string, unknown>;
    (machines["entity-2"] as Record<string, unknown>).input = { copperOre: 4 };

    const parsed = parseSave(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }

    expect(parsed.save.grid.machines["entity-2"]?.input).toEqual({ copperOre: 4 });
    expect(parsed.save.grid.machines["entity-2"]).not.toHaveProperty("bufferedResource");
  });

  it("carries a blocked producer flag through a save round trip", () => {
    const state = createStateWithEntities();

    const parsed = parseSave(serializeSave(state));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }

    expect(parsed.save.grid.machines["entity-2"]?.alreadyNotifiedBlocked).toBe(false);
    expect(parsed.save.grid.machines["entity-3"]?.alreadyNotifiedBlocked).toBe(true);

    const written = JSON.parse(serializeSave(state)) as SaveGame;
    expect(written.grid.machines["entity-3"]?.alreadyNotifiedBlocked).toBe(true);
  });

  it("defaults a legacy machine runtime that lacks the blocked flag to unblocked", () => {
    const legacy = legacySaveWithoutBlockedFlag();

    const parsed = parseSave(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }

    expect(parsed.save.grid.machines["entity-2"]).not.toHaveProperty("bufferedResource");
    expect(parsed.save.grid.machines["entity-2"]?.alreadyNotifiedBlocked).toBe(false);
    expect(parsed.save.grid.machines["entity-3"]?.alreadyNotifiedBlocked).toBe(false);
  });

  it("keeps a loaded blocked producer flagged instead of re-notifying it silently", () => {
    const legacy = legacySaveWithoutBlockedFlag();
    const machines = (legacy.grid as Record<string, unknown>).machines as Record<string, unknown>;
    (machines["entity-2"] as Record<string, unknown>).alreadyNotifiedBlocked = true;

    const loaded = loadSave(createStorageWith(legacy));

    expect(loaded.grid.machines["entity-2"]?.alreadyNotifiedBlocked).toBe(true);
    expect(loaded.grid.machines["entity-3"]?.alreadyNotifiedBlocked).toBe(false);
  });

  it("rejects a blocked producer flag that is not a boolean", () => {
    const legacy = legacySaveWithoutBlockedFlag();
    const machines = (legacy.grid as Record<string, unknown>).machines as Record<string, unknown>;
    (machines["entity-2"] as Record<string, unknown>).alreadyNotifiedBlocked = "blocked";

    const parsed = parseSave(JSON.stringify(legacy));
    expect(parsed).toEqual({
      ok: false,
      reason: "invalidSave",
      message: 'Save field "grid" is invalid.',
    });
  });
});

function legacySaveWithoutBufferedResource(): Record<string, unknown> {
  const legacy = toSaveObject(createStateWithEntities());
  const machines = (legacy.grid as Record<string, unknown>).machines as Record<string, unknown>;
  delete (machines["entity-3"] as Record<string, unknown>).bufferedResource;
  return legacy;
}

function legacySaveWithoutBlockedFlag(): Record<string, unknown> {
  const legacy = toSaveObject(createStateWithEntities());
  const machines = (legacy.grid as Record<string, unknown>).machines as Record<string, unknown>;
  for (const runtime of Object.values(machines)) {
    delete (runtime as Record<string, unknown>).alreadyNotifiedBlocked;
  }
  return legacy;
}

function createStorageWith(save: Record<string, unknown>): SaveStorage {
  const storage = new FakeStorage();
  storage.setItem(SAVE_KEY, JSON.stringify(save));
  return storage;
}

describe("save validation and migration", () => {
  it("rejects unsafe record keys", () => {
    for (const key of ["__proto__", "prototype", "constructor"]) {
      const save = toSaveObject(createStateWithEntities());
      const grid = save.grid as Record<string, unknown>;
      const entities = grid.entities as Array<Record<string, unknown>>;
      const belts = grid.belts as Record<string, unknown>;
      const originalBelt = belts["entity-1"] as Record<string, unknown>;
      delete belts["entity-1"];
      entities[0].id = key;
      Object.defineProperty(belts, key, {
        configurable: true,
        enumerable: true,
        value: { ...originalBelt, entityId: key },
        writable: true,
      });

      expectInvalidSave(save);
    }
  });

  it("dispatches a temporarily registered migration by source version", () => {
    const registry = persistenceMigrations as unknown as {
      registerSaveMigration?: (version: number, migration: SaveMigration) => () => void;
    };
    expect(registry.registerSaveMigration).toBeTypeOf("function");
    if (registry.registerSaveMigration === undefined) {
      return;
    }

    const state = createStateWithEntities();
    const validSave = toSaveObject(state) as unknown as SaveGame;
    const source = { ...validSave, version: 2 };
    let calls = 0;
    const cleanup = registry.registerSaveMigration(2, () => {
      calls += 1;
      return { ok: true, save: validSave, migrated: true };
    });

    try {
      const result = migrateSave(source);
      expect(calls).toBe(1);
      expect(result).toEqual({ ok: true, save: validSave, migrated: true });
    } finally {
      cleanup();
    }

    expect(migrateSave(source)).toMatchObject({ ok: false, reason: "unsupportedVersion" });
  });

  it("rejects an unknown version without throwing", () => {
    const state = createStateWithEntities();
    const raw = JSON.parse(serializeSave(state)) as Record<string, unknown>;
    raw.version = 2;

    const result = parseSave(JSON.stringify(raw));

    expect(result).toMatchObject({ ok: false, reason: "unsupportedVersion" });
    expect(() => migrateSave(raw)).not.toThrow();
    expect(migrateSave(raw)).toMatchObject({ ok: false, reason: "unsupportedVersion" });
  });

  it("recovers from malformed JSON and malformed save shapes", () => {
    const malformedJson = parseSave("{not-json");
    expect(malformedJson).toMatchObject({ ok: false, reason: "malformedJson" });

    const malformedShape = parseSave(JSON.stringify({ version: 1, currency: 10 }));
    expect(malformedShape).toMatchObject({ ok: false, reason: "invalidSave" });
  });

  it("rejects non-finite values, unknown IDs, illegal rotations, and out-of-bounds coordinates", () => {
    const state = createStateWithEntities();
    const valid = JSON.parse(serializeSave(state)) as Record<string, unknown>;

    const cases = [
      mutate(valid, (save) => {
        save.lastSavedAt = "now";
      }),
      mutate(valid, (save) => {
        const grid = save.grid as Record<string, unknown>;
        const entities = grid.entities as Array<Record<string, unknown>>;
        entities[0].rotation = 45;
      }),
      mutate(valid, (save) => {
        const grid = save.grid as Record<string, unknown>;
        const entities = grid.entities as Array<Record<string, unknown>>;
        entities[0].x = 64;
      }),
      mutate(valid, (save) => {
        const grid = save.grid as Record<string, unknown>;
        const entities = grid.entities as Array<Record<string, unknown>>;
        entities[0].type = "teleporter";
      }),
      mutate(valid, (save) => {
        const grid = save.grid as Record<string, unknown>;
        const nodes = grid.nodes as Array<Record<string, unknown>>;
        nodes[0].resource = "unobtainium";
      }),
      mutate(valid, (save) => {
        const grid = save.grid as Record<string, unknown>;
        const entities = grid.entities as Array<Record<string, unknown>>;
        entities[1].recipeId = "unknownRecipe";
      }),
    ];

    for (const candidate of cases) {
      expect(parseSave(JSON.stringify(candidate))).toMatchObject({
        ok: false,
        reason: "invalidSave",
      });
    }
  });

  it("uses a no-op version-1 migration entry", () => {
    const state = createStateWithEntities();
    const save = JSON.parse(serializeSave(state)) as Record<string, unknown>;

    const result: MigrationResult = migrateSave(save);

    expect(result).toEqual({ ok: true, save, migrated: false });
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.save).toBe(save);
  });
});

describe("save storage", () => {
  it("returns a new-game result when storage getItem throws", () => {
    const storage: SaveStorage = {
      getItem: () => {
        throw new Error("read failed");
      },
      setItem: () => undefined,
    };

    const result = loadSaveWithResult(storage);

    expect(result).toMatchObject({
      recovered: true,
      reason: "storageError",
      source: "newGame",
    });
    expect(result.state).toEqual(createInitialState());
  });

  it("does not throw or write when storage setItem throws", () => {
    let writeCount = 0;
    const storage: SaveStorage = {
      getItem: () => null,
      setItem: () => {
        writeCount += 1;
        throw new Error("write failed");
      },
    };

    expect(() => saveToStorage(storage, createStateWithEntities())).not.toThrow();
    expect(writeCount).toBe(1);
  });

  it("writes and reads the explicit save key through a fake storage adapter", () => {
    const storage = new FakeStorage();
    const state = createStateWithEntities();
    const serialized = serializeSave(state);

    saveToStorage(storage, state);

    expect(storage.writes).toEqual([{ key: SAVE_KEY, value: serialized }]);
    expect(loadSave(storage)).toMatchObject({
      version: 1,
      lastSavedAt: 1234,
      currency: 987.5,
      grid: {
        entities: state.grid.entities,
        machines: state.grid.machines,
        belts: state.grid.belts,
      },
    });
  });

  it("returns a recoverable result and a deterministic new-game fallback for bad input", () => {
    const storage = new FakeStorage();
    storage.values.set(SAVE_KEY, "{bad");

    const result = loadSaveWithResult(storage);

    expect(result).toMatchObject({ recovered: true, reason: "malformedJson" });
    expect(result.state).toEqual(createInitialState());
    expect(loadSave(storage)).toEqual(createInitialState());
  });

  it("does not read or write browser globals when a storage adapter is supplied", () => {
    const storage = new FakeStorage();
    const state = createStateWithEntities();
    saveToStorage(storage, state);

    expect(storage.writes).toHaveLength(1);
    expect(loadSave(storage).grid.entities).toEqual(state.grid.entities);
  });
});

function toSaveObject(state: SimulationState): Record<string, unknown> {
  return JSON.parse(serializeSave(state)) as Record<string, unknown>;
}

function expectInvalidSave(save: Record<string, unknown>): void {
  expect(parseSave(JSON.stringify(save))).toMatchObject({ ok: false, reason: "invalidSave" });
}

function createStateWithEntities(): SimulationState {
  const state = createInitialState();
  state.lastSavedAt = 1234;
  state.currency = 987.5;
  state.lifetimeCurrency = 2000;
  state.prestige = {
    points: 3,
    totalPrestiges: 1,
    permanentMultipliers: { productionSpeed: 1.5, sellValue: 2 },
  };
  state.unlocked = {
    machines: ["extractor", "belt", "depot", "silo"],
    recipes: ["copperIngot"],
  };
  state.grid.entities = [
    {
      id: "entity-1",
      type: "belt",
      x: 7,
      y: 9,
      rotation: 270,
      level: 2,
    },
    {
      id: "entity-2",
      type: "extractor",
      x: 10,
      y: 11,
      rotation: 90,
      level: 1,
      resourceNode: "copperOre",
    },
    {
      id: "entity-3",
      type: "silo",
      x: 12,
      y: 13,
      rotation: 180,
      level: 1,
    },
  ];
  state.grid.machines = {
    "entity-2": {
      entityId: "entity-2",
      progressTicks: 0.25,
      input: {},
      output: { copperOre: 2 },
      active: true,
      alreadyNotifiedBlocked: false,
    },
    "entity-3": {
      entityId: "entity-3",
      progressTicks: 0,
      input: { copperIngot: 42 },
      output: {},
      active: false,
      bufferedResource: "copperIngot",
      alreadyNotifiedBlocked: true,
    },
  };
  state.grid.belts = {
    "entity-1": {
      entityId: "entity-1",
      item: "ironOre",
      progress: 0.5,
    },
  };
  state.productionChains = {
    copper: {
      id: "copper",
      outputResource: "copperIngot",
      steadyStateThroughput: 1.5,
      sellValue: 6,
    },
  };
  return state;
}

function mutate(
  value: Record<string, unknown>,
  change: (save: Record<string, unknown>) => void,
): Record<string, unknown> {
  const copy = structuredClone(value);
  change(copy);
  return copy;
}
