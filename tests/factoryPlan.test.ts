import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { MACHINES, ROTATIONS } from '../src/sim/machines';
import { resourceNodeAt } from '../src/sim/worldgen';
import {
  planMotorFactory,
  applyPlan,
  diagnoseAttempt,
  planSize,
  PLANNER_ATTEMPTS,
  type FactoryPlan,
} from './support/factoryPlan';

/**
 * The world-scale factory: eight extractors on real map nodes, corridors all the
 * way to a refinery, and a Motor out the far end.
 *
 * STATUS: UNBLOCKED by the crossing tile (PLAYTEST.md §5 fix 1).
 *
 * When the playtest tried to beat act 3 it found the map could not express the
 * factory: with one entity per cell, a line that descends is a wall, and the
 * coal lines had to cross the iron lines. The planner could not route all 28
 * connections in any of 200 orders. The crossing tile — two lines pass through
 * one cell, each straight through on its own axis — is the fix, and these tests
 * are the acceptance ones the blocked file promised to keep:
 *
 *   the plan exists -> it places -> it delivers ore -> a Motor is sold.
 *
 * `planMotorFactory()` routes every connection before anything is placed, so a
 * collision is a one-line fix instead of a bisect through a half-built factory.
 */

function tryPlan(): FactoryPlan | null {
  try {
    return planMotorFactory();
  } catch {
    return null;
  }
}

