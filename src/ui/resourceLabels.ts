import type { ResourceId } from '../sim/worldgen';

const RESOURCE_LABELS: Record<ResourceId, string> = {
  copperOre: 'Copper Ore',
  ironOre: 'Iron Ore',
  coal: 'Coal',
  stone: 'Stone',
  copperIngot: 'Copper Ingot',
  ironIngot: 'Iron Ingot',
  refinedStone: 'Refined Stone',
  wire: 'Wire',
  gear: 'Gear',
  plate: 'Plate',
  circuit: 'Circuit',
  frame: 'Frame',
  motor: 'Motor',
};

export function resourceLabel(resource: ResourceId): string {
  return RESOURCE_LABELS[resource];
}
