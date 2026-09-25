import { GRID_HEIGHT, GRID_WIDTH, STARTING_CURRENCY, TILE_SIZE_PX } from "./constants";
import type { ResourceId, ResourceNode, SimulationState } from "./types";

const RAW_RESOURCES: ResourceId[] = ["copperOre", "ironOre", "coal", "stone"];
const NODES_PER_RESOURCE = 4;
const CENTRAL_REGION_SIZE = 48;
const CLUSTER_SIZE = CENTRAL_REGION_SIZE / 2;
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
  const startX = (GRID_WIDTH - CENTRAL_REGION_SIZE) / 2;
  const startY = (GRID_HEIGHT - CENTRAL_REGION_SIZE) / 2;
  const nodes: ResourceNode[] = [];
  let nodeIndex = 0;

  for (let resourceIndex = 0; resourceIndex < RAW_RESOURCES.length; resourceIndex += 1) {
    const clusterX = startX + (resourceIndex % 2) * CLUSTER_SIZE;
    const clusterY = startY + Math.floor(resourceIndex / 2) * CLUSTER_SIZE;
    const coordinates: GridPointTuple[] = [];

    for (let y = clusterY; y < clusterY + CLUSTER_SIZE; y += 1) {
      for (let x = clusterX; x < clusterX + CLUSTER_SIZE; x += 1) {
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

    for (let nodeInCluster = 0; nodeInCluster < NODES_PER_RESOURCE; nodeInCluster += 1) {
      const coordinate = coordinates[nodeInCluster];
      const [x, y] = coordinate;
      nodes.push({
        id: `node-${nodeIndex}`,
        resource: RAW_RESOURCES[resourceIndex],
        x,
        y,
      });
      nodeIndex += 1;
    }
  }

  return nodes;
}

type GridPointTuple = [number, number];

export function createInitialState(seed = 1337): SimulationState {
  return {
    version: 1,
    lastSavedAt: 0,
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
    pendingRotation: 0,
    notifications: [],
  };
}
