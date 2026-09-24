import type { Simulation } from '../../src/sim/simulation';
import type { Cell } from '../../src/sim/placement';
import {
  MACHINES,
  acceptsFrom,
  rotationDelta,
  type MachineType,
  type Rotation,
} from '../../src/sim/machines';
import { GRID_H, GRID_W } from '../../src/config/constants';
import { RESOURCE_NODES, type RawResourceId } from '../../src/sim/worldgen';

/**
 * A plan for the whole world-scale factory: eight extractors on real map nodes,
 * corridors to a refinery, and a Motor out the far end.
 *
 * Why a planner and not a hand-written list. The map forbids two things in one
 * cell, so every corridor has to be laid out *around* every other corridor, and
 * the eight raw nodes are spread across all four quadrants of a 64x64 map. Hand
 * planning that took two wrong attempts for the eight straight descents in
 * `mapCorridors.test.ts`; with corners allowed it is hopeless by eye. So the
 * corridors are routed breadth-first over the free grid, before anything is
 * placed, and the result is a data structure both the unit test and the browser
 * playthrough consume — one plan, verified headlessly, played by the UI.
 *
 * Crossings (the act-3 unblock, PLAYTEST.md §5). Before the crossing tile
 * existed, no routing order out of 200 completed: a line that descends is a
 * wall, and the coal lines had to cross the iron lines. Now the planner may
 * route a stream ACROSS an earlier line by converting one of its straight belt
 * cells into a crossing. The rules, matching what the sim actually implements:
 *
 *   - only a STRAIGHT belt cell (entry axis === exit axis in its own route) can
 *     be converted — a crossing carries each stream straight through, so the
 *     original flow must survive the conversion unchanged;
 *   - only a PERPENDICULAR stream may ride over (one stream per axis);
 *   - once converted, the cell is a hard block — a crossing keeps two lanes,
 *     so a third line can never pass through it.
 *
 * Overpasses cost more than free ground, so the planner goes around when going
 * around is cheap and crosses only when it must.
 *
 * The refinery itself is not routed: it is the proven layout from
 * `motorChain.test.ts`, straight links and all, so the only new thing a failure
 * here can be blamed on is a corridor.
 */

export interface PlannedMachine {
  id: string;
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
}

export interface PlannedBelt {
  x: number;
  y: number;
  rotation: Rotation;
}

/** A tile two lines pass through. Placed like a machine; no facing of its own. */
export interface PlannedCrossing {
  x: number;
  y: number;
}

export interface PlannedRoute {
  /** `corridor:<name>` for a raw line, `link:<producer>-><consumer>` otherwise. */
  connection: string;
  producer: string;
  consumer: string;
  /**
   * The full path an item travels, INCLUDING any crossing tiles — the cell
   * before a crossing must face into it. `plan.belts` is the placed-belt view;
   * crossing cells live in `plan.crossings`.
   */
  belts: Cell[];
}

export interface FactoryPlan {
  machines: PlannedMachine[];
  belts: PlannedBelt[];
  crossings: PlannedCrossing[];
  routes: PlannedRoute[];
}

interface Machine {
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
}

const key = (cell: Cell): string => `${cell.x},${cell.y}`;

