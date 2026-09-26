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

  it("scatters every raw type across the whole grid", () => {
    const state = createInitialState();
    const coordinates = state.grid.nodes.map((node) => `${node.x},${node.y}`);
    const resources = [...new Set(state.grid.nodes.map((node) => node.resource))].sort();

    expect(state.grid.nodes).toHaveLength(32);
    expect(resources).toEqual(["coal", "copperOre", "ironOre", "stone"]);
    expect(new Set(coordinates).size).toBe(coordinates.length);

    for (const node of state.grid.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThan(GRID_WIDTH);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThan(GRID_HEIGHT);
      expect(node).not.toHaveProperty("remaining");
    }
  });

  it("gives every raw type more than one row and more than one column", () => {
    const state = createInitialState();

    for (const resource of ["copperOre", "ironOre", "coal", "stone"]) {
      const nodes = state.grid.nodes.filter((node) => node.resource === resource);
      expect(new Set(nodes.map((node) => node.x)).size, `${resource} columns`).toBeGreaterThan(1);
      expect(new Set(nodes.map((node) => node.y)).size, `${resource} rows`).toBeGreaterThan(1);
    }
  });

  it("puts a raw node on enough rows and columns that a straight belt line can carry any resource", () => {
    const state = createInitialState();
    const rowsWithNode = new Set(state.grid.nodes.map((node) => node.y));
    const columnsWithNode = new Set(state.grid.nodes.map((node) => node.x));

    expect(rowsWithNode.size).toBeGreaterThanOrEqual(16);
    expect(columnsWithNode.size).toBeGreaterThanOrEqual(16);
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
