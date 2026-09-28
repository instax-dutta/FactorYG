import { writeFileSync } from "node:fs";
import { NEW_GAME_SEED, createInitialState } from "../src/sim/initialState";
import { arePortsConnected, getWorldPortCells } from "../src/sim/connections";
import { rotateGridPoint } from "../src/sim/rotation";
import { getRecipe } from "../src/content/recipes";
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
  placements: number;
  nodesUsed: number;
  restarts: number;
  exhausted?: boolean;
}

interface PlanNode {
  id: string;
  type: MachineType;
  recipe: RecipeId;
  feeders: Array<{ resource: ResourceId; port: number; child?: PlanNode }>;
}

interface PlanSpec {
  id: string;
  type: MachineType;
  recipe: RecipeId;
  inputs: Array<{ resource: ResourceId; child?: string }>;
}

interface GenEntity {
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
  recipeId?: RecipeId;
  resourceNode?: ResourceId;
}

interface SubtreeCandidate {
  x: number;
  y: number;
  rotation: Rotation;
  entities: GenEntity[];
  mask: Uint32Array;
  belts: number;
}

const GRID = 64;
const WORD_STRIDE = GRID / 32;
const MASK_WORDS = WORD_STRIDE * GRID;
const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
const SCAN_STEP = 4;
const PER_CALL_STEPS = 120_000;
const PER_ROOT_CAP = 6;
const PER_ROOT_KEEP = 3;
const POOL_LIMIT = 1200;
const MAX_SPAN = 20;
const DEPOSIT_SPAN = 14;
const SUBTREE_SEEDS: readonly PlanSpec[] = [
  { id: "circuit", type: "assembler", recipe: "circuit", inputs: [
    { resource: "wire", child: "wire" },
    { resource: "gear", child: "gear1" },
  ] },
  { id: "frame", type: "assembler", recipe: "frame", inputs: [
    { resource: "plate", child: "plate" },
    { resource: "gear", child: "gear2" },
  ] },
];

const PLAN_SPECS: readonly PlanSpec[] = [
  { id: "motor", type: "assembler", recipe: "motor", inputs: [
    { resource: "circuit", child: "circuit" },
    { resource: "frame", child: "frame" },
  ] },
  { id: "circuit", type: "assembler", recipe: "circuit", inputs: [
    { resource: "wire", child: "wire" },
    { resource: "gear", child: "gear1" },
  ] },
  { id: "frame", type: "assembler", recipe: "frame", inputs: [
    { resource: "plate", child: "plate" },
    { resource: "gear", child: "gear2" },
  ] },
  { id: "wire", type: "assembler", recipe: "wire", inputs: [
    { resource: "copperIngot", child: "copper" },
  ] },
  { id: "gear1", type: "assembler", recipe: "gear", inputs: [
    { resource: "ironIngot", child: "iron1" },
  ] },
  { id: "gear2", type: "assembler", recipe: "gear", inputs: [
    { resource: "ironIngot", child: "iron2" },
  ] },
  { id: "plate", type: "assembler", recipe: "plate", inputs: [
    { resource: "ironIngot", child: "iron3" },
    { resource: "refinedStone", child: "stone" },
  ] },
  { id: "copper", type: "smelter", recipe: "copperIngot", inputs: [
    { resource: "copperOre" },
  ] },
  { id: "stone", type: "smelter", recipe: "refinedStone", inputs: [
    { resource: "stone" },
  ] },
  { id: "iron1", type: "smelter", recipe: "ironIngot", inputs: [
    { resource: "ironOre" },
    { resource: "coal" },
  ] },
  { id: "iron2", type: "smelter", recipe: "ironIngot", inputs: [
    { resource: "ironOre" },
    { resource: "coal" },
  ] },
  { id: "iron3", type: "smelter", recipe: "ironIngot", inputs: [
    { resource: "ironOre" },
    { resource: "coal" },
  ] },
];

const SPEC_BY_ID = new Map(PLAN_SPECS.map((spec) => [spec.id, spec]));

const OUT_DIRECTION = new Map<Rotation, Cell>(
  ROTATIONS.map((rotation) => {
    const point = rotateGridPoint({ x: 1, y: 0 }, rotation);
    return [rotation, { x: point.x, y: point.y }];
  }),
);

const DIRECTION_ROTATION = new Map<string, Rotation>(
  [...OUT_DIRECTION].map(([rotation, direction]) => [`${direction.x},${direction.y}`, rotation]),
);

