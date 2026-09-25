import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  NEW_GAME_TIMESTAMP,
  STARTING_CURRENCY,
  TILE_SIZE_PX,
} from "../../src/sim/constants";
import type { SimulationCommand } from "../../src/sim/types";

describe("createInitialState", () => {
  it("creates a renewable 64 by 64 world with the starting economy", () => {
    const state = createInitialState();

    expect(NEW_GAME_TIMESTAMP).toBe(0);
    expect(state.version).toBe(1);
    expect(state.lastSavedAt).toBe(NEW_GAME_TIMESTAMP);
    expect(state.grid.width).toBe(GRID_WIDTH);
    expect(state.grid.height).toBe(GRID_HEIGHT);
    expect(state.grid.tileSizePx).toBe(TILE_SIZE_PX);
    expect(state.currency).toBe(STARTING_CURRENCY);
    expect(state.grid.entities).toHaveLength(0);
    expect(state.unlocked.machines).toEqual(["extractor", "belt", "depot"]);
    expect(state.unlocked.recipes).toEqual([]);
  });

  it("creates exactly 16 renewable nodes in the central region", () => {
    const state = createInitialState();
    const coordinates = state.grid.nodes.map((node) => `${node.x},${node.y}`);
    const resources = [...new Set(state.grid.nodes.map((node) => node.resource))].sort();

    expect(state.grid.nodes).toHaveLength(16);
    expect(resources).toEqual(["coal", "copperOre", "ironOre", "stone"]);
    expect(new Set(coordinates).size).toBe(coordinates.length);

    for (const node of state.grid.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(8);
      expect(node.x).toBeLessThanOrEqual(55);
      expect(node.y).toBeGreaterThanOrEqual(8);
      expect(node.y).toBeLessThanOrEqual(55);
      expect(node).not.toHaveProperty("remaining");
    }
  });

  it("creates deterministic nodes and initial simulation bookkeeping", () => {
    const state = createInitialState(1337);

    expect(createInitialState(1337)).toEqual(state);
    expect(state.nextEntitySequence).toBe(1);
    expect(state.pendingRotation).toBe(0);
    expect(state.notifications).toEqual([]);
  });

  it("accepts machine unlock commands in the shared command contract", () => {
    const command: SimulationCommand = { type: "unlockMachine", machine: "silo" };

    expect(command).toEqual({ type: "unlockMachine", machine: "silo" });
  });
});
