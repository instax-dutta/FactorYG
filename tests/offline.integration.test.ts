import { describe, expect, it } from 'vitest';
import { computeOfflineGains } from '../src/sim/offline';
import { applySave, serializeSim } from '../src/sim/save';
import { Simulation, type Entity } from '../src/sim/simulation';
import type { ChainInfo } from '../src/sim/throughputLedger';
import type { ResourceId } from '../src/sim/worldgen';

type Sale = (item: ResourceId) => void;
type RestoreThroughput = (chains: readonly ChainInfo[]) => void;
type CreditOffline = (report: ReturnType<typeof computeOfflineGains>) => void;
type ReachesDepot = (source: Entity) => boolean;

const motorChain = (throughput: number): ChainInfo => ({
  id: 'sold-motor',
  outputResource: 'motor',
  steadyStateThroughput: throughput,
});

function sell(sim: Simulation, item: ResourceId): void {
  (sim as unknown as { sell: Sale }).sell(item);
}

function restoreThroughput(sim: Simulation, chains: readonly ChainInfo[]): void {
  (sim as unknown as { restoreThroughput: RestoreThroughput }).restoreThroughput(chains);
}

function creditOffline(sim: Simulation, report: ReturnType<typeof computeOfflineGains>): void {
  (sim as unknown as { creditOffline: CreditOffline }).creditOffline(report);
}

function countRouteWalks(sim: Simulation): () => number {
  const target = sim as unknown as { reachesDepot: ReachesDepot };
  const original = target.reachesDepot;
  let walks = 0;
  target.reachesDepot = (source) => {
    walks += 1;
    return original.call(sim, source);
  };
  return () => walks;
}

function saveWithMotorChain(throughput = 0.5) {
  return {
    ...serializeSim(new Simulation(), 0),
    productionChains: {
      'sold-motor': {
        outputResource: 'motor' as const,
        steadyStateThroughput: throughput,
      },
    },
  };
}

