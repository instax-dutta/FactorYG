export type ResourceId =
  // Tier 0 — raw, mined from nodes
  | 'copperOre'
  | 'ironOre'
  | 'coal'
  | 'stone'
  // Tier 1 — smelted
  | 'copperIngot'
  | 'ironIngot'
  | 'refinedStone'
  // Tier 2 — components
  | 'wire'
  | 'gear'
  | 'plate'
  // Tier 3 — products
  | 'circuit'
  | 'frame'
  | 'motor';

/** The subset of resources that exists as a map node for extractors. */
export type RawResourceId = Extract<ResourceId, 'copperOre' | 'ironOre' | 'coal' | 'stone'>;

export interface ResourceNode {
  x: number;
  y: number;
  resource: RawResourceId;
}

/**
 * Hand-designed, deterministic layout: no RNG, so saves from before a reload
 * always agree with the map the player built on. Two clusters sit off-centre so
 * the starting area is clear for the first extractor + belt run.
 */
export const RESOURCE_NODES: readonly ResourceNode[] = [
  // Copper cluster, west of centre.
  { x: 22, y: 24, resource: 'copperOre' },
  { x: 24, y: 24, resource: 'copperOre' },
  { x: 26, y: 25, resource: 'copperOre' },
  { x: 22, y: 27, resource: 'copperOre' },
  { x: 25, y: 28, resource: 'copperOre' },
  { x: 27, y: 30, resource: 'copperOre' },
  // Iron cluster, east of centre.
  { x: 40, y: 35, resource: 'ironOre' },
  { x: 42, y: 34, resource: 'ironOre' },
  { x: 44, y: 36, resource: 'ironOre' },
  { x: 41, y: 38, resource: 'ironOre' },
  { x: 43, y: 40, resource: 'ironOre' },
  { x: 45, y: 39, resource: 'ironOre' },
  // Coal, north of centre: iron ingots need it, so it cannot be an afterthought.
  { x: 29, y: 17, resource: 'coal' },
  { x: 32, y: 15, resource: 'coal' },
  { x: 35, y: 18, resource: 'coal' },
  // Stone, south-west: filler for plates and refined stone.
  { x: 16, y: 38, resource: 'stone' },
  { x: 18, y: 41, resource: 'stone' },
  { x: 21, y: 39, resource: 'stone' },
];

const NODE_INDEX = new Map<string, RawResourceId>(
  RESOURCE_NODES.map((node) => [`${node.x},${node.y}`, node.resource]),
);

export function generateNodes(): ResourceNode[] {
  return RESOURCE_NODES.map((node) => ({ ...node }));
}

export function resourceNodeAt(x: number, y: number): RawResourceId | null {
  return NODE_INDEX.get(`${x},${y}`) ?? null;
}

export function nodeCount(): number {
  return RESOURCE_NODES.length;
}
