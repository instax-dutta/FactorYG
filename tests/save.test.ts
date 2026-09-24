import { describe, it, expect } from 'vitest';
import { SAVE_KEY, SAVE_VERSION } from '../src/config/constants';
import { ALL_UNLOCKED, startingUnlocks } from '../src/sim/techTree';
import { BASE_GRID, EXPANSION_STEP, MAX_EXPANSIONS_PER_AXIS } from '../src/sim/expansion';
import { MAX_MACHINE_LEVEL } from '../src/sim/upgrades';
import { Simulation } from '../src/sim/simulation';
import {
  applySave,
  clearSave,
  loadSave,
  saveToStorage,
  serializeSim,
  validateSaveData,
  type SaveData,
} from '../src/sim/save';

function buildSim(): Simulation {
  // A gated sim, because that is what the app always constructs: a bare
  // `Simulation` is deliberately the all-unlocked sandbox.
  const sim = new Simulation({ unlocked: startingUnlocks() });
  expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
  expect(sim.place('belt', 23, 24, 90).ok).toBe(true);
  expect(sim.place('depot', 24, 24, 0).ok).toBe(true);
  for (let i = 0; i < 100; i++) sim.tick();
  return sim;
}

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

function validV1Save(): Record<string, unknown> {
  return {
    version: 1,
    lastSavedAt: 1_700_000_000_000,
    currency: 100,
    prestige: {
      points: 3,
      totalPrestiges: 2,
      permanentMultipliers: { productionSpeed: 1.75, sellValue: 2.5 },
    },
    unlocked: startingUnlocks(),
    grid: {
      width: 64,
      height: 64,
      entities: [
        {
          id: 'belt-1',
          type: 'belt',
          x: 1,
          y: 2,
          rotation: 90,
          level: 1,
          resourceNode: null,
          item: null,
        },
      ],
    },
    productionChains: {
      chain: { steadyStateThroughput: 1, outputResource: 'copperOre' },
    },
  };
}

function v1Entity(raw: Record<string, unknown>): Record<string, unknown> {
  return (raw.grid as { entities: Array<Record<string, unknown>> }).entities[0];
}

function validV2Save(): Record<string, unknown> {
  return serializeSim(new Simulation(), 0) as unknown as Record<string, unknown>;
}

function validEntity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'belt-1',
    type: 'belt',
    x: 1,
    y: 1,
    rotation: 90,
    level: 1,
    resourceNode: null,
    item: null,
    inputs: {},
    ...overrides,
  };
}

function entitiesOf(save: Record<string, unknown>): Array<Record<string, unknown>> {
  return (save.grid as { entities: Array<Record<string, unknown>> }).entities;
}

