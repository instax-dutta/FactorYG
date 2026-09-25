import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { RECIPES } from "../../src/content/recipes";
import { createInitialState } from "../../src/sim/initialState";
import {
  canRunRecipe,
  consumeRecipeInputs,
  createMachineRuntime,
  tickProcessor,
} from "../../src/sim/machines";
import { advanceSimulation } from "../../src/sim/tick";
import type {
  BeltCell,
  Entity,
  MachineRuntime,
  RecipeDefinition,
  RenderEvent,
  ResourceId,
  Rotation,
  SimulationState,
} from "../../src/sim/types";

const ASSEMBLER_RECIPES: RecipeDefinition[] = [
  RECIPES.wire,
  RECIPES.gear,
  RECIPES.plate,
  RECIPES.circuit,
  RECIPES.frame,
  RECIPES.motor,
];
const ASSEMBLER_RECIPE_CASES = ASSEMBLER_RECIPES.map(
  (recipe) => [recipe.id, recipe] as [string, RecipeDefinition],
);
const ASSEMBLER_RECIPE_IDS = ASSEMBLER_RECIPES.map((recipe) => recipe.id);
const OUTPUT_BUFFER = MACHINES.assembler.outputBuffer;
const DEFAULT_ASSEMBLER = createAssembler();
const SURPLUS_BASE: Partial<Record<ResourceId, number>> = {
  copperIngot: 3,
  ironIngot: 4,
  refinedStone: 2,
  wire: 1,
  gear: 1,
  plate: 1,
  circuit: 1,
  frame: 1,
  motor: 1,
};
const COPPER_NODE = {
  id: "node-copper-assembler",
  resource: "copperOre" as ResourceId,
  x: 8,
  y: 9,
};

describe("assembler recipe readiness", () => {
  it.each(ASSEMBLER_RECIPE_CASES)(
    "requires the exact inputs of %s",
    (_id, recipe) => {
      expect(canRunRecipe(createRuntime({ input: fullInputs(recipe) }), DEFAULT_ASSEMBLER, recipe)).toBe(
        true,
      );
      expect(
        canRunRecipe(createRuntime({ input: shortInputs(recipe) }), DEFAULT_ASSEMBLER, recipe),
      ).toBe(false);
      expect(canRunRecipe(createRuntime(), DEFAULT_ASSEMBLER, recipe)).toBe(false);
    },
  );

  it.each(ASSEMBLER_RECIPE_CASES)(
    "refuses to start %s while one required input is short",
    (_id, recipe) => {
      const stored = { ...surplusInputs(recipe), ...shortInputs(recipe) };
      const runtime = createRuntime({ input: stored });

      expect(canRunRecipe(runtime, DEFAULT_ASSEMBLER, recipe)).toBe(false);
      expect(consumeRecipeInputs(runtime, DEFAULT_ASSEMBLER, recipe)).toBe(runtime);
    },
  );

  it.each(ASSEMBLER_RECIPE_CASES)(
    "consumes the exact %s inputs from the mixed input buffer",
    (_id, recipe) => {
      const stored = { ...surplusInputs(recipe), ...fullInputs(recipe) };
      const runtime = createRuntime({ input: stored });

      const result = consumeRecipeInputs(runtime, DEFAULT_ASSEMBLER, recipe);

      expect(result.input).toEqual(surplusInputs(recipe));
      expect(runtime.input).toEqual(stored);
    },
  );

  it("refuses a recipe whose output buffer cannot hold the result", () => {
    const runtime = createRuntime({
      input: fullInputs(RECIPES.wire),
      output: { wire: OUTPUT_BUFFER },
    });

    expect(canRunRecipe(runtime, DEFAULT_ASSEMBLER, RECIPES.wire)).toBe(false);
    expect(consumeRecipeInputs(runtime, DEFAULT_ASSEMBLER, RECIPES.wire)).toBe(runtime);
  });
});

