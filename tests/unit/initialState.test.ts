import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { GRID_HEIGHT, GRID_WIDTH, STARTING_CURRENCY, TILE_SIZE_PX } from "../../src/sim/constants";

describe("createInitialState", () => {
  it("creates a renewable 64 by 64 world with the starting economy", () => {
    const state = createInitialState();

    expect(state.version).toBe(1);
    expect(state.grid.width).toBe(GRID_WIDTH);
    expect(state.grid.height).toBe(GRID_HEIGHT);
    expect(state.grid.tileSizePx).toBe(TILE_SIZE_PX);
    expect(state.currency).toBe(STARTING_CURRENCY);
    expect(state.grid.entities).toHaveLength(0);
    expect(state.unlocked.machines).toEqual(["extractor", "belt", "depot"]);
    expect(state.unlocked.recipes).toEqual([]);
  });

  it("creates resource nodes without overlapping coordinates", () => {
    const state = createInitialState();
    const coordinates = state.grid.nodes.map((node) => `${node.x},${node.y}`);

    expect(new Set(coordinates).size).toBe(coordinates.length);
    expect(state.grid.nodes.length).toBeGreaterThan(0);
  });
});
