import { MACHINES, acceptsFrom, rotationDelta, type MachineType, type Rotation } from './machines';
import type { Cell } from './placement';

export type ConnectionQuality = 'connected' | 'partial' | 'disconnected';
export type Direction = 'north' | 'east' | 'south' | 'west';

export interface ConnectionCandidate {
  type: MachineType;
  rotation: Rotation;
}

export interface ConnectionNeighbor {
  type: MachineType;
  rotation: Rotation;
}

export type NeighborView = ConnectionNeighbor | null | undefined;
export type NeighborViews =
  | Readonly<Partial<Record<Direction, NeighborView>>>
  | readonly [NeighborView, NeighborView, NeighborView, NeighborView];

const DIRECTIONS: readonly Direction[] = ['north', 'east', 'south', 'west'];
const DELTAS: Record<Direction, Cell> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

function neighborAt(neighbors: NeighborViews, direction: Direction): NeighborView {
  if (Array.isArray(neighbors)) {
    return (neighbors as readonly NeighborView[])[DIRECTIONS.indexOf(direction)] ?? null;
  }
  return (neighbors as Readonly<Record<Direction, NeighborView>>)[direction];
}

function opposite(direction: Direction): Direction {
  switch (direction) {
    case 'north':
      return 'south';
    case 'east':
      return 'west';
    case 'south':
      return 'north';
    case 'west':
      return 'east';
  }
}

function sameDirection(direction: Direction, delta: Cell): boolean {
  return DELTAS[direction].x === delta.x && DELTAS[direction].y === delta.y;
}

function outputDirections(type: MachineType, rotation: Rotation): readonly Direction[] {
  if (type === 'crossing') return DIRECTIONS;
  if (MACHINES[type].ports.output === 'none') return [];
  const facing = rotationDelta(rotation);
  const forward = DIRECTIONS.find((direction) => sameDirection(direction, facing));
  if (!forward) return [];
  if (type !== 'splitter') return [forward];
  const right = { x: -facing.y, y: facing.x };
  const rightDirection = DIRECTIONS.find((direction) => sameDirection(direction, right));
  return rightDirection ? [forward, rightDirection] : [forward];
}

function acceptsInput(candidate: ConnectionCandidate, direction: Direction): boolean {
  return acceptsFrom(candidate.type, candidate.rotation, DELTAS[direction]);
}

function outputsToward(candidate: ConnectionCandidate, direction: Direction): boolean {
  return outputDirections(candidate.type, candidate.rotation).includes(direction);
}

function connects(
  candidate: ConnectionCandidate,
  neighbor: ConnectionNeighbor,
  direction: Direction,
): boolean {
  return (
    (outputsToward(candidate, direction) && acceptsInput(neighbor, opposite(direction))) ||
    (outputsToward(neighbor, opposite(direction)) && acceptsInput(candidate, direction))
  );
}

function inputSatisfied(
  candidate: ConnectionCandidate,
  neighbors: NeighborViews,
  direction: Direction,
): boolean {
  const neighbor = neighborAt(neighbors, direction);
  return neighbor !== null && neighbor !== undefined && outputsToward(neighbor, opposite(direction)) && acceptsInput(candidate, direction);
}

function outputSatisfied(
  candidate: ConnectionCandidate,
  neighbors: NeighborViews,
  direction: Direction,
): boolean {
  const neighbor = neighborAt(neighbors, direction);
  return neighbor !== null && neighbor !== undefined && outputsToward(candidate, direction) && acceptsInput(neighbor, opposite(direction));
}

function requiredSides(type: MachineType): readonly ('input' | 'output' | 'any')[] {
  switch (type) {
    case 'extractor':
      return ['output'];
    case 'smelter':
    case 'assembler':
    case 'silo':
      return ['input', 'output'];
    case 'depot':
      return ['input'];
    case 'belt':
    case 'splitter':
    case 'crossing':
      return ['any'];
  }
}

export function classifyConnection(
  candidate: ConnectionCandidate,
  neighbors: NeighborViews,
): ConnectionQuality {
  const requirements = requiredSides(candidate.type);
  if (requirements.length === 1 && requirements[0] === 'any') {
    return DIRECTIONS.some((direction) => {
      const neighbor = neighborAt(neighbors, direction);
      return neighbor !== null && neighbor !== undefined && connects(candidate, neighbor, direction);
    })
      ? 'connected'
      : 'disconnected';
  }

  const satisfied = requirements.map((side) => {
    if (side === 'any') return false;
    return DIRECTIONS.some((direction) =>
      side === 'input' ? inputSatisfied(candidate, neighbors, direction) : outputSatisfied(candidate, neighbors, direction),
    );
  });
  const count = satisfied.filter(Boolean).length;
  if (count === requirements.length) return 'connected';
  if (count > 0) return 'partial';
  return 'disconnected';
}

export type ProposedCell =
  | { cell: Cell; rotation: Rotation; type?: MachineType }
  | (Cell & { rotation: Rotation; type?: MachineType });

export interface ProposedRun {
  cells: readonly Cell[];
  rotation: Rotation;
  type?: MachineType;
}

export type EntityMap = ReadonlyMap<string, ConnectionNeighbor>;
export type RunInput = readonly ProposedCell[] | ProposedRun;
type NormalizedProposedCell = { cell: Cell; rotation: Rotation; type?: MachineType };

function normalizeRun(input: RunInput): NormalizedProposedCell[] {
  if (!Array.isArray(input)) {
    const run = input as ProposedRun;
    return run.cells.map((cell) => ({ cell, rotation: run.rotation, type: run.type }));
  }
  return input.map((entry) => {
    if ('cell' in entry) return entry;
    return { cell: { x: entry.x, y: entry.y }, rotation: entry.rotation, type: entry.type };
  });
}

export function neighborViews(cell: Cell, existingEntities: EntityMap): NeighborViews {
  return {
    north: existingEntities.get(`${cell.x},${cell.y - 1}`) ?? null,
    east: existingEntities.get(`${cell.x + 1},${cell.y}`) ?? null,
    south: existingEntities.get(`${cell.x},${cell.y + 1}`) ?? null,
    west: existingEntities.get(`${cell.x - 1},${cell.y}`) ?? null,
  };
}

export function classifyRun(input: RunInput, existingEntities: EntityMap): ConnectionQuality[] {
  const proposals = normalizeRun(input);
  const combined = new Map(existingEntities);
  for (const proposal of proposals) {
    combined.set(`${proposal.cell.x},${proposal.cell.y}`, {
      type: proposal.type ?? 'belt',
      rotation: proposal.rotation,
    });
  }
  return proposals.map((proposal) =>
    classifyConnection(
      { type: proposal.type ?? 'belt', rotation: proposal.rotation },
      neighborViews(proposal.cell, combined),
    ),
  );
}
