import { describe, it, expect } from 'vitest';
import { NODE_LEGEND, nodeLegendEntries } from '../src/ui/nodeLegend';
import { RESOURCE_NODES } from '../src/sim/worldgen';

/**
 * The map's only remaining blind spot (the act-3 map audit): resource nodes are
 * colored discs with nothing that says what the colors mean. The goal line's
 * first instruction ("place an Extractor on a resource node") points at them,
 * so the legend is what makes that instruction followable for a new player.
 *
 * The view model is pure: it derives from the one source of truth for node
 * colors (ITEM_COLORS) and from the real node list, so the legend cannot
 * drift from what the discs actually render.
 */
describe('node legend view model', () => {
  it('has one entry per resource that exists on the map', () => {
    const kinds = new Set(RESOURCE_NODES.map((n) => n.resource));

    expect(nodeLegendEntries().map((e) => e.resource)).toEqual([...kinds]);
  });

  it('orders entries copper, iron, coal, stone — the order a new player meets them', () => {
    expect(nodeLegendEntries().map((e) => e.resource)).toEqual([
      'copperOre',
      'ironOre',
      'coal',
      'stone',
    ]);
  });

  it('reuses the exact item colors the discs and cargo render with', () => {
    for (const entry of nodeLegendEntries()) {
      expect(entry.color).toBeTypeOf('number');
      expect(NODE_LEGEND[entry.resource]).toBe(entry.color);
    }
  });

  it('gives every resource a distinct color — same color would make the legend lie', () => {
    const colors = nodeLegendEntries().map((e) => e.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
