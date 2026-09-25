import { describe, expect, it } from "vitest";
import { SAVE_KEY } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import type { SimulationState } from "../../src/sim/types";
import { migrateSave } from "../../src/persistence/migrate";
import type { MigrationResult } from "../../src/persistence/migrate";
import {
  loadSave,
  loadSaveWithResult,
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
});

describe("save validation and migration", () => {
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
  ];
  state.grid.machines = {
    "entity-2": {
      entityId: "entity-2",
      progressTicks: 0.25,
      input: {},
      output: { copperOre: 2 },
      active: true,
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