const DIRS: Cell[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

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

/** 'h' flows along x; 'v' along y. A crossing carries one stream per axis. */
type Axis = 'h' | 'v';

const axisOf = (dir: Cell): Axis => (dir.x !== 0 ? 'h' : 'v');

function dirBetween(from: Cell, to: Cell): Cell {
  return { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
}

/** Riding over an existing line costs this much more than free ground. TUNE. */
const OVERPASS_COST = 8;

/**
 * What the search knows about the grid so far.
 *
 * Three classes of cell, because the overpass rule needs all three:
 *   - `blocked` — machines, crossings, extractors, nodes: never passable;
 *   - straight belts — passable ONLY to a perpendicular stream (the candidates
 *     in `beltAxis`);
 *   - corner belts — occupied by another line but NOT crossable, since a
 *     crossing carries each stream straight through and a corner is not
 *     straight. Missing this class let later routes route straight through
 *     another line's corner: the plan's belt map silently overwrote the cell
 *     and the factory shipped with two flows on one tile.
 */
interface Occupancy {
  blocked: Set<string>;
  /** Every committed belt cell, straight or not. */
  beltCells: Set<string>;
  /** The straight subset, by flow axis: the overpass candidates. */
  beltAxis: Map<string, Axis>;
}

/**
 * The refinery, exactly as `motorChain.test.ts` proves it: every stage faces
 * east except where a link needs to climb, and each raw stream has a silo as its
 * injection point. The silos are the reason the corridors have somewhere to
 * arrive: they accept from every side but their own output.
 */
const REFINERY: Record<string, Machine> = {
  // Row 46, west to east: ore -> ingot -> wire -> circuit -> motor -> depot.
  siloCu: { type: 'silo', x: 36, y: 46, rotation: 90 },
  sCu: { type: 'smelter', x: 37, y: 46, rotation: 90 },
  aWire: { type: 'assembler', x: 40, y: 46, rotation: 90 },
  aCircuit: { type: 'assembler', x: 44, y: 46, rotation: 90 },
  aMotor: { type: 'assembler', x: 50, y: 46, rotation: 90 },
  depot: { type: 'depot', x: 52, y: 46, rotation: 0 },

  // Iron line 1: ore + coal -> ingot -> gear -> circuit (the circuit's second input).
  siloFeOre1: { type: 'silo', x: 40, y: 50, rotation: 90 },
  sFe1: { type: 'smelter', x: 41, y: 50, rotation: 90 },
  siloCoal1: { type: 'silo', x: 41, y: 49, rotation: 180 },
  aGear1: { type: 'assembler', x: 44, y: 50, rotation: 0 },

  // Stone line: stone -> refined stone -> plate.
  siloStone: { type: 'silo', x: 45, y: 50, rotation: 90 },
  sStone: { type: 'smelter', x: 46, y: 50, rotation: 180 },

  // Iron line 2: ore + coal -> ingot -> gear -> frame.
  siloFeOre2: { type: 'silo', x: 46, y: 58, rotation: 90 },
  sFe2: { type: 'smelter', x: 47, y: 58, rotation: 90 },
  siloCoal2: { type: 'silo', x: 47, y: 57, rotation: 180 },
  aGear2: { type: 'assembler', x: 50, y: 58, rotation: 0 },

  // Iron line 3: ore + coal -> ingot -> plate.
  siloFeOre3: { type: 'silo', x: 42, y: 54, rotation: 90 },
  sFe3: { type: 'smelter', x: 43, y: 54, rotation: 90 },
  siloCoal3: { type: 'silo', x: 43, y: 53, rotation: 180 },
  aPlate: { type: 'assembler', x: 46, y: 54, rotation: 90 },

  // Plates + the second gear -> frame -> motor.
  aFrame: { type: 'assembler', x: 50, y: 54, rotation: 0 },
};

/** Every producer -> consumer edge inside the refinery. */
const LINKS: [string, string][] = [
  ['siloCu', 'sCu'],
  ['sCu', 'aWire'],
  ['aWire', 'aCircuit'],
  ['aCircuit', 'aMotor'],
  ['aMotor', 'depot'],
  ['siloFeOre1', 'sFe1'],
  ['siloCoal1', 'sFe1'],
  ['sFe1', 'aGear1'],
  ['aGear1', 'aCircuit'],
  ['siloStone', 'sStone'],
  ['sStone', 'aPlate'],
  ['siloFeOre2', 'sFe2'],
  ['siloCoal2', 'sFe2'],
  ['sFe2', 'aGear2'],
  ['aGear2', 'aFrame'],
  ['siloFeOre3', 'sFe3'],
  ['siloCoal3', 'sFe3'],
  ['sFe3', 'aPlate'],
  ['aPlate', 'aFrame'],
  ['aFrame', 'aMotor'],
];

/**
 * One extractor per raw stream. The pairs are chosen to keep the three coal
 * lines and the three iron lines from having to thread past each other on the
 * way south, and they are listed in the order they are routed: the sources
 * furthest from the refinery first, so a short greedy path cannot cut off a
 * long one.
 */
const RAW_STREAMS: { name: string; resource: RawResourceId; node: Cell; silo: string }[] = [
  { name: 'coal2', resource: 'coal', node: { x: 35, y: 18 }, silo: 'siloCoal2' },
  { name: 'stone', resource: 'stone', node: { x: 16, y: 38 }, silo: 'siloStone' },
  { name: 'coal1', resource: 'coal', node: { x: 29, y: 17 }, silo: 'siloCoal1' },
  { name: 'iron2', resource: 'ironOre', node: { x: 42, y: 34 }, silo: 'siloFeOre2' },
  { name: 'coal3', resource: 'coal', node: { x: 32, y: 15 }, silo: 'siloCoal3' },
  { name: 'iron3', resource: 'ironOre', node: { x: 40, y: 35 }, silo: 'siloFeOre3' },
  { name: 'copper', resource: 'copperOre', node: { x: 27, y: 30 }, silo: 'siloCu' },
  { name: 'iron1', resource: 'ironOre', node: { x: 44, y: 36 }, silo: 'siloFeOre1' },
];

/**
 * Routes from `source` to an input side of `consumer` over `occ`.
 *
 * The state is (cell, travel direction) for overpass candidates and (cell) for
 * everything else: a crossing forces its stream straight through, so entering
 * one heading east and entering it heading south are different searches with
 * different futures.
 */
function routeFrom(
  source: Cell,
  consumer: Machine,
  occ: Occupancy,
  /** When the producer already exists, its route must leave through its output. */
  firstStep: { x: number; y: number } | undefined,
  rng?: () => number,
): Cell[] {
  const startDir = firstStep ?? { x: 0, y: 0 };
  const stateKey = (cell: Cell, dir: Cell): string => {
    const at = key(cell);
    return occ.beltAxis.has(at) ? `${at}|${dir.x},${dir.y}` : at;
  };

  const cameFrom = new Map<string, string | null>();
  const best = new Map<string, number>();
  const heap: { cell: Cell; dir: Cell; cost: number }[] = [
    { cell: source, dir: startDir, cost: 0 },
  ];
  const startState = stateKey(source, startDir);
  best.set(startState, 0);
  cameFrom.set(startState, null);

  const push = (entry: { cell: Cell; dir: Cell; cost: number }): void => {
    heap.push(entry);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent].cost <= heap[index].cost) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  };

  const pop = (): { cell: Cell; dir: Cell; cost: number } => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < heap.length && heap[left].cost < heap[smallest].cost) smallest = left;
        if (right < heap.length && heap[right].cost < heap[smallest].cost) smallest = right;
        if (smallest === index) break;
        [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
        index = smallest;
      }
    }
    return top;
  };

  while (heap.length > 0) {
    const current = pop();
    const at = key(current.cell);
    const state = stateKey(current.cell, current.dir);
    if (current.cost > (best.get(state) ?? Infinity)) continue;

    // Adjacency matters as much as the side: `acceptsFrom` compares direction
    // signs, not distance, so a silo — whose ports accept from `all` — would
    // otherwise be "reachable" from any cell on the map.
    const adjacent =
      Math.abs(current.cell.x - consumer.x) + Math.abs(current.cell.y - consumer.y) === 1;
    if (
      at !== key(source) &&
      adjacent &&
      acceptsFrom(consumer.type, consumer.rotation, {
        x: current.cell.x - consumer.x,
        y: current.cell.y - consumer.y,
      })
    ) {
      // Reconstruct, dropping the source cell: what is left is path cells in
      // the order an item travels them, ending on the consumer's input side.
      const path: Cell[] = [];
      let cursor: string | null = state;
      while (cursor !== null) {
        const [x, y] = cursor.split('|')[0].split(',').map(Number);
        path.push({ x, y });
        cursor = cameFrom.get(cursor) ?? null;
      }
      path.pop();
      return path.reverse();
    }

    // From a producer that is already placed, the only legal first move is the
    // one it faces — its output is a single cell, so a route leaving any other
    // way would never be fed. A crossing in hand forces straight-through.
    let dirs: Cell[];
    if (occ.beltAxis.has(at)) {
      dirs = [current.dir];
    } else if (firstStep !== undefined && at === key(source)) {
      dirs = [firstStep];
    } else {
      dirs = rng ? shuffled(DIRS, rng) : DIRS;
    }

    for (const dir of dirs) {
      const next: Cell = { x: current.cell.x + dir.x, y: current.cell.y + dir.y };
      if (next.x < 0 || next.y < 0 || next.x >= GRID_W || next.y >= GRID_H) continue;

      const nextKey = key(next);
      let stepCost = 1;
      if (occ.beltCells.has(nextKey)) {
        // Overpass: only a perpendicular stream, only over a STRAIGHT belt. A
        // corner belt is somebody's turn, and a turn cannot survive becoming a
        // crossing — so it walls the search out like any machine.
        if (!occ.beltAxis.has(nextKey)) continue;
        if (axisOf(dir) === occ.beltAxis.get(nextKey)) continue;
        stepCost = OVERPASS_COST;
      } else if (occ.blocked.has(nextKey)) {
        continue;
      }

      const nextState = stateKey(next, dir);
      const cost = current.cost + stepCost;
      if (cost >= (best.get(nextState) ?? Infinity)) continue;

      best.set(nextState, cost);
      cameFrom.set(nextState, state);
      push({ cell: next, dir, cost });
    }
  }

  throw new Error(`no corridor from ${key(source)} to ${consumer.type} at ${consumer.x},${consumer.y}`);
}

