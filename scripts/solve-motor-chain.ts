import { MACHINES } from "../src/content/machines";
import { RECIPES } from "../src/content/recipes";
import { NEW_GAME_SEED, createInitialState } from "../src/sim/initialState";
import { rotateGridPoint } from "../src/sim/rotation";
import { arePortsConnected, getProducedResource, getWorldPortCells } from "../src/sim/connections";
import type {
  Entity,
  MachineType,
  RecipeId,
  ResourceId,
  Rotation,
} from "../src/sim/types";

export interface Cell {
  x: number;
  y: number;
}

export interface LayoutEntity {
  id: string;
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
  recipeId?: RecipeId;
  resourceNode?: ResourceId;
}

export interface SolveResult {
  ok: boolean;
  entities: LayoutEntity[];
  beltCount: number;
  anchor?: Cell;
  spineMachines: number;
  leafMachines: number;
}

interface PlanNode {
  id: string;
  type: MachineType;
  recipe: RecipeId;
  feeders: Array<{ resource: ResourceId; port: number; child?: PlanNode }>;
  spine: boolean;
}

interface Route {
  cells: Cell[];
  rotations: Rotation[];
}

interface LeafSolution {
  node: PlanNode;
  cell: Cell;
  rotation: Rotation;
  sources: Map<ResourceId, Cell>;
  extractorRotations: Rotation[];
  rawRoutes: Route[];
  link: Route;
  cost: number;
}

interface Slot {
  portCell: Cell;
  direction: Cell;
  consumerCell: Cell;
  consumerId: string;
}

interface SpineLayout {
  placed: Map<PlanNode, { cell: Cell; rotation: Rotation }>;
  slots: Map<PlanNode, Slot>;
  ports: Map<PlanNode, Map<PlanNode, number>>;
}

interface Attempt {
  layout: SpineLayout;
  solutions: LeafSolution[];
  cost: number;
  anchor: Cell;
}

