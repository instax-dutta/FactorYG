import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import type { Rotation } from '../src/sim/machines';
import { createHistory } from '../src/sim/history';

/**
 * Undo for factory edits. Machines are free, so this is not about money: it is
 * about not having to re-click a 20-belt run because the fourth belt is one
 * cell off.
 *
 * The history is deliberately in-memory only. Undoing an action that happened
 * before a reload would need the pre-reload world in the save, and a player
 * reloading a save has already accepted that state as the truth.
 */

const cell = (x: number, y: number): { x: number; y: number } => ({ x, y });

function place(
  sim: Simulation,
  history: ReturnType<typeof createHistory>,
  type: 'belt' | 'silo' | 'depot',
  x: number,
  y: number,
  rotation: Rotation = 90,
): void {
  expect(sim.place(type, x, y, rotation).ok).toBe(true);
  history.recordPlace(cell(x, y));
}

describe('edit history', () => {
  it('reports whether there is anything to undo', () => {
    const history = createHistory();
    expect(history.canUndo()).toBe(false);
    expect(history.undo(new Simulation())).toBe(false);
  });

  it('undoes a placement', () => {
    const sim = new Simulation();
    const history = createHistory();
    place(sim, history, 'belt', 30, 30);
    place(sim, history, 'belt', 31, 30);

    expect(history.undo(sim)).toBe(true);
    expect(sim.entityAt(cell(31, 30))).toBeNull();
    expect(sim.entityAt(cell(30, 30))?.type).toBe('belt');
    expect(history.canUndo()).toBe(true);

    expect(history.undo(sim)).toBe(true);
    expect(sim.entities()).toEqual([]);
    expect(history.canUndo()).toBe(false);
  });

  it('undoes a demolish by putting the machine back exactly as it was', () => {
    const sim = new Simulation();
    const history = createHistory();
    sim.restoreEntity({
      id: 'silo1',
      type: 'silo',
      x: 30,
      y: 30,
      rotation: 180,
      level: 3,
      resourceNode: null,
      item: 'ironOre',
      inputs: { ironOre: 12, coal: 4 },
    });

    const doomed = sim.entityAt(cell(30, 30));
    if (!doomed) throw new Error('unreachable');
    history.recordDemolish(doomed);
    sim.removeAt(cell(30, 30));
    expect(sim.entityAt(cell(30, 30))).toBeNull();

    expect(history.undo(sim)).toBe(true);
    // Everything a silo is: its buffer, the item it was releasing, its level,
    // its facing and its id (so the mesh and the chain readout keep matching).
    expect(sim.entityAt(cell(30, 30))).toEqual({
      id: 'silo1',
      type: 'silo',
      x: 30,
      y: 30,
      rotation: 180,
      level: 3,
      resourceNode: null,
      item: 'ironOre',
      inputs: { ironOre: 12, coal: 4 },
      recipe: null,
      progress: 0,
    });
  });

  it('undoes a move by putting the machine back where it was', () => {
    const sim = new Simulation();
    const history = createHistory();
    place(sim, history, 'belt', 30, 30);

    expect(sim.move(cell(30, 30), cell(33, 33)).ok).toBe(true);
    history.recordMove(cell(30, 30), cell(33, 33));

    expect(history.undo(sim)).toBe(true);
    expect(sim.entityAt(cell(33, 33))).toBeNull();
    expect(sim.entityAt(cell(30, 30))?.type).toBe('belt');
  });

  it('undoes a run of edits in reverse order', () => {
    const sim = new Simulation();
    const history = createHistory();
    place(sim, history, 'belt', 30, 30);
    place(sim, history, 'belt', 31, 30);
    place(sim, history, 'depot', 32, 30);

    expect(history.undo(sim)).toBe(true); // depot
    expect(sim.entityAt(cell(32, 30))).toBeNull();
    expect(history.undo(sim)).toBe(true); // second belt
    expect(sim.entityAt(cell(31, 30))).toBeNull();
    expect(sim.entityAt(cell(30, 30))?.type).toBe('belt');
  });

  it('drops the oldest edit once the stack is full', () => {
    const sim = new Simulation();
    const history = createHistory({ limit: 2 });
    place(sim, history, 'belt', 30, 30);
    place(sim, history, 'belt', 31, 30);
    place(sim, history, 'belt', 32, 30);

    // Only the two newest survive, so the first belt stays built forever.
    expect(history.undo(sim)).toBe(true);
    expect(history.undo(sim)).toBe(true);
    expect(history.undo(sim)).toBe(false);
    expect(sim.entityAt(cell(30, 30))?.type).toBe('belt');
    expect(sim.entities()).toHaveLength(1);
  });

  it('forgets everything when the world is replaced', () => {
    const sim = new Simulation();
    const history = createHistory();
    place(sim, history, 'belt', 30, 30);

    // A load or a prestige reset replaces the factory; undoing into the old
    // world would resurrect a machine the player has already left behind.
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.undo(sim)).toBe(false);
  });
});
