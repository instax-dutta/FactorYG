import {
  GRID_HEIGHT,
  GRID_WIDTH,
  NEW_GAME_TIMESTAMP,
  STARTING_CURRENCY,
  TILE_SIZE_PX,
} from "./constants";
import type { ResourceId, ResourceNode, SimulationState } from "./types";

const RAW_RESOURCES: ResourceId[] = ["copperOre", "ironOre", "coal", "stone"];
const NODES_PER_RESOURCE = 8;
const RANDOM_RANGE = 0x100000000;

function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / RANDOM_RANGE;
  };
}

function createResourceNodes(seed: number): ResourceNode[] {
  const random = createRandom(seed);
  const coordinates: GridPointTuple[] = [];

  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      coordinates.push([x, y]);
    }
  }

  for (let index = coordinates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = coordinates[index];
    const swap = coordinates[swapIndex];
    coordinates[index] = swap;
    coordinates[swapIndex] = current;
  }

  const nodes: ResourceNode[] = [];

  for (let slot = 0; slot < NODES_PER_RESOURCE; slot += 1) {
    for (let resourceIndex = 0; resourceIndex < RAW_RESOURCES.length; resourceIndex += 1) {
      const coordinate = coordinates[slot * RAW_RESOURCES.length + resourceIndex];
      const [x, y] = coordinate;
      nodes.push({
        id: `node-${nodes.length}`,
        resource: RAW_RESOURCES[resourceIndex],
        x,
        y,
      });
    }
  }

  return nodes;
}

type GridPointTuple = [number, number];

export function createInitialState(seed = 1337): SimulationState {
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
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      tileSizePx: TILE_SIZE_PX,
      nodes: createResourceNodes(seed),
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
