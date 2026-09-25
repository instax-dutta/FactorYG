import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { applyPlacement, validatePlacement } from "../../src/sim/placement";
import { SimulationStore } from "../../src/sim/store";
import type {
  Entity,
  MachineType,
  ResourceId,
  ResourceNode,
  Rotation,
  SimulationState,
} from "../../src/sim/types";
import type { PlaceEntityCommand } from "../../src/sim/placement";

const NODE: ResourceNode = {
  id: "node-copper-test",
  resource: "copperOre",
  x: 20,
  y: 21,
};

describe("placement validation", () => {
  it("accepts an unlocked belt on an empty in-bounds cell", () => {
    expect(validatePlacement(createState(), placeCommand())).toEqual({ ok: true });
  });

  it("rejects a locked machine", () => {
    expect(
      validatePlacement(createState(), placeCommand({ machine: "smelter", recipeId: "copperIngot" })),
    ).toEqual({ ok: false, reason: "lockedMachine" });
  });

  it.each([
    [-1, 1],
    [1, -1],
    [64, 1],
    [1, 64],
  ])("rejects out-of-bounds cell %s, %s", (x, y) => {
    expect(validatePlacement(createState(), placeCommand({ x, y }))).toEqual({
      ok: false,
      reason: "outOfBounds",
    });
  });

  it("rejects an occupied cell", () => {
    const state = createState();
    state.grid.entities = [createEntity("entity-occupied", "belt", 3, 4)];

    expect(validatePlacement(state, placeCommand({ x: 3, y: 4 }))).toEqual({
      ok: false,
      reason: "occupied",
    });
  });

  it("rejects a placement without enough currency", () => {
    const state = createState();
    state.currency = 9;

    expect(validatePlacement(state, placeCommand())).toEqual({
      ok: false,
      reason: "insufficientCurrency",
    });
  });

  it("rejects a rotation outside the four supported angles", () => {
    expect(
      validatePlacement(
        createState(),
        placeCommand({ rotation: 45 as unknown as Rotation }),
      ),
    ).toEqual({ ok: false, reason: "invalidRotation" });
  });

  it("rejects an extractor on a cell without a resource node", () => {
    expect(
      validatePlacement(
        createState(),
        placeCommand({ machine: "extractor", x: 1, y: 1 }),
      ),
    ).toEqual({ ok: false, reason: "missingResourceNode" });
  });

  it("accepts an extractor when the command matches the node resource", () => {
    expect(
      validatePlacement(
        createState(),
        placeCommand({
          machine: "extractor",
          x: NODE.x,
          y: NODE.y,
          resourceNode: NODE.resource,
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("accepts an extractor when the command matches the node id", () => {
    expect(
      validatePlacement(
        createState(),
        placeCommand({
          machine: "extractor",
          x: NODE.x,
          y: NODE.y,
          resourceNode: NODE.id as unknown as ResourceId,
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects an extractor when the command names a different node", () => {
    expect(
      validatePlacement(
        createState(),
        placeCommand({
          machine: "extractor",
          x: NODE.x,
          y: NODE.y,
          resourceNode: "ironOre",
        }),
      ),
    ).toEqual({ ok: false, reason: "missingResourceNode" });
  });

  it("rejects a smelter or assembler without a selected recipe", () => {
    const state = createState();
    state.currency = 1_000;
    state.unlocked.machines = ["smelter", "assembler"];

    for (const machine of ["smelter", "assembler"] as const) {
      expect(validatePlacement(state, placeCommand({ machine }))).toEqual({
        ok: false,
        reason: "missingRecipe",
      });
    }
  });

  it("rejects a recipe that belongs to a different machine", () => {
    const state = createState();
    state.currency = 1_000;
    state.unlocked.machines = ["smelter", "assembler"];

    state.unlocked.recipes = ["copperIngot"];
    expect(
      validatePlacement(state, placeCommand({ machine: "assembler", recipeId: "copperIngot" })),
    ).toEqual({ ok: false, reason: "missingRecipe" });
    expect(
      validatePlacement(state, placeCommand({ machine: "smelter", recipeId: "copperIngot" })),
    ).toEqual({ ok: true });

    state.unlocked.recipes = ["wire"];
    expect(
      validatePlacement(state, placeCommand({ machine: "assembler", recipeId: "wire" })),
    ).toEqual({ ok: true });
    expect(
      validatePlacement(state, placeCommand({ machine: "smelter", recipeId: "wire" })),
    ).toEqual({ ok: false, reason: "missingRecipe" });
  });

  it("rejects an unknown selected recipe", () => {
    const state = createState();
    state.currency = 1_000;
    state.unlocked.machines = ["smelter"];
    state.unlocked.recipes = ["not-a-recipe"];

    expect(
      validatePlacement(state, placeCommand({ machine: "smelter", recipeId: "not-a-recipe" })),
    ).toEqual({ ok: false, reason: "missingRecipe" });
  });

  it("debits the machine cost once per successful application", () => {
    const state = createState();
    const first = applyPlacement(state, placeCommand({ x: 1, y: 1 }));
    const second = applyPlacement(first.state, placeCommand({ x: 2, y: 1 }));

    expect(first.state.currency).toBe(490);
    expect(second.state.currency).toBe(480);
    expect(state.currency).toBe(500);
    expect(first.entity?.id).toBe("entity-1");
    expect(second.entity?.id).toBe("entity-2");
  });

  it("creates deterministic entity ids and machine runtime records", () => {
    const state = createState();
    state.currency = 1_000;
    state.unlocked.machines = ["extractor"];

    const application = applyPlacement(
      state,
      placeCommand({
        machine: "extractor",
        x: NODE.x,
        y: NODE.y,
        resourceNode: NODE.resource,
      }),
    );

    expect(application.entity).toEqual({
      id: "entity-1",
      type: "extractor",
      x: NODE.x,
      y: NODE.y,
      rotation: 0,
      level: 1,
      resourceNode: NODE.resource,
    });
    expect(application.state.nextEntitySequence).toBe(2);
    expect(application.state.grid.machines["entity-1"]).toEqual({
      entityId: "entity-1",
      progressTicks: 0,
      input: {},
      output: {},
      active: false,
    });
    expect(application.state.grid.belts["entity-1"]).toBeUndefined();
  });

  it("uses the same validation result for ghost checks and command application", () => {
    const state = createState();
    state.currency = 0;
    const store = new SimulationStore(state);
    const command = placeCommand();

    expect(store.validatePlacement(command)).toEqual({
      ok: false,
      reason: "insufficientCurrency",
    });
    expect(store.dispatch(command)).toEqual({
      ok: false,
      reason: "insufficientCurrency",
    });
    expect(store.getSnapshot().currency).toBe(0);
  });
});

function createState(): SimulationState {
  const state = createInitialState();
  state.grid.nodes = [NODE];
  return state;
}

function placeCommand(overrides: Partial<PlaceEntityCommand> = {}): PlaceEntityCommand {
  return {
    type: "placeEntity",
    machine: "belt",
    x: 1,
    y: 1,
    rotation: 0,
    ...overrides,
  };
}

function createEntity(id: string, type: MachineType, x: number, y: number): Entity {
  return {
    id,
    type,
    x,
    y,
    rotation: 0,
    level: 1,
  };
}