const GRID = 64;
const EDGE = 2;
const MAX_RUN = GRID - 1;

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
const OUTPUT_OFFSETS: Readonly<Record<Rotation, Cell>> = {
  0: { x: 1, y: 0 },
  90: { x: 0, y: 1 },
  180: { x: -1, y: 0 },
  270: { x: 0, y: -1 },
};
const ROTATION_FOR_OUTPUT: Readonly<Record<string, Rotation>> = {
  "1,0": 0,
  "0,1": 90,
  "-1,0": 180,
  "0,-1": 270,
};

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function same(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

function add(a: Cell, b: Cell): Cell {
  return { x: a.x + b.x, y: a.y + b.y };
}

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function inBounds(cell: Cell): boolean {
  return cell.x >= 1 && cell.y >= 1 && cell.x < GRID - 1 && cell.y < GRID - 1;
}

function outputDirection(rotation: Rotation): Cell {
  return OUTPUT_OFFSETS[rotation];
}

function rotationForOutput(direction: Cell): Rotation | undefined {
  return ROTATION_FOR_OUTPUT[key(direction.x, direction.y)];
}

function inputPortDirection(rotation: Rotation, portIndex: number): Cell | undefined {
  const port = MACHINES.assembler.ports[portIndex];
  if (port === undefined || port.kind !== "input") {
    return undefined;
  }
  const rotated = rotateGridPoint(port.offset as Cell, rotation) as Cell;
  return { x: rotated.x, y: rotated.y };
}

function inputPortCount(type: MachineType): number {
  return MACHINES[type].ports.filter((port) => port.kind === "input").length;
}

function uniqueInputs(recipe: RecipeId): ResourceId[] {
  return Object.keys(RECIPES[recipe].inputs) as ResourceId[];
}

function producerRecipeFor(resource: ResourceId): RecipeId | undefined {
  return (Object.keys(RECIPES) as RecipeId[]).find((id) => RECIPES[id].output.resource === resource);
}

/**
 * Expands a recipe into a plan. Every consumer gets its own producer, because a
 * producer's single output port reaches exactly one cell and therefore exactly
 * one consumer. A consumer needing two units of one resource still gets one
 * producer, because those units are buffered and arrive over successive runs.
 */
export function planChain(rootRecipe: RecipeId = "motor"): PlanNode[] {
  const plan: PlanNode[] = [];
  let counter = 0;

  const build = (recipe: RecipeId): PlanNode => {
    counter += 1;
    const inputs = uniqueInputs(recipe);
    const node: PlanNode = {
      id: `${RECIPES[recipe].machine}-${recipe}-${counter}`,
      type: RECIPES[recipe].machine,
      recipe,
      feeders: inputs.map((resource, index) => ({ resource, port: index })),
      spine: inputs.some((resource) => producerRecipeFor(resource) !== undefined),
    };
    plan.push(node);

    let port = 0;
    for (const feeder of node.feeders) {
      const producer = producerRecipeFor(feeder.resource);
      if (producer === undefined) {
        continue;
      }
      feeder.child = build(producer);
      port += 1;
    }
    return node;
  };

  build(rootRecipe);
  return plan;
}

function portAssignments(portCount: number, inputCount: number): number[][] {
  const result: number[][] = [];
  const walk = (chosen: number[], rest: number[]): void => {
    if (chosen.length === inputCount) {
      result.push(chosen);
      return;
    }
    for (let index = 0; index < rest.length; index += 1) {
      walk([...chosen, rest[index]], [...rest.slice(0, index), ...rest.slice(index + 1)]);
    }
  };
  walk([], Array.from({ length: portCount }, (_, index) => index));
  return result;
}

/**
 * Lays a straight run of belts between two cells. A belt's input port is
 * diametrically opposite its output port, so a run can never turn: the two ends
 * must share a row or a column, and every belt in the run carries the same
 * rotation. The run covers the cells strictly between the ends, so an
 * adjacency is a direct feed and delivers with no belt at all.
 */
function straightRun(from: Cell, to: Cell): Route | undefined {
  if (same(from, to)) {
    return { cells: [], rotations: [] };
  }
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  if (deltaX !== 0 && deltaY !== 0) {
    return undefined;
  }
  const step: Cell = deltaX !== 0 ? { x: Math.sign(deltaX), y: 0 } : { x: 0, y: Math.sign(deltaY) };
  const rotation = rotationForOutput(step);
  if (rotation === undefined) {
    return undefined;
  }
  const cells: Cell[] = [];
  for (let x = from.x + step.x, y = from.y + step.y; x !== to.x || y !== to.y; x += step.x, y += step.y) {
    const cell = { x, y };
    if (!inBounds(cell)) {
      return undefined;
    }
    cells.push(cell);
  }
  return { cells, rotations: cells.map(() => rotation) };
}

/** Assigns each leaf supplier a distinct resource node for every raw input. */
function assignNodes(
  leaves: readonly PlanNode[],
  nodes: ReadonlyArray<{ resource: ResourceId; x: number; y: number; id: string }>,
): Map<PlanNode, Map<ResourceId, Cell>> | undefined {
  const used = new Set<string>();
  const result = new Map<PlanNode, Map<ResourceId, Cell>>();
  const ordered = [...leaves].sort(
    (a, b) => uniqueInputs(b.recipe).length - uniqueInputs(a.recipe).length,
  );

  for (const leaf of ordered) {
    const inputs = uniqueInputs(leaf.recipe);
    let best: { map: Map<ResourceId, Cell>; cost: number } | undefined;
    const walk = (depth: number, chosen: Cell[], cost: number): void => {
      if (depth === inputs.length) {
        if (best === undefined || cost < best.cost) {
          const map = new Map<ResourceId, Cell>();
          inputs.forEach((resource, index) => {
            const cell = chosen[index];
            if (cell !== undefined) {
              map.set(resource, cell);
            }
          });
          best = { map, cost };
        }
        return;
      }
      for (const node of nodes) {
        if (used.has(key(node.x, node.y)) || node.resource !== inputs[depth]) {
          continue;
        }
        const cell = { x: node.x, y: node.y };
        const spread =
          depth === 0 ? 0 : cost + manhattan(chosen[0] as Cell, cell);
        chosen.push(cell);
        walk(depth + 1, chosen, spread);
        chosen.pop();
      }
    };
    walk(0, [], 0);
    if (best === undefined) {
      return undefined;
    }
    for (const cell of best.map.values()) {
      const node = nodes.find((candidate) => candidate.x === cell.x && candidate.y === cell.y);
      if (node !== undefined) {
        used.add(node.id);
      }
    }
    result.set(leaf, best.map);
  }

  return result;
}

type PortChoice = Map<PlanNode, number[]>;

function injective(portCount: number, childCount: number): number[][] {
  const result: number[][] = [];
  const walk = (chosen: number[], rest: number[]): void => {
    if (chosen.length === childCount) {
      result.push(chosen);
      return;
    }
    for (let index = 0; index < rest.length; index += 1) {
      walk([...chosen, rest[index]], [...rest.slice(0, index), ...rest.slice(index + 1)]);
    }
  };
  walk([], Array.from({ length: portCount }, (_, index) => index));
  return result;
}

/**
 * Every way of wiring the tree's children to input ports. Which port a child
 * uses is not fixed by the recipe: it decides the direction a child sits in and
 * therefore the whole shape of the layout, so the solver enumerates them all.
 */
function portChoiceSets(plan: PlanNode[], root: PlanNode): PortChoice[] {
  let results: PortChoice[] = [new Map()];
  const ordered = [...plan].sort((a, b) => depthOf(plan, a) - depthOf(plan, b));
  for (const node of ordered) {
    const children = node.feeders
      .map((feeder) => feeder.child)
      .filter((child): child is PlanNode => child !== undefined);
    if (children.length === 0) {
      continue;
    }
    const options = injective(inputPortCount(node.type), children.length);
    const next: PortChoice[] = [];
    for (const base of results) {
      for (const option of options) {
        const copy = new Map(base);
        copy.set(node, option);
        next.push(copy);
      }
    }
    results = next;
    if (results.length > 4096) {
      break;
    }
  }
  void root;
  void plan;
  return results;
}

function depthOf(plan: PlanNode[], node: PlanNode): number {
  const index = plan.indexOf(node);
  return index;
}

function layoutSpine(
  root: PlanNode,
  anchor: Cell,
  choice: PortChoice,
  rootRotation: Rotation = 0,
): SpineLayout | undefined {
  const placed = new Map<PlanNode, { cell: Cell; rotation: Rotation }>();
  const slots = new Map<PlanNode, Slot>();
  const portsUsed = new Map<PlanNode, Map<PlanNode, number>>();
  const claimed = new Set<string>();

  const visit = (node: PlanNode, cell: Cell, rotation: Rotation): boolean => {
    if (!inBounds(cell) || claimed.has(key(cell.x, cell.y))) {
      return false;
    }
    claimed.add(key(cell.x, cell.y));
    placed.set(node, { cell, rotation });
    portsUsed.set(node, new Map());

    let childIndex = 0;
    for (const feeder of node.feeders) {
      const child = feeder.child;
      if (child === undefined) {
        continue;
      }
      const port = choice.get(node)?.[childIndex] ?? feeder.port;
      childIndex += 1;
      const direction = inputPortDirection(rotation, port);
      if (direction === undefined) {
        return false;
      }
      if (child.spine) {
        const childRotation = rotationForOutput({ x: -direction.x, y: -direction.y });
        if (childRotation === undefined || !visit(child, add(cell, direction), childRotation)) {
          return false;
        }
      } else {
        portsUsed.get(node)?.set(child, port);
        slots.set(child, {
          portCell: add(cell, direction),
          direction,
          consumerCell: cell,
          consumerId: node.id,
        });
      }
    }
    return true;
  };

  if (!visit(root, anchor, rootRotation)) {
    return undefined;
  }
  return { placed, slots, ports: portsUsed };
}

/**
 * Finds where a leaf supplier can stand so that every raw input arrives on a
 * straight run and the supplier's own output reaches its consumer's port cell
 * on a straight run. Both ends of a run are fixed by geometry, so the only free
 * variable is how far back along the consumer's port the supplier sits.
 */
function solveLeaf(
  node: PlanNode,
  sources: ReadonlyMap<ResourceId, Cell>,
  slot: Slot,
  machineBlocked: ReadonlySet<string>,
  beltBlocked: ReadonlySet<string>,
): LeafSolution | undefined {
  return solveLeafAll(node, sources, slot, machineBlocked, beltBlocked)[0];
}

function solveLeafAll(
  node: PlanNode,
  sources: ReadonlyMap<ResourceId, Cell>,
  slot: Slot,
  machineBlocked: ReadonlySet<string>,
  beltBlocked: ReadonlySet<string>,
): LeafSolution[] {
  const inputs = uniqueInputs(node.recipe);
  const ports = inputPortCount(node.type);
  const direction = slot.direction;
  const rotation = rotationForOutput(direction);
  if (rotation === undefined) {
    return [];
  }

  const found: LeafSolution[] = [];
  for (const assignment of portAssignments(ports, inputs.length)) {
    const portDirections = assignment.map((portIndex) => inputPortDirection(rotation, portIndex));
    void ports;
    if (portDirections.some((entry) => entry === undefined)) {
      continue;
    }

    for (let run = 0; run <= MAX_RUN; run += 1) {
      const cell = { x: slot.portCell.x - direction.x * run, y: slot.portCell.y - direction.y * run };
      if (!inBounds(cell) || machineBlocked.has(key(cell.x, cell.y))) {
        continue;
      }

      const rawRoutes: Route[] = [];
      const extractorRotations: Rotation[] = [];
      const taken = new Set<string>(beltBlocked);
      taken.add(key(cell.x, cell.y));
      let cost = run === 0 ? 0 : run - 1;
      let feasible = true;

      for (let inputIndex = 0; inputIndex < inputs.length; inputIndex += 1) {
        const resource = inputs[inputIndex];
        const source = sources.get(resource);
        const portDirection = portDirections[inputIndex];
        if (source === undefined || portDirection === undefined) {
          feasible = false;
          break;
        }
        const portCell = add(cell, portDirection);
        if (!inBounds(portCell) || taken.has(key(portCell.x, portCell.y))) {
          feasible = false;
          break;
        }
        const route = straightRun(source, portCell);
        if (route === undefined) {
          feasible = false;
          break;
        }
        if (route.cells.some((beltCell) => taken.has(key(beltCell.x, beltCell.y)))) {
          feasible = false;
          break;
        }
        const extractorRotation = routeForExtractor(source, route, cell);
        if (extractorRotation === undefined) {
          feasible = false;
          break;
        }
        for (const beltCell of route.cells) {
          taken.add(key(beltCell.x, beltCell.y));
        }
        rawRoutes[inputIndex] = route;
        extractorRotations[inputIndex] = extractorRotation;
        cost += route.cells.length;
      }

      if (!feasible) {
        continue;
      }

      const link = straightRun(cell, slot.portCell);
      if (link === undefined) {
        continue;
      }
      if (link.cells.some((beltCell) => taken.has(key(beltCell.x, beltCell.y)))) {
        continue;
      }

      found.push({
        node,
        cell,
        rotation,
        sources: new Map(sources),
        extractorRotations,
        rawRoutes,
        link,
        cost,
      });
    }
  }

  found.sort((left, right) => left.cost - right.cost || left.cell.y - right.cell.y || left.cell.x - right.cell.x);
  return found;
}

function routeForExtractor(source: Cell, route: Route, reader: Cell): Rotation | undefined {
  const first = route.cells[0];
  if (first === undefined) {
    return rotationForOutput({ x: reader.x - source.x, y: reader.y - source.y });
  }
  return rotationForOutput({ x: first.x - source.x, y: first.y - source.y });
}

interface FreeState {
  placed: Map<PlanNode, { cell: Cell; rotation: Rotation }>;
  assignments: Map<PlanNode, Map<ResourceId, Cell>>;
  cost: number;
}

function allLeafAssignments(
  leaf: PlanNode,
  nodes: ReadonlyArray<{ resource: ResourceId; x: number; y: number }>,
): Map<ResourceId, Cell>[] {
  const inputs = uniqueInputs(leaf.recipe);
  const found: Map<ResourceId, Cell>[] = [];
  const walk = (depth: number, chosen: Map<ResourceId, Cell>): void => {
    if (found.length >= 40) {
      return;
    }
    if (depth === inputs.length) {
      found.push(new Map(chosen));
      return;
    }
    for (const node of nodes) {
      if (node.resource !== inputs[depth] || chosen.has(node.resource)) {
        continue;
      }
      chosen.set(node.resource, { x: node.x, y: node.y });
      walk(depth + 1, chosen);
      chosen.delete(node.resource);
    }
  };
  walk(0, new Map());
  found.sort((left, right) => {
    const spread = (map: ReadonlyMap<ResourceId, Cell>): number => {
      const cells = [...map.values()];
      if (cells.length < 2) {
        return 0;
      }
      return manhattan(cells[0], cells[1]);
    };
    return spread(left) - spread(right);
  });
  return found;
}

/**
 * A free-standing supplier position: the machine stands where a straight run
 * from each of its resource nodes reaches one of its input port cells.
 */
function freeLeafOptions(
  leaf: PlanNode,
  sources: ReadonlyMap<ResourceId, Cell>,
  blocked: ReadonlySet<string>,
  limit: number,
): Array<{ cell: Cell; rotation: Rotation }> {
  const inputs = uniqueInputs(leaf.recipe);
  const ports = inputPortCount(leaf.type);
  const found: Array<{ cell: Cell; rotation: Rotation; cost: number }> = [];

  for (const rotation of ROTATIONS) {
    const dirs: Cell[] = [];
    for (let index = 0; index < ports; index += 1) {
      const direction = inputPortDirection(rotation, index);
      if (direction === undefined) {
        break;
      }
      dirs.push(direction);
    }
    if (dirs.length !== ports) {
      continue;
    }

    for (const assignment of portAssignments(ports, inputs.length)) {
      for (let x = 1; x < GRID - 1; x += 1) {
        for (let y = 1; y < GRID - 1; y += 1) {
          const cell = { x, y };
          if (blocked.has(key(x, y))) {
            continue;
          }
          let cost = 0;
          let feasible = true;
          for (let inputIndex = 0; inputIndex < inputs.length; inputIndex += 1) {
            const source = sources.get(inputs[inputIndex]);
            const portDirection = dirs[assignment[inputIndex]];
            if (source === undefined || portDirection === undefined) {
              feasible = false;
              break;
            }
            const portCell = add(cell, portDirection);
            if (!inBounds(portCell)) {
              feasible = false;
              break;
            }
            const route = straightRun(source, portCell);
            if (route === undefined) {
              feasible = false;
              break;
            }
            if (route.cells.some((beltCell) => blocked.has(key(beltCell.x, beltCell.y)))) {
              feasible = false;
              break;
            }
            cost += route.cells.length;
          }
          if (feasible) {
            found.push({ cell, rotation, cost });
          }
        }
      }
    }
  }

  found.sort((left, right) => left.cost - right.cost || left.cell.y - right.cell.y || left.cell.x - right.cell.x);
  return found.slice(0, limit).map((entry) => ({ cell: entry.cell, rotation: entry.rotation }));
}

function rayHit(origin: Cell, direction: Cell, otherOrigin: Cell, otherDirection: Cell): Cell | undefined {
  const det = direction.x * -otherDirection.y - direction.y * -otherDirection.x;
  if (det === 0) {
    return undefined;
  }
  const dx = otherOrigin.x - origin.x;
  const dy = otherOrigin.y - origin.y;
  const k = (dx * -otherDirection.y - dy * -otherDirection.x) / det;
  const m = (direction.x * dy - direction.y * dx) / det;
  if (!Number.isInteger(k) || !Number.isInteger(m) || k < 1 || m < 1) {
    return undefined;
  }
  const hit = { x: origin.x + direction.x * k, y: origin.y + direction.y * k };
  return inBounds(hit) ? hit : undefined;
}

/**
 * Builds the chain bottom up. A consumer stands wherever its suppliers' output
 * rays meet, so the whole layout is a tree of straight runs rather than a
 * compact block, and nothing is assumed about where the root ends up.
 */
function solveFree(
  plan: PlanNode[],
  root: PlanNode,
  leaves: readonly PlanNode[],
  nodes: ReadonlyArray<{ resource: ResourceId; x: number; y: number }>,
  nodeCells: ReadonlySet<string>,
  beamWidth: number,
  leafLimit: number,
): { placed: Map<PlanNode, { cell: Cell; rotation: Rotation }>; assignments: Map<PlanNode, Map<ResourceId, Cell>> } | undefined {
  const rawAssignments = new Map<PlanNode, Map<ResourceId, Cell>[]>();
  for (const leaf of leaves) {
    rawAssignments.set(leaf, allLeafAssignments(leaf, nodes));
  }
  const depth = new Map<PlanNode, number>();
  const measure = (node: PlanNode, level: number): void => {
    depth.set(node, level);
    for (const feeder of node.feeders) {
      if (feeder.child !== undefined) {
        measure(feeder.child, level + 1);
      }
    }
  };
  measure(root, 0);

  const order = [...plan].sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0));
  let beam: FreeState[] = [{ placed: new Map(), assignments: new Map(), cost: 0 }];

  for (const node of order) {
    const next: FreeState[] = [];
    for (const state of beam) {
      const children = node.feeders
        .map((feeder) => feeder.child)
        .filter((child): child is PlanNode => child !== undefined);

      if (children.length === 0) {
        const candidates = rawAssignments.get(node) ?? [];
        if (candidates.length === 0) {
          continue;
        }
        const blocked = new Set<string>(nodeCells);
        for (const entry of state.placed.values()) {
          blocked.add(key(entry.cell.x, entry.cell.y));
        }
        for (const sources of candidates) {
          for (const option of freeLeafOptions(node, sources, blocked, leafLimit)) {
            const placed = new Map(state.placed);
            placed.set(node, { cell: option.cell, rotation: option.rotation });
            next.push({
              placed,
              cost: state.cost,
              assignments: new Map(state.assignments).set(node, sources),
            });
          }
        }
        continue;
      }

      if (children.length === 1) {
        const child = state.placed.get(children[0]);
        if (child === undefined) {
          continue;
        }
        const childDirection = outputDirection(child.rotation);
        for (let k = 1; k < GRID - 1; k += 1) {
          const cell = { x: child.cell.x + childDirection.x * k, y: child.cell.y + childDirection.y * k };
          if (!inBounds(cell)) {
            continue;
          }
          for (const rotation of ROTATIONS) {
            const feeds = ROTATIONS.some((candidate) => {
              const portDirection = inputPortDirection(candidate, 0);
              return portDirection !== undefined && same(portDirection, { x: -childDirection.x, y: -childDirection.y });
            });
            if (!feeds) {
              continue;
            }
            const placed = new Map(state.placed);
            placed.set(node, { cell, rotation });
            next.push({ placed, assignments: state.assignments, cost: state.cost + k });
          }
        }
        continue;
      }

      const first = state.placed.get(children[0]);
      const second = state.placed.get(children[1]);
      if (first === undefined || second === undefined) {
        continue;
      }
      const firstDirection = outputDirection(first.rotation);
      const secondDirection = outputDirection(second.rotation);
      const cell = rayHit(first.cell, firstDirection, second.cell, secondDirection);
      if (cell === undefined) {
        continue;
      }
      const ports = inputPortCount(node.type);
      const firstNeed = { x: -firstDirection.x, y: -firstDirection.y };
      const secondNeed = { x: -secondDirection.x, y: -secondDirection.y };
      for (let firstPort = 0; firstPort < ports; firstPort += 1) {
        for (let secondPort = 0; secondPort < ports; secondPort += 1) {
          if (firstPort === secondPort) {
            continue;
          }
          const rotation = ROTATIONS.find((candidate) => {
            const a = inputPortDirection(candidate, firstPort);
            const b = inputPortDirection(candidate, secondPort);
            return a !== undefined && b !== undefined && same(a, firstNeed) && same(b, secondNeed);
          });
          if (rotation === undefined) {
            continue;
          }
          const placed = new Map(state.placed);
          placed.set(node, { cell, rotation });
          next.push({
            placed,
            assignments: state.assignments,
            cost: state.cost + manhattan(first.cell, cell) + manhattan(second.cell, cell),
          });
        }
      }
    }

    if (next.length === 0) {
      return undefined;
    }
    next.sort((left, right) => left.cost - right.cost);
    beam = next.slice(0, beamWidth);
  }

  const complete = beam.find((state) => state.placed.has(root));
  return complete === undefined ? undefined : { placed: complete.placed, assignments: complete.assignments };
}