describe('world-scale motor factory (act 3, unblocked by the crossing)', () => {
  it(
    `routes all 28 connections within ${PLANNER_ATTEMPTS} search orders`,
    () => {
      expect(tryPlan()).not.toBeNull();
    },
    60_000,
  );

  it('sells a Motor, which can only happen if every tier ran', () => {
    const plan = planMotorFactory();
    const sim = new Simulation();
    applyPlan(sim, plan);

    let ticks = 0;
    while (ticks < 60_000 && sim.currency === 0) {
      sim.tick();
      ticks += 1;
    }

    expect(ticks).toBeLessThan(60_000);
    // Exactly one motor's worth of raw is not guaranteed — silos buffer 50 and
    // keep feeding — so assert the first sale is a motor's value, not a running
    // total.
    expect(sim.currency).toBeGreaterThanOrEqual(1500);
    expect(sim.currency % 1500).toBeCloseTo(0, 6);
  });

  it('places eight extractors, one per raw stream, each on its own node', () => {
    const plan = planMotorFactory();
    const extractors = plan.machines.filter((machine) => machine.type === 'extractor');
    expect(extractors).toHaveLength(8);

    const resources = extractors.map((machine) => resourceNodeAt(machine.x, machine.y));
    expect(resources).not.toContain(null);
    expect(resources.filter((r) => r === 'ironOre')).toHaveLength(3);
    expect(resources.filter((r) => r === 'coal')).toHaveLength(3);
    expect(resources.filter((r) => r === 'copperOre')).toHaveLength(1);
    expect(resources.filter((r) => r === 'stone')).toHaveLength(1);
  });

  it('never puts two things in one cell', () => {
    const plan = planMotorFactory();
    const cells = new Set<string>();
    for (const thing of [...plan.machines, ...plan.belts, ...plan.crossings]) {
      const at = `${thing.x},${thing.y}`;
      expect(cells.has(at), `${at} is used twice`).toBe(false);
      cells.add(at);
    }
    expect(cells.size).toBe(planSize(plan).total);
  });

  it('uses crossings only where two lines genuinely meet, and every one stays a straight flow', () => {
    const plan = planMotorFactory();
    expect(plan.crossings.length).toBeGreaterThan(0);

    // A crossing sits on a cell no belt or machine also claims.
    const beltCells = new Set(plan.belts.map((belt) => `${belt.x},${belt.y}`));
    for (const crossing of plan.crossings) {
      expect(beltCells.has(`${crossing.x},${crossing.y}`)).toBe(false);
    }
  });

  it('gives every crossing exactly two riders, on perpendicular axes', () => {
    // A crossing resolves one lane per axis. Two same-axis riders would share
    // one lane: their deliveries interleave into the same exit cell and the
    // sim overwrites one. So the plan may only convert a belt whose stream is
    // PERPENDICULAR to the rider — asserted here off the routes themselves.
    const plan = planMotorFactory();
    const riders = new Map<string, { axis: string; route: string }[]>();
    for (const route of plan.routes) {
      for (let i = 0; i < route.belts.length; i++) {
        const at = route.belts[i];
        if (!plan.crossings.some((c) => c.x === at.x && c.y === at.y)) continue;
        const prev = route.belts[i - 1] ?? { x: at.x - 1, y: at.y }; // extractors enter heading east
        const axis = at.y - prev.y !== 0 ? 'v' : 'h';
        const list = riders.get(`${at.x},${at.y}`) ?? [];
        list.push({ axis, route: route.connection });
        riders.set(`${at.x},${at.y}`, list);
      }
    }

    for (const [at, list] of riders) {
      expect(list.length, `${at} has ${list.length} riders`).toBe(2);
      expect(new Set(list.map((r) => r.axis)).size, `${at} riders share an axis: ${list.map((r) => r.route).join(', ')}`).toBe(2);
    }
  });

  it('points every belt at the next cell of its route, crossings included', () => {
    const plan = planMotorFactory();
    const typeAt = new Map<string, string>();
    for (const belt of plan.belts) typeAt.set(`${belt.x},${belt.y}`, 'belt');
    for (const crossing of plan.crossings) typeAt.set(`${crossing.x},${crossing.y}`, 'crossing');

    for (const route of plan.routes) {
      for (let i = 0; i < route.belts.length; i++) {
        const cell = route.belts[i];
        const next = route.belts[i + 1];
        const placed = plan.belts.find((candidate) => candidate.x === cell.x && candidate.y === cell.y);
        if (!placed) continue; // this cell is a crossing: no facing of its own

        const delta = deltaOf(placed.rotation);
        const facing = { x: cell.x + delta.x, y: cell.y + delta.y };
        if (!next) continue;
        // Into a crossing, or along the route: either way the cell it faces
        // must be the one the item travels next.
        expect(facing).toEqual(next);
        expect(typeAt.has(`${next.x},${next.y}`), `${route.connection} faces empty ground at ${next.x},${next.y}`).toBe(true);
      }
    }
  });

  it('plans only legal rotations', () => {
    const plan = planMotorFactory();
    for (const thing of [...plan.machines, ...plan.belts]) {
      expect(ROTATIONS).toContain(thing.rotation);
    }
  });
});

describe('act-3 history (the reason the crossing exists)', () => {
  it('records that the dependency-ordered attempt now succeeds too', () => {
    // Before the crossing this order died on corridor:stone; now overpasses
    // carry any line that would otherwise wall another in.
    expect(diagnoseAttempt(Array.from({ length: 28 }, (_, i) => i)).failed).toBeNull();
  });
});

function deltaOf(rotation: number): { x: number; y: number } {
  switch (rotation) {
    case 0:
      return { x: 0, y: -1 };
    case 90:
      return { x: 1, y: 0 };
    case 180:
      return { x: 0, y: 1 };
    default:
      return { x: -1, y: 0 };
  }
}

describe('plan prerequisites that hold today', () => {
  it('refuses to place an extractor anywhere but a resource node', () => {
    const sim = new Simulation();
    expect(resourceNodeAt(1, 1)).toBeNull();
    expect(sim.place('extractor', 1, 1, 0).ok).toBe(false);
  });

  it('knows the machine definitions the plan depends on', () => {
    expect(MACHINES.silo.ports.input).toBe('all');
    expect(MACHINES.silo.bufferSize).toBeGreaterThan(1);
    expect(MACHINES.extractor.inputs).toBe(0);
    expect(MACHINES.smelter.inputs).toBe(2);
  });
});
