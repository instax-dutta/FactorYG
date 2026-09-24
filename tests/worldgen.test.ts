import { describe, it, expect } from 'vitest';
import { RESOURCE_NODES, generateNodes, resourceNodeAt } from '../src/sim/worldgen';
import { RECIPES } from '../src/sim/recipes';
import { GRID_W, GRID_H } from '../src/config/constants';

describe('worldgen (fixed node map)', () => {
  it('generates deterministic fixed copper + iron node positions', () => {
    const nodes = generateNodes();
    expect(nodes.length).toBeGreaterThanOrEqual(8);

    const resources = new Set(nodes.map((node) => node.resource));
    expect(resources).toContain('copperOre');
    expect(resources).toContain('ironOre');

    // Nodes are hand-designed, so the exact layout is part of the contract.
    expect(nodes).toEqual(RESOURCE_NODES.map((node) => ({ ...node })));
    expect(resourceNodeAt(RESOURCE_NODES[0].x, RESOURCE_NODES[0].y)).toBe(RESOURCE_NODES[0].resource);
    expect(resourceNodeAt(-1, -1)).toBeNull();
  });

  it('two runs return identical maps (no RNG)', () => {
    expect(generateNodes()).toEqual(generateNodes());
  });

  it('every node lies inside 64x64 bounds with no duplicate cells', () => {
    const cells = new Set<string>();
    for (const node of RESOURCE_NODES) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThan(GRID_W);
      expect(node.y).toBeLessThan(GRID_H);
      cells.add(`${node.x},${node.y}`);
    }
    expect(cells.size).toBe(RESOURCE_NODES.length);
  });

  it('sources every raw input the recipe table asks for', () => {
    const nodes = generateNodes();
    const sourced = new Set(nodes.map((node) => node.resource));

    const rawInputs = new Set<string>();
    for (const recipe of Object.values(RECIPES)) {
      if (recipe.tier === 0) continue;
      for (const input of Object.keys(recipe.inputs)) {
        if (RECIPES[input as keyof typeof RECIPES].tier === 0) rawInputs.add(input);
      }
    }

    // Guard against passing on an empty table: the tier 1-3 recipes really do
    // consume these four raws.
    expect(rawInputs.size).toBe(4);

    // Coal and stone exist only to feed recipes: without a node they are dead
    // content and the iron/stone chain is unbuildable.
    for (const raw of rawInputs) expect(sourced).toContain(raw);
  });

  it('leaves the starting area clear so the first extractor can be placed', () => {
    const center = { x: (GRID_W - 1) / 2, y: (GRID_H - 1) / 2 };
    for (const node of RESOURCE_NODES) {
      const distance = Math.hypot(node.x - center.x, node.y - center.y);
      expect(distance).toBeGreaterThan(4);
    }
  });
});