export function solve(seed: number = NEW_GAME_SEED): SolveResult {
  const state = createInitialState(seed);
  const nodes = state.grid.nodes;
  const plan = planChain("motor");

  const root = plan.find((node) => node.spine);
  if (root === undefined) {
    return { ok: false, entities: [], beltCount: 0, spineMachines: 0, leafMachines: 0 };
  }
  const spine = plan.filter((node) => node.spine);
  const leaves = plan.filter((node) => !node.spine);
  const nodeCells = new Set(nodes.map((node) => key(node.x, node.y)));

  const choices = portChoiceSets(plan, root);
  const attempts: Attempt[] = [];
  for (const rootRotation of ROTATIONS) {
    for (const choice of choices) {
      for (let x = EDGE; x < GRID - EDGE; x += ANCHOR_STEP) {
        for (let y = EDGE; y < GRID - EDGE; y += ANCHOR_STEP) {
          const attempt = attemptAnchor(plan, root, { x, y }, choice, rootRotation, nodes, nodeCells);
          if (attempt !== undefined) {
            attempts.push(attempt);
          }
        }
      }
    }
  }

  if (process.env.SOLVER_MODE === "free") {
    const free = solveFree(plan, root, leaves, nodes, nodeCells, 600, 60);
    if (free !== undefined) {
      const entities = emitLayout(plan, free.assignments, free.placed, new Map(), nodeCells);
      if (entities !== undefined && validateLayout(entities).length === 0) {
        return {
          ok: true,
          entities,
          beltCount: entities.filter((entity) => entity.type === "belt").length,
          anchor: free.placed.get(root)?.cell,
          spineMachines: spine.length,
          leafMachines: leaves.length,
        };
      }
      if (process.env.DEBUG_SOLVE !== undefined) {
        console.error(" free layout rejected", entities === undefined ? "emit failed" : "invalid");
      }
    } else if (process.env.DEBUG_SOLVE !== undefined) {
      console.error(" free search exhausted");
    }
  }

  attempts.sort((left, right) => left.cost - right.cost || left.anchor.x - right.anchor.x || left.anchor.y - right.anchor.y);

  for (const attempt of attempts) {
    const entities = buildEntities(attempt, spine, root, nodeCells);
    if (entities === undefined) {
      if (process.env.DEBUG_SOLVE !== undefined) {
        console.error(" build failed at", attempt.anchor.x, attempt.anchor.y);
      }
      continue;
    }
    const probs = validateLayout(entities);
    if (process.env.DEBUG_SOLVE !== undefined) {
      console.error(" validate", attempt.anchor.x, attempt.anchor.y, probs.length, probs.slice(0, 2).join(" | "));
    }
    if (probs.length > 0) {
      continue;
    }
    return {
      ok: true,
      entities,
      beltCount: entities.filter((entity) => entity.type === "belt").length,
      anchor: attempt.anchor,
      spineMachines: spine.length,
      leafMachines: leaves.length,
    };
  }

  return { ok: false, entities: [], beltCount: 0, spineMachines: 0, leafMachines: 0 };
}