/** Every cell a plan commits, so a caller can place into it without clashing. */
export function planOccupancy(plan: FactoryPlan): Set<string> {
  const cells = new Set<string>();
  for (const machine of plan.machines) cells.add(key(machine));
  for (const belt of plan.belts) cells.add(key(belt));
  for (const crossing of plan.crossings) cells.add(key(crossing));
  return cells;
}

/** Deterministic RNG, so a search result is reproducible across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Every connection the factory needs: refinery internals first, then raw lines. */
interface Connection {
  name: string;
  from: Machine;
  to: Machine;
  producerId: string;
  consumerId: string;
}

function allConnections(): Connection[] {
  const connections: Connection[] = LINKS.map(([producer, consumer]) => ({
    name: `link:${producer}->${consumer}`,
    from: REFINERY[producer],
    to: REFINERY[consumer],
    producerId: producer,
    consumerId: consumer,
  }));

  for (const stream of RAW_STREAMS) {
    connections.push({
      name: `corridor:${stream.name}`,
      from: { type: 'extractor', x: stream.node.x, y: stream.node.y, rotation: 0 },
      to: REFINERY[stream.silo],
      producerId: stream.name,
      consumerId: stream.silo,
    });
  }

  return connections;
}

/**
 * Route every connection, in a given order, and report the whole plan or nothing.
 *
 * Routed together rather than in two phases — refinery first, then corridors —
 * because that split is what kept trapping the earlier drafts: a corridor
 * committed early became a wall for a refinery link that still had to cross it.
 * Letting one search interleave them, over many orders — with crossings for the
 * intersections nothing can route around — is what makes this tractable.
 */