describe("assembler production", () => {
  it.each(ASSEMBLER_RECIPE_CASES)(
    "produces exactly one %s unit at its recipe duration",
    (recipeId, recipe) => {
      const entity = createAssembler({ recipeId });
      const state = createState([entity], {
        [entity.id]: createRuntime({
          input: { ...surplusInputs(recipe), ...fullInputs(recipe) },
        }),
      });
      const events: RenderEvent[] = [];

      const running = advanceSimulation(state, recipe.durationTicks - 1, events);

      expect(running.grid.machines[entity.id]?.output).toEqual({});
      expect(running.grid.machines[entity.id]?.input).toEqual(surplusInputs(recipe));
      expect(running.grid.machines[entity.id]?.progressTicks).toBe(recipe.durationTicks - 1);
      expect(running.grid.machines[entity.id]?.active).toBe(true);

      const completed = advanceSimulation(running, 1, events);

      expect(completed.grid.machines[entity.id]?.output).toEqual({
        [recipe.output.resource]: 1,
      });
      expect(completed.grid.machines[entity.id]?.input).toEqual(surplusInputs(recipe));
      expect(completed.grid.machines[entity.id]?.progressTicks).toBe(0);
      expect(completed.grid.machines[entity.id]?.active).toBe(false);
      expect(events).toEqual([
        { type: "machineStateChanged", entityId: entity.id, active: true },
        { type: "machineStateChanged", entityId: entity.id, active: false },
      ]);
    },
  );

  it.each(ASSEMBLER_RECIPE_CASES)(
    "charges the exact %s inputs on the first tick",
    (recipeId, recipe) => {
      const entity = createAssembler({ recipeId });
      const state = createState([entity], {
        [entity.id]: createRuntime({
          input: { ...surplusInputs(recipe), ...fullInputs(recipe) },
        }),
      });
      const events: RenderEvent[] = [];

      const next = advanceSimulation(state, 1, events);

      expect(next.grid.machines[entity.id]?.input).toEqual(surplusInputs(recipe));
      expect(next.grid.machines[entity.id]?.progressTicks).toBe(1);
      expect(next.grid.machines[entity.id]?.active).toBe(true);
      expect(next.grid.machines[entity.id]?.output).toEqual({});
      expect(events).toEqual([
        { type: "machineStateChanged", entityId: entity.id, active: true },
      ]);
    },
  );

  it("waits for every required input and never partially consumes", () => {
    const entity = createAssembler({ recipeId: "frame" });
    const state = createState([entity], {
      [entity.id]: createRuntime({ input: { plate: 2, copperIngot: 1 } }),
    });
    const events: RenderEvent[] = [];

    const waiting = advanceSimulation(state, 200, events);

    expect(waiting.grid.machines[entity.id]?.input).toEqual({ plate: 2, copperIngot: 1 });
    expect(waiting.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(waiting.grid.machines[entity.id]?.active).toBe(false);
    expect(waiting.grid.machines[entity.id]?.output).toEqual({});
    expect(events).toEqual([]);

    const geared = withInput(waiting, entity.id, { gear: 1 });

    const completed = advanceSimulation(geared, RECIPES.frame.durationTicks, events);

    expect(completed.grid.machines[entity.id]?.input).toEqual({ copperIngot: 1 });
    expect(completed.grid.machines[entity.id]?.output).toEqual({ frame: 1 });
    expect(completed.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(completed.grid.machines[entity.id]?.active).toBe(false);
  });

  it("reads both rotated input ports into the single mixed input buffer", () => {
    const assembler = createAssembler({
      id: "assembler-rotated",
      x: 10,
      y: 10,
      rotation: 90,
      recipeId: "plate",
    });
    const firstPortBelt = createBelt("belt-input-1", 10, 9, 90);
    const secondPortBelt = createBelt("belt-input-2", 11, 10, 180);
    const staleRotationBelt = createBelt("belt-unrotated", 9, 10, 0);
    const state = createState(
      [assembler, firstPortBelt, secondPortBelt, staleRotationBelt],
      { [assembler.id]: createRuntime() },
      ASSEMBLER_RECIPE_IDS,
      createBeltCells([
        [firstPortBelt, "ironIngot"],
        [secondPortBelt, "refinedStone"],
        [staleRotationBelt, "gear"],
      ]),
    );
    const events: RenderEvent[] = [];

    const delivered = advanceSimulation(state, 1, events);

    expect(delivered.grid.machines[assembler.id]?.input).toEqual({
      ironIngot: 1,
      refinedStone: 1,
    });
    expect(delivered.grid.machines[assembler.id]?.progressTicks).toBe(0);
    expect(delivered.grid.belts[firstPortBelt.id]?.item).toBeUndefined();
    expect(delivered.grid.belts[secondPortBelt.id]?.item).toBeUndefined();
    expect(delivered.grid.belts[staleRotationBelt.id]?.item).toBe("gear");
    expect(events).toEqual([
      { type: "beltItemChanged", entityId: firstPortBelt.id, item: undefined },
      { type: "beltItemChanged", entityId: secondPortBelt.id, item: undefined },
    ]);

    const completed = advanceSimulation(delivered, RECIPES.plate.durationTicks, events);

    expect(completed.grid.machines[assembler.id]?.output).toEqual({ plate: 1 });
    expect(completed.grid.machines[assembler.id]?.input).toEqual({});
    expect(completed.grid.belts[staleRotationBelt.id]?.item).toBe("gear");
    expect(events).toEqual([
      { type: "beltItemChanged", entityId: firstPortBelt.id, item: undefined },
      { type: "beltItemChanged", entityId: secondPortBelt.id, item: undefined },
      { type: "machineStateChanged", entityId: assembler.id, active: true },
      { type: "machineStateChanged", entityId: assembler.id, active: false },
    ]);
  });

  it("does not start a recipe while the output buffer is full", () => {
    const entity = createAssembler({ recipeId: "wire" });
    const state = createState([entity], {
      [entity.id]: createRuntime({
        input: { copperIngot: 2 },
        output: { wire: OUTPUT_BUFFER },
      }),
    });
    const events: RenderEvent[] = [];

    const next = advanceSimulation(state, 120, events);

    expect(next.grid.machines[entity.id]).toEqual(state.grid.machines[entity.id]);
    expect(next.grid.machines[entity.id]?.input).toEqual({ copperIngot: 2 });
    expect(next.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(events).toEqual([]);
  });

  it("fills the output buffer to capacity and then stops", () => {
    const entity = createAssembler({ recipeId: "wire" });
    const state = createState([entity], {
      [entity.id]: createRuntime({ input: { copperIngot: OUTPUT_BUFFER * 2 } }),
    });

    const filled = advanceSimulation(state, RECIPES.wire.durationTicks * OUTPUT_BUFFER);

    expect(filled.grid.machines[entity.id]?.output).toEqual({ wire: OUTPUT_BUFFER });
    expect(filled.grid.machines[entity.id]?.input).toEqual({});

    const blocked = advanceSimulation(filled, 10);

    expect(blocked.grid.machines[entity.id]).toEqual(filled.grid.machines[entity.id]);
    expect(blocked.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(blocked.grid.machines[entity.id]?.active).toBe(false);
  });

  it("holds a finished recipe until the output buffer clears", () => {
    const entity = createAssembler({ recipeId: "wire" });
    const blocked = createState([entity], {
      [entity.id]: createRuntime({
        progressTicks: RECIPES.wire.durationTicks - 1,
        output: { wire: OUTPUT_BUFFER },
        active: true,
      }),
    });
    const events: RenderEvent[] = [];

    const waiting = advanceSimulation(blocked, 5, events);

    expect(waiting.grid.machines[entity.id]?.output).toEqual({ wire: OUTPUT_BUFFER });
    expect(waiting.grid.machines[entity.id]?.progressTicks).toBe(
      RECIPES.wire.durationTicks - 1,
    );
    expect(waiting.grid.machines[entity.id]?.active).toBe(false);
    expect(events).toEqual([
      { type: "machineStateChanged", entityId: entity.id, active: false },
    ]);

    const drained = withOutput(
      waiting,
      entity.id,
      OUTPUT_BUFFER - RECIPES.wire.output.amount,
      "wire",
    );
    const completed = advanceSimulation(drained, 1, events);

    expect(completed.grid.machines[entity.id]?.output).toEqual({ wire: OUTPUT_BUFFER });
    expect(completed.grid.machines[entity.id]?.progressTicks).toBe(0);
  });

  it.each([
    ["locked", createAssembler({ recipeId: "wire" }), []],
    ["smelter-only", createAssembler({ recipeId: "copperIngot" }), ["copperIngot", "wire"]],
    ["unknown", createAssembler({ recipeId: "unobtanium" }), ["wire", "unobtanium"]],
    ["missing", createAssembler({ recipeId: undefined }), ASSEMBLER_RECIPE_IDS],
  ])("never runs a %s recipe", (_label, entity, unlocked) => {
    const runtime = createRuntime({ input: { copperIngot: 2 } });
    const state = createState([entity], { [entity.id]: runtime }, unlocked);

    expect(tickProcessor(runtime, entity, state)).toBe(runtime);

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 200, events);

    expect(next.grid.machines[entity.id]).toEqual(runtime);
    expect(next.grid.machines[entity.id]?.input).toEqual({ copperIngot: 2 });
    expect(next.grid.machines[entity.id]?.output).toEqual({});
    expect(next.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(events).toEqual([]);
  });

  it("clears stale progress and deactivates a runtime whose recipe is locked", () => {
    const entity = createAssembler({ recipeId: "plate" });
    const runtime = createRuntime({
      progressTicks: 5,
      input: { ironIngot: 2 },
      active: true,
    });
    const state = createState([entity], { [entity.id]: runtime }, []);

    const result = tickProcessor(runtime, entity, state);

    expect(result).not.toBe(runtime);
    expect(result).toEqual({ ...runtime, progressTicks: 0, active: false });
    expect(runtime.progressTicks).toBe(5);
  });

  it.each([
    ["locked", createAssembler({ recipeId: "wire" }), []],
    ["smelter-only", createAssembler({ recipeId: "copperIngot" }), ["copperIngot", "wire"]],
    ["unknown", createAssembler({ recipeId: "unobtanium" }), ["wire", "unobtanium"]],
    ["missing", createAssembler({ recipeId: undefined }), ASSEMBLER_RECIPE_IDS],
  ])(
    "discards an in-flight run for a %s recipe without touching buffers",
    (_label, entity, unlocked) => {
      const runtime = createRuntime({
        progressTicks: 7,
        input: { copperIngot: 1, gear: 2 },
        output: { wire: 3 },
        active: true,
      });
      const state = createState([entity], { [entity.id]: runtime }, unlocked);

      const result = tickProcessor(runtime, entity, state);

      expect(result).not.toBe(runtime);
      expect(result.progressTicks).toBe(0);
      expect(result.active).toBe(false);
      expect(result.input).toEqual({ copperIngot: 1, gear: 2 });
      expect(result.output).toEqual({ wire: 3 });
      expect(runtime.progressTicks).toBe(7);
    },
  );

  it("discards an in-flight run once the selected recipe becomes unresolvable", () => {
    const entity = createAssembler({ recipeId: "plate" });
    const state = createState([entity], {
      [entity.id]: createRuntime({ input: { ironIngot: 2, refinedStone: 2, gear: 1 } }),
    });
    const events: RenderEvent[] = [];

    const started = advanceSimulation(state, 6, events);

    expect(started.grid.machines[entity.id]?.progressTicks).toBe(6);
    expect(started.grid.machines[entity.id]?.input).toEqual({
      ironIngot: 1,
      refinedStone: 1,
      gear: 1,
    });
    expect(started.grid.machines[entity.id]?.active).toBe(true);

    const unresolved = withUnlockedRecipes(started, []);
    const abandoned = advanceSimulation(unresolved, 60, events);

    expect(abandoned.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(abandoned.grid.machines[entity.id]?.active).toBe(false);
    expect(abandoned.grid.machines[entity.id]?.output).toEqual({});
    expect(abandoned.grid.machines[entity.id]?.input).toEqual({
      ironIngot: 1,
      refinedStone: 1,
      gear: 1,
    });
    expect(events).toEqual([
      { type: "machineStateChanged", entityId: entity.id, active: true },
      { type: "machineStateChanged", entityId: entity.id, active: false },
    ]);

    const relocked = withUnlockedRecipes(abandoned, ASSEMBLER_RECIPE_IDS);
    const restarted = advanceSimulation(relocked, 1, events);

    expect(restarted.grid.machines[entity.id]?.progressTicks).toBe(1);
    expect(restarted.grid.machines[entity.id]?.active).toBe(true);
    expect(restarted.grid.machines[entity.id]?.input).toEqual({ gear: 1 });
    expect(restarted.grid.machines[entity.id]?.output).toEqual({});
    expect(events).toEqual([
      { type: "machineStateChanged", entityId: entity.id, active: true },
      { type: "machineStateChanged", entityId: entity.id, active: false },
      { type: "machineStateChanged", entityId: entity.id, active: true },
    ]);

    const completed = advanceSimulation(restarted, RECIPES.plate.durationTicks - 1, events);

    expect(completed.grid.machines[entity.id]?.output).toEqual({ plate: 1 });
    expect(completed.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(completed.grid.machines[entity.id]?.active).toBe(false);
    expect(completed.grid.machines[entity.id]?.input).toEqual({ gear: 1 });
    expect(events).toEqual([
      { type: "machineStateChanged", entityId: entity.id, active: true },
      { type: "machineStateChanged", entityId: entity.id, active: false },
      { type: "machineStateChanged", entityId: entity.id, active: true },
      { type: "machineStateChanged", entityId: entity.id, active: false },
    ]);
  });

  it("keeps extractor, smelter, belt, and depot behavior while assemblers run", () => {
    const extractor: Entity = {
      id: "extractor-assembler-world",
      type: "extractor",
      x: COPPER_NODE.x,
      y: COPPER_NODE.y,
      rotation: 0,
      level: 1,
      resourceNode: COPPER_NODE.resource,
    };
    const smelter = createAssembler({
      id: "smelter-assembler-world",
      type: "smelter",
      x: 12,
      y: 13,
      recipeId: "copperIngot",
    });
    const assembler = createAssembler({ id: "assembler-world", x: 14, y: 13 });
    const belt: Entity = {
      id: "belt-assembler-world",
      type: "belt",
      x: 16,
      y: 15,
      rotation: 0,
      level: 1,
    };
    const depot: Entity = {
      id: "depot-assembler-world",
      type: "depot",
      x: 16,
      y: 17,
      rotation: 0,
      level: 1,
    };
    const machines: Record<string, MachineRuntime> = {
      [extractor.id]: createMachineRuntime(extractor),
      [smelter.id]: createRuntime({ input: { copperOre: 1 } }),
      [assembler.id]: createRuntime({ input: { copperIngot: 2 } }),
      [depot.id]: createRuntime(),
    };
    const state = createState(
      [extractor, smelter, assembler, belt, depot],
      machines,
      [...ASSEMBLER_RECIPE_IDS, "copperIngot"],
    );
    state.grid.belts[belt.id] = { entityId: belt.id, progress: 0 };
    const stateBefore = structuredClone(state);

    const next = advanceSimulation(state, RECIPES.wire.durationTicks);

    expect(next.grid.machines[extractor.id]?.output).toEqual({ copperOre: 1 });
    expect(next.grid.machines[smelter.id]?.output).toEqual({ copperIngot: 1 });
    expect(next.grid.machines[assembler.id]?.output).toEqual({ wire: 1 });
    expect(next.grid.machines[assembler.id]?.input).toEqual({});
    expect(next.grid.machines[depot.id]).toEqual(stateBefore.grid.machines[depot.id]);
    expect(next.grid.belts).toEqual(stateBefore.grid.belts);
    expect(state).toEqual(stateBefore);
  });
});

function createAssembler(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "assembler-test",
    type: "assembler",
    x: 4,
    y: 6,
    rotation: 0,
    level: 1,
    recipeId: "wire",
    ...overrides,
  };
}

function createBelt(id: string, x: number, y: number, rotation: Rotation): Entity {
  return {
    id,
    type: "belt",
    x,
    y,
    rotation,
    level: 1,
  };
}

function createBeltCells(entries: Array<[Entity, ResourceId]>): Record<string, BeltCell> {
  const cells: Record<string, BeltCell> = {};
  for (const [entity, item] of entries) {
    cells[entity.id] = { entityId: entity.id, item, progress: 0 };
  }
  return cells;
}

function createRuntime(overrides: Partial<MachineRuntime> = {}): MachineRuntime {
  return {
    ...createMachineRuntime(DEFAULT_ASSEMBLER),
    ...overrides,
  };
}

function createState(
  entities: Entity[],
  machines: Record<string, MachineRuntime>,
  unlockedRecipes: string[] = ASSEMBLER_RECIPE_IDS,
  belts: Record<string, BeltCell> = {},
): SimulationState {
  const state = createInitialState(1337);
  state.grid.nodes = [COPPER_NODE];
  state.grid.entities = entities;
  state.grid.machines = machines;
  state.grid.belts = belts;
  state.unlocked.recipes = [...unlockedRecipes];
  return state;
}

function withInput(
  state: SimulationState,
  entityId: string,
  input: Partial<Record<ResourceId, number>>,
): SimulationState {
  const runtime = state.grid.machines[entityId];
  if (runtime === undefined) {
    return state;
  }

  return {
    ...state,
    grid: {
      ...state.grid,
      machines: {
        ...state.grid.machines,
        [entityId]: { ...runtime, input: { ...runtime.input, ...input } },
      },
    },
  };
}

function withOutput(
  state: SimulationState,
  entityId: string,
  amount: number,
  resource: ResourceId,
): SimulationState {
  const runtime = state.grid.machines[entityId];
  if (runtime === undefined) {
    return state;
  }

  return {
    ...state,
    grid: {
      ...state.grid,
      machines: {
        ...state.grid.machines,
        [entityId]: { ...runtime, output: { ...runtime.output, [resource]: amount } },
      },
    },
  };
}

function withUnlockedRecipes(state: SimulationState, recipes: string[]): SimulationState {
  return {
    ...state,
    unlocked: { ...state.unlocked, recipes: [...recipes] },
  };
}

function recipeEntries(recipe: RecipeDefinition): Array<[ResourceId, number]> {
  return Object.entries(recipe.inputs) as Array<[ResourceId, number]>;
}

function fullInputs(recipe: RecipeDefinition): Partial<Record<ResourceId, number>> {
  return { ...recipe.inputs };
}

function shortInputs(recipe: RecipeDefinition): Partial<Record<ResourceId, number>> {
  const entries = recipeEntries(recipe);
  const last = entries[entries.length - 1];
  if (last === undefined) {
    return {};
  }

  const [resource, amount] = last;
  return { ...recipe.inputs, [resource]: Math.max(0, amount - 1) };
}

function surplusInputs(recipe: RecipeDefinition): Partial<Record<ResourceId, number>> {
  const required = new Set(recipeEntries(recipe).map(([resource]) => resource));
  const surplus: Partial<Record<ResourceId, number>> = { ...SURPLUS_BASE };
  for (const resource of required) {
    delete surplus[resource];
  }
  return surplus;
}
