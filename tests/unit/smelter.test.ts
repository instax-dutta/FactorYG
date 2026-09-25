import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { RECIPES } from "../../src/content/recipes";
import { createInitialState } from "../../src/sim/initialState";
import {
  canRunRecipe,
  completeRecipe,
  consumeRecipeInputs,
  createMachineRuntime,
  tickProcessor,
} from "../../src/sim/machines";
import { advanceSimulation } from "../../src/sim/tick";
import type {
  Entity,
  MachineRuntime,
  RecipeDefinition,
  RenderEvent,
  ResourceId,
  SimulationState,
} from "../../src/sim/types";

const SMELTER_RECIPES: RecipeDefinition[] = [
  RECIPES.copperIngot,
  RECIPES.ironIngot,
  RECIPES.refinedStone,
];
const SMELTER_RECIPE_CASES = SMELTER_RECIPES.map(
  (recipe) => [recipe.id, recipe] as [string, RecipeDefinition],
);
const OUTPUT_BUFFER = MACHINES.smelter.outputBuffer;
const COPPER_NODE = {
  id: "node-copper-smelter",
  resource: "copperOre" as ResourceId,
  x: 8,
  y: 9,
};
const DEFAULT_SMELTER = createSmelter();

describe("canRunRecipe", () => {
  it.each(SMELTER_RECIPE_CASES)(
    "requires the exact inputs of %s",
    (_id, recipe) => {
      expect(canRunRecipe(createRuntime({ input: fullInputs(recipe) }), DEFAULT_SMELTER, recipe)).toBe(
        true,
      );
      expect(canRunRecipe(createRuntime({ input: shortInputs(recipe) }), DEFAULT_SMELTER, recipe)).toBe(
        false,
      );
      expect(canRunRecipe(createRuntime(), DEFAULT_SMELTER, recipe)).toBe(false);
    },
  );

  it("accepts surplus inputs for a smelter mixed input buffer", () => {
    const runtime = createRuntime({ input: { ironOre: 5, coal: 3, stone: 2 } });

    expect(canRunRecipe(runtime, DEFAULT_SMELTER, RECIPES.ironIngot)).toBe(true);
  });

  it("refuses a recipe whose output buffer cannot hold the result", () => {
    const runtime = createRuntime({
      input: fullInputs(RECIPES.copperIngot),
      output: { copperIngot: OUTPUT_BUFFER },
    });

    expect(canRunRecipe(runtime, DEFAULT_SMELTER, RECIPES.copperIngot)).toBe(false);
  });

  it("allows a recipe with exactly one free output slot", () => {
    const runtime = createRuntime({
      input: fullInputs(RECIPES.copperIngot),
      output: { copperIngot: OUTPUT_BUFFER - 1 },
    });

    expect(canRunRecipe(runtime, DEFAULT_SMELTER, RECIPES.copperIngot)).toBe(true);
  });
});

describe("consumeRecipeInputs", () => {
  it.each(SMELTER_RECIPE_CASES)(
    "consumes the exact %s inputs and leaves surplus",
    (_id, recipe) => {
      const stored = { ...surplusInputs(recipe), ...fullInputs(recipe) };
      const runtime = createRuntime({ input: stored });

      const result = consumeRecipeInputs(runtime, DEFAULT_SMELTER, recipe);

      expect(result.input).toEqual(surplusInputs(recipe));
      expect(runtime.input).toEqual(stored);
    },
  );

  it("consumes both mixed inputs of ironIngot from one buffer", () => {
    const runtime = createRuntime({ input: { ironOre: 2, coal: 1 } });

    const result = consumeRecipeInputs(runtime, DEFAULT_SMELTER, RECIPES.ironIngot);

    expect(result.input).toEqual({ ironOre: 1 });
  });

  it("returns the same runtime when one required input is missing", () => {
    const runtime = createRuntime({ input: { ironOre: 1 } });

    expect(consumeRecipeInputs(runtime, DEFAULT_SMELTER, RECIPES.ironIngot)).toBe(runtime);
  });

  it("returns the same runtime when the output buffer is full", () => {
    const runtime = createRuntime({
      input: fullInputs(RECIPES.copperIngot),
      output: { copperIngot: OUTPUT_BUFFER },
    });

    expect(consumeRecipeInputs(runtime, DEFAULT_SMELTER, RECIPES.copperIngot)).toBe(runtime);
  });
});