function attemptAll(
  order: readonly number[],
  neighborSeed: number,
  onFail?: (connection: string) => void,
): FactoryPlan | null {
  const rng = mulberry32(neighborSeed);
  const machines: PlannedMachine[] = [];
  const beltAt = new Map<string, PlannedBelt>();
  const crossings: PlannedCrossing[] = [];
  const routes: PlannedRoute[] = [];
  const blocked = new Set<string>();
  const beltCells = new Set<string>();
  const beltAxis = new Map<string, Axis>();
  const nodeCells = new Set(RESOURCE_NODES.map((node) => key(node)));

  for (const [id, machine] of Object.entries(REFINERY)) {
    machines.push({ id, type: machine.type, x: machine.x, y: machine.y, rotation: machine.rotation });
    blocked.add(key(machine));
  }

  const connections = allConnections();

  for (const index of order) {
    const connection = connections[index];
    const source = connection.from;
    const consumer = connection.to;

    // An extractor is placed on its node and then faces whatever the route
    // chose; everything else already has a rotation its links must respect.
    const isExtractor = source.type === 'extractor';
    const occBlocked = new Set(blocked);
    for (const node of nodeCells) occBlocked.add(node);
    if (isExtractor) occBlocked.delete(key(source));
    // The routing stream may stand on its own source cell, but nothing else
    // about the world is negotiable: belts included (see Occupancy).
    const occ: Occupancy = { blocked: occBlocked, beltCells, beltAxis };

    // Two machines that already touch need no belt between them — and that is
    // not an edge case, it is most of the refinery. Missing this made every
    // attempt fail instantly on `siloCu -> sCu`, whose output cell *is* the
    // consumer.
    const facing = isExtractor ? null : rotationDelta(source.rotation);
    const touchesConsumer =
      facing !== null && source.x + facing.x === consumer.x && source.y + facing.y === consumer.y;

    let path: Cell[] = [];
    if (!touchesConsumer) {
      try {
        path = routeFrom(
          { x: source.x, y: source.y },
          consumer,
          occ,
          facing ?? undefined,
          rng,
        );
      } catch {
        onFail?.(connection.name);
        return null;
      }
    }

    // Commit the path: plain cells become belts, cells that already carry a
    // perpendicular straight belt become crossings (the belt that was there is
    // gone; the crossing keeps its flow, per the rules in the header).
    for (let i = 0; i < path.length; i++) {
      const cell = path[i];
      const at = key(cell);
      if (beltCells.has(at)) {
        // An overpass commit: the straight belt that was here is gone, the
        // crossing keeps both flows (per the rules in the header).
        beltAt.delete(at);
        beltAxis.delete(at);
        beltCells.delete(at);
        crossings.push({ x: cell.x, y: cell.y });
        blocked.add(at);
        continue;
      }
      const next = path[i + 1] ?? { x: consumer.x, y: consumer.y };
      beltAt.set(at, { x: cell.x, y: cell.y, rotation: rotationBetween(cell, next) });
      beltCells.add(at);
    }

    // Straight belts are the overpass candidates for later routes: a cell whose
    // own flow enters and leaves on one axis can carry a crossing without its
    // stream noticing. A corner never can.
    for (let i = 0; i < path.length; i++) {
      const cell = path[i];
      const at = key(cell);
      if (!beltAt.has(at)) continue; // already a crossing
      const entry = dirBetween(i === 0 ? { x: source.x, y: source.y } : path[i - 1], cell);
      const exit = dirBetween(
        cell,
        i === path.length - 1 ? { x: consumer.x, y: consumer.y } : path[i + 1],
      );
      if (entry.x === exit.x && entry.y === exit.y) beltAxis.set(at, axisOf(exit));
      else beltAxis.delete(at);
    }

    if (isExtractor) {
      machines.push({
        id: connection.producerId,
        type: 'extractor',
        x: source.x,
        y: source.y,
        rotation: rotationBetween(source, path[0]),
      });
      blocked.add(key(source));
      nodeCells.delete(key(source));
    }
    routes.push({
      connection: connection.name,
      producer: connection.producerId,
      consumer: connection.consumerId,
      belts: path,
    });
  }

  return { machines, belts: [...beltAt.values()], crossings, routes };
}

