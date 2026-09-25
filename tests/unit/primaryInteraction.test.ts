import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import { createPrimaryCanvasCommand } from "../../src/phaser/primaryInteraction";
import type { Entity } from "../../src/sim/types";

describe("primary canvas command resolution", () => {
  it("selects an existing entity and clears selection for an empty cell", () => {
    const state = createInitialState();
    const entity = createEntity();
    state.grid.entities = [entity];
    const store = new SimulationStore(state);
    const cell = { x: entity.x, y: entity.y };

    const selectCommand = createPrimaryCanvasCommand(undefined, 0, cell, entity);
    expect(selectCommand).toEqual({ type: "selectEntity", entityId: "entity-1" });
    expect(store.dispatch(selectCommand)).toEqual({ ok: true });
    expect(store.getSnapshot().selectedEntity?.id).toBe("entity-1");

    const clearCommand = createPrimaryCanvasCommand(undefined, 0, { x: 12, y: 12 }, undefined);
    expect(clearCommand).toEqual({ type: "selectEntity", entityId: undefined });
    expect(store.dispatch(clearCommand)).toEqual({ ok: true });
    expect(store.getSnapshot().selectedEntity).toBeUndefined();
  });

  it("keeps the placement command when a placement mode is active", () => {
    const command = createPrimaryCanvasCommand(
      "belt",
      90,
      { x: 6, y: 7 },
      createEntity(),
    );

    expect(command).toEqual({
      type: "placeEntity",
      machine: "belt",
      x: 6,
      y: 7,
      rotation: 90,
    });
  });
});

function createEntity(): Entity {
  return {
    id: "entity-1",
    type: "extractor",
    x: 4,
    y: 5,
    rotation: 0,
    level: 1,
    resourceNode: "copperOre",
  };
}