const ANCHOR_STEP = 6;

interface LeafOption {
  solution: LeafSolution;
  nodes: string[];
}

/**
 * Tries every anchor for the spine. For each anchor every leaf supplier is
 * offered every legal combination of resource nodes and every legal position on
 * its consumer's port ray, and the anchor is scored by the cheapest set of
 * choices that share no node and no cell, so no leaf is starved by an earlier
 * one. That makes the search exhaustive over the anchors rather than greedy.
 */
function attemptAnchor(
  plan: PlanNode[],
  root: PlanNode,
  anchor: Cell,
  choice: PortChoice,
  rootRotation: Rotation,
  nodes: ReadonlyArray<{ resource: ResourceId; x: number; y: number; id: string }>,
  nodeCells: ReadonlySet<string>,
): Attempt | undefined {
  const layout = layoutSpine(root, anchor, choice, rootRotation);
  if (layout === undefined) {
    return undefined;
  }
  const machineBlocked = new Set<string>(nodeCells);
  for (const placed of layout.placed.values()) {
    machineBlocked.add(key(placed.cell.x, placed.cell.y));
  }
  const beltBlocked = new Set<string>();
  for (const placed of layout.placed.values()) {
    beltBlocked.add(key(placed.cell.x, placed.cell.y));
  }

  const leaves = plan.filter((node) => !node.spine).sort(
    (a, b) => optionBreadth(a, nodes) - optionBreadth(b, nodes),
  );

  const optionsFor = (leaf: PlanNode): LeafOption[] => {
    const slot = layout.slots.get(leaf);
    if (slot === undefined) {
      return [];
    }
    const inputs = uniqueInputs(leaf.recipe);
    const options: LeafOption[] = [];
    const seen = new Set<string>();
    const walk = (depth: number, chosen: Cell[], keys: string[]): void => {
      if (depth === inputs.length) {
        const sources = new Map<ResourceId, Cell>();
        inputs.forEach((resource, index) => {
          const cell = chosen[index];
          if (cell !== undefined) {
            sources.set(resource, cell);
          }
        });
        for (const solution of solveLeafAll(leaf, sources, slot, machineBlocked, beltBlocked)) {
          const signature = `${keys.join("|")}:${solution.cell.x},${solution.cell.y}:${solution.rotation}`;
          if (seen.has(signature)) {
            continue;
          }
          seen.add(signature);
          options.push({ solution, nodes: keys });
        }
        return;
      }
      for (const node of nodes) {
        if (node.resource !== inputs[depth]) {
          continue;
        }
        chosen.push({ x: node.x, y: node.y });
        walk(depth + 1, chosen, [...keys, node.id]);
        chosen.pop();
      }
    };
    walk(0, [], []);
    return options;
  };

  const perLeaf = leaves.map((leaf) => optionsFor(leaf));
  if (process.env.DEBUG_SOLVE === "detail") {
    console.error(" anchor", anchor.x, anchor.y, "r", rootRotation, perLeaf.map((options, index) => `${leaves[index].recipe}=${options.length}`).join(" "));
  }
  if (perLeaf.some((options) => options.length === 0)) {
    return undefined;
  }

  let best: { picked: LeafOption[]; cost: number } | undefined;
  const usedNodes = new Set<string>();
  const usedCells = new Set<string>();
  const picked: LeafOption[] = [];

  const search = (index: number, cost: number): void => {
    if (best !== undefined && cost >= best.cost) {
      return;
    }
    if (index === perLeaf.length) {
      best = { picked: [...picked], cost };
      return;
    }
    const options = perLeaf[index];
    for (const option of options) {
      if (option.nodes.some((id) => usedNodes.has(id))) {
        continue;
      }
      const cellKey = key(option.solution.cell.x, option.solution.cell.y);
      if (usedCells.has(cellKey)) {
        continue;
      }
      let clash = false;
      for (const cell of [
        ...option.solution.rawRoutes.flatMap((route) => route.cells),
        ...option.solution.link.cells,
        ...[...option.solution.sources.values()],
      ]) {
        if (usedCells.has(key(cell.x, cell.y))) {
          clash = true;
          break;
        }
      }
      if (clash) {
        continue;
      }
      const addedCells = new Set<string>();
      for (const route of [...option.solution.rawRoutes, option.solution.link]) {
        for (const beltCell of route.cells) {
          addedCells.add(key(beltCell.x, beltCell.y));
        }
      }
      for (const source of option.solution.sources.values()) {
        addedCells.add(key(source.x, source.y));
      }
      addedCells.add(cellKey);
      for (const id of option.nodes) {
        usedNodes.add(id);
      }
      for (const entry of addedCells) {
        usedCells.add(entry);
      }
      picked.push(option);
      search(index + 1, cost + option.solution.cost);
      picked.pop();
      for (const id of option.nodes) {
        usedNodes.delete(id);
      }
      for (const entry of addedCells) {
        usedCells.delete(entry);
      }
    }
  };

  search(0, 0);
  if (process.env.DEBUG_SOLVE !== undefined) {
    console.error("   joint", best === undefined ? "NONE" : best.cost);
  }
  if (best === undefined) {
    return undefined;
  }

  return {
    layout,
    solutions: best.picked.map((option) => option.solution),
    cost: best.cost,
    anchor,
  };
}