/**
 * The world-scale factory, or the shortest one the search could find.
 *
 * The plan that wins is the one with the fewest placements, which is not a
 * cosmetic tie-break: every tile is a click (or a drag) for the player, so a
 * shorter route is genuinely a better factory to be handed.
 */
export const PLANNER_ATTEMPTS = 200;

let cached: FactoryPlan | null | undefined;

export function planMotorFactory(): FactoryPlan {
  if (cached !== undefined) {
    if (cached === null) throw new Error(BLOCKED_MESSAGE);
    return cached;
  }
  cached = searchForPlan();
  if (cached === null) throw new Error(BLOCKED_MESSAGE);
  return cached;
}

export const BLOCKED_MESSAGE =
  'no routing order produced a collision-free plan for the motor factory (see PLAYTEST.md act 3)';

function searchForPlan(): FactoryPlan | null {
  const connections = allConnections();
  const indices = connections.map((_, i) => i);
  let best: FactoryPlan | null = null;

  for (let seed = 0; seed < PLANNER_ATTEMPTS; seed++) {
    const order = seed === 0 ? indices : shuffled(indices, mulberry32(seed * 2246822519));
    const plan = attemptAll(order, seed * 7919 + 17);
    const size = plan ? plan.belts.length + plan.crossings.length : Infinity;
    const bestSize = best ? best.belts.length + best.crossings.length : Infinity;
    if (plan && size < bestSize) {
      best = plan;
      // A short plan is what matters; once the search has one, only a better one
      // is worth continuing for.
      if (size < 220) break;
    }
  }

  return best;
}