describe("completeRecipe", () => {
  it("adds the exact output amount and resets progress", () => {
    const runtime = createRuntime({ progressTicks: 19, active: true });

    const result = completeRecipe(runtime, DEFAULT_SMELTER, RECIPES.copperIngot);

    expect(result.output).toEqual({ copperIngot: 1 });
    expect(result.progressTicks).toBe(0);
    expect(result.active).toBe(true);
    expect(runtime.output).toEqual({});
    expect(runtime.progressTicks).toBe(19);
  });

  it("fills the output buffer to capacity without exceeding it", () => {
    const runtime = createRuntime({
      output: { refinedStone: OUTPUT_BUFFER - 1 },
      progressTicks: 19,
      active: true,
    });

    const result = completeRecipe(runtime, DEFAULT_SMELTER, RECIPES.refinedStone);

    expect(result.output).toEqual({ refinedStone: OUTPUT_BUFFER });
  });

  it("returns the same runtime and holds progress while the output buffer is full", () => {
    const runtime = createRuntime({
      output: { ironIngot: OUTPUT_BUFFER },
      progressTicks: 30,
      active: true,
    });

    expect(completeRecipe(runtime, DEFAULT_SMELTER, RECIPES.ironIngot)).toBe(runtime);
    expect(runtime.progressTicks).toBe(30);
    expect(runtime.output).toEqual({ ironIngot: OUTPUT_BUFFER });
  });
});

