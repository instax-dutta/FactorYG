import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { TICK_HZ } from '../src/config/constants';

/** Phase 1 accept: "200 belts at 10tps stable". */
const BELT_COUNT = 200;
const SIM_SECONDS = 60;

/** extractor(90) -> belt(90) -> belt(90) -> depot, the only producing chain. */
const CHAIN: { type: 'extractor' | 'belt' | 'depot'; x: number; y: number; rotation: 0 | 90 }[] = [
  { type: 'extractor', x: 22, y: 24, rotation: 90 },
  { type: 'belt', x: 23, y: 24, rotation: 90 },
  { type: 'belt', x: 24, y: 24, rotation: 90 },
  { type: 'depot', x: 25, y: 24, rotation: 0 },
];

function placeChain(sim: Simulation): void {
  for (const part of CHAIN) {
    expect(sim.place(part.type, part.x, part.y, part.rotation).ok).toBe(true);
  }
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

/** The chain plus `BELT_COUNT` idle belts parked in the south-east quadrant. */
function buildLoadedSim(): Simulation {
  const sim = new Simulation();
  placeChain(sim);

  let placed = 0;
  for (let y = 40; y < 64 && placed < BELT_COUNT; y++) {
    for (let x = 40; x < 64 && placed < BELT_COUNT; x++) {
      if (sim.place('belt', x, y, 0).ok) placed++;
    }
  }
  expect(placed).toBe(BELT_COUNT);
  return sim;
}

function placeSmelterRoute(sim: Simulation): void {
  expect(sim.place('smelter', 20, 20, 90).ok).toBe(true);
  expect(sim.place('belt', 21, 20, 90).ok).toBe(true);
  expect(sim.place('depot', 22, 20, 0).ok).toBe(true);
}

describe('inspector route queries', () => {
  it('reports a smelter route to a depot', () => {
    const sim = new Simulation();
    placeSmelterRoute(sim);

    expect(sim.entityReachesDepot({ x: 20, y: 20 })).toBe(true);
  });

  it('rejects a directed hop into a machine that cannot receive it', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
    expect(sim.place('belt', 23, 24, 90).ok).toBe(true);
    expect(sim.place('extractor', 24, 24, 90).ok).toBe(true);
    expect(sim.place('belt', 25, 24, 90).ok).toBe(true);
    expect(sim.place('depot', 26, 24, 0).ok).toBe(true);

    expect(sim.entityReachesDepot({ x: 22, y: 24 })).toBe(false);
  });

  it('keeps splitter exits and temporary belt occupancy out of topology status', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
    expect(sim.place('belt', 23, 24, 90).ok).toBe(true);
    expect(sim.place('splitter', 24, 24, 90).ok).toBe(true);
    expect(sim.place('belt', 25, 24, 90).ok).toBe(true);
    expect(sim.place('depot', 24, 25, 0).ok).toBe(true);
    sim.entityAt({ x: 25, y: 24 })!.item = 'copperOre';

    expect(sim.entityReachesDepot({ x: 22, y: 24 })).toBe(true);
  });

  it('keeps a crossing pass-through route in every direction', () => {
    const sim = new Simulation();
    sim.restoreEntity({
      id: 'crossing-1', type: 'crossing', x: 22, y: 24, rotation: 0,
      level: 1, resourceNode: null, item: null, inputs: {},
    });
    for (const [x, y] of [[22, 23], [23, 24], [22, 25], [21, 24]]) {
      expect(sim.place('depot', x, y, 0).ok).toBe(true);
    }

    expect(sim.entityReachesDepot({ x: 22, y: 24 })).toBe(true);
  });

  it('follows routes longer than 256 entities', () => {
    const sim = new Simulation();
    const place = (x: number, y: number, rotation: 0 | 90 | 180 | 270): void => {
      expect(sim.place('belt', x, y, rotation).ok).toBe(true);
    };
    for (let x = 1; x <= 59; x += 1) place(x, 0, 90);
    place(60, 0, 180);
    place(60, 1, 180);
    for (let x = 59; x >= 2; x -= 1) place(x, 1, 270);
    place(1, 1, 180);
    place(1, 2, 180);
    for (let x = 2; x <= 59; x += 1) place(x, 2, 90);
    place(60, 2, 180);
    place(60, 3, 180);
    for (let x = 59; x >= 3; x -= 1) place(x, 3, 270);
    place(2, 3, 180);
    place(2, 4, 180);
    for (let x = 3; x <= 61; x += 1) place(x, 4, 90);
    expect(sim.place('depot', 62, 4, 0).ok).toBe(true);
    expect(sim.entities().length).toBeGreaterThan(256);

    expect(sim.entityReachesDepot({ x: 1, y: 0 })).toBe(true);
  });

  it('invalidates cached routes across topology mutations', () => {
    const sim = new Simulation();
    placeSmelterRoute(sim);
    const source = { x: 20, y: 20 };
    const belt = { x: 21, y: 20 };

    expect(sim.entityReachesDepot(source)).toBe(true);
    let version = sim.topologyVersion;
    expect(sim.entityReachesDepot(source)).toBe(true);
    expect(sim.topologyVersion).toBe(version);

    expect(sim.place('belt', 30, 30, 90).ok).toBe(true);
    expect(sim.topologyVersion).toBeGreaterThan(version);
    version = sim.topologyVersion;
    expect(sim.entityReachesDepot(source)).toBe(true);

    expect(sim.placeRun({ cells: [{ x: 31, y: 30 }, { x: 32, y: 30 }], rotation: 90 })).toHaveLength(2);
    expect(sim.topologyVersion).toBeGreaterThan(version);
    version = sim.topologyVersion;
    expect(sim.entityReachesDepot(source)).toBe(true);

    expect(sim.removeAt(belt)).toBe(true);
    expect(sim.topologyVersion).toBeGreaterThan(version);
    version = sim.topologyVersion;
    expect(sim.entityReachesDepot(source)).toBe(false);

    sim.restoreEntity({
      id: 'restored-belt', type: 'belt', x: belt.x, y: belt.y, rotation: 90,
      level: 1, resourceNode: null, item: null, inputs: {},
    });
    expect(sim.topologyVersion).toBeGreaterThan(version);
    expect(sim.entityReachesDepot(source)).toBe(true);
    version = sim.topologyVersion;

    expect(sim.move(belt, { x: 23, y: 20 }).ok).toBe(true);
    expect(sim.topologyVersion).toBeGreaterThan(version);
    version = sim.topologyVersion;
    expect(sim.entityReachesDepot(source)).toBe(false);

    sim.reset();
    expect(sim.topologyVersion).toBeGreaterThan(version);
    version = sim.topologyVersion;
    expect(sim.entityReachesDepot(source)).toBe(false);

    sim.restoreEntity({
      id: 'restored-smelter', type: 'smelter', x: 20, y: 20, rotation: 90,
      level: 1, resourceNode: null, item: null, inputs: {},
    });
    sim.restoreEntity({
      id: 'restored-belt-final', type: 'belt', x: 21, y: 20, rotation: 90,
      level: 1, resourceNode: null, item: null, inputs: {},
    });
    sim.restoreEntity({
      id: 'restored-depot', type: 'depot', x: 22, y: 20, rotation: 0,
      level: 1, resourceNode: null, item: null, inputs: {},
    });
    expect(sim.topologyVersion).toBeGreaterThan(version);
    expect(sim.entityReachesDepot(source)).toBe(true);
  });
});

