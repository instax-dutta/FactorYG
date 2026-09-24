import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import type { Cell } from '../src/sim/placement';
import { rotationDelta, type Rotation } from '../src/sim/machines';
import { resourceNodeAt } from '../src/sim/worldgen';

/**
 * Map-scale chain: every raw line from the real worldgen nodes to a silo, hand
 * planned as corridors.
 *
 * Corridors are data, not a search: `planCorridors` expands every one, reports
 * *all* overlapping cells in one run, and only then places anything — so a
 * collision is a one-line fix instead of a bisect through a half-built factory.
 *
 * The layout rule, which is what makes eight lines fit on one 64x64 map without
 * splitters (v1 has none, so no two lines may share a cell):
 *
 *   1. Every line travels **west** from its source, then turns south and
 *      descends **straight into its own silo**. There is no final eastward run:
 *      the descent column *is* the silo's column, so a line never crosses the
 *      band of columns the other lines are descending through.
 *   2. Descent columns are ordered the same way as the source rows — the
 *      northernmost source gets the westernmost column.
 *
 * Together those two make a collision impossible: an east-west run at row `r_j`
 * can only meet a descent whose column is east of `c_j`, and rule 2 means such
 * a descent belongs to a line whose source is *south* of `r_j` — so it starts
 * below that run and never reaches it. Descends are parallel by construction.
 */

const cell = (x: number, y: number): Cell => ({ x, y });
const key = (c: Cell): string => `${c.x},${c.y}`;

/** All silos sit on one row; each is fed from the cell directly north of it. */
const SILO_ROW = 46;

const DELTA_ROTATION: Record<string, Rotation> = {
  '0,-1': 0,
  '1,0': 90,
  '0,1': 180,
  '-1,0': 270,
};

function rotationBetween(from: Cell, to: Cell): Rotation {
  const rotation = DELTA_ROTATION[`${Math.sign(to.x - from.x)},${Math.sign(to.y - from.y)}`];
  if (rotation === undefined) throw new Error(`not axis-aligned: ${key(from)} -> ${key(to)}`);
  return rotation;
}

interface Source {
  /** Cell of the resource node the extractor sits on. */
  node: Cell;
  /** The direction the extractor outputs, i.e. the first corridor cell's side. */
  faces: Rotation;
}

interface Corridor {
  source: Source;
  /** Corner cells between the extractor's output and the target's input cell. */
  waypoints: Cell[];
  /** Cell the run ends on: the target's input side. */
  arrival: Cell;
}

interface Line {
  /** Resource node the extractor sits on. */
  node: Cell;
  /** Column this line descends in, and therefore its silo's column. */
  column: number;
}

/**
 * The eight raw lines, listed north to south. The order of this table *is* the
 * column assignment: north-most source, west-most descent.
 */
const LINES: Record<string, Line> = {
  coal2: { node: cell(32, 15), column: 3 },
  coal1: { node: cell(29, 17), column: 4 },
  coal3: { node: cell(35, 18), column: 5 },
  copper: { node: cell(27, 30), column: 6 },
  iron2: { node: cell(42, 34), column: 7 },
  iron3: { node: cell(40, 35), column: 8 },
  iron1: { node: cell(44, 36), column: 9 },
  stone: { node: cell(16, 38), column: 10 },
};

/** The silo each corridor has to reach: one per line, in the line's column. */
const TARGETS: Record<string, Cell> = Object.fromEntries(
  Object.entries(LINES).map(([name, line]) => [name, cell(line.column, SILO_ROW)]),
);

/** West out of the extractor, west to the column, then straight south. */
const CORRIDORS: Record<string, Corridor> = Object.fromEntries(
  Object.entries(LINES).map(([name, line]) => [
    name,
    {
      source: { node: line.node, faces: 270 as Rotation },
      waypoints: [cell(line.column, line.node.y)],
      arrival: cell(line.column, SILO_ROW - 1),
    },
  ]),
);