describe("smelter production", () => {
  it.each(SMELTER_RECIPE_CASES)(
    "produces %s exactly at its recipe duration",
    (recipeId, recipe) => {
      const entity = createSmelter({ recipeId });
      const state = createState([entity], {
        [entity.id]: createRuntime({ input: fullInputs(recipe) }),
      });
      const events: RenderEvent[] = [];

      const running = advanceSimulation(state, recipe.durationTicks - 1, events);

      expect(running.grid.machines[entity.id]?.output).toEqual({});
      expect(running.grid.machines[entity.id]?.progressTicks).toBe(recipe.durationTicks - 1);
      expect(running.grid.machines[entity.id]?.active).toBe(true);

      const completed = advanceSimulation(running, 1, events);

      expect(completed.grid.machines[entity.id]?.output).toEqual({
        [recipe.output.resource]: recipe.output.amount,
      });
      expect(completed.grid.machines[entity.id]?.progressTicks).toBe(0);
      expect(completed.grid.machines[entity.id]?.active).toBe(false);
      expect(events).toEqual([
        { type: "machineStateChanged", entityId: entity.id, active: true },
        { type: "machineStateChanged", entityId: entity.id, active: false },
      ]);
    },
  );

  it("consumes inputs on the first tick and emits the active transition", () => {
    const entity = createSmelter({ recipeId: "ironIngot" });
    const state = createState([entity], {
      [entity.id]: createRuntime({ input: { ironOre: 2, coal: 1, stone: 3 } }),
    });
    const events: RenderEvent[] = [];

    const next = advanceSimulation(state, 1, events);

    expect(next.grid.machines[entity.id]?.input).toEqual({ ironOre: 1, stone: 3 });
    expect(next.grid.machines[entity.id]?.progressTicks).toBe(1);
    expect(next.grid.machines[entity.id]?.active).toBe(true);
    expect(events).toEqual([
      { type: "machineStateChanged", entityId: entity.id, active: true },
    ]);
  });

  it("waits for every mixed input of the selected recipe", () => {
    const entity = createSmelter({ recipeId: "ironIngot" });
    const state = createState([entity], {
      [entity.id]: createRuntime({ input: { ironOre: 2 } }),
    });
    const events: RenderEvent[] = [];

    const waiting = advanceSimulation(state, 40, events);

    expect(waiting.grid.machines[entity.id]?.input).toEqual({ ironOre: 2 });
    expect(waiting.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(waiting.grid.machines[entity.id]?.active).toBe(false);
    expect(waiting.grid.machines[entity.id]?.output).toEqual({});
    expect(events).toEqual([]);

    const coal = {
      ...waiting,
      grid: {
        ...waiting.grid,
        machines: {
          ...waiting.grid.machines,
          [entity.id]: {
            ...waiting.grid.machines[entity.id],
            input: { ironOre: 2, coal: 1 },
          },
        },
      },
    };

    const completed = advanceSimulation(coal, 30, events);

    expect(completed.grid.machines[entity.id]?.output).toEqual({ ironIngot: 1 });
    expect(completed.grid.machines[entity.id]?.input).toEqual({ ironOre: 1 });
  });

  it("does not start a recipe while the output buffer is full", () => {
    const entity = createSmelter({ recipeId: "copperIngot" });
    const state = createState([entity], {
      [entity.id]: createRuntime({
        input: { copperOre: 2 },
        output: { copperIngot: OUTPUT_BUFFER },
      }),
    });
    const events: RenderEvent[] = [];

    const next = advanceSimulation(state, 60, events);

    expect(next.grid.machines[entity.id]).toEqual(state.grid.machines[entity.id]);
    expect(events).toEqual([]);
  });

  it("fills the output buffer to capacity and then stops", () => {
    const entity = createSmelter({ recipeId: "copperIngot" });
    const state = createState([entity], {
      [entity.id]: createRuntime({ input: { copperOre: OUTPUT_BUFFER } }),
    });

    const filled = advanceSimulation(state, RECIPES.copperIngot.durationTicks * OUTPUT_BUFFER);

    expect(filled.grid.machines[entity.id]?.output).toEqual({ copperIngot: OUTPUT_BUFFER });
    expect(filled.grid.machines[entity.id]?.input).toEqual({});

    const blocked = advanceSimulation(filled, 10);

    expect(blocked.grid.machines[entity.id]?.output).toEqual({ copperIngot: OUTPUT_BUFFER });
    expect(blocked.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(blocked.grid.machines[entity.id]?.active).toBe(false);
  });

  it("holds a finished recipe until the output buffer clears", () => {
    const entity = createSmelter({ recipeId: "copperIngot" });
    const blocked = createState([entity], {
      [entity.id]: createRuntime({
        progressTicks: RECIPES.copperIngot.durationTicks - 1,
        output: { copperIngot: OUTPUT_BUFFER },
        active: true,
      }),
    });
    const events: RenderEvent[] = [];

    const waiting = advanceSimulation(blocked, 5, events);

    expect(waiting.grid.machines[entity.id]?.output).toEqual({ copperIngot: OUTPUT_BUFFER });
    expect(waiting.grid.machines[entity.id]?.progressTicks).toBe(
      RECIPES.copperIngot.durationTicks - 1,
    );
    expect(waiting.grid.machines[entity.id]?.active).toBe(false);
    expect(events).toEqual([
      { type: "machineStateChanged", entityId: entity.id, active: false },
    ]);

    const drained = {
      ...waiting,
      grid: {
        ...waiting.grid,
        machines: {
          ...waiting.grid.machines,
          [entity.id]: {
            ...waiting.grid.machines[entity.id],
            output: { copperIngot: OUTPUT_BUFFER - 1 },
          },
        },
      },
    };

    const completed = advanceSimulation(drained, 1, events);

    expect(completed.grid.machines[entity.id]?.output).toEqual({ copperIngot: OUTPUT_BUFFER });
    expect(completed.grid.machines[entity.id]?.progressTicks).toBe(0);
  });

  it.each([
    ["locked", createSmelter({ recipeId: "copperIngot" }), []],
    ["assembler-only", createSmelter({ recipeId: "wire" }), ["copperIngot", "wire"]],
    ["unknown", createSmelter({ recipeId: "unobtanium" }), ["copperIngot", "unobtanium"]],
    ["missing", createSmelter({ recipeId: undefined }), ["copperIngot"]],
  ])("never runs a %s recipe", (_label, entity, unlocked) => {
    const runtime = createRuntime({ input: { copperOre: 2 } });
    const state = createState([entity], { [entity.id]: runtime }, unlocked);

    expect(tickProcessor(runtime, entity, state)).toBe(runtime);

    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 120, events);

    expect(next.grid.machines[entity.id]).toEqual(runtime);
    expect(next.grid.machines[entity.id]?.input).toEqual({ copperOre: 2 });
    expect(next.grid.machines[entity.id]?.output).toEqual({});
    expect(events).toEqual([]);
  });

  it("clears stale progress and deactivates a runtime whose recipe is locked", () => {
    const entity = createSmelter({ recipeId: "copperIngot" });
    const runtime = createRuntime({ progressTicks: 5, input: { stone: 2 }, active: true });
    const state = createState([entity], { [entity.id]: runtime }, []);

    const result = tickProcessor(runtime, entity, state);

    expect(result).not.toBe(runtime);
    expect(result).toEqual({
      ...runtime,
      progressTicks: 0,
      active: false,
    });
    expect(runtime.progressTicks).toBe(5);
  });

  it.each([
    ["locked", createSmelter({ recipeId: "copperIngot" }), []],
    ["assembler-only", createSmelter({ recipeId: "wire" }), ["copperIngot", "wire"]],
    ["unknown", createSmelter({ recipeId: "unobtanium" }), ["copperIngot", "unobtanium"]],
    ["missing", createSmelter({ recipeId: undefined }), ["copperIngot"]],
  ])(
    "discards an in-flight run for a %s recipe without touching buffers",
    (_label, entity, unlocked) => {
      const runtime = createRuntime({
        progressTicks: 7,
        input: { copperOre: 1, stone: 2 },
        output: { copperIngot: 3 },
        active: true,
      });
      const state = createState([entity], { [entity.id]: runtime }, unlocked);

      const result = tickProcessor(runtime, entity, state);

      expect(result).not.toBe(runtime);
      expect(result.progressTicks).toBe(0);
      expect(result.active).toBe(false);
      expect(result.input).toEqual({ copperOre: 1, stone: 2 });
      expect(result.output).toEqual({ copperIngot: 3 });
      expect(runtime.progressTicks).toBe(7);
    },
  );

  it("discards an in-flight run once the selected recipe becomes unresolvable", () => {
    const entity = createSmelter({ recipeId: "copperIngot" });
    const state = createState([entity], {
      [entity.id]: createRuntime({ input: { copperOre: 2, stone: 1 } }),
    });
    const events: RenderEvent[] = [];

    const started = advanceSimulation(state, 6, events);

    expect(started.grid.machines[entity.id]?.progressTicks).toBe(6);
    expect(started.grid.machines[entity.id]?.input).toEqual({ copperOre: 1, stone: 1 });
    expect(started.grid.machines[entity.id]?.active).toBe(true);

    const unresolved: SimulationState = {
      ...started,
      unlocked: { ...started.unlocked, recipes: [] },
    };
    const abandoned = advanceSimulation(unresolved, 40, events);

    expect(abandoned.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(abandoned.grid.machines[entity.id]?.active).toBe(false);
    expect(abandoned.grid.machines[entity.id]?.output).toEqual({});
    expect(abandoned.grid.machines[entity.id]?.input).toEqual({ copperOre: 1, stone: 1 });
    expect(events).toEqual([
      { type: "machineStateChanged", entityId: entity.id, active: true },
      { type: "machineStateChanged", entityId: entity.id, active: false },
    ]);

    const relocked: SimulationState = {
      ...abandoned,
      unlocked: { ...abandoned.unlocked, recipes: ["copperIngot"] },
    };
    const restarted = advanceSimulation(relocked, 1, events);

    expect(restarted.grid.machines[entity.id]?.progressTicks).toBe(1);
    expect(restarted.grid.machines[entity.id]?.active).toBe(true);
    expect(restarted.grid.machines[entity.id]?.input).toEqual({ stone: 1 });
    expect(restarted.grid.machines[entity.id]?.output).toEqual({});
    expect(events).toEqual([
      { type: "machineStateChanged", entityId: entity.id, active: true },
      { type: "machineStateChanged", entityId: entity.id, active: false },
      { type: "machineStateChanged", entityId: entity.id, active: true },
    ]);

    const completed = advanceSimulation(restarted, RECIPES.copperIngot.durationTicks - 1, events);

    expect(completed.grid.machines[entity.id]?.output).toEqual({ copperIngot: 1 });
    expect(completed.grid.machines[entity.id]?.progressTicks).toBe(0);
    expect(completed.grid.machines[entity.id]?.active).toBe(false);
    expect(completed.grid.machines[entity.id]?.input).toEqual({ stone: 1 });
  });

  it("keeps extractor, belt, and depot behavior while smelters run", () => {
    const extractor: Entity = {
      id: "extractor-smelter-world",
      type: "extractor",
      x: COPPER_NODE.x,
      y: COPPER_NODE.y,
      rotation: 0,
      level: 1,
      resourceNode: COPPER_NODE.resource,
    };
    const smelter = createSmelter({ id: "smelter-world", x: 12, y: 13 });
    const belt: Entity = {
      id: "belt-smelter-world",
      type: "belt",
      x: 14,
      y: 15,
      rotation: 0,
      level: 1,
    };
    const depot: Entity = {
      id: "depot-smelter-world",
      type: "depot",
      x: 16,
      y: 17,
      rotation: 0,
      level: 1,
    };
    const machines: Record<string, MachineRuntime> = {
      [extractor.id]: createMachineRuntime(extractor),
      [smelter.id]: createRuntime({ input: { copperOre: 1 } }),
      [depot.id]: createRuntime(),
    };
    const state = createState([extractor, smelter, belt, depot], machines);
    state.grid.belts[belt.id] = { entityId: belt.id, progress: 0 };
    const stateBefore = structuredClone(state);

    const next = advanceSimulation(state, RECIPES.copperIngot.durationTicks);

    expect(next.grid.machines[extractor.id]?.output).toEqual({ copperOre: 1 });
    expect(next.grid.machines[smelter.id]?.output).toEqual({ copperIngot: 1 });
    expect(next.grid.machines[depot.id]).toEqual(stateBefore.grid.machines[depot.id]);
    expect(next.grid.belts).toEqual(stateBefore.grid.belts);
    expect(state).toEqual(stateBefore);
  });
});

function createSmelter(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "smelter-test",
    type: "smelter",
    x: 4,
    y: 6,
    rotation: 0,
    level: 1,
    recipeId: "copperIngot",
    ...overrides,
  };
}

function createRuntime(overrides: Partial<MachineRuntime> = {}): MachineRuntime {
  return {
    ...createMachineRuntime(DEFAULT_SMELTER),
    ...overrides,
  };
}

function createState(
  entities: Entity[],
  machines: Record<string, MachineRuntime>,
  unlockedRecipes: string[] = ["copperIngot", "ironIngot", "refinedStone"],
): SimulationState {
  const state = createInitialState(1337);
  state.grid.nodes = [COPPER_NODE];
  state.grid.entities = entities;
  state.grid.machines = machines;
  state.unlocked.recipes = [...unlockedRecipes];
  return state;
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
  const surplus: Partial<Record<ResourceId, number>> = {
    copperOre: 3,
    ironOre: 5,
    coal: 2,
    stone: 4,
  };
  for (const resource of required) {
    delete surplus[resource];
  }
  return surplus;
}
