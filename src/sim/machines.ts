export type MachineType =
  | 'extractor'
  | 'belt'
  | 'crossing'
  | 'splitter'
  | 'depot'
  | 'smelter'
  | 'assembler'
  | 'silo';

export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/**
 * Where items may enter and leave, declared once per machine type (spec §5).
 * Sides are relative to the side the machine faces, which rotation selects.
 */
export interface MachinePorts {
  /** 'behind' = only the cell opposite the output; 'none' = never takes input. */
  input: 'behind' | 'all-but-output' | 'all' | 'none';
  output: 'facing' | 'none';
}

export interface MachineDef {
  type: MachineType;
  /** How many input sides the machine has. 0 = it never takes input. */
  inputs: number;
  /** How many sides emit items. */
  outputs: number;
  /** Extractors are only placeable on a resource node tile. */
  requiresNode: boolean;
  /**
   * Ticks needed to move one item through, or null when the machine does not
   * move items on its own schedule: sinks (depot), and crafters whose time
   * comes from the recipe they are running. Belts carry an item exactly one
   * cell per tick; extractors take 10 ticks (1 ore/sec at 10tps).
   * TUNE_AFTER_PLAYABLE.
   */
  ticksPerItem: number | null;
  /** Items the machine can hold at once. Silos exist to hold more than one. */
  bufferSize: number;
  /** Storage accepts anything, so the sim does not type-check what enters. */
  acceptsAnyInput: boolean;
  ports: MachinePorts;
}

export const MACHINES: Record<MachineType, MachineDef> = {
  extractor: {
    type: 'extractor',
    inputs: 0,
    outputs: 1,
    requiresNode: true,
    ticksPerItem: 10,
    bufferSize: 1,
    acceptsAnyInput: false,
    ports: { input: 'none', output: 'facing' },
  },
  belt: {
    type: 'belt',
    inputs: 1,
    outputs: 1,
    requiresNode: false,
    // A belt carries its item exactly one cell per tick.
    ticksPerItem: 1,
    bufferSize: 1,
    acceptsAnyInput: false,
    // Takes from any side but the one it feeds, which is what lets a run turn
    // a corner: a belt facing east accepts from the north or south as well as
    // from behind. It never takes from the cell it outputs into, so opposing
    // belts cannot push items backwards up a line.
    ports: { input: 'all-but-output', output: 'facing' },
  },
  crossing: {
    type: 'crossing',
    // Not a storage machine: it never holds an item of its own. Each tick it
    // forwards what each feeder hands it, straight through on that feeder's
    // axis — which is why `Simulation.tick` has a crossing branch and never
    // consults the ports table for one.
    inputs: 0,
    // Two independent streams pass through, so the flow is per-axis, not the
    // single direction `outputs` normally implies. `reachesDepot` walks both
    // axes explicitly; nothing else reads this.
    outputs: 2,
    requiresNode: false,
    ticksPerItem: null,
    bufferSize: 0,
    acceptsAnyInput: false,
    // Cosmetic: the tile's rotation changes nothing about flow, but the entity
    // schema (and the render mesh) still carries one.
    ports: { input: 'all', output: 'none' },
  },
  splitter: {
    type: 'splitter',
    // One stream in, two out: the T-junction that lets a line serve two
    // consumers without duplicating the machines behind it. Takes from behind
    // only, so it is not a merge; exits facing + right-of-facing, so rotation
    // picks the T's orientation and two splitters make a 4-way.
    inputs: 1,
    // The second exit is right-of-facing, resolved in the sim's tick (the ports
    // table can only express one direction). `reachesDepot` fans out over both.
    outputs: 2,
    requiresNode: false,
    // Belt pace: the T costs no throughput.
    ticksPerItem: 1,
    bufferSize: 1,
    acceptsAnyInput: false,
    ports: { input: 'behind', output: 'facing' },
  },
  // A depot is a sink with one input side per edge, so belts can feed it from
  // any direction without extra routing.
  depot: {
    type: 'depot',
    inputs: 4,
    outputs: 0,
    requiresNode: false,
    ticksPerItem: null,
    bufferSize: 0,
    acceptsAnyInput: false,
    ports: { input: 'all', output: 'none' },
  },
  smelter: {
    type: 'smelter',
    // Iron ingots need ore + coal, so two input sides minimum.
    inputs: 2,
    outputs: 1,
    requiresNode: false,
    ticksPerItem: null,
    bufferSize: 2,
    acceptsAnyInput: false,
    ports: { input: 'all-but-output', output: 'facing' },
  },
  assembler: {
    type: 'assembler',
    // Every tier 2-3 recipe takes two distinct components.
    inputs: 2,
    outputs: 1,
    requiresNode: false,
    ticksPerItem: null,
    bufferSize: 2,
    acceptsAnyInput: false,
    ports: { input: 'all-but-output', output: 'facing' },
  },
  silo: {
    type: 'silo',
    inputs: 4,
    outputs: 1,
    requiresNode: false,
    ticksPerItem: null,
    bufferSize: 50,
    acceptsAnyInput: true,
    ports: { input: 'all', output: 'facing' },
  },
};

export function isRotation(value: number): value is Rotation {
  return (ROTATIONS as readonly number[]).includes(value);
}

export function rotateCW(rotation: Rotation): Rotation {
  return ((rotation + 90) % 360) as Rotation;
}

/**
 * Grid direction the machine faces. Grid y grows downward, so rotation 0
 * points "north" (toward -y).
 */
export function rotationDelta(rotation: Rotation): { x: number; y: number } {
  switch (rotation) {
    case 0:
      return { x: 0, y: -1 };
    case 90:
      return { x: 1, y: 0 };
    case 180:
      return { x: 0, y: 1 };
    case 270:
      return { x: -1, y: 0 };
  }
}

export function machineSupportsNode(type: MachineType): boolean {
  return MACHINES[type].requiresNode;
}

/**
 * True when a machine can take an item from a neighbour sitting at `delta`
 * (the neighbour's cell minus the machine's cell), given the side it faces.
 */
export function acceptsFrom(
  type: MachineType,
  rotation: Rotation,
  delta: { x: number; y: number },
): boolean {
  const ports = MACHINES[type].ports;
  if (ports.input === 'none') return false;

  const facing = rotationDelta(rotation);
  const isFacing = delta.x === facing.x && delta.y === facing.y;

  switch (ports.input) {
    case 'behind':
      // The cell opposite the output.
      return delta.x === -facing.x && delta.y === -facing.y;
    case 'all-but-output':
      return !isFacing;
    case 'all':
      return true;
  }
}
