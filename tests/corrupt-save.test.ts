import { describe, expect, it } from 'vitest';
import { SAVE_KEY } from '../src/config/constants';
import { Simulation } from '../src/sim/simulation';
import { serializeSim, loadSave, validateSaveData } from '../src/sim/save';
import { MAX_MACHINE_LEVEL } from '../src/sim/upgrades';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
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

describe('corrupt save validation', () => {
  it('rejects a production chain with no output resource', () => {
    expect(validateSaveData).toBeTypeOf('function');
    expect(() =>
      validateSaveData({
        version: 1,
        lastSavedAt: 1,
        currency: 0,
        grid: { width: 64, height: 64, entities: [] },
        productionChains: {
          broken: { steadyStateThroughput: 1 },
        },
      }),
    ).toThrow(/invalid save/i);
  });
});

describe('loadSave recovery', () => {
  it('reports an empty storage without throwing', () => {
    expect(loadSave(fakeStorage(), 1_700_000_000_000)).toEqual({ kind: 'empty' });
  });

  it('loads and migrates a valid v1 save without quarantining it', () => {
    const raw = JSON.stringify({
      version: 1,
      lastSavedAt: 1,
      currency: 10,
      grid: { width: 64, height: 64, entities: [] },
      productionChains: {
        legacy: { steadyStateThroughput: 100, outputResource: 'motor' },
      },
    });
    const storage = fakeStorage({ [SAVE_KEY]: raw });

    const result = loadSave(storage, 1_700_000_000_000);

    expect(result.kind).toBe('loaded');
    if (result.kind !== 'loaded') throw new Error('expected a loaded save');
    expect(result.save).toMatchObject({ version: 2, currency: 10, productionChains: {} });
    expect(storage.getItem(SAVE_KEY)).toBe(raw);
    expect(storage.getItem(`${SAVE_KEY}.corrupt.1700000000000`)).toBeNull();
  });

  it('quarantines a structurally valid v2 save with impossible entity state', () => {
    const save = serializeSim(new Simulation(), 0);
    save.grid.entities.push({
      id: 'overlevelled',
      type: 'belt',
      x: 1,
      y: 1,
      rotation: 90,
      level: MAX_MACHINE_LEVEL + 1,
      resourceNode: null,
      item: null,
      inputs: {},
    });
    const raw = JSON.stringify(save);
    const storage = fakeStorage({ [SAVE_KEY]: raw });

    expect(loadSave(storage, 1_700_000_000_000)).toEqual({ kind: 'recovered', raw });
    expect(storage.getItem(`${SAVE_KEY}.corrupt.1700000000000`)).toBe(raw);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });

  it.each([
    ['invalid JSON', '{not json'],
    [
      'invalid structure',
      JSON.stringify({
        version: 1,
        lastSavedAt: 1,
        currency: 0,
        grid: { width: 64, height: 64, entities: [{}] },
        productionChains: {},
      }),
    ],
  ])('quarantines and removes %s', (_name, raw) => {
    const storage = fakeStorage({ [SAVE_KEY]: raw });

    expect(loadSave(storage, 1_700_000_000_000)).toEqual({ kind: 'recovered', raw });
    expect(storage.getItem(`${SAVE_KEY}.corrupt.1700000000000`)).toBe(raw);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });

  it.each(['get', 'backup', 'remove', 'backup-and-remove'] as const)(
    'still recovers when storage throws during %s',
    (failure) => {
      const raw = '{not json';
      const data = new Map([[SAVE_KEY, raw]]);
      const storage: Storage = {
        get length() {
          return data.size;
        },
        clear: () => data.clear(),
        getItem: (key: string) => {
          if (failure === 'get') throw new Error('get failed');
          return data.get(key) ?? null;
        },
        key: (index: number) => [...data.keys()][index] ?? null,
        removeItem: (key: string) => {
          if (failure === 'remove' || failure === 'backup-and-remove') {
            throw new Error('remove failed');
          }
          data.delete(key);
        },
        setItem: (key: string, value: string) => {
          if (failure === 'backup' || failure === 'backup-and-remove') {
            throw new Error('backup failed');
          }
          data.set(key, value);
        },
      };

      expect(loadSave(storage, 1_700_000_000_000)).toEqual({ kind: 'recovered', raw: failure === 'get' ? null : raw });
    },
  );
});