describe('simulation load (Phase 1 accept)', () => {
  it(`${BELT_COUNT} idle belts do not change what the chain produces`, () => {
    const bare = new Simulation();
    placeChain(bare);
    run(bare, SIM_SECONDS * TICK_HZ);

    const loaded = buildLoadedSim();
    run(loaded, SIM_SECONDS * TICK_HZ);

    // Identical income proves the extra entities neither stall, block, nor
    // feed the chain.
    expect(bare.currency).toBeGreaterThan(0);
    expect(loaded.currency).toBe(bare.currency);

    // One ore per second at 0.4 cr each, once the ramp-up has settled.
    expect(loaded.cps()).toBeCloseTo(0.4, 6);
    expect(loaded.chains()).toHaveLength(1);
  });

  it('keeps entity state consistent across a long run', () => {
    const sim = buildLoadedSim();
    const before = sim.entities();

    run(sim, SIM_SECONDS * TICK_HZ);

    const after = sim.entities();
    expect(after).toHaveLength(before.length);

    // No cell holds two entities, and ids stay unique.
    expect(new Set(after.map((entity) => `${entity.x},${entity.y}`)).size).toBe(after.length);
    expect(new Set(after.map((entity) => entity.id)).size).toBe(after.length);

    // Idle belts hold nothing; only the chain is carrying ore.
    const carrying = after.filter((entity) => entity.item !== null);
    expect(carrying.every((entity) => entity.type !== 'belt' || entity.x <= 25)).toBe(true);
  });

  it('runs 10 seconds of sim inside the tick budget', () => {
    const sim = buildLoadedSim();

    const started = performance.now();
    run(sim, 10 * TICK_HZ);
    const elapsedMs = performance.now() - started;

    // A 10tps budget is 1000ms for this window; the guard only fails if the
    // tick cost has blown up by orders of magnitude.
    console.log(`200 belts: ${100} ticks in ${elapsedMs.toFixed(1)}ms`);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
