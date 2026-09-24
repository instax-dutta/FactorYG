import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { TICK_HZ } from '../src/config/constants';
import { ALL_UNLOCKED } from '../src/sim/techTree';

const COPPER_NODE = { x: 22, y: 24 };
const EXTRACT_TICKS = 10;

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

/** extractor(90) -> belt(90) -> belt(90) -> depot */
function buildChain(): Simulation {
  const sim = new Simulation();
  expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
  expect(sim.place('belt', 23, 24, 90).ok).toBe(true);
  expect(sim.place('belt', 24, 24, 90).ok).toBe(true);
  expect(sim.place('depot', 25, 24, 0).ok).toBe(true);
  return sim;
}

describe('simulation tick', () => {
  it('extractor on copper node produces ore over time', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', COPPER_NODE.x, COPPER_NODE.y, 90).ok).toBe(true);

    run(sim, EXTRACT_TICKS - 1);
    expect(sim.entityAt(COPPER_NODE)?.item).toBeNull();

    sim.tick();
    expect(sim.entityAt(COPPER_NODE)?.item).toBe('copperOre');

    // A full buffer must block rather than losing or duplicating ore.
    run(sim, 5 * EXTRACT_TICKS);
    expect(sim.entityAt(COPPER_NODE)?.item).toBe('copperOre');
  });

  it('extractor off node produces nothing', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 5, 5, 0)).toEqual({ ok: false, reason: 'no-resource-node' });

    run(sim, 4 * EXTRACT_TICKS);
    expect(sim.entityAt({ x: 5, y: 5 })).toBeNull();
    expect(sim.currency).toBe(0);
  });

  it('belt moves item 1 cell per tick toward output direction', () => {
    const sim = buildChain();

    // Extraction takes EXTRACT_TICKS, then the item is carried one cell a tick.
    run(sim, EXTRACT_TICKS);
    expect(sim.entityAt(COPPER_NODE)?.item).toBe('copperOre');

    sim.tick();
    expect(sim.entityAt(COPPER_NODE)?.item).toBeNull();
    expect(sim.entityAt({ x: 23, y: 24 })?.item).toBe('copperOre');

    sim.tick();
    expect(sim.entityAt({ x: 23, y: 24 })?.item).toBeNull();
    expect(sim.entityAt({ x: 24, y: 24 })?.item).toBe('copperOre');
    expect(sim.currency).toBe(0);

    sim.tick();
    expect(sim.entityAt({ x: 24, y: 24 })?.item).toBeNull();
    expect(sim.currency).toBeCloseTo(0.4, 6);
  });

  it('belt auto-connects to adjacent belt/machine facing correct direction', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
    expect(sim.place('belt', 23, 24, 90).ok).toBe(true);
    // Facing back up the line: the upstream belt sits on its output side, so
    // the item cannot come back against the flow.
    expect(sim.place('belt', 24, 24, 270).ok).toBe(true);

    run(sim, EXTRACT_TICKS + 1);
    expect(sim.entityAt({ x: 23, y: 24 })?.item).toBe('copperOre');
    expect(sim.entityAt({ x: 24, y: 24 })?.item).toBeNull();

    // Point it downstream and it connects.
    sim.removeAt({ x: 24, y: 24 });
    expect(sim.place('belt', 24, 24, 90).ok).toBe(true);
    sim.tick();
    expect(sim.entityAt({ x: 23, y: 24 })?.item).toBeNull();
    expect(sim.entityAt({ x: 24, y: 24 })?.item).toBe('copperOre');
    expect(sim.currency).toBe(0);
  });

  it('a belt takes from the side, so a run can turn a corner', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 22, 24, 180).ok).toBe(true);
    // South, then east around the corner, into the depot.
    expect(sim.place('belt', 22, 25, 180).ok).toBe(true);
    expect(sim.place('belt', 22, 26, 90).ok).toBe(true);
    expect(sim.place('depot', 23, 26, 0).ok).toBe(true);

    run(sim, EXTRACT_TICKS + 3);

    // The corner belt received from the north rather than from behind.
    expect(sim.currency).toBeCloseTo(0.4, 6);
  });

  it('depot converts delivered ore to currency', () => {
    const sim = buildChain();
    run(sim, EXTRACT_TICKS + 3);

    expect(sim.currency).toBeCloseTo(0.4, 6);
    expect(sim.entityAt({ x: 25, y: 24 })?.item).toBeNull();

    // Steady flow keeps converting: another ore reaches the depot 10 ticks on.
    run(sim, EXTRACT_TICKS);
    expect(sim.currency).toBeCloseTo(0.8, 6);
  });

  it('currencyPerSec rolling average increases under steady flow', () => {
    const sim = buildChain();
    run(sim, 3 * TICK_HZ);
    const early = sim.snapshot().cps;

    run(sim, 3 * TICK_HZ);
    const later = sim.snapshot().cps;

    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(early);
    // Steady state: 1 ore/sec at 0.4 per ore.
    expect(later).toBeLessThanOrEqual(0.4);
  });

  it('canPlaceAt reports placement rules without mutating the sim', () => {
    const sim = buildChain();

    expect(sim.canPlaceAt('extractor', 5, 5)).toEqual({ ok: false, reason: 'no-resource-node' });
    expect(sim.canPlaceAt('belt', 23, 24)).toEqual({ ok: false, reason: 'occupied' });
    expect(sim.canPlaceAt('belt', -1, 0)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(sim.canPlaceAt('belt', 26, 24)).toEqual({ ok: true });
    expect(sim.entities()).toHaveLength(4);
  });

  it('wakes every dormant assembler with buffered inputs after a recipe unlock', () => {
    const sim = new Simulation({
      unlocked: {
        ...ALL_UNLOCKED,
        recipes: ALL_UNLOCKED.recipes.filter((id) => id !== 'circuit'),
      },
    });
    sim.currency = 1_000;
    const entities = [
      sim.restoreEntity({
        id: 'e1',
        type: 'assembler',
        x: 30,
        y: 30,
        rotation: 90,
        level: 1,
        resourceNode: null,
        item: null,
        inputs: { wire: 1, gear: 1 },
      }),
      sim.restoreEntity({
        id: 'e2',
        type: 'assembler',
        x: 31,
        y: 30,
        rotation: 90,
        level: 1,
        resourceNode: null,
        item: null,
        inputs: { wire: 1, gear: 1 },
      }),
    ];

    sim.tick();
    sim.tick();
    expect(sim.lastTickWork).toBe(0);
    expect(entities.every((entity) => entity.recipe === null)).toBe(true);

    expect(sim.unlock('circuit').ok).toBe(true);
    sim.tick();
    for (const entity of entities) {
      expect(entity.recipe).toBe('circuit');
      expect(entity.inputs).toEqual({});
    }
  });

  it('invalid placement (occupied / out of bounds) is rejected', () => {
    const sim = buildChain();

    expect(sim.place('belt', 23, 24, 90)).toEqual({ ok: false, reason: 'occupied' });
    expect(sim.place('belt', -1, 0, 90)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(sim.place('belt', 64, 0, 90)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(sim.entities().length).toBe(4);

    // Demolishing frees the cell again.
    expect(sim.removeAt({ x: 24, y: 24 })).toBe(true);
    expect(sim.place('belt', 24, 24, 90).ok).toBe(true);
  });
});