describe('save schema (spec §8)', () => {
  it('round-trips currency, grid.entities, productionChains per spec §8 schema', () => {
    const sim = buildSim();
    const save = serializeSim(sim, 1_700_000_000_000);

    expect(save.version).toBe(SAVE_VERSION);
    expect(save.grid.width).toBe(64);
    expect(save.grid.height).toBe(64);
    expect(save.grid.entities).toHaveLength(3);
    expect(save.grid.entities[0]).toMatchObject({
      type: 'extractor',
      x: 22,
      y: 24,
      rotation: 90,
      level: 1,
      resourceNode: 'copperOre',
    });
    expect(save.currency).toBeCloseTo(sim.currency, 6);
    expect(Object.keys(save.productionChains)).toHaveLength(1);
    expect(Object.values(save.productionChains)[0]).toEqual({
      steadyStateThroughput: 1,
      outputResource: 'copperOre',
    });

    const restored = new Simulation();
    applySave(restored, save);
    expect(restored.currency).toBeCloseTo(sim.currency, 6);
    expect(restored.entities()).toHaveLength(3);
    expect(restored.entityAt({ x: 22, y: 24 })?.resourceNode).toBe('copperOre');
    expect(restored.entityAt({ x: 24, y: 24 })?.type).toBe('depot');

    // Restored sim keeps producing the same way.
    const before = restored.currency;
    for (let i = 0; i < 20; i++) restored.tick();
    expect(restored.currency).toBeGreaterThan(before);
  });

  it('keeps a silo buffer across a save and reload', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
    expect(sim.place('belt', 23, 24, 90).ok).toBe(true);
    expect(sim.place('silo', 24, 24, 90).ok).toBe(true);
    // Nothing downstream, so the silo simply collects.
    for (let i = 0; i < 300; i++) sim.tick();

    const held = sim.entityAt({ x: 24, y: 24 })?.inputs;
    expect(held?.copperOre ?? 0).toBeGreaterThan(0);

    const restored = new Simulation();
    applySave(restored, serializeSim(sim, 1_700_000_000_000));

    // A silo is storage: what it holds is player state, not an in-flight craft,
    // so reloading must not quietly empty it.
    expect(restored.entityAt({ x: 24, y: 24 })?.inputs).toEqual(held);

    // And the restored buffer still works: give it somewhere to go.
    expect(restored.place('belt', 25, 24, 90).ok).toBe(true);
    expect(restored.place('depot', 26, 24, 0).ok).toBe(true);

    const before = restored.currency;
    for (let i = 0; i < 60; i++) restored.tick();
    expect(restored.currency).toBeGreaterThan(before);
  });

  it('includes version + lastSavedAt', () => {
    const save = serializeSim(buildSim(), 1_700_000_000_000);
    expect(SAVE_VERSION).toBe(2);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.lastSavedAt).toBe(1_700_000_000_000);
    expect(save.prestige).toEqual({
      lifetimeMotors: 0,
      points: 0,
      claimedPoints: 0,
      totalPrestiges: 0,
      permanentMultipliers: { productionSpeed: 1, sellValue: 1 },
    });
    expect(save.unlocked.machines).toEqual(startingUnlocks().machines);
    expect(save.unlocked.recipes).toEqual(startingUnlocks().recipes);
  });

  it('persists the tech tree so an unlock is never bought twice', () => {
    const sim = new Simulation({ unlocked: startingUnlocks() });
    sim.currency = 5000;
    expect(sim.unlock('assembler').ok).toBe(true);

    const save = serializeSim(sim, 1_700_000_000_000);
    expect(save.unlocked.machines).toContain('assembler');

    const restored = new Simulation();
    applySave(restored, save);

    expect(restored.unlocks().machines).toContain('assembler');
    expect(restored.currency).toBeCloseTo(sim.currency, 6);
    // The restored sim can build what the player paid for.
    expect(restored.canPlaceAt('assembler', 30, 30).ok).toBe(true);
  });

  it('falls back to the starting unlock set for a save written before the tech tree', () => {
    const legacy = validV1Save();
    delete legacy.unlocked;

    const restored = new Simulation();
    // Old saves must load, and must not be handed the whole tree for free.
    expect(() => applySave(restored, legacy)).not.toThrow();
    expect(restored.unlocks()).toEqual(startingUnlocks());
  });

  it('validates a v2 save produced by the serializer', () => {
    const save = serializeSim(buildSim(), 1_700_000_000_000);
    expect(validateSaveData(save)).toEqual(save);
  });

  it('requires the canonical starting unlocks', () => {
    const raw = validV2Save();
    const starting = startingUnlocks();
    raw.unlocked = {
      machines: starting.machines.slice(1),
      recipes: [...starting.recipes],
    };

    expect(() => validateSaveData(raw)).toThrow(/invalid save/i);
  });

  it('requires every unlocked tech node prerequisite', () => {
    const raw = validV2Save();
    raw.unlocked = {
      machines: [...ALL_UNLOCKED.machines],
      recipes: ALL_UNLOCKED.recipes.filter((id) => id !== 'wire'),
    };

    expect(() => validateSaveData(raw)).toThrow(/invalid save/i);
  });

  it('rejects duplicate entity ids', () => {
    const raw = validV2Save();
    entitiesOf(raw).push(validEntity(), validEntity({ x: 2 }));

    expect(() => validateSaveData(raw)).toThrow(/invalid save/i);
  });

  it('rejects multiple entities in one occupied cell', () => {
    const raw = validV2Save();
    entitiesOf(raw).push(validEntity(), validEntity({ id: 'belt-2' }));

    expect(() => validateSaveData(raw)).toThrow(/invalid save/i);
  });

  it('rejects entity levels above the upgrade cap', () => {
    const raw = validV2Save();
    entitiesOf(raw).push(validEntity({ level: MAX_MACHINE_LEVEL + 1 }));

    expect(() => validateSaveData(raw)).toThrow(/invalid save/i);
  });

  it('requires an extractor resource to match its world node', () => {
    const raw = validV2Save();
    entitiesOf(raw).push(
      validEntity({
        id: 'extractor-1',
        type: 'extractor',
        x: 22,
        y: 24,
        rotation: 90,
        resourceNode: 'stone',
      }),
    );

    expect(() => validateSaveData(raw)).toThrow(/invalid save/i);
  });

  it.each([
    ['a resource field on a belt', validEntity({ resourceNode: 'copperOre' })],
    ['a missing resource field on an extractor', validEntity({
      id: 'extractor-1',
      type: 'extractor',
      x: 22,
      y: 24,
      resourceNode: null,
    })],
    ['cargo on a crossing', validEntity({ type: 'crossing', item: 'copperOre' })],
    ['cargo on a depot', validEntity({ type: 'depot', item: 'copperOre' })],
    ['a crafter output from the wrong machine', validEntity({
      type: 'smelter',
      item: 'motor',
    })],
  ])('rejects %s', (_name, entity) => {
    const raw = validV2Save();
    entitiesOf(raw).push(entity);

    expect(() => validateSaveData(raw)).toThrow(/invalid save/i);
  });

  it.each([
    ['belt inputs', validEntity({ inputs: { copperOre: 1 } })],
    ['an unsupported crafter input', validEntity({ type: 'assembler', inputs: { motor: 1 } })],
    ['a crafter input above its recipe capacity', validEntity({
      type: 'assembler',
      inputs: { copperIngot: 3 },
    })],
    ['a crafter input total above its buffer', validEntity({
      type: 'assembler',
      inputs: { copperIngot: 2, ironIngot: 1 },
    })],
    ['a silo total above its buffer', validEntity({
      type: 'silo',
      inputs: { copperOre: 51 },
    })],
  ])('rejects %s', (_name, entity) => {
    const raw = validV2Save();
    entitiesOf(raw).push(entity);

    expect(() => validateSaveData(raw)).toThrow(/invalid save/i);
  });

  it('validates before applySave can mutate the simulation', () => {
    const sim = buildSim();
    const before = serializeSim(sim, 0);
    const raw = validV2Save();
    raw.currency = 999;
    entitiesOf(raw).push(validEntity({ level: MAX_MACHINE_LEVEL + 1 }));

    expect(() => applySave(sim, raw as unknown as SaveData)).toThrow(/invalid save/i);
    expect(serializeSim(sim, 0)).toEqual(before);
  });

  it('migrates a valid v1 save to v2 and discards raw chain estimates', () => {
    const migrated = validateSaveData(validV1Save());

    expect(migrated).toMatchObject({
      version: 2,
      lastSavedAt: 1_700_000_000_000,
      currency: 100,
      prestige: {
        lifetimeMotors: 75,
        points: 3,
        claimedPoints: 3,
        totalPrestiges: 2,
        permanentMultipliers: { productionSpeed: 1.75, sellValue: 2.5 },
      },
      grid: { expansionsBought: 0 },
      productionChains: {},
    });
    expect(migrated.grid.entities[0].inputs).toEqual({});
  });

  it('fills every absent optional v1 block with supported defaults', () => {
    const raw = validV1Save();
    delete raw.prestige;
    delete raw.unlocked;
    const grid = raw.grid as { entities: Array<Record<string, unknown>>; expansionsBought?: number };
    delete grid.expansionsBought;
    delete grid.entities[0].inputs;

    const migrated = validateSaveData(raw);

    expect(migrated.prestige).toEqual({
      lifetimeMotors: 0,
      points: 0,
      claimedPoints: 0,
      totalPrestiges: 0,
      permanentMultipliers: { productionSpeed: 1, sellValue: 1 },
    });
    expect(migrated.unlocked).toEqual(startingUnlocks());
    expect(migrated.grid.expansionsBought).toBe(0);
    expect(migrated.grid.entities[0].inputs).toEqual({});
    expect(migrated.productionChains).toEqual({});
  });

  it('accepts the largest contract-valid plot and its boundary cell', () => {
    const raw = validV1Save();
    const grid = raw.grid as {
      width: number;
      height: number;
      expansionsBought: number;
      entities: Array<Record<string, unknown>>;
    };
    const size = BASE_GRID.width + EXPANSION_STEP * MAX_EXPANSIONS_PER_AXIS;
    grid.width = size;
    grid.height = size;
    grid.expansionsBought = MAX_EXPANSIONS_PER_AXIS;
    grid.entities[0].x = size - 1;
    grid.entities[0].y = size - 1;

    expect(() => validateSaveData(raw)).not.toThrow();
  });

  it.each([
    { points: 1, totalPrestiges: 0, claimedPoints: 0 },
    { points: 1, totalPrestiges: 2, claimedPoints: 1 },
    { points: 2, totalPrestiges: 1, claimedPoints: 2 },
  ])('infers v1 claimed points conservatively for points=$points prestiges=$totalPrestiges', ({ points, totalPrestiges, claimedPoints }) => {
    const raw = validV1Save();
    raw.prestige = {
      points,
      totalPrestiges,
      permanentMultipliers: { productionSpeed: 1, sellValue: 1 },
    };

    expect(validateSaveData(raw).prestige.claimedPoints).toBe(claimedPoints);
  });

  const malformed: Array<[string, () => Record<string, unknown>]> = [
    ['an empty entity', () => {
      const raw = validV1Save();
      (raw.grid as { entities: unknown[] }).entities = [{}];
      return raw;
    }],
    ['malformed nested prestige', () => {
      const raw = validV1Save();
      raw.prestige = { points: 1, totalPrestiges: 0, permanentMultipliers: { productionSpeed: 1 } };
      return raw;
    }],
    ['an invalid machine', () => {
      const raw = validV1Save();
      v1Entity(raw).type = 'reactor';
      return raw;
    }],
    ['an invalid resource node', () => {
      const raw = validV1Save();
      v1Entity(raw).resourceNode = 'gold';
      return raw;
    }],
    ['an invalid item resource', () => {
      const raw = validV1Save();
      v1Entity(raw).item = 'unobtainium';
      return raw;
    }],
    ['an invalid rotation', () => {
      const raw = validV1Save();
      v1Entity(raw).rotation = 45;
      return raw;
    }],
    ['an invalid recipe unlock', () => {
      const raw = validV1Save();
      (raw.unlocked as { recipes: unknown[] }).recipes = ['unobtainium'];
      return raw;
    }],
    ['negative currency', () => {
      const raw = validV1Save();
      raw.currency = -1;
      return raw;
    }],
    ['non-finite currency', () => {
      const raw = validV1Save();
      raw.currency = Number.NaN;
      return raw;
    }],
    ['negative prestige points', () => {
      const raw = validV1Save();
      (raw.prestige as { points: number }).points = -1;
      return raw;
    }],
    ['a negative expansion count', () => {
      const raw = validV1Save();
      (raw.grid as { expansionsBought: number }).expansionsBought = -1;
      return raw;
    }],
    ['an expansion count above the cap', () => {
      const raw = validV1Save();
      const size = BASE_GRID.width + EXPANSION_STEP * (MAX_EXPANSIONS_PER_AXIS + 1);
      Object.assign(raw.grid as Record<string, unknown>, {
        width: size,
        height: size,
        expansionsBought: MAX_EXPANSIONS_PER_AXIS + 1,
      });
      return raw;
    }],
    ['oversized dimensions for zero expansions', () => {
      const raw = validV1Save();
      Object.assign(raw.grid as Record<string, unknown>, {
        width: BASE_GRID.width + EXPANSION_STEP,
        height: BASE_GRID.height + EXPANSION_STEP,
        expansionsBought: 0,
      });
      return raw;
    }],
    ['inconsistent width, height, and expansion count', () => {
      const raw = validV1Save();
      Object.assign(raw.grid as Record<string, unknown>, {
        width: BASE_GRID.width,
        height: BASE_GRID.height + EXPANSION_STEP,
        expansionsBought: 1,
      });
      return raw;
    }],
    ['an entity outside count-consistent bounds', () => {
      const raw = validV1Save();
      Object.assign(raw.grid as Record<string, unknown>, {
        width: BASE_GRID.width + 1,
        height: BASE_GRID.height + 1,
        expansionsBought: 0,
      });
      v1Entity(raw).x = BASE_GRID.width;
      return raw;
    }],
    ['an entity on the declared boundary', () => {
      const raw = validV1Save();
      v1Entity(raw).x = BASE_GRID.width;
      return raw;
    }],
    ['a negative buffer count', () => {
      const raw = validV1Save();
      v1Entity(raw).inputs = { copperOre: -1 };
      return raw;
    }],
    ['a fractional buffer count', () => {
      const raw = validV1Save();
      v1Entity(raw).inputs = { copperOre: 1.5 };
      return raw;
    }],
    ['an invalid grid width', () => {
      const raw = validV1Save();
      (raw.grid as { width: number }).width = 0;
      return raw;
    }],
    ['a fractional grid height', () => {
      const raw = validV1Save();
      (raw.grid as { height: number }).height = 64.5;
      return raw;
    }],
    ['non-finite throughput', () => {
      const raw = validV1Save();
      (raw.productionChains as Record<string, { steadyStateThroughput: number }>).chain.steadyStateThroughput = Number.POSITIVE_INFINITY;
      return raw;
    }],
    ['an invalid chain resource', () => {
      const raw = validV1Save();
      (raw.productionChains as Record<string, { outputResource: string }>).chain.outputResource = 'unobtainium';
      return raw;
    }],
    ['a future version', () => {
      const raw = validV1Save();
      raw.version = 99;
      return raw;
    }],
    ['a v2 save without claimedPoints', () => {
      const raw = validV1Save();
      raw.version = 2;
      raw.prestige = {
        lifetimeMotors: 0,
        points: 0,
        totalPrestiges: 0,
        permanentMultipliers: { productionSpeed: 1, sellValue: 1 },
      };
      return raw;
    }],
  ];

  it.each(malformed)('rejects %s', (_name, build) => {
    expect(validateSaveData).toBeTypeOf('function');
    expect(() => validateSaveData(build())).toThrow(/invalid save|unsupported save/i);
  });

  it('saves to and loads from storage under the versioned key', () => {
    const storage = fakeStorage();
    const sim = buildSim();
    saveToStorage(sim, storage, 1_700_000_000_000);

    expect(storage.getItem(SAVE_KEY)).not.toBeNull();
    const result = loadSave(storage);
    expect(result.kind).toBe('loaded');
    if (result.kind !== 'loaded') throw new Error('expected a loaded save');
    expect(result.save.currency).toBeCloseTo(sim.currency, 6);
    expect(result.save.grid.entities).toHaveLength(3);

    expect(loadSave(fakeStorage())).toEqual({ kind: 'empty' });
  });

  it('clearing the save leaves nothing for a reload to resurrect', () => {
    const storage = fakeStorage();
    saveToStorage(buildSim(), storage, 1_700_000_000_000);
    expect(storage.getItem(SAVE_KEY)).not.toBeNull();

    clearSave(storage);

    // The whole point of a start-over: the next load is a new player, not the
    // factory the player just threw away.
    expect(storage.getItem(SAVE_KEY)).toBeNull();
    expect(loadSave(storage)).toEqual({ kind: 'empty' });
    // Idempotent, so a start-over on an already-empty slot is not an error.
    expect(() => clearSave(storage)).not.toThrow();
  });

  it('a corrupt stored save is quarantined rather than thrown', () => {
    const storage = fakeStorage();
    storage.setItem(SAVE_KEY, '{not json');

    expect(loadSave(storage, 1_700_000_000_000)).toEqual({ kind: 'recovered', raw: '{not json' });
    expect(storage.getItem(`${SAVE_KEY}.corrupt.1700000000000`)).toBe('{not json');
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });

  it('serializes points claimed by prestige separately from the reset count', () => {
    const sim = buildSim();
    sim.lifetimeMotors = 50;

    expect(sim.prestige().ok).toBe(true);
    expect(serializeSim(sim, 0).prestige).toMatchObject({
      points: 2,
      claimedPoints: 2,
      totalPrestiges: 1,
    });
  });

  it('restores claimed points independently from completed resets', () => {
    const sim = buildSim();
    const base = serializeSim(sim, 0);
    applySave(sim, {
      ...base,
      prestige: {
        ...base.prestige,
        lifetimeMotors: 75,
        points: 3,
        claimedPoints: 1,
        totalPrestiges: 2,
      },
    });

    expect(serializeSim(sim, 0).prestige).toMatchObject({
      lifetimeMotors: 75,
      points: 3,
      claimedPoints: 1,
      totalPrestiges: 2,
    });
  });

  it('round-trips cumulative and claimed points before claiming the remainder', () => {
    const source = buildSim();
    source.lifetimeMotors = 75;
    source.claimedPrestigePoints = 1;
    source.totalPrestiges = 2;

    const save = serializeSim(source, 0);
    const restored = new Simulation();
    applySave(restored, save);

    expect(restored.prestigeState()).toMatchObject({
      lifetimeMotors: 75,
      points: 3,
      claimedPoints: 1,
      availablePoints: 2,
    });
    expect(restored.prestige()).toEqual({ ok: true, points: 2, totalPrestiges: 3 });
    expect(restored.prestigeState().availablePoints).toBe(0);
  });

  it('persists fractional lifetime motors from offline credit', () => {
    const sim = buildSim();
    sim.lifetimeMotors = 3.5;

    const save = serializeSim(sim, 0);
    expect(() => validateSaveData(save)).not.toThrow();
    expect(validateSaveData(save).prestige.lifetimeMotors).toBe(3.5);
  });

  it('persists lifetime motors and the multipliers they earn', () => {
    const sim = buildSim();
    sim.lifetimeMotors = 50;
    sim.totalPrestiges = 1;

    const save = serializeSim(sim, 0);
    // Points and multipliers are written for the spec's shape, but
    // `lifetimeMotors` is the source of truth they are derived from.
    expect(save.prestige).toEqual({
      lifetimeMotors: 50,
      points: 2,
      claimedPoints: 0,
      totalPrestiges: 1,
      permanentMultipliers: { productionSpeed: 1.5, sellValue: 2 },
    });
  });

  it('restores a prestige bonus that actually reaches the tick', () => {
    const source = new Simulation({ unlocked: startingUnlocks() });
    source.lifetimeMotors = 25;
    source.totalPrestiges = 2;

    const restored = new Simulation({ unlocked: startingUnlocks() });
    applySave(restored, serializeSim(source, 0));
    expect(restored.lifetimeMotors).toBe(25);
    expect(restored.prestigeState()).toMatchObject({ points: 1, totalPrestiges: 2 });

    // Extractor -> belt -> depot: 12 ticks at 1x, 10 at the restored 1.25x. A
    // loaded multiplier that only existed on paper would land on 12.
    expect(restored.place('extractor', 22, 24, 90).ok).toBe(true);
    expect(restored.place('belt', 23, 24, 90).ok).toBe(true);
    expect(restored.place('depot', 24, 24, 0).ok).toBe(true);
    let ticks = 0;
    while (ticks < 200 && restored.currency === 0) {
      restored.tick();
      ticks += 1;
    }
    expect(ticks).toBe(10);
  });

  it('keeps the multiplier for a save written before motors were counted', () => {
    const legacy = validV1Save();
    legacy.prestige = {
      points: 3,
      totalPrestiges: 4,
      permanentMultipliers: { productionSpeed: 1.75, sellValue: 2.5 },
    };

    const restored = new Simulation({ unlocked: startingUnlocks() });
    applySave(restored, legacy);
    expect(restored.lifetimeMotors).toBe(75);
    expect(restored.prestigeState()).toMatchObject({
      points: 3,
      totalPrestiges: 4,
      permanentMultipliers: { productionSpeed: 1.75, sellValue: 2.5 },
    });
  });
});