function optionBreadth(
  leaf: PlanNode,
  nodes: ReadonlyArray<{ resource: ResourceId }>,
): number {
  return uniqueInputs(leaf.recipe).reduce((total, resource) => {
    return total + nodes.filter((node) => node.resource === resource).length;
  }, 0);
}

function buildEntities(
  attempt: Attempt,
  spine: readonly PlanNode[],
  root: PlanNode,
  nodeCells: ReadonlySet<string>,
): LayoutEntity[] | undefined {
  const entities: LayoutEntity[] = [];
  const used = new Set<string>();

  for (const solution of attempt.solutions) {
    for (const cell of [
      solution.cell,
      ...solution.rawRoutes.flatMap((route) => route.cells),
      ...solution.link.cells,
    ]) {
      if (used.has(key(cell.x, cell.y))) {
        if (process.env.DEBUG_SOLVE !== undefined) {
          console.error("  cell clash", key(cell.x, cell.y), "on", solution.node.id);
        }
        return undefined;
      }
      used.add(key(cell.x, cell.y));
    }
  }

  for (const solution of attempt.solutions) {
    entities.push({
      id: solution.node.id,
      type: solution.node.type,
      x: solution.cell.x,
      y: solution.cell.y,
      rotation: solution.rotation,
      recipeId: solution.node.recipe,
    });
    for (let inputIndex = 0; inputIndex < uniqueInputs(solution.node.recipe).length; inputIndex += 1) {
      const resource = uniqueInputs(solution.node.recipe)[inputIndex];
      const source = solution.sources.get(resource);
      const route = solution.rawRoutes[inputIndex];
      const extractorRotation = solution.extractorRotations[inputIndex];
      if (source === undefined || route === undefined || extractorRotation === undefined) {
        return undefined;
      }
      entities.push({
        id: `extractor-${solution.node.id}-${resource}`,
        type: "extractor",
        x: source.x,
        y: source.y,
        rotation: extractorRotation,
        resourceNode: resource,
      });
      for (let beltIndex = 0; beltIndex < route.cells.length; beltIndex += 1) {
        entities.push({
          id: `belt-raw-${solution.node.id}-${resource}-${beltIndex}`,
          type: "belt",
          x: route.cells[beltIndex].x,
          y: route.cells[beltIndex].y,
          rotation: route.rotations[beltIndex] ?? 0,
        });
      }
    }
    for (let beltIndex = 0; beltIndex < solution.link.cells.length; beltIndex += 1) {
      entities.push({
        id: `belt-link-${solution.node.id}-${beltIndex}`,
        type: "belt",
        x: solution.link.cells[beltIndex].x,
        y: solution.link.cells[beltIndex].y,
        rotation: solution.link.rotations[beltIndex] ?? 0,
      });
    }
  }

  for (const node of spine) {
    const placed = attempt.layout.placed.get(node);
    if (placed === undefined) {
      return undefined;
    }
    entities.push({
      id: node.id,
      type: node.type,
      x: placed.cell.x,
      y: placed.cell.y,
      rotation: placed.rotation,
      recipeId: node.recipe,
    });
  }

  const rootPlaced = attempt.layout.placed.get(root);
  if (rootPlaced === undefined) {
    return undefined;
  }
  const motorDirection = outputDirection(rootPlaced.rotation);
  const motorOutput = add(rootPlaced.cell, motorDirection);
  const depotRotation = ROTATIONS.find((rotation) =>
    same(inputPortDirection(rotation, 0) ?? { x: 9, y: 9 }, { x: -motorDirection.x, y: -motorDirection.y }),
  );
  if (
    !inBounds(motorOutput) ||
    used.has(key(motorOutput.x, motorOutput.y)) ||
    depotRotation === undefined
  ) {
    if (process.env.DEBUG_SOLVE !== undefined) {
      console.error("  depot problem at", motorOutput.x, motorOutput.y, "used", used.has(key(motorOutput.x, motorOutput.y)), "rot", depotRotation);
    }
    return undefined;
  }
  entities.push({
    id: "depot-motor",
    type: "depot",
    x: motorOutput.x,
    y: motorOutput.y,
    rotation: depotRotation,
  });

  return entities;
}