/** Places a whole plan into a sim, machines, then crossings, then belts. */
export function applyPlan(sim: Simulation, plan: FactoryPlan): void {
  for (const machine of plan.machines) {
    const placed = sim.place(machine.type, machine.x, machine.y, machine.rotation);
    if (!placed.ok) throw new Error(`could not place ${machine.id} (${machine.type}) at ${machine.x},${machine.y}: ${placed.reason}`);
  }
  for (const crossing of plan.crossings) {
    const placed = sim.place('crossing', crossing.x, crossing.y, 0);
    if (!placed.ok) throw new Error(`could not place crossing at ${crossing.x},${crossing.y}: ${placed.reason}`);
  }
  for (const belt of plan.belts) {
    const placed = sim.place('belt', belt.x, belt.y, belt.rotation);
    if (!placed.ok) throw new Error(`could not place belt at ${belt.x},${belt.y}: ${placed.reason}`);
  }
}

/** The plan's total build size: what a player has to place, one click at a time. */
export function planSize(plan: FactoryPlan): { machines: number; belts: number; crossings: number; total: number } {
  return {
    machines: plan.machines.length,
    belts: plan.belts.length,
    crossings: plan.crossings.length,
    total: plan.machines.length + plan.belts.length + plan.crossings.length,
  };
}

/** Machines in the order a player would sensibly build them: inputs first. */
export function planBuildOrder(plan: FactoryPlan): PlannedMachine[] {
  const order: MachineType[] = ['extractor', 'crossing', 'belt', 'smelter', 'silo', 'assembler', 'depot'];
  return [...plan.machines].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

export { MACHINES, rotationBetween };

/** TEMP diagnostic: which connection does a given order fail on? */
export function diagnoseAttempt(order: readonly number[]): { failed: string | null; plan: FactoryPlan | null } {
  let failed: string | null = null;
  const plan = attemptAll(order, 17, (name) => {
    if (failed === null) failed = name;
  });
  return { failed, plan };
}