function portDirections(rotation: Rotation): [Cell, Cell] {
  const first = rotateGridPoint({ x: -1, y: 0 }, rotation);
  const second = rotateGridPoint({ x: 0, y: -1 }, rotation);
  return [{ x: first.x, y: first.y }, { x: second.x, y: second.y }];
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

function negate(direction: Cell): Cell {
  return { x: -direction.x, y: -direction.y };
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID && y < GRID;
}

function cellWord(x: number, y: number): number {
  return WORD_STRIDE * y + (x >= GRID / 2 ? 1 : 0);
}

function cellBit(x: number): number {
  return 1 << (x % 32);
}

function maskHolds(mask: Uint32Array, x: number, y: number): boolean {
  return (mask[cellWord(x, y)] & cellBit(x)) !== 0;
}

function maskAdd(mask: Uint32Array, x: number, y: number): void {
  mask[cellWord(x, y)] |= cellBit(x);
}

function masksDisjoint(a: Uint32Array, b: Uint32Array): boolean {
  for (let word = 0; word < MASK_WORDS; word += 1) {
    if ((a[word] & b[word]) !== 0) {
      return false;
    }
  }
  return true;
}

function resourceNodes(seed: number): Map<ResourceId, Cell[]> {
  const byResource = new Map<ResourceId, Cell[]>();
  for (const node of createInitialState(seed).grid.nodes) {
    const existing = byResource.get(node.resource);
    if (existing === undefined) {
      byResource.set(node.resource, [{ x: node.x, y: node.y }]);
    } else {
      existing.push({ x: node.x, y: node.y });
    }
  }
  return byResource;
}

export function planChain(rootRecipe: RecipeId = "motor"): PlanNode[] {
  const built = new Map<string, PlanNode>();
  const build = (id: string): PlanNode => {
    const existing = built.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const spec = SPEC_BY_ID.get(id);
    if (spec === undefined) {
      throw new Error(`unknown plan node ${id}`);
    }
    const node: PlanNode = { id: spec.id, type: spec.type, recipe: spec.recipe, feeders: [] };
    built.set(id, node);
    node.feeders = spec.inputs.map((input, port) => ({
      resource: input.resource,
      port,
      ...(input.child === undefined ? {} : { child: build(input.child) }),
    }));
    return node;
  };
  const root = [...SPEC_BY_ID.values()].find((spec) => spec.recipe === rootRecipe);
  if (root === undefined) {
    throw new Error(`no plan for ${rootRecipe}`);
  }
  const ordered: PlanNode[] = [];
  const seen = new Set<string>();
  const flatten = (node: PlanNode): void => {
    if (seen.has(node.id)) {
      return;
    }
    seen.add(node.id);
    ordered.push(node);
    for (const feeder of node.feeders) {
      if (feeder.child !== undefined) {
        flatten(feeder.child);
      }
    }
  };
  flatten(build(root.id));
  return ordered;
}

class Halt extends Error {}

interface GenContext {
  occupied: Uint32Array;
  entities: GenEntity[];
  stepsLeft: number;
  halted: boolean;
}

function occupy(context: GenContext, x: number, y: number): void {
  context.occupied[cellWord(x, y)] |= cellBit(x);
}

function release(context: GenContext, x: number, y: number): void {
  context.occupied[cellWord(x, y)] &= ~cellBit(x);
}

function free(context: GenContext, x: number, y: number): boolean {
  return (context.occupied[cellWord(x, y)] & cellBit(x)) === 0;
}

function spanFree(context: GenContext, x: number, y: number, direction: Cell, span: number): boolean {
  for (let step = 1; step <= span; step += 1) {
    const cx = x + direction.x * step;
    const cy = y + direction.y * step;
    if (!inBounds(cx, cy) || !free(context, cx, cy)) {
      return false;
    }
  }
  return true;
}

function layBelts(
  context: GenContext,
  x: number,
  y: number,
  direction: Cell,
  span: number,
  rotation: Rotation,
): void {
  for (let step = 1; step < span; step += 1) {
    const bx = x + direction.x * step;
    const by = y + direction.y * step;
    occupy(context, bx, by);
    context.entities.push({ type: "belt", x: bx, y: by, rotation });
  }
}

function unlayBelts(context: GenContext, x: number, y: number, direction: Cell, span: number): void {
  for (let step = 1; step < span; step += 1) {
    release(context, x + direction.x * step, y + direction.y * step);
  }
}

function growSubtree(
  spec: PlanSpec,
  x: number,
  y: number,
  rotation: Rotation,
  context: GenContext,
  onComplete: (spec: PlanSpec, x: number, y: number, rotation: Rotation) => boolean,
  nodes: Map<ResourceId, Cell[]>,
): boolean {
  if (context.halted) {
    return false;
  }
  context.stepsLeft -= 1;
  if (context.stepsLeft <= 0) {
    context.halted = true;
    return false;
  }
  if (!inBounds(x, y) || !free(context, x, y)) {
    return false;
  }
  occupy(context, x, y);
  context.entities.push({ type: spec.type, x, y, rotation, recipeId: spec.recipe });
  const mark = context.entities.length - 1;
  const ports = portDirections(rotation);
  const assignments: number[][] =
    spec.inputs.length === 2 ? [[0, 1], [1, 0]] : [[0], [1]];
  let complete = false;

  const assign = (assignment: number[], depth: number): void => {
    if (complete || context.halted) {
      return;
    }
    if (depth === spec.inputs.length) {
      complete = onComplete(spec, x, y, rotation);
      if (complete) {
        context.halted = true;
      }
      return;
    }
    const input = spec.inputs[depth];
    const port = ports[assignment[depth]];
    const back = negate(port);
    const beltRotation = DIRECTION_ROTATION.get(`${back.x},${back.y}`);
    if (beltRotation === undefined) {
      return;
    }
    if (input.child === undefined) {
      const candidates = (nodes.get(input.resource) ?? [])
        .map((node) => {
          const along = (node.x - x) * port.x + (node.y - y) * port.y;
          return { node, span: along };
        })
        .filter(
          (entry) =>
            entry.span >= 1 &&
            x + port.x * entry.span === entry.node.x &&
            y + port.y * entry.span === entry.node.y,
        )
        .sort((a, b) => a.span - b.span);
      for (const entry of candidates) {
        if (context.halted) {
          return;
        }
        if (!spanFree(context, x, y, port, entry.span)) {
          continue;
        }
        const beltMark = context.entities.length;
        layBelts(context, x, y, port, entry.span, beltRotation);
        occupy(context, entry.node.x, entry.node.y);
        context.entities.push({
          type: "extractor",
          x: entry.node.x,
          y: entry.node.y,
          rotation: beltRotation,
          resourceNode: input.resource,
        });
        assign(assignment, depth + 1);
        release(context, entry.node.x, entry.node.y);
        unlayBelts(context, x, y, port, entry.span);
        context.entities.length = beltMark;
        if (complete || context.halted) {
          return;
        }
      }
      return;
    }
    const child = SPEC_BY_ID.get(input.child);
    if (child === undefined) {
      return;
    }
    for (let span = 1; span <= MAX_SPAN; span += 1) {
      if (context.halted) {
        return;
      }
      const cx = x + port.x * span;
      const cy = y + port.y * span;
      if (!inBounds(cx, cy) || !spanFree(context, x, y, port, span)) {
        break;
      }
      const beltMark = context.entities.length;
      layBelts(context, x, y, port, span, beltRotation);
      growSubtree(child, cx, cy, beltRotation, context, () => {
        assign(assignment, depth + 1);
        return context.halted;
      }, nodes);
      unlayBelts(context, x, y, port, span);
      context.entities.length = beltMark;
      if (complete || context.halted) {
        return;
      }
    }
  };

  for (const assignment of assignments) {
    if (complete || context.halted) {
      break;
    }
    assign(assignment, 0);
  }
  release(context, x, y);
  context.entities.length = mark;
  return complete;
}

function collectSubtrees(
  spec: PlanSpec,
  rotation: Rotation,
  nodes: Map<ResourceId, Cell[]>,
): SubtreeCandidate[] {
  const kept: SubtreeCandidate[] = [];
  for (let y = 1; y < GRID - 1; y += SCAN_STEP) {
    for (let x = 1; x < GRID - 1; x += SCAN_STEP) {
      const found: SubtreeCandidate[] = [];
      const context: GenContext = {
        occupied: new Uint32Array(MASK_WORDS),
        entities: [],
        stepsLeft: PER_CALL_STEPS,
        halted: false,
      };
      const onComplete = (
        done: PlanSpec,
        cx: number,
        cy: number,
        crot: Rotation,
      ): boolean => {
        const entities = context.entities.map((entity) => ({ ...entity }));
        const mask = new Uint32Array(MASK_WORDS);
        let belts = 0;
        for (const entity of entities) {
          maskAdd(mask, entity.x, entity.y);
          if (entity.type === "belt") {
            belts += 1;
          }
        }
        found.push({ x: cx, y: cy, rotation: crot, entities, mask, belts });
        if (found.length >= PER_ROOT_CAP) {
          throw new Halt();
        }
        return false;
      };
      try {
        growSubtree(spec, x, y, rotation, context, onComplete, nodes);
      } catch (error) {
        if (!(error instanceof Halt)) {
          throw error;
        }
      }
      found.sort((a, b) => a.belts - b.belts);
      for (const candidate of found.slice(0, PER_ROOT_KEEP)) {
        kept.push(candidate);
      }
    }
  }
  return kept.slice(0, POOL_LIMIT);
}

function rayMeeting(
  fromA: Cell,
  dirA: Cell,
  fromB: Cell,
  dirB: Cell,
): { k: number; m: number; cell: Cell } | undefined {
  const determinant = dirA.x * negate(dirB).y - dirA.y * negate(dirB).x;
  if (determinant === 0) {
    return undefined;
  }
  const dx = fromB.x - fromA.x;
  const dy = fromB.y - fromA.y;
  const k = (dx * negate(dirB).y - dy * negate(dirB).x) / determinant;
  const m = (dirA.x * dy - dirA.y * dx) / determinant;
  if (!Number.isInteger(k) || !Number.isInteger(m) || k < 1 || m < 1) {
    return undefined;
  }
  const cell = { x: fromA.x + dirA.x * k, y: fromA.y + dirA.y * k };
  return inBounds(cell.x, cell.y) ? { k, m, cell } : undefined;
}

function runClear(
  a: Uint32Array,
  b: Uint32Array,
  from: Cell,
  direction: Cell,
  first: number,
  last: number,
): boolean {
  for (let step = first; step <= last; step += 1) {
    const cx = from.x + direction.x * step;
    const cy = from.y + direction.y * step;
    if (!inBounds(cx, cy) || maskHolds(a, cx, cy) || maskHolds(b, cx, cy)) {
      return false;
    }
  }
  return true;
}

function motorRotation(dirA: Cell, dirB: Cell): Rotation | undefined {
  const negA = negate(dirA);
  const negB = negate(dirB);
  for (const rotation of ROTATIONS) {
    const [first, second] = portDirections(rotation);
    if ((sameCell(first, negA) && sameCell(second, negB)) || (sameCell(first, negB) && sameCell(second, negA))) {
      return rotation;
    }
  }
  return undefined;
}

interface CombinedLayout {
  entities: GenEntity[];
  belts: number;
}

function pairSubtrees(
  circuits: readonly SubtreeCandidate[],
  frames: readonly SubtreeCandidate[],
  dirA: Cell,
  dirB: Cell,
): CombinedLayout | undefined {
  const motorRotationChoice = motorRotation(dirA, dirB);
  if (motorRotationChoice === undefined) {
    return undefined;
  }
  const motorOut = OUT_DIRECTION.get(motorRotationChoice);
  if (motorOut === undefined) {
    return undefined;
  }
  let best: CombinedLayout | undefined;
  for (const circuit of circuits) {
    for (const frame of frames) {
      const meeting = rayMeeting(circuit, dirA, frame, dirB);
      if (meeting === undefined) {
        continue;
      }
      if (maskHolds(circuit.mask, meeting.cell.x, meeting.cell.y)) {
        continue;
      }
      if (maskHolds(frame.mask, meeting.cell.x, meeting.cell.y)) {
        continue;
      }
      if (!runClear(circuit.mask, frame.mask, circuit, dirA, 1, meeting.k - 1)) {
        continue;
      }
      if (!runClear(circuit.mask, frame.mask, frame, dirB, 1, meeting.m - 1)) {
        continue;
      }
      if (!masksDisjoint(circuit.mask, frame.mask)) {
        continue;
      }
      let deposited = false;
      for (let span = 1; span <= DEPOSIT_SPAN; span += 1) {
        if (!runClear(circuit.mask, frame.mask, meeting.cell, motorOut, 0, span - 1)) {
          break;
        }
        const entities: GenEntity[] = [
          ...circuit.entities,
          ...frame.entities,
          ...beltRun(circuit, dirA, meeting.k),
          ...beltRun(frame, dirB, meeting.m),
          {
            type: "assembler",
            x: meeting.cell.x,
            y: meeting.cell.y,
            rotation: motorRotationChoice,
            recipeId: "motor",
          },
          ...beltRun(meeting.cell, motorOut, span),
          {
            type: "depot",
            x: meeting.cell.x + motorOut.x * span,
            y: meeting.cell.y + motorOut.y * span,
            rotation: DIRECTION_ROTATION.get(`${motorOut.x},${motorOut.y}`) ?? 0,
          },
        ];
        const belts = entities.filter((entity) => entity.type === "belt").length;
        if (best === undefined || belts < best.belts) {
          best = { entities, belts };
        }
        deposited = true;
        break;
      }
      if (!deposited) {
        continue;
      }
    }
  }
  return best;
}

function beltRun(origin: Cell, direction: Cell, span: number): GenEntity[] {
  const rotation = DIRECTION_ROTATION.get(`${direction.x},${direction.y}`);
  if (rotation === undefined) {
    return [];
  }
  const run: GenEntity[] = [];
  for (let step = 1; step < span; step += 1) {
    run.push({
      type: "belt",
      x: origin.x + direction.x * step,
      y: origin.y + direction.y * step,
      rotation,
    });
  }
  return run;
}

export const __probe = { growSubtree, resourceNodes, SPEC_BY_ID, collectSubtrees, OUT_DIRECTION };

export function solve(seed: number = NEW_GAME_SEED): SolveResult {
  const nodes = resourceNodes(seed);
  const pools = new Map<string, SubtreeCandidate[]>();
  for (const spec of SUBTREE_SEEDS) {
    for (const rotation of ROTATIONS) {
      const direction = OUT_DIRECTION.get(rotation);
      if (direction === undefined) {
        continue;
      }
      const key = `${spec.id}|${direction.x},${direction.y}`;
      pools.set(key, collectSubtrees(spec, rotation, nodes));
    }
  }
  const directions = [...OUT_DIRECTION.values()];
  let best: CombinedLayout | undefined;
  for (const dirA of directions) {
    const circuits = pools.get(`circuit|${dirA.x},${dirA.y}`);
    if (circuits === undefined) {
      continue;
    }
    for (const dirB of directions) {
      if (Math.abs(dirA.x * dirB.x + dirA.y * dirB.y) !== 0) {
        continue;
      }
      const frames = pools.get(`frame|${dirB.x},${dirB.y}`);
      if (frames === undefined) {
        continue;
      }
      const combined = pairSubtrees(circuits, frames, dirA, dirB);
      if (combined !== undefined && (best === undefined || combined.belts < best.belts)) {
        best = combined;
      }
    }
  }
  if (best === undefined) {
    return {
      ok: false,
      entities: [],
      beltCount: 0,
      placements: 0,
      nodesUsed: 0,
      restarts: 0,
      exhausted: true,
    };
  }
  const entities: LayoutEntity[] = best.entities.map((entity, order) => ({
    id: `e${order}`,
    type: entity.type,
    x: entity.x,
    y: entity.y,
    rotation: entity.rotation,
    ...(entity.recipeId === undefined ? {} : { recipeId: entity.recipeId }),
    ...(entity.resourceNode === undefined ? {} : { resourceNode: entity.resourceNode }),
  }));
  const nodeCells = new Set(
    entities
      .filter((entity) => entity.type === "extractor")
      .map((entity) => `${entity.x},${entity.y}`),
  );
  return {
    ok: true,
    entities,
    beltCount: best.belts,
    placements: entities.length,
    nodesUsed: nodeCells.size,
    restarts: 0,
  };
}

function asEntity(entity: LayoutEntity): Entity {
  return {
    id: entity.id,
    type: entity.type,
    x: entity.x,
    y: entity.y,
    rotation: entity.rotation,
    level: 1,
    ...(entity.recipeId === undefined ? {} : { recipeId: entity.recipeId }),
    ...(entity.resourceNode === undefined ? {} : { resourceNode: entity.resourceNode }),
  };
}

function producedResource(entity: Entity): ResourceId | undefined {
  if (entity.type === "extractor") {
    return entity.resourceNode;
  }
  if (entity.recipeId === undefined) {
    return undefined;
  }
  return getRecipe(entity.recipeId)?.output.resource;
}

export function validateLayout(
  layout: readonly LayoutEntity[],
  seed: number = NEW_GAME_SEED,
): string[] {
  const problems: string[] = [];
  const entities = layout.map(asEntity);
  const byCell = new Map<string, Entity>();
  for (const entity of entities) {
    const key = `${entity.x},${entity.y}`;
    if (byCell.has(key)) {
      problems.push(`two entities share cell ${key}`);
      continue;
    }
    byCell.set(key, entity);
  }
  for (const entity of entities) {
    if (!inBounds(entity.x, entity.y)) {
      problems.push(`${entity.type} at ${entity.x},${entity.y} is outside the grid`);
    }
  }
  const nodes = resourceNodes(seed);
  for (const entity of entities) {
    if (entity.type !== "extractor" || entity.resourceNode === undefined) {
      continue;
    }
    const stands = (nodes.get(entity.resourceNode) ?? []).some(
      (node) => node.x === entity.x && node.y === entity.y,
    );
    if (!stands) {
      problems.push(`extractor at ${entity.x},${entity.y} is not on a ${entity.resourceNode} node`);
    }
  }
  for (const entity of entities) {
    const output = getWorldPortCells(entity).find((port) => port.port.kind === "output");
    if (output === undefined) {
      continue;
    }
    const target = byCell.get(`${output.x},${output.y}`);
    if (target === undefined) {
      problems.push(`${entity.type} at ${entity.x},${entity.y} has nothing on its output port cell`);
      continue;
    }
    if (!arePortsConnected(entity, target)) {
      problems.push(
        `${entity.type} at ${entity.x},${entity.y} does not connect to ${target.type} at ${target.x},${target.y}`,
      );
    }
  }
  for (const entity of entities) {
    if (entity.type !== "smelter" && entity.type !== "assembler") {
      continue;
    }
    if (entity.recipeId === undefined) {
      problems.push(`${entity.type} at ${entity.x},${entity.y} has no recipe`);
      continue;
    }
    const recipe = getRecipe(entity.recipeId);
    if (recipe === undefined) {
      problems.push(`${entity.type} at ${entity.x},${entity.y} names an unknown recipe ${entity.recipeId}`);
      continue;
    }
    const needed = new Set<ResourceId>(Object.keys(recipe.inputs) as ResourceId[]);
    const fed = new Set<ResourceId>();
    for (const port of getWorldPortCells(entity).filter((cell) => cell.port.kind === "input")) {
      let current = byCell.get(`${port.x},${port.y}`);
      if (current === undefined) {
        continue;
      }
      const visited = new Set<string>();
      while (current !== undefined && current.type === "belt") {
        const key = `${current.x},${current.y}`;
        if (visited.has(key)) {
          problems.push(`the belt run feeding ${entity.recipeId} at ${entity.x},${entity.y} loops`);
          current = undefined;
          break;
        }
        visited.add(key);
        const entry: Cell | undefined = getWorldPortCells(current).find(
          (cell) => cell.port.kind === "input",
        );
        current =
          entry === undefined ? undefined : byCell.get(`${entry.x},${entry.y}`);
      }
      if (current === undefined) {
        problems.push(
          `the belt run feeding ${entity.recipeId} at ${entity.x},${entity.y} has no producer at its start`,
        );
        continue;
      }
      const resource = producedResource(current);
      if (resource === undefined || !needed.has(resource)) {
        problems.push(
          `an input of ${entity.recipeId} at ${entity.x},${entity.y} is fed ${resource ?? current.type}, which it does not need`,
        );
        continue;
      }
      fed.add(resource);
    }
    for (const resource of needed) {
      if (!fed.has(resource)) {
        problems.push(`no producer reaches the ${resource} input of ${entity.recipeId} at ${entity.x},${entity.y}`);
      }
    }
  }
  return problems;
}

export function layoutJson(seed: number = NEW_GAME_SEED, path?: string): string {
  const result = solve(seed);
  const json = JSON.stringify(result.entities, null, 2);
  if (path !== undefined) {
    writeFileSync(path, `${json}\n`);
  }
  return json;
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].includes("solve-motor-chain");

if (invokedDirectly) {
  const started = Date.now();
  const result = solve(NEW_GAME_SEED);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const problems = result.ok ? validateLayout(result.entities, NEW_GAME_SEED) : ["solver found nothing"];
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: result.ok,
        entities: result.placements,
        belts: result.beltCount,
        nodesUsed: result.nodesUsed,
        problems: problems.length,
        detail: problems.slice(0, 8),
        seconds: Number(elapsed),
      },
      null,
      2,
    )}\n`,
  );
  if (result.ok) {
    layoutJson(NEW_GAME_SEED, "scripts/motor-chain-layout.json");
    process.stdout.write("wrote scripts/motor-chain-layout.json\n");
  }
}
