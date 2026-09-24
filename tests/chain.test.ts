import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import type { Cell } from '../src/sim/placement';
import { type Rotation } from '../src/sim/machines';
import { RECIPES, sellValueFor } from '../src/sim/recipes';

const cell = (x: number, y: number): Cell => ({ x, y });

/** Ticks until `predicate` holds, so the tests never depend on magic timings. */
function runUntil(sim: Simulation, predicate: () => boolean, maxTicks = 5000): number {
  for (let tick = 1; tick <= maxTicks; tick++) {
    sim.tick();
    if (predicate()) return tick;
  }
  throw new Error('condition never became true');
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

function rotationToward(from: Cell, to: Cell): Rotation {
  if (to.x > from.x) return 90;
  if (to.x < from.x) return 270;
  if (to.y > from.y) return 180;
  return 0;
}

/** Places a belt run: each cell faces the next, the last faces `into`. */
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

const steps = (from: Cell, to: Cell): Cell[] => {
  // Inclusive-of-`from`, exclusive-of-`to` straight run, x first then y.
  const cells: Cell[] = [];
  let { x, y } = from;
  while (x !== to.x) {
    cells.push(cell(x, y));
    x += Math.sign(to.x - x);
  }
  while (y !== to.y) {
    cells.push(cell(x, y));
    y += Math.sign(to.y - y);
  }
  return cells;
};

/** extractor(on node) -> belts -> machine -> belt -> depot, all facing east. */
function copperSmelterLine(sim: Simulation): void {
  expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
  beltRun(sim, [cell(23, 24), cell(24, 24)], cell(25, 24));
  expect(sim.place('smelter', 25, 24, 90).ok).toBe(true);
}

describe('chain simulation (Phase 2)', () => {
  it('smelter converts Cu Ore -> Cu Ingot 1:1', () => {
    const sim = new Simulation();
    copperSmelterLine(sim);
    beltRun(sim, [cell(26, 24)], cell(27, 24));
    expect(sim.place('depot', 27, 24, 0).ok).toBe(true);

    const smelter = cell(25, 24);
    runUntil(sim, () => sim.entityAt(smelter)?.recipe !== null);

    // The ore was consumed into one ingot's worth of work, not spawned free.
    expect(sim.entityAt(smelter)?.inputs).toEqual({});
    expect(sim.entityAt(smelter)?.recipe).toBe('copperIngot');
    expect(sim.entityAt(smelter)?.item).toBeNull();

    runUntil(sim, () => sim.entityAt(smelter)?.item !== null);
    expect(sim.entityAt(smelter)?.item).toBe('copperIngot');
    expect(sim.entityAt(smelter)?.recipe).toBeNull();

    runUntil(sim, () => sim.currency > 0);
    expect(sim.currency).toBeCloseTo(sellValueFor('copperIngot'), 6);
  });

  it('smelter requires both inputs for Fe Ingot (Fe Ore + Coal)', () => {
    // Iron on its own: the smelter waits rather than inventing the coal.
    const solo = new Simulation();
    expect(solo.place('extractor', 40, 35, 90).ok).toBe(true);
    beltRun(solo, [cell(41, 35)], cell(42, 35));
    expect(solo.place('smelter', 42, 35, 90).ok).toBe(true);
    beltRun(solo, [cell(43, 35)], cell(44, 35));
    expect(solo.place('depot', 44, 35, 0).ok).toBe(true);

    run(solo, 200);
    expect(solo.entityAt(cell(42, 35))?.inputs).toEqual({ ironOre: 1 });
    expect(solo.entityAt(cell(42, 35))?.recipe).toBeNull();
    expect(solo.currency).toBe(0);

    // Coal routed in from its own node completes the recipe.
    const sim = new Simulation();
    expect(sim.place('extractor', 40, 35, 90).ok).toBe(true);
    beltRun(sim, [cell(41, 35)], cell(42, 35));
    expect(sim.place('extractor', 35, 18, 180).ok).toBe(true);
    // South down x=35, then east along y=34 and south into the smelter's
    // north side. The L-path stops one cell short of the machine, so the last
    // belt is the corner at (42,34) facing it.
    beltRun(sim, [...steps(cell(35, 19), cell(35, 34)), ...steps(cell(35, 34), cell(42, 35))], cell(42, 35));
    expect(sim.place('smelter', 42, 35, 90).ok).toBe(true);
    beltRun(sim, [cell(43, 35)], cell(44, 35));
    expect(sim.place('depot', 44, 35, 0).ok).toBe(true);

    runUntil(sim, () => sim.currency > 0);
    expect(sim.currency).toBeCloseTo(sellValueFor('ironIngot'), 6);
  });

  it('assembler combines 2x Cu Ingot -> Wire', () => {
    const sim = new Simulation();
    copperSmelterLine(sim);
    beltRun(sim, [cell(26, 24)], cell(27, 24));
    expect(sim.place('assembler', 27, 24, 90).ok).toBe(true);
    beltRun(sim, [cell(28, 24)], cell(29, 24));
    expect(sim.place('depot', 29, 24, 0).ok).toBe(true);

    const assembler = cell(27, 24);
    runUntil(sim, () => (sim.entityAt(assembler)?.inputs.copperIngot ?? 0) === 1);
    // One ingot is not enough, and it is held rather than consumed.
    expect(sim.entityAt(assembler)?.recipe).toBeNull();

    runUntil(sim, () => sim.entityAt(assembler)?.recipe !== null);
    expect(sim.entityAt(assembler)?.recipe).toBe('wire');
    expect(sim.entityAt(assembler)?.inputs).toEqual({});
    expect(RECIPES.wire.inputs).toEqual({ copperIngot: 2 });

    runUntil(sim, () => sim.currency > 0);
    expect(sim.currency).toBeCloseTo(sellValueFor('wire'), 6);
  });

  it('motor sells for the highest v1 value', () => {
    const sim = new Simulation();
    expect(sim.place('depot', 30, 30, 0).ok).toBe(true);
    sim.restoreEntity({
      id: 'e1',
      type: 'assembler',
      x: 29,
      y: 30,
      rotation: 90,
      level: 1,
      resourceNode: null,
      item: 'motor',
    });

    const before = sim.currency;
    runUntil(sim, () => sim.currency > before);
    expect(sim.currency).toBeCloseTo(1500, 6);
  });
});
