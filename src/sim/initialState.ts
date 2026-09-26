import {
  GRID_HEIGHT,
  GRID_WIDTH,
  NEW_GAME_TIMESTAMP,
  STARTING_CURRENCY,
  TILE_SIZE_PX,
} from "./constants";
import type {
  GridDimensions,
  GridState,
  PrestigeState,
  ResourceId,
  ResourceNode,
  SimulationState,
} from "./types";

const RAW_RESOURCES: ResourceId[] = ["copperOre", "ironOre", "coal", "stone"];
const NODES_PER_RESOURCE = 8;
const BASE_AREA = GRID_WIDTH * GRID_HEIGHT;
const RANDOM_RANGE = 0x100000000;

export const NEW_GAME_SEED = 1337;

type GridPointTuple = [number, number];

function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / RANDOM_RANGE;
  };
}

function nodesPerResource(width: number, height: number): number {
  return Math.max(NODES_PER_RESOURCE, Math.floor((NODES_PER_RESOURCE * width * height) / BASE_AREA));
}

function gridCells(width: number, height: number): GridPointTuple[] {
  const cells: GridPointTuple[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push([x, y]);
    }
  }

  return cells;
}

function addedGridCells(
  previous: GridDimensions,
  width: number,
  height: number,
): GridPointTuple[] {
  const cells: GridPointTuple[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= previous.width || y >= previous.height) {
        cells.push([x, y]);
      }
    }
  }

  return cells;
}

function shuffle(random: () => number, coordinates: GridPointTuple[]): void {
  for (let index = coordinates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = coordinates[index];
    const swap = coordinates[swapIndex];
    coordinates[index] = swap;
    coordinates[swapIndex] = current;
  }
}

function takeNodes(
  random: () => number,
  coordinates: GridPointTuple[],
  perResource: number,
  idOffset: number,
): ResourceNode[] {
  const shuffled = [...coordinates];
  shuffle(random, shuffled);

  const nodes: ResourceNode[] = [];

  for (let slot = 0; slot < perResource; slot += 1) {
    for (let resourceIndex = 0; resourceIndex < RAW_RESOURCES.length; resourceIndex += 1) {
      const coordinate = shuffled[slot * RAW_RESOURCES.length + resourceIndex];
      if (coordinate === undefined) {
        break;
      }

      const [x, y] = coordinate;
      nodes.push({
        id: `node-${idOffset + nodes.length}`,
        resource: RAW_RESOURCES[resourceIndex],
        x,
        y,
      });
    }
  }

  return nodes;
}

function nextNodeIdOffset(nodes: readonly ResourceNode[]): number {
  let highest = -1;

  for (const node of nodes) {
    const match = /^node-(\d+)$/.exec(node.id);
    if (match === null) {
      continue;
    }

    const index = Number(match[1]);
    if (Number.isSafeInteger(index) && index > highest) {
      highest = index;
    }
  }

  return highest + 1;
}

function createResourceNodes(seed: number, width: number, height: number): ResourceNode[] {
  return takeNodes(
    createRandom(seed),
    gridCells(width, height),
    nodesPerResource(width, height),
    0,
  );
}

export function createExpansionNodes(
  seed: number,
  previous: GridState,
  width: number,
  height: number,
): ResourceNode[] {
  const added =
    nodesPerResource(width, height) - nodesPerResource(previous.width, previous.height);
  if (added <= 0) {
    return [];
  }

  return takeNodes(
    createRandom(seed),
    addedGridCells(previous, width, height),
    added,
    nextNodeIdOffset(previous.nodes),
  );
}

export function createInitialState(
  seed = NEW_GAME_SEED,
  width = GRID_WIDTH,
  height = GRID_HEIGHT,
): SimulationState {
  return {
    version: 1,
    lastSavedAt: NEW_GAME_TIMESTAMP,
    currency: STARTING_CURRENCY,
    lifetimeCurrency: 0,
    prestige: {
      points: 0,
      totalPrestiges: 0,
      permanentMultipliers: {
        productionSpeed: 1,
        sellValue: 1,
      },
    },
    unlocked: {
      machines: ["extractor", "belt", "depot"],
      recipes: [],
    },
    grid: {
      width,
      height,
      tileSizePx: TILE_SIZE_PX,
      nodes: createResourceNodes(seed, width, height),
      entities: [],
      machines: {},
      belts: {},
    },
    productionChains: {},
    nextEntitySequence: 1,
    tickCount: 0,
    currencySamples: [],
    pendingRotation: 0,
    notifications: [],
    offlineSummary: undefined,
  };
}

export function createResetState(
  permanent: PrestigeState,
  dimensions: GridDimensions,
): SimulationState {
  return {
    ...createInitialState(NEW_GAME_SEED, dimensions.width, dimensions.height),
    prestige: {
      points: permanent.points,
      totalPrestiges: permanent.totalPrestiges,
      permanentMultipliers: {
        productionSpeed: permanent.permanentMultipliers.productionSpeed,
        sellValue: permanent.permanentMultipliers.sellValue,
      },
    },
  };
}
