import { ITEM_COLORS } from '../render/EntityMeshFactory';
import type { RawResourceId } from '../sim/worldgen';

/**
 * The map legend (PLAYTEST.md B5): what each resource-node disc color means.
 * Colors come from the render palette itself — the same hex the 3D discs and
 * belt cargo use — so the legend cannot drift from what is on the ground.
 */
export const NODE_LEGEND: Record<RawResourceId, number> = {
  copperOre: ITEM_COLORS.copperOre,
  ironOre: ITEM_COLORS.ironOre,
  coal: ITEM_COLORS.coal,
  stone: ITEM_COLORS.stone,
};

/** Player-facing reading order: the order a new player meets the resources. */
const LEGEND_ORDER: readonly RawResourceId[] = ['copperOre', 'ironOre', 'coal', 'stone'];

/** Pure view model for the legend panel; derived so tests pin it to the map. */
export function nodeLegendEntries(): Array<{ resource: RawResourceId; color: number }> {
  return LEGEND_ORDER.map((resource) => ({ resource, color: NODE_LEGEND[resource] }));
}