/** Expands a corridor's waypoints into every belt cell, in order. */
function expand(source: Source, waypoints: Cell[], arrival: Cell): Cell[] {
  const delta = rotationDelta(source.faces);
  const points = [cell(source.node.x + delta.x, source.node.y + delta.y), ...waypoints, arrival];
  const cells: Cell[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const step = { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
    if (step.x !== 0 && step.y !== 0) throw new Error(`bendless corridors only: ${key(from)}`);
    let current = from;
    while (current.x !== to.x || current.y !== to.y) {
      cells.push(current);
      current = cell(current.x + step.x, current.y + step.y);
    }
  }
  cells.push(points[points.length - 1]);
  return cells;
}

function planCorridors(corridors: Record<string, Corridor>): Record<string, Cell[]> {
  const planned: Record<string, Cell[]> = {};
  const claims = new Map<string, string[]>();

  for (const [name, corridor] of Object.entries(corridors)) {
    if (!resourceNodeAt(corridor.source.node.x, corridor.source.node.y)) {
      throw new Error(`${name}: no resource node at ${key(corridor.source.node)}`);
    }
    const cells = expand(corridor.source, corridor.waypoints, corridor.arrival);
    planned[name] = cells;
    for (const c of cells) {
      const owners = claims.get(key(c)) ?? [];
      owners.push(name);
      claims.set(key(c), owners);
    }
  }

  // Belt cells must be unique: two routes sharing one cell is exactly the
  // collision that makes a fan-out unbuildable without splitters.
  const overlaps = [...claims.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([c, owners]) => `${c} <- ${owners.join(', ')}`);
  if (overlaps.length > 0) throw new Error(`corridors overlap:\n${overlaps.join('\n')}`);
  return planned;
}

function placeCorridor(sim: Simulation, cells: Cell[], target: Cell): void {
  cells.forEach((current, index) => {
    const next = cells[index + 1] ?? target;
    const placed = sim.place('belt', current.x, current.y, rotationBetween(current, next));
    expect({ at: key(current), ok: placed.ok }).toEqual({ at: key(current), ok: true });
  });
}

describe('map-scale raw corridors', () => {
  it('covers every raw resource the recipe tree consumes', () => {
    const raws = new Set(Object.keys(LINES).map((name) => resourceNodeAt(LINES[name].node.x, LINES[name].node.y)));
    expect([...raws].sort()).toEqual(['coal', 'copperOre', 'ironOre', 'stone']);
    // Eight lines, not four: iron ingots need coal, so coal is a second stream
    // into the same smelter, not a nicety.
    expect(Object.keys(LINES)).toHaveLength(8);
  });

  it('plans every corridor without a collision', () => {
    const planned = planCorridors(CORRIDORS);
    const total = Object.values(planned).reduce((sum, cells) => sum + cells.length, 0);
    // A floor, so a corridor that silently planned to nothing cannot pass.
    expect(total).toBeGreaterThan(200);
  });

  it('collides when two lines swap columns, which is what makes the order load-bearing', () => {
    // Same source, but descending in coal2's column: the run west along row 36
    // and the descent cross the coal line's descent. The rule in the header is
    // the only reason eight lines fit, so breaking it has to be visible.
    const broken: Record<string, Corridor> = {
      ...CORRIDORS,
      iron1: {
        source: CORRIDORS.iron1.source,
        waypoints: [cell(LINES.coal2.column, LINES.iron1.node.y)],
        arrival: cell(LINES.coal2.column, SILO_ROW - 1),
      },
    };
    expect(() => planCorridors(broken)).toThrow(/overlap/i);
  });

  it('ends every run on an input side of the silo it feeds', () => {
    for (const [name, corridor] of Object.entries(CORRIDORS)) {
      const target = TARGETS[name];
      const gap = Math.abs(corridor.arrival.x - target.x) + Math.abs(corridor.arrival.y - target.y);
      // Orthogonally adjacent, so the last belt actually feeds the silo.
      expect({ name, gap }).toEqual({ name, gap: 1 });
    }
  });

  it('delivers ore from every node into its own silo', () => {
    const sim = new Simulation();
    const planned = planCorridors(CORRIDORS);
    for (const [name, corridor] of Object.entries(CORRIDORS)) {
      const placed = sim.place('extractor', corridor.source.node.x, corridor.source.node.y, corridor.source.faces);
      expect({ name, ok: placed.ok }).toEqual({ name, ok: true });
      const target = TARGETS[name];
      expect({ name, silo: sim.place('silo', target.x, target.y, 0).ok }).toEqual({ name, silo: true });
      placeCorridor(sim, planned[name], target);
    }

    // The longest line is ~58 belts at one cell per tick, plus extraction, so
    // this window is generous by two orders of magnitude.
    for (let tick = 0; tick < 3000; tick++) sim.tick();

    for (const name of Object.keys(CORRIDORS)) {
      const silo = sim.entityAt(TARGETS[name]);
      const held = Object.values(silo?.inputs ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
      expect({ name, holding: held > 0 || silo?.item !== null }).toEqual({ name, holding: true });
    }
  });
});