function fallbackAssignments(
  leaves: readonly PlanNode[],
  nodes: ReadonlyArray<{ resource: ResourceId; x: number; y: number; id: string }>,
): Map<PlanNode, Map<ResourceId, Cell>> {
  const used = new Set<string>();
  const result = new Map<PlanNode, Map<ResourceId, Cell>>();
  for (const leaf of leaves) {
    const inputs = uniqueInputs(leaf.recipe);
    const map = new Map<ResourceId, Cell>();
    for (const resource of inputs) {
      const node = nodes
        .filter((candidate) => candidate.resource === resource && !used.has(key(candidate.x, candidate.y)))
        .sort((a, b) => a.y - b.y || a.x - b.x)[0];
      const chosen = node ?? nodes.find((candidate) => candidate.resource === resource);
      if (chosen === undefined) {
        return result;
      }
      used.add(key(chosen.x, chosen.y));
      map.set(resource, { x: chosen.x, y: chosen.y });
    }
    result.set(leaf, map);
  }
  return result;
}

/**
 * Turns a placement into entities. Every feeder, whether it comes from a
 * resource node or from another machine, is a straight run that ends on the
 * consumer's input port cell, so one loop lays the whole tree.
 */
function emitLayout(
  plan: PlanNode[],
  assignments: ReadonlyMap<PlanNode, Map<ResourceId, Cell>>,
  placed: ReadonlyMap<PlanNode, { cell: Cell; rotation: Rotation }>,
  ports: ReadonlyMap<PlanNode, Map<PlanNode, number>>,
  nodeCells: ReadonlySet<string>,
): LayoutEntity[] | undefined {
  const belts: Array<{ cell: Cell; rotation: Rotation; id: string }> = [];
  const extractors: LayoutEntity[] = [];
  const used = new Set<string>();
  const reservedNodes = new Set<string>();
  void nodeCells;

  for (const node of plan) {
    const entry = placed.get(node);
    if (entry === undefined) {
      return undefined;
    }
    for (const feeder of node.feeders) {
      const port =
        feeder.child === undefined ? feeder.port : ports.get(node)?.get(feeder.child) ?? feeder.port;
      const portDirection = inputPortDirection(entry.rotation, port);
      if (portDirection === undefined) {
        return undefined;
      }
      const portCell = add(entry.cell, portDirection);
      let source: Cell | undefined;
      if (feeder.child !== undefined) {
        const child = placed.get(feeder.child);
        source = child?.cell;
      } else {
        source = assignments.get(node)?.get(feeder.resource);
      }
      if (source === undefined) {
        return undefined;
      }
      const route = straightRun(source, portCell);
      if (route === undefined) {
        return undefined;
      }
      for (let index = 0; index < route.cells.length; index += 1) {
        const beltCell = route.cells[index];
        if (used.has(key(beltCell.x, beltCell.y))) {
          return undefined;
        }
        used.add(key(beltCell.x, beltCell.y));
        belts.push({
          cell: beltCell,
          rotation: route.rotations[index] ?? 0,
          id: `belt-${node.id}-${feeder.resource}-${index}`,
        });
      }
      if (feeder.child === undefined) {
        const extractorRotation = routeForExtractor(source, route, entry.cell);
        const sourceKey = key(source.x, source.y);
        if (extractorRotation === undefined || used.has(sourceKey) || reservedNodes.has(sourceKey)) {
          return undefined;
        }
        reservedNodes.add(sourceKey);
        extractors.push({
          id: `extractor-${node.id}-${feeder.resource}`,
          type: "extractor",
          x: source.x,
          y: source.y,
          rotation: extractorRotation,
          resourceNode: feeder.resource,
        });
      }
    }
    if (used.has(key(entry.cell.x, entry.cell.y))) {
      return undefined;
    }
    used.add(key(entry.cell.x, entry.cell.y));
  }

  const machines = plan.map((node) => {
    const entry = placed.get(node) as { cell: Cell; rotation: Rotation };
    return {
      id: node.id,
      type: node.type,
      x: entry.cell.x,
      y: entry.cell.y,
      rotation: entry.rotation,
      recipeId: node.recipe,
    } satisfies LayoutEntity;
  });

  const root = plan.find((node) => node.type === "assembler" && node.recipe === "motor");
  const rootEntry = root === undefined ? undefined : placed.get(root);
  if (rootEntry === undefined) {
    return undefined;
  }
  const motorDirection = outputDirection(rootEntry.rotation);
  const motorOutput = add(rootEntry.cell, motorDirection);
  const depotRotation = ROTATIONS.find((rotation) =>
    same(inputPortDirection(rotation, 0) ?? { x: 9, y: 9 }, { x: -motorDirection.x, y: -motorDirection.y }),
  );
  if (!inBounds(motorOutput) || used.has(key(motorOutput.x, motorOutput.y)) || depotRotation === undefined) {
    return undefined;
  }
  const depot: LayoutEntity = {
    id: "depot-motor",
    type: "depot",
    x: motorOutput.x,
    y: motorOutput.y,
    rotation: depotRotation,
  };

  return [
    ...extractors,
    ...machines,
    ...belts.map((belt) => ({
      id: belt.id,
      type: "belt" as const,
      x: belt.cell.x,
      y: belt.cell.y,
      rotation: belt.rotation,
    })),
    depot,
  ];
}