describe('throughput ledger simulation integration', () => {
  it('turns actual Motor sales into a persisted Motor chain', () => {
    const sim = new Simulation();
    sell(sim, 'motor');
    for (let tick = 0; tick < 50; tick++) sim.tick();

    expect(sim.chains()).toEqual([
      { id: 'sold-motor', outputResource: 'motor', steadyStateThroughput: 0.2 },
    ]);
  });

  it('uses the persisted Motor chain instead of raw extractor chains for offline gains', () => {
    const factory = new Simulation();
    expect(factory.place('extractor', 22, 24, 90).ok).toBe(true);
    expect(factory.place('belt', 23, 24, 90).ok).toBe(true);
    expect(factory.place('depot', 24, 24, 0).ok).toBe(true);

    const loaded = new Simulation();
    applySave(loaded, saveWithMotorChain(0.5));
    const report = computeOfflineGains(loaded.chains(), 60, 1);

    expect(loaded.chains()).toEqual([motorChain(0.5)]);
    expect(report.gains).toHaveLength(1);
    expect(report.gains[0]).toMatchObject({
      chainId: 'sold-motor',
      outputResource: 'motor',
      amount: 30,
    });
  });

  it('credits offline currency and fractional Motor quantity', () => {
    const sim = new Simulation();
    const report = computeOfflineGains([motorChain(0.5)], 10, 2);
    const startingCurrency = sim.currency;

    creditOffline(sim, report);

    expect(sim.currency).toBeGreaterThan(startingCurrency);
    expect(sim.lifetimeMotors).toBe(5);
  });

  it('does not turn offline credit into a live sale sample', () => {
    const sim = new Simulation();
    restoreThroughput(sim, [motorChain(0.5)]);
    const before = sim.chains();
    const report = computeOfflineGains(before, 10, 1);

    creditOffline(sim, report);

    expect(sim.chains()).toEqual(before);
  });

  it('keeps a loaded seed through an immediate save and reload', () => {
    const loaded = new Simulation();
    applySave(loaded, saveWithMotorChain(0.5));
    const expected = loaded.chains();

    const reloaded = new Simulation();
    applySave(reloaded, serializeSim(loaded, 1_700_000_000_000));

    expect(reloaded.chains()).toEqual(expected);
  });

  it('does not replace a seed after one sale before the measured window completes', () => {
    const sim = new Simulation();
    applySave(sim, saveWithMotorChain(0.5));
    sell(sim, 'motor');
    for (let tick = 0; tick < 49; tick++) sim.tick();

    expect(sim.chains()).toEqual([motorChain(0.5)]);

    sim.tick();
    expect(sim.chains()).toEqual([
      { id: 'sold-motor', outputResource: 'motor', steadyStateThroughput: 0.2 },
    ]);
  });

  it('reports route health per cell instead of inferring it from aggregate sales', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 16, 38, 180).ok).toBe(true);
    expect(sim.place('belt', 16, 39, 180).ok).toBe(true);
    sim.restoreEntity({
      id: 'x1', type: 'crossing', x: 16, y: 40, rotation: 90,
      level: 1, resourceNode: null, item: null,
    });
    expect(sim.place('belt', 16, 41, 180).ok).toBe(true);
    expect(sim.place('depot', 16, 42, 0).ok).toBe(true);
    sim.restoreEntity({
      id: 'disconnected-stone', type: 'extractor', x: 1, y: 1, rotation: 0,
      level: 1, resourceNode: 'stone', item: null, inputs: {},
    });

    for (let tick = 0; tick < 250; tick += 1) sim.tick();

    expect(sim.chains()).toEqual([
      { id: 'sold-stone', outputResource: 'stone', steadyStateThroughput: 1 },
    ]);
    expect(sim.isConnectedToDepot({ x: 16, y: 38 })).toBe(true);
    expect(sim.isConnectedToDepot({ x: 16, y: 40 })).toBe(true);
    expect(sim.isConnectedToDepot({ x: 1, y: 1 })).toBe(false);
  });

  it('caches route health and invalidates it for topology mutations', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 16, 38, 180).ok).toBe(true);
    expect(sim.place('belt', 16, 39, 180).ok).toBe(true);
    expect(sim.place('depot', 16, 40, 0).ok).toBe(true);
    const walks = countRouteWalks(sim);

    expect(sim.isConnectedToDepot({ x: 16, y: 38 })).toBe(true);
    expect(sim.isConnectedToDepot({ x: 16, y: 38 })).toBe(true);
    expect(walks()).toBe(1);

    expect(sim.place('belt', 20, 20, 90).ok).toBe(true);
    expect(sim.isConnectedToDepot({ x: 16, y: 38 })).toBe(true);
    expect(walks()).toBe(2);

    expect(sim.placeRun({ cells: [{ x: 21, y: 20 }, { x: 22, y: 20 }], rotation: 90 })).toHaveLength(2);
    expect(sim.isConnectedToDepot({ x: 16, y: 38 })).toBe(true);
    expect(walks()).toBe(3);

    expect(sim.move({ x: 20, y: 20 }, { x: 20, y: 21 }).ok).toBe(true);
    expect(sim.isConnectedToDepot({ x: 16, y: 38 })).toBe(true);
    expect(walks()).toBe(4);

    expect(sim.removeAt({ x: 20, y: 21 })).toBe(true);
    expect(sim.isConnectedToDepot({ x: 16, y: 38 })).toBe(true);
    expect(walks()).toBe(5);

    sim.reset();
    expect(sim.isConnectedToDepot({ x: 16, y: 38 })).toBe(false);

    sim.restoreEntity({
      id: 'restored-extractor', type: 'extractor', x: 16, y: 38, rotation: 180,
      level: 1, resourceNode: 'stone', item: null, inputs: {},
    });
    sim.restoreEntity({
      id: 'restored-belt', type: 'belt', x: 16, y: 39, rotation: 180,
      level: 1, resourceNode: null, item: null, inputs: {},
    });
    sim.restoreEntity({
      id: 'restored-depot', type: 'depot', x: 16, y: 40, rotation: 0,
      level: 1, resourceNode: null, item: null, inputs: {},
    });
    expect(sim.isConnectedToDepot({ x: 16, y: 38 })).toBe(true);
  });  it('clears old throughput on reset, prestige, and restart', () => {
    const reset = new Simulation();
    sell(reset, 'motor');
    for (let tick = 0; tick < 50; tick++) reset.tick();
    expect(reset.chains()).toHaveLength(1);
    reset.reset();
    expect(reset.chains()).toEqual([]);

    const prestige = new Simulation();
    sell(prestige, 'motor');
    for (let tick = 0; tick < 50; tick++) prestige.tick();
    prestige.lifetimeMotors = 25;
    expect(prestige.prestige().ok).toBe(true);
    expect(prestige.chains()).toEqual([]);

    const restart = new Simulation();
    sell(restart, 'motor');
    for (let tick = 0; tick < 50; tick++) restart.tick();
    restart.restart();
    expect(restart.chains()).toEqual([]);
  });
});
