import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import type { Cell } from '../src/sim/placement';
import { MACHINES, type Rotation } from '../src/sim/machines';
import { sellValueFor } from '../src/sim/recipes';

const cell = (x: number, y: number): Cell => ({ x, y });

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

/** Ticks until `predicate` holds, so the tests never depend on magic timings. */
function runUntil(sim: Simulation, predicate: () => boolean, maxTicks = 5000): number {
  for (let tick = 1; tick <= maxTicks; tick++) {
    sim.tick();
    if (predicate()) return tick;
  }
  throw new Error('condition never became true');
}

function rotationToward(from: Cell, to: Cell): Rotation {
  if (to.x > from.x) return 90;
  if (to.x < from.x) return 270;
  if (to.y > from.y) return 180;
  return 0;
}

/** Places a belt on each cell, each facing the next, the last facing `into`. */
function beltRun(sim: Simulation, cells: Cell[], into: Cell): void {
  const path = [...cells, into];
  cells.forEach((current, index) => {
    const next = path[index + 1];
    const placed = sim.place('belt', current.x, current.y, rotationToward(current, next));
    expect({ at: `${current.x},${current.y}`, ok: placed.ok }).toEqual({
      at: `${current.x},${current.y}`,
      ok: true,
    });
  });
}

/**
 * Every item held anywhere in the factory: output slots plus buffers. The whole
 * point of backpressure is that this number never goes down except by selling,
 * so it is the assertion that catches both item loss and duplication.
 */
function itemCount(sim: Simulation): number {
  return sim.entities().reduce((total, entity) => {
    const buffered = Object.values(entity.inputs).reduce((sum, count) => sum + (count ?? 0), 0);
    return total + (entity.item === null ? 0 : 1) + buffered;
  }, 0);
}

describe('backpressure + silo (Phase 2, slice 2.4)', () => {
  it('blocked output stalls upstream without losing or duplicating items', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
    // Two belts, the last one feeding a cell that stays empty: a dead end.
    beltRun(sim, [cell(23, 24), cell(24, 24)], cell(25, 24));

    run(sim, 200);

    // The line is full (one item per belt) and the extractor is holding its
    // next ore, so it has stopped: three items, and no fourth anywhere.
    expect(itemCount(sim)).toBe(3);
    expect(sim.entityAt(cell(23, 24))?.item).toBe('copperOre');
    expect(sim.entityAt(cell(24, 24))?.item).toBe('copperOre');
    expect(sim.entityAt(cell(22, 24))?.item).toBe('copperOre');
    expect(sim.currency).toBe(0);

    const stalledProgress = sim.entityAt(cell(22, 24))?.progress;
    run(sim, 300);

    // A stalled machine must not bank progress and then spawn free items, and
    // it must not drop what it is holding either.
    expect(itemCount(sim)).toBe(3);
    expect(sim.entityAt(cell(22, 24))?.progress).toBe(stalledProgress);
    expect(sim.currency).toBe(0);
  });

  it('silo absorbs overflow then releases when downstream frees', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
    beltRun(sim, [cell(23, 24)], cell(24, 24));
    expect(sim.place('silo', 24, 24, 90).ok).toBe(true);
    // Nothing in front of the silo, so its output is blocked from the start.

    run(sim, 900);

    const silo = sim.entityAt(cell(24, 24));
    expect(silo?.type).toBe('silo');
    // The silo held far more than a belt could: that is the overflow absorbed
    // rather than lost, and the source stalled behind it.
    expect(itemCount(sim)).toBeGreaterThan(MACHINES.silo.bufferSize);
    expect(sim.entityAt(cell(23, 24))?.item).toBe('copperOre');
    expect(sim.entityAt(cell(22, 24))?.item).toBe('copperOre');
    expect(sim.currency).toBe(0);

    // Clear the source so what remains can only drain, then free the output.
    expect(sim.removeAt(cell(22, 24))).toBe(true);
    expect(sim.removeAt(cell(23, 24))).toBe(true);
    const buffered = itemCount(sim);
    beltRun(sim, [cell(25, 24)], cell(26, 24));
    expect(sim.place('depot', 26, 24, 0).ok).toBe(true);

    runUntil(sim, () => itemCount(sim) === 0);

    // Every buffered item was sold exactly once: releasing lost nothing and
    // duplicated nothing.
    expect(sim.currency).toBeCloseTo(buffered * sellValueFor('copperOre'), 6);
  });

  it('skips idle machines instead of ticking the whole grid', () => {
    const sim = new Simulation();

    // 30 belts with nothing on them and nothing feeding them.
    for (let x = 30; x < 60; x++) {
      expect(sim.place('belt', x, 30, 90).ok).toBe(true);
    }

    // Placement wakes the new machines; the first tick visits them, and then
    // they have nothing to do and go quiet.
    sim.tick();
    expect(sim.lastTickWork).toBeGreaterThan(0);
    sim.tick();
    expect(sim.lastTickWork).toBe(0);

    // Now feed the run: only the machines that actually hold work should be
    // visited, even though the line is 30 belts long.
    expect(sim.place('extractor', 27, 30, 90).ok).toBe(true);
    beltRun(sim, [cell(28, 30), cell(29, 30)], cell(30, 30));
    expect(sim.place('depot', 60, 30, 0).ok).toBe(true);

    run(sim, 400);

    // Waking up has to be lossless: the chain still delivers, so no wake-up was
    // missed while the belts were asleep.
    expect(sim.currency).toBeGreaterThan(0);
    expect(sim.lastTickWork).toBeLessThan(sim.entities().length / 2);
  });
});
