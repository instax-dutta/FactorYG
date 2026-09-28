import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { RECIPES } from "../../src/content/recipes";
import { UNLOCKS } from "../../src/content/unlocks";
import { NEW_GAME_SEED, createInitialState } from "../../src/sim/initialState";
import { applyPlacement, validatePlacement } from "../../src/sim/placement";
import { advanceSimulation } from "../../src/sim/tick";
import { arePortsConnected, getWorldPortCells } from "../../src/sim/connections";
import { validateLayout } from "../../scripts/solve-motor-chain";
import type { LayoutEntity } from "../../scripts/solve-motor-chain";
import type { Entity, MachineType, SimulationState } from "../../src/sim/types";

const LAYOUT_PATH = "scripts/motor-chain-layout.json";
const ALL_MACHINES = Object.keys(MACHINES) as MachineType[];
const ALL_RECIPES = Object.keys(RECIPES);

function committedLayout(): LayoutEntity[] {
  return JSON.parse(readFileSync(LAYOUT_PATH, "utf8")) as LayoutEntity[];
}

function armedState(): SimulationState {
  const state = createInitialState(NEW_GAME_SEED);
  return {
    ...state,
    unlocked: { machines: ALL_MACHINES, recipes: ALL_RECIPES },
    currency: 1_000_000,
  };
}

function placeAll(layout: readonly LayoutEntity[]): { state: SimulationState; placed: number; cost: number } {
  let state = armedState();
  let placed = 0;
  let cost = 0;
  for (const entity of layout) {
    const command = {
      type: "placeEntity" as const,
      machine: entity.type,
      x: entity.x,
      y: entity.y,
      rotation: entity.rotation,
      ...(entity.recipeId === undefined ? {} : { recipeId: entity.recipeId }),
      ...(entity.resourceNode === undefined ? {} : { resourceNode: entity.resourceNode }),
    };
    expect(validatePlacement(state, command).ok).toBe(true);
    const before = state.currency;
    const applied = applyPlacement(state, command);
    expect(applied.changed).toBe(true);
    state = applied.state;
    placed += 1;
    cost += before - state.currency;
  }
  return { state, placed, cost };
}

function asEntity(entity: LayoutEntity): Entity {
  return {
    id: entity.id,
    type: entity.type,
    x: entity.x,
    y: entity.y,
    rotation: entity.rotation,
    level: 1,
    ...(entity.recipeId === undefined ? {} : { recipeId: entity.recipeId }),
    ...(entity.resourceNode === undefined ? {} : { resourceNode: entity.resourceNode }),
  };
}

describe("the committed motor chain layout", () => {
  it("resolves every recipe input to a real producer through the belts", () => {
    expect(validateLayout(committedLayout())).toEqual([]);
  });

  it("keeps one entity per cell and every cell inside the grid", () => {
    const cells = new Set<string>();

    for (const entity of committedLayout()) {
      const cell = `${entity.x},${entity.y}`;
      expect(cells.has(cell)).toBe(false);
      cells.add(cell);
      expect(entity.x).toBeGreaterThanOrEqual(0);
      expect(entity.y).toBeGreaterThanOrEqual(0);
      expect(entity.x).toBeLessThan(64);
      expect(entity.y).toBeLessThan(64);
    }
  });

  it("gives every belt a connected entity standing on its output port cell", () => {
    const layout = committedLayout();
    const byCell = new Map(layout.map((entity) => [`${entity.x},${entity.y}`, asEntity(entity)]));

    for (const belt of layout.filter((entity) => entity.type === "belt")) {
      const source = asEntity(belt);
      const output = getWorldPortCells(source).find((port) => port.port.kind === "output");
      const next = output === undefined ? undefined : byCell.get(`${output.x},${output.y}`);

      expect(output).toBeDefined();
      expect(next).toBeDefined();
      expect(arePortsConnected(source, next as Entity)).toBe(true);
    }
  });

  it("gives every producer a consumer on its own output port cell", () => {
    const layout = committedLayout();
    const byCell = new Map(layout.map((entity) => [`${entity.x},${entity.y}`, asEntity(entity)]));
    const producers = layout.filter((entity) => entity.type !== "belt" && entity.type !== "depot");

    for (const producer of producers) {
      const source = asEntity(producer);
      const output = getWorldPortCells(source).find((port) => port.port.kind === "output");
      const target = output === undefined ? undefined : byCell.get(`${output.x},${output.y}`);

      expect(output).toBeDefined();
      expect(target).toBeDefined();
      expect(arePortsConnected(source, target as Entity)).toBe(true);
    }
  });

  it("stands every extractor on a node of the resource it claims", () => {
    const nodes = createInitialState(NEW_GAME_SEED).grid.nodes;

    for (const entity of committedLayout().filter((candidate) => candidate.type === "extractor")) {
      const node = nodes.find((candidate) => candidate.x === entity.x && candidate.y === entity.y);
      expect(node).toBeDefined();
      expect(node?.resource).toBe(entity.resourceNode);
    }
  });

  it("places every entity through the real placement command with no rejection", () => {
    const layout = committedLayout();
    const { state, placed, cost } = placeAll(layout);

    expect(placed).toBe(layout.length);
    expect(state.grid.entities).toHaveLength(layout.length);
    expect(cost).toBeGreaterThan(0);
  });

  it("costs what the game charges, so the browser budget is honest", () => {
    const unlocks =
      Object.values(UNLOCKS.machineUnlocks).reduce((total, entry) => total + entry.cost, 0) +
      Object.values(UNLOCKS.recipeUnlocks).reduce((total, entry) => total + entry.cost, 0);
    const { cost } = placeAll(committedLayout());

    expect(cost + unlocks).toBeLessThan(40_000);
  });
  it("runs every intermediate recipe and sells the motors they build", () => {
    const { state } = placeAll(committedLayout());
    const base = state.currency;
    const peak = new Map<string, number>();
    const sample = (current: SimulationState): void => {
      for (const entity of current.grid.entities) {
        if (entity.recipeId === undefined) {
          continue;
        }
        const progress = current.grid.machines[entity.id]?.progressTicks ?? 0;
        peak.set(entity.recipeId, Math.max(peak.get(entity.recipeId) ?? 0, progress));
      }
    };
    let current = state;

    sample(current);
    for (let step = 0; step < 120; step += 1) {
      current = advanceSimulation(current, 10);
      sample(current);
      if ((current.currency - base) >= RECIPES.motor.sellValue) {
        break;
      }
    }

    for (const recipe of ["ironIngot", "gear", "plate", "circuit", "frame", "motor"]) {
      expect(peak.get(recipe) ?? 0).toBeGreaterThan(0);
    }
    expect(current.currency - base).toBeGreaterThanOrEqual(RECIPES.motor.sellValue);
  });
});
