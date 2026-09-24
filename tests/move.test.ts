import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';

/**
 * Moving a placed machine. This is what makes a long belt run fixable: a
 * mis-placed belt used to mean demolish-and-rebuild the whole run behind it.
 *
 * A move is a relocation, not a rebuild — id, level, buffer, held item and
 * in-flight progress all travel with the machine, so moving a silo does not
 * quietly empty it and moving an extractor does not reset its work.
 */

const cell = (x: number, y: number): Cell => ({ x, y });
type Cell = { x: number; y: number };

describe('Simulation.move', () => {
  it('relocates a machine and leaves nothing behind', () => {
    const sim = new Simulation();
    expect(sim.place('belt', 30, 30, 90).ok).toBe(true);

    expect(sim.move(cell(30, 30), cell(31, 31))).toEqual({ ok: true });

    expect(sim.entityAt(cell(30, 30))).toBeNull();
    expect(sim.entityAt(cell(31, 31))?.type).toBe('belt');
    expect(sim.entities()).toHaveLength(1);
  });

  it('keeps the id, level and rotation, so nothing downstream is disturbed', () => {
    const sim = new Simulation();
    const placed = sim.place('assembler', 30, 30, 180);
    expect(placed.ok).toBe(true);
    if (!placed.ok) throw new Error('unreachable');
    sim.currency = 1000;
    expect(sim.upgrade(cell(30, 30)).ok).toBe(true);
    expect(sim.entityAt(cell(30, 30))?.level).toBe(2);

    expect(sim.move(cell(30, 30), cell(33, 30)).ok).toBe(true);

    const moved = sim.entityAt(cell(33, 30));
    expect(moved).toMatchObject({ id: placed.entity.id, type: 'assembler', rotation: 180, level: 2 });
  });

  it('carries a silo buffer with it', () => {
    const sim = new Simulation();
    sim.restoreEntity({
      id: 'silo1',
      type: 'silo',
      x: 30,
      y: 30,
      rotation: 90,
      level: 1,
      resourceNode: null,
      item: 'copperOre',
      inputs: { copperOre: 28, ironOre: 3 },
    });

    expect(sim.move(cell(30, 30), cell(34, 34)).ok).toBe(true);

    expect(sim.entityAt(cell(34, 34))?.inputs).toEqual({ copperOre: 28, ironOre: 3 });
  });

  it('keeps a machine awake and keeps its work in flight', () => {
    const sim = new Simulation();
    // Extractor ticks every 10; run it half-way so the move has state to lose.
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
    for (let i = 0; i < 5; i++) sim.tick();
    expect(sim.entityAt(cell(22, 24))?.progress).toBe(5);

    expect(sim.move(cell(22, 24), cell(24, 24)).ok).toBe(true);
    const moved = sim.entityAt(cell(24, 24));
    expect(moved?.progress).toBe(5);

    // Half a job already done: five more ticks finish it, which only holds if
    // the moved machine is still in the active set.
    for (let i = 0; i < 5; i++) sim.tick();
    expect(sim.entityAt(cell(24, 24))?.item).toBe('copperOre');
  });

  it('takes the resource of the node it lands on', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
    expect(sim.entityAt(cell(22, 24))?.resourceNode).toBe('copperOre');

    // A different resource, not just a different tile.
    expect(sim.move(cell(22, 24), cell(40, 35)).ok).toBe(true);
    expect(sim.entityAt(cell(40, 35))?.resourceNode).toBe('ironOre');
  });

  it('refuses an extractor with no node under it, without moving anything', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);

    expect(sim.move(cell(22, 24), cell(23, 24))).toEqual({
      ok: false,
      reason: 'no-resource-node',
    });
    expect(sim.entityAt(cell(22, 24))?.type).toBe('extractor');
    expect(sim.entityAt(cell(23, 24))).toBeNull();
  });

  it('refuses an occupied target so a machine cannot be overwritten', () => {
    const sim = new Simulation();
    expect(sim.place('belt', 30, 30, 90).ok).toBe(true);
    expect(sim.place('depot', 31, 30, 0).ok).toBe(true);

    expect(sim.move(cell(30, 30), cell(31, 30))).toEqual({ ok: false, reason: 'occupied' });
    expect(sim.entityAt(cell(30, 30))?.type).toBe('belt');
    expect(sim.entityAt(cell(31, 30))?.type).toBe('depot');
  });

  it('refuses an empty source, the same cell, and off the plot', () => {
    const sim = new Simulation();
    expect(sim.place('belt', 30, 30, 90).ok).toBe(true);

    expect(sim.move(cell(20, 20), cell(21, 21))).toEqual({ ok: false, reason: 'empty' });
    expect(sim.move(cell(30, 30), cell(30, 30))).toEqual({ ok: false, reason: 'same-cell' });
    expect(sim.move(cell(30, 30), cell(64, 30))).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(sim.move(cell(30, 30), cell(30, -1))).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(sim.entityAt(cell(30, 30))?.type).toBe('belt');
  });

  it('answers whether a move is legal without performing it', () => {
    const sim = new Simulation();
    expect(sim.place('belt', 30, 30, 90).ok).toBe(true);
    expect(sim.place('depot', 31, 30, 0).ok).toBe(true);

    // The drag preview asks this on every pointer move, so it must not mutate:
    // a refused check that moved the machine anyway would be the bug it exists
    // to prevent.
    expect(sim.canMove(cell(30, 30), cell(32, 30)).ok).toBe(true);
    expect(sim.canMove(cell(30, 30), cell(31, 30)).ok).toBe(false);
    expect(sim.canMove(cell(20, 20), cell(21, 21)).ok).toBe(false);
    expect(sim.canMove(cell(30, 30), cell(30, 30)).ok).toBe(false);
    expect(sim.canMove(cell(30, 30), cell(64, 30)).ok).toBe(false);

    expect(sim.entityAt(cell(30, 30))?.type).toBe('belt');
    expect(sim.entityAt(cell(32, 30))).toBeNull();
  });

  it('moves a belt without breaking the line it is part of', () => {
    const sim = new Simulation();
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
    expect(sim.place('belt', 23, 24, 90).ok).toBe(true);
    expect(sim.place('depot', 24, 24, 0).ok).toBe(true);

    // Nudge the belt out of line and back: the run keeps selling, which is the
    // whole point of being able to move it instead of rebuilding it.
    expect(sim.move(cell(23, 24), cell(23, 25)).ok).toBe(true);
    expect(sim.move(cell(23, 25), cell(23, 24)).ok).toBe(true);

    for (let i = 0; i < 40 && sim.currency === 0; i++) sim.tick();
    expect(sim.currency).toBeGreaterThan(0);
  });
});
