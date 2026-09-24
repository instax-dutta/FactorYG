import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { straightRun } from '../src/sim/runs';
import { createHistory } from '../src/sim/history';
import type { Cell } from '../src/sim/placement';

/**
 * Multi-place: dragging out a straight belt run in one gesture.
 *
 * The act 3 build is ~140 cells and nearly all of them are belt; placing them one
 * click at a time is the single biggest cost of playing the game past act 2. A
 * drag is one edit, so it undoes as one edit too — undoing a 12-belt run one cell
 * at a time would be its own kind of punishment.
 */

const cell = (x: number, y: number): Cell => ({ x, y });

describe('straightRun', () => {
  it('walks a vertical drag from the first cell to the last', () => {
    const run = straightRun(cell(5, 5), cell(5, 9));
    expect(run.cells).toEqual([cell(5, 5), cell(5, 6), cell(5, 7), cell(5, 8), cell(5, 9)]);
    // y grows downward, so a downward drag feeds south.
    expect(run.rotation).toBe(180);
  });

  it('faces the belts the way the drag went', () => {
    // Dragging back the other way has to reverse the run, or a player who
    // overshoots and drags back would place belts against their own line.
    expect(straightRun(cell(5, 9), cell(5, 5)).rotation).toBe(0);
    expect(straightRun(cell(5, 5), cell(5, 9)).rotation).toBe(180);
    expect(straightRun(cell(2, 5), cell(7, 5)).rotation).toBe(90);
    expect(straightRun(cell(7, 5), cell(2, 5)).rotation).toBe(270);
  });

  it('snaps a diagonal drag to its dominant axis', () => {
    // A mouse drag is never axis-perfect. Snapping to the longer leg is what
    // makes a run buildable without pixel-hunting.
    const flat = straightRun(cell(5, 5), cell(9, 6));
    expect(flat.cells).toEqual([cell(5, 5), cell(6, 5), cell(7, 5), cell(8, 5), cell(9, 5)]);
    expect(flat.rotation).toBe(90);

    const tall = straightRun(cell(5, 5), cell(6, 9));
    expect(tall.cells).toEqual([cell(5, 5), cell(5, 6), cell(5, 7), cell(5, 8), cell(5, 9)]);
    expect(tall.rotation).toBe(180);
  });

  it('is a single cell when the drag does not move', () => {
    expect(straightRun(cell(5, 5), cell(5, 5)).cells).toEqual([cell(5, 5)]);
  });

  it('breaks a perfect diagonal toward the horizontal leg', () => {
    // Deterministic, so a drag that is exactly 45 degrees cannot flicker
    // between two runs as the mouse jitters.
    const run = straightRun(cell(5, 5), cell(8, 8));
    expect(run.cells).toEqual([cell(5, 5), cell(6, 5), cell(7, 5), cell(8, 5)]);
  });
});

describe('Simulation belt runs', () => {
  it('places a belt on every cell of the run, facing along it', () => {
    const sim = new Simulation();
    const run = straightRun(cell(20, 20), cell(24, 20));

    expect(sim.canPlaceRun(run)).toBe(true);
    const placed = sim.placeRun(run);

    expect(placed).toEqual(run.cells);
    for (const at of run.cells) {
      const entity = sim.entityAt(at);
      expect(entity?.type).toBe('belt');
      expect(entity?.rotation).toBe(90);
    }
  });

  it('refuses the whole run when any cell is taken', () => {
    const sim = new Simulation();
    sim.place('belt', 22, 20, 90);
    const run = straightRun(cell(20, 20), cell(24, 20));

    // All-or-nothing: a run with a hole in it is worse than no run, because the
    // player cannot see which cell was dropped without inspecting each one.
    expect(sim.canPlaceRun(run)).toBe(false);
    expect(sim.placeRun(run)).toEqual([]);
    expect(sim.entityAt(cell(20, 20))).toBeNull();
    expect(sim.entityAt(cell(24, 20))).toBeNull();
  });

  it('does not mutate the world while answering canPlaceRun', () => {
    const sim = new Simulation();
    const run = straightRun(cell(20, 20), cell(22, 20));
    const before = sim.entities().length;
    sim.canPlaceRun(run);
    expect(sim.entities()).toHaveLength(before);
  });

  it('places a run on resource nodes, because a belt is not an extractor', () => {
    const sim = new Simulation();
    // (22,24) is a copper node; a belt over it is legal, an extractor is not.
    const run = straightRun(cell(22, 24), cell(22, 25));
    expect(sim.placeRun(run)).toEqual(run.cells);
  });

  it('sells nothing on its own, so a run is real belts and not a decoration', () => {
    const sim = new Simulation();
    sim.placeRun(straightRun(cell(20, 20), cell(23, 20)));
    for (let i = 0; i < 100; i++) sim.tick();
    expect(sim.currency).toBe(0);
  });
});

describe('undoing a run', () => {
  it('reverses a whole run as one edit', () => {
    const sim = new Simulation();
    const history = createHistory();
    const run = straightRun(cell(20, 20), cell(24, 20));

    const before = sim.entities().length;
    const placed = sim.placeRun(run);
    history.recordRun(placed);
    expect(sim.entities()).toHaveLength(before + 5);

    expect(history.undo(sim)).toBe(true);
    expect(sim.entities()).toHaveLength(before);
    expect(sim.entityAt(cell(20, 20))).toBeNull();
  });

  it('counts as one entry, so the edit before it is still reachable', () => {
    const sim = new Simulation();
    const history = createHistory();

    sim.place('smelter', 30, 30, 90);
    history.recordPlace(cell(30, 30));
    const placed = sim.placeRun(straightRun(cell(20, 20), cell(22, 20)));
    history.recordRun(placed);

    history.undo(sim); // the run
    expect(sim.entityAt(cell(30, 30))?.type).toBe('smelter');
    history.undo(sim); // then the smelter
    expect(sim.entityAt(cell(30, 30))).toBeNull();
  });

  it('leaves a machine placed on top of the run alone', () => {
    const sim = new Simulation();
    const history = createHistory();
    const run = straightRun(cell(20, 20), cell(22, 20));
    history.recordRun(sim.placeRun(run));

    // The player replaces a belt with a smelter, then undoes the run. Removing
    // the run must not delete the smelter that now stands there.
    sim.removeAt(cell(21, 20));
    sim.place('smelter', 21, 20, 90);

    history.undo(sim);
    expect(sim.entityAt(cell(21, 20))?.type).toBe('smelter');
    expect(sim.entityAt(cell(20, 20))).toBeNull();
  });
});