function toEntity(layout: LayoutEntity, index: number): Entity {
  return {
    id: `entity-${index + 1}`,
    type: layout.type,
    x: layout.x,
    y: layout.y,
    rotation: layout.rotation,
    level: 1,
    ...(layout.recipeId === undefined ? {} : { recipeId: layout.recipeId }),
    ...(layout.resourceNode === undefined ? {} : { resourceNode: layout.resourceNode }),
  };
}

function producerBehind(entities: readonly Entity[], cell: Cell, seen: Set<string>): Entity | undefined {
  const source = entities.find((entity) => entity.x === cell.x && entity.y === cell.y);
  if (source === undefined || source.type !== "belt") {
    return source;
  }
  if (seen.has(source.id)) {
    return undefined;
  }
  seen.add(source.id);
  for (const port of getWorldPortCells(source)) {
    if (port.port.kind !== "input") {
      continue;
    }
    const found = producerBehind(entities, { x: port.x, y: port.y }, seen);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function validateLayout(layout: readonly LayoutEntity[], seed: number = NEW_GAME_SEED): string[] {
  const problems: string[] = [];
  const entities = layout.map(toEntity);
  const occupied = new Set<string>();
  const state = createInitialState(seed);

  for (const entity of entities) {
    const cellKey = key(entity.x, entity.y);
    if (occupied.has(cellKey)) {
      problems.push(`two entities share cell ${cellKey}`);
    }
    occupied.add(cellKey);
    if (entity.x < 0 || entity.y < 0 || entity.x >= state.grid.width || entity.y >= state.grid.height) {
      problems.push(`entity ${entity.id} is outside the grid at ${cellKey}`);
    }
  }

  for (const entity of entities) {
    if (entity.type !== "extractor") {
      continue;
    }
    const node = state.grid.nodes.find((candidate) => candidate.x === entity.x && candidate.y === entity.y);
    if (node === undefined) {
      problems.push(`extractor ${entity.id} stands on no resource node`);
    } else if (node.resource !== entity.resourceNode) {
      problems.push(`extractor ${entity.id} claims ${entity.resourceNode} on a ${node.resource} node`);
    }
  }

  for (const belt of entities.filter((entity) => entity.type === "belt")) {
    const output = getWorldPortCells(belt).find((port) => port.port.kind === "output");
    if (output === undefined) {
      problems.push(`belt ${belt.id} has no output port`);
      continue;
    }
    const next = entities.find((entity) => entity.x === output.x && entity.y === output.y);
    if (next === undefined) {
      problems.push(`belt ${belt.id} points at nothing from ${belt.x},${belt.y}`);
    } else if (!arePortsConnected(belt, next)) {
      problems.push(`belt ${belt.id} at ${belt.x},${belt.y} does not connect to ${next.id}`);
    }
  }

  for (const entity of entities) {
    if (entity.type !== "smelter" && entity.type !== "assembler") {
      continue;
    }
    const recipe = entity.recipeId === undefined ? undefined : RECIPES[entity.recipeId as RecipeId];
    if (recipe === undefined || recipe.machine !== entity.type) {
      problems.push(`processor ${entity.id} has no runnable recipe`);
      continue;
    }
    const ports = getWorldPortCells(entity).filter((port) => port.port.kind === "input");
    for (const resource of uniqueInputs(recipe.id)) {
      const fed = ports.some((port) => {
        const producer = producerBehind(entities, { x: port.x, y: port.y }, new Set());
        if (producer === undefined) {
          return false;
        }
        const producerOutput = getWorldPortCells(producer).find((cell) => cell.port.kind === "output");
        return producerOutput !== undefined && getProducedResource(producer, producerOutput.port) === resource;
      });
      if (!fed) {
        problems.push(`processor ${entity.id} has no producer for ${resource}`);
      }
    }
    const output = getWorldPortCells(entity).find((port) => port.port.kind === "output");
    if (output === undefined) {
      problems.push(`processor ${entity.id} has no output port`);
      continue;
    }
    const consumer = entities.find((candidate) => candidate.x === output.x && candidate.y === output.y);
    if (consumer === undefined) {
      problems.push(`processor ${entity.id} has no consumer on its output port cell`);
    } else if (!arePortsConnected(entity, consumer)) {
      problems.push(`processor ${entity.id} does not connect to ${consumer.id}`);
    }
  }

  return problems;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  const started = Date.now();
  const result = solve(NEW_GAME_SEED);
  if (!result.ok) {
    console.log("no solution found");
    process.exitCode = 1;
  } else {
    const problems = validateLayout(result.entities);
    console.log(
      `motor chain solved in ${Date.now() - started}ms: ${result.entities.length} entities, ${result.beltCount} belts, ${result.spineMachines} spine, ${result.leafMachines} leaves, ${problems.length} problems`,
    );
    for (const problem of problems) {
      console.log(`  ${problem}`);
    }
    if (problems.length > 0) {
      process.exitCode = 1;
    }
  }
}
