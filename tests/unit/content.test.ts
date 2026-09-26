import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../src/content/freeze";
import { MACHINES, getMachine, type MachineDefinition } from "../../src/content/machines";
import { RECIPES, getRecipe } from "../../src/content/recipes";
import { RESOURCES, getResource, type ResourceId } from "../../src/content/resources";
import type { MachineDefinition as CanonicalMachineDefinition } from "../../src/content/types";
import { UNLOCKS } from "../../src/content/unlocks";
import { validateContent } from "../../src/content/validation";
import type { MachineDefinition as SimulationMachineDefinition } from "../../src/sim/types";

const ALL_RESOURCES: ResourceId[] = [
  "copperOre",
  "ironOre",
  "coal",
  "stone",
  "copperIngot",
  "ironIngot",
  "refinedStone",
  "wire",
  "gear",
  "plate",
  "circuit",
  "frame",
  "motor",
];

const RAW_RESOURCES: ResourceId[] = ["copperOre", "ironOre", "coal", "stone"];
const PROCESSED_RESOURCES: ResourceId[] = ALL_RESOURCES.filter(
  (resource) => !RAW_RESOURCES.includes(resource),
);

interface MutableUnlockRequirement {
  cost: number;
  requiresMachines: string[];
  requiresRecipes: string[];
}

interface MutableContentSnapshot {
  resources: Record<string, Record<string, unknown>>;
  machines: Record<string, Record<string, unknown>>;
  recipes: Record<string, Record<string, unknown>>;
  unlocks: {
    machines: string[];
    recipes: string[];
    machineUnlocks: Record<string, MutableUnlockRequirement>;
    recipeUnlocks: Record<string, MutableUnlockRequirement>;
  };
}

function createMutableContentSnapshot(): MutableContentSnapshot {
  return structuredClone({
    resources: RESOURCES,
    machines: MACHINES,
    recipes: RECIPES,
    unlocks: UNLOCKS,
  }) as unknown as MutableContentSnapshot;
}

function summarizePorts(machine: MachineDefinition) {
  return machine.ports.map((port) => ({
    id: port.id,
    kind: port.kind,
    offset: port.offset,
    accepts: port.accepts,
    produces: port.produces,
  }));
}

describe("Factor-Y content tables", () => {
  it("defines all thirteen resources with exact tiers, labels, and sell values", () => {
    expect(
      Object.values(RESOURCES).map(({ id, tier, label, sellValue }) => ({
        id,
        tier,
        label,
        sellValue,
      })),
    ).toEqual([
      { id: "copperOre", tier: 0, label: "Copper Ore", sellValue: 1 },
      { id: "ironOre", tier: 0, label: "Iron Ore", sellValue: 1 },
      { id: "coal", tier: 0, label: "Coal", sellValue: 2 },
      { id: "stone", tier: 0, label: "Stone", sellValue: 1 },
      { id: "copperIngot", tier: 1, label: "Copper Ingot", sellValue: 6 },
      { id: "ironIngot", tier: 1, label: "Iron Ingot", sellValue: 10 },
      { id: "refinedStone", tier: 1, label: "Refined Stone", sellValue: 5 },
      { id: "wire", tier: 2, label: "Wire", sellValue: 24 },
      { id: "gear", tier: 2, label: "Gear", sellValue: 30 },
      { id: "plate", tier: 2, label: "Plate", sellValue: 36 },
      { id: "circuit", tier: 3, label: "Circuit", sellValue: 120 },
      { id: "frame", tier: 3, label: "Frame", sellValue: 180 },
      { id: "motor", tier: 3, label: "Motor", sellValue: 600 },
    ]);
  });

  it("uses unique resource manifest keys and valid colors", () => {
    const iconKeys = Object.values(RESOURCES).map((resource) => resource.iconKey);
    const colors = Object.values(RESOURCES).map((resource) => resource.color);

    expect(iconKeys).toEqual(ALL_RESOURCES.map((resource) => `resource.${resource}`));
    expect(new Set(iconKeys).size).toBe(iconKeys.length);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
  });

  it("defines all six machines with exact costs, capacities, timings, and sprites", () => {
    expect(
      Object.values(MACHINES).map((machine: MachineDefinition) => {
        const {
          type,
          footprint,
          cost,
          unlockCost,
          inputBuffer,
          outputBuffer,
          bufferMode,
          storageCapacity,
          defaultProcessTicks,
          spriteKey,
          activeSpriteKey,
        } = machine;
        return {
          type,
          footprint,
          cost,
          unlockCost,
          inputBuffer,
          outputBuffer,
          bufferMode,
          storageCapacity,
          defaultProcessTicks,
          spriteKey,
          activeSpriteKey,
        };
      }),
    ).toEqual([
      {
        type: "extractor",
        footprint: { width: 1, height: 1 },
        cost: 50,
        unlockCost: 0,
        inputBuffer: 0,
        outputBuffer: 1,
        bufferMode: "separate",
        storageCapacity: undefined,
        defaultProcessTicks: 20,
        spriteKey: "machine.extractor.idle",
        activeSpriteKey: "machine.extractor.active",
      },
      {
        type: "belt",
        footprint: { width: 1, height: 1 },
        cost: 10,
        unlockCost: 0,
        inputBuffer: 1,
        outputBuffer: 1,
        bufferMode: "separate",
        storageCapacity: undefined,
        defaultProcessTicks: 10,
        spriteKey: "machine.belt.idle",
        activeSpriteKey: "machine.belt.active",
      },
      {
        type: "smelter",
        footprint: { width: 1, height: 1 },
        cost: 250,
        unlockCost: 250,
        inputBuffer: 10,
        outputBuffer: 10,
        bufferMode: "separate",
        storageCapacity: undefined,
        defaultProcessTicks: 20,
        spriteKey: "machine.smelter.idle",
        activeSpriteKey: "machine.smelter.active",
      },
      {
        type: "assembler",
        footprint: { width: 1, height: 1 },
        cost: 500,
        unlockCost: 500,
        inputBuffer: 20,
        outputBuffer: 10,
        bufferMode: "separate",
        storageCapacity: undefined,
        defaultProcessTicks: 30,
        spriteKey: "machine.assembler.idle",
        activeSpriteKey: "machine.assembler.active",
      },
      {
        type: "silo",
        footprint: { width: 1, height: 1 },
        cost: 150,
        unlockCost: 150,
        inputBuffer: 100,
        outputBuffer: 100,
        bufferMode: "shared",
        storageCapacity: 100,
        defaultProcessTicks: 10,
        spriteKey: "machine.silo.idle",
        activeSpriteKey: "machine.silo.active",
      },
      {
        type: "depot",
        footprint: { width: 1, height: 1 },
        cost: 100,
        unlockCost: 0,
        inputBuffer: 100,
        outputBuffer: 0,
        bufferMode: "separate",
        storageCapacity: undefined,
        defaultProcessTicks: 1,
        spriteKey: "machine.depot.idle",
        activeSpriteKey: "machine.depot.active",
      },
    ]);
  });

  it("defines explicit ports for every machine", () => {
    expect(Object.fromEntries(Object.values(MACHINES).map((machine) => [machine.type, summarizePorts(machine)]))).toEqual({
      extractor: [
        {
          id: "output",
          kind: "output",
          offset: { x: 1, y: 0 },
          accepts: undefined,
          produces: undefined,
        },
      ],
      belt: [
        {
          id: "input",
          kind: "input",
          offset: { x: -1, y: 0 },
          accepts: ALL_RESOURCES,
          produces: undefined,
        },
        {
          id: "output",
          kind: "output",
          offset: { x: 1, y: 0 },
          accepts: undefined,
          produces: undefined,
        },
      ],
      smelter: [
        {
          id: "input-1",
          kind: "input",
          offset: { x: -1, y: 0 },
          accepts: RAW_RESOURCES,
          produces: undefined,
        },
        {
          id: "input-2",
          kind: "input",
          offset: { x: 0, y: -1 },
          accepts: RAW_RESOURCES,
          produces: undefined,
        },
        {
          id: "output",
          kind: "output",
          offset: { x: 1, y: 0 },
          accepts: undefined,
          produces: undefined,
        },
      ],
      assembler: [
        {
          id: "input-1",
          kind: "input",
          offset: { x: -1, y: 0 },
          accepts: PROCESSED_RESOURCES,
          produces: undefined,
        },
        {
          id: "input-2",
          kind: "input",
          offset: { x: 0, y: -1 },
          accepts: PROCESSED_RESOURCES,
          produces: undefined,
        },
        {
          id: "output",
          kind: "output",
          offset: { x: 1, y: 0 },
          accepts: undefined,
          produces: undefined,
        },
      ],
      silo: [
        {
          id: "input",
          kind: "input",
          offset: { x: -1, y: 0 },
          accepts: ALL_RESOURCES,
          produces: undefined,
        },
        {
          id: "output",
          kind: "output",
          offset: { x: 1, y: 0 },
          accepts: undefined,
          produces: undefined,
        },
      ],
      depot: [
        {
          id: "input",
          kind: "input",
          offset: { x: -1, y: 0 },
          accepts: ALL_RESOURCES,
          produces: undefined,
        },
      ],
    });
  });

  it("defines all nine recipes with exact inputs, outputs, timings, and values", () => {
    expect(
      Object.values(RECIPES).map(
        ({ id, machine, inputs, output, durationTicks, unlockCost, sellValue }) => ({
          id,
          machine,
          inputs,
          output,
          durationTicks,
          unlockCost,
          sellValue,
        }),
      ),
    ).toEqual([
      {
        id: "copperIngot",
        machine: "smelter",
        inputs: { copperOre: 1 },
        output: { resource: "copperIngot", amount: 1 },
        durationTicks: 20,
        unlockCost: 300,
        sellValue: 6,
      },
      {
        id: "ironIngot",
        machine: "smelter",
        inputs: { ironOre: 1, coal: 1 },
        output: { resource: "ironIngot", amount: 1 },
        durationTicks: 30,
        unlockCost: 450,
        sellValue: 10,
      },
      {
        id: "refinedStone",
        machine: "smelter",
        inputs: { stone: 1 },
        output: { resource: "refinedStone", amount: 1 },
        durationTicks: 20,
        unlockCost: 600,
        sellValue: 5,
      },
      {
        id: "wire",
        machine: "assembler",
        inputs: { copperIngot: 2 },
        output: { resource: "wire", amount: 1 },
        durationTicks: 30,
        unlockCost: 900,
        sellValue: 24,
      },
      {
        id: "gear",
        machine: "assembler",
        inputs: { ironIngot: 2 },
        output: { resource: "gear", amount: 1 },
        durationTicks: 30,
        unlockCost: 1_200,
        sellValue: 30,
      },
      {
        id: "plate",
        machine: "assembler",
        inputs: { ironIngot: 1, refinedStone: 1 },
        output: { resource: "plate", amount: 1 },
        durationTicks: 30,
        unlockCost: 1_600,
        sellValue: 36,
      },
      {
        id: "circuit",
        machine: "assembler",
        inputs: { wire: 1, gear: 1 },
        output: { resource: "circuit", amount: 1 },
        durationTicks: 40,
        unlockCost: 4_000,
        sellValue: 120,
      },
      {
        id: "frame",
        machine: "assembler",
        inputs: { plate: 2, gear: 1 },
        output: { resource: "frame", amount: 1 },
        durationTicks: 40,
        unlockCost: 6_000,
        sellValue: 180,
      },
      {
        id: "motor",
        machine: "assembler",
        inputs: { circuit: 1, frame: 1 },
        output: { resource: "motor", amount: 1 },
        durationTicks: 50,
        unlockCost: 12_000,
        sellValue: 600,
      },
    ]);
  });

  it("starts with only the raw-loop machines unlocked and prices every paid entry", () => {
    expect(UNLOCKS).toEqual({
      machines: ["extractor", "belt", "depot"],
      recipes: [],
      machineUnlocks: {
        smelter: { cost: 250, requiresMachines: [], requiresRecipes: [] },
        assembler: { cost: 500, requiresMachines: ["smelter"], requiresRecipes: [] },
        silo: { cost: 150, requiresMachines: [], requiresRecipes: [] },
      },
      recipeUnlocks: {
        copperIngot: { cost: 300, requiresMachines: ["smelter"], requiresRecipes: [] },
        ironIngot: { cost: 450, requiresMachines: ["smelter"], requiresRecipes: [] },
        refinedStone: { cost: 600, requiresMachines: ["smelter"], requiresRecipes: [] },
        wire: { cost: 900, requiresMachines: ["assembler"], requiresRecipes: ["copperIngot"] },
        gear: { cost: 1_200, requiresMachines: ["assembler"], requiresRecipes: ["ironIngot"] },
        plate: {
          cost: 1_600,
          requiresMachines: ["assembler"],
          requiresRecipes: ["ironIngot", "refinedStone"],
        },
        circuit: {
          cost: 4_000,
          requiresMachines: ["assembler"],
          requiresRecipes: ["wire", "gear"],
        },
        frame: {
          cost: 6_000,
          requiresMachines: ["assembler"],
          requiresRecipes: ["plate", "gear"],
        },
        motor: {
          cost: 12_000,
          requiresMachines: ["assembler"],
          requiresRecipes: ["circuit", "frame"],
        },
      },
    });
  });

  it("pins the plate prerequisites to every recipe that produces its inputs", () => {
    expect(RECIPES.plate.inputs).toEqual({ ironIngot: 1, refinedStone: 1 });
    expect(UNLOCKS.recipeUnlocks.plate).toEqual({
      cost: 1_600,
      requiresMachines: ["assembler"],
      requiresRecipes: ["ironIngot", "refinedStone"],
    });
  });

  it("looks up known content and returns undefined for unknown identifiers", () => {
    expect(getResource("copperIngot")).toBe(RESOURCES.copperIngot);
    expect(getMachine("assembler")).toBe(MACHINES.assembler);
    expect(getRecipe("motor")).toBe(RECIPES.motor);
    expect(getResource("missing")).toBeUndefined();
    expect(getMachine("missing")).toBeUndefined();
    expect(getRecipe("missing")).toBeUndefined();
  });

  it("re-exports the canonical machine contract through the simulation types", () => {
    const canonical: CanonicalMachineDefinition = MACHINES.smelter;
    const simulation: SimulationMachineDefinition = canonical;

    expect(simulation.defaultProcessTicks).toBe(20);
    expect(simulation.bufferMode).toBe("separate");
  });

  it("recursively freezes mutable values and every level of the shipped tables", () => {
    const nested = deepFreeze({
      branch: {
        entries: [{ value: 1 }],
      },
    });

    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.branch)).toBe(true);
    expect(Object.isFrozen(nested.branch.entries)).toBe(true);
    expect(Object.isFrozen(nested.branch.entries[0])).toBe(true);
    expect(nested.branch.entries[0].value).toBe(1);

    expect(Object.isFrozen(RESOURCES)).toBe(true);
    expect(Object.isFrozen(RESOURCES.copperOre)).toBe(true);
    expect(Object.isFrozen(MACHINES)).toBe(true);
    expect(Object.isFrozen(MACHINES.smelter)).toBe(true);
    expect(Object.isFrozen(MACHINES.smelter.footprint)).toBe(true);
    expect(Object.isFrozen(MACHINES.smelter.ports)).toBe(true);
    expect(Object.isFrozen(MACHINES.smelter.ports[0])).toBe(true);
    expect(Object.isFrozen(MACHINES.smelter.ports[0].offset)).toBe(true);
    expect(Object.isFrozen(RECIPES)).toBe(true);
    expect(Object.isFrozen(RECIPES.ironIngot)).toBe(true);
    expect(Object.isFrozen(RECIPES.ironIngot.inputs)).toBe(true);
    expect(Object.isFrozen(RECIPES.ironIngot.output)).toBe(true);
    expect(Object.isFrozen(UNLOCKS)).toBe(true);
    expect(Object.isFrozen(UNLOCKS.machines)).toBe(true);
    expect(Object.isFrozen(UNLOCKS.recipes)).toBe(true);
    expect(Object.isFrozen(UNLOCKS.machineUnlocks)).toBe(true);
    expect(Object.isFrozen(UNLOCKS.machineUnlocks.smelter)).toBe(true);
    expect(Object.isFrozen(UNLOCKS.machineUnlocks.assembler?.requiresMachines)).toBe(true);
    expect(Object.isFrozen(UNLOCKS.recipeUnlocks)).toBe(true);
    expect(Object.isFrozen(UNLOCKS.recipeUnlocks.motor)).toBe(true);
    expect(Object.isFrozen(UNLOCKS.recipeUnlocks.motor?.requiresRecipes)).toBe(true);

    const smelterInput = MACHINES.smelter.ports.find((port) => port.kind === "input");
    if (smelterInput?.accepts === undefined) {
      throw new Error("Expected the smelter input port to accept resources.");
    }

    expect(Reflect.set(RESOURCES, "copperOre", undefined)).toBe(false);
    expect(Reflect.set(RESOURCES.copperOre, "label", "Changed")).toBe(false);
    expect(Reflect.set(MACHINES.smelter.footprint, "width", 2)).toBe(false);
    expect(Reflect.set(MACHINES.smelter.ports[0].offset, "x", 0)).toBe(false);
    expect(Reflect.set(smelterInput.accepts, 0, "missingResource")).toBe(false);
    expect(Reflect.set(RECIPES.ironIngot.inputs, "ironOre", 99)).toBe(false);
    expect(Reflect.set(RECIPES.ironIngot.output, "amount", 99)).toBe(false);
    expect(Reflect.set(UNLOCKS.machines, 0, "silo")).toBe(false);
    expect(RESOURCES.copperOre.label).toBe("Copper Ore");
    expect(MACHINES.smelter.footprint.width).toBe(1);
    expect(smelterInput.accepts[0]).toBe("copperOre");
    expect(RECIPES.ironIngot.inputs.ironOre).toBe(1);
    expect(RECIPES.ironIngot.output.amount).toBe(1);
    expect(UNLOCKS.machines[0]).toBe("extractor");
  });

  it("requires the exact canonical resource and recipe ID sets", () => {
    const missingResource = createMutableContentSnapshot();
    delete missingResource.resources.motor;
    missingResource.resources.scrap = { ...RESOURCES.motor, id: "scrap" };
    const missingRecipe = createMutableContentSnapshot();
    delete missingRecipe.recipes.motor;
    missingRecipe.recipes.scrap = { ...RECIPES.motor, id: "scrap" };
    const missingResourceErrors = validateContent(missingResource);

    expect(missingResourceErrors.some((error) => error.includes("Resource IDs") && error.includes("motor") && error.includes("scrap"))).toBe(true);
    expect(missingResourceErrors).toContain('Machine "belt" port "input" references unknown resource "motor".');
    expect(missingResourceErrors).toContain('Recipe "motor" references unknown output resource "motor".');
    expect(validateContent(missingRecipe).some((error) => error.includes("Recipe IDs") && error.includes("motor") && error.includes("scrap"))).toBe(true);
  });

  it("checks resource, machine, and recipe key and ID agreement", () => {
    const snapshot = createMutableContentSnapshot();
    snapshot.resources.copperOre = { ...snapshot.resources.copperOre, id: "ironOre" };
    snapshot.machines.smelter = { ...snapshot.machines.smelter, type: "belt" };
    snapshot.recipes.motor = { ...snapshot.recipes.motor, id: "frame" };
    const invalidRecipeReference = createMutableContentSnapshot();
    invalidRecipeReference.recipes.copperIngot = {
      ...invalidRecipeReference.recipes.copperIngot,
      inputs: { missingResource: 1 },
    };

    const errors = validateContent(snapshot);
    expect(errors).toContain('Resource key "copperOre" must match id "ironOre".');
    expect(errors).toContain('Machine key "smelter" must match type "belt".');
    expect(errors).toContain('Recipe key "motor" must match id "frame".');
    expect(validateContent(invalidRecipeReference)).toContain(
      'Recipe "copperIngot" references unknown resource "missingResource".',
    );
  });

  it("returns human-readable errors without throwing for malformed snapshots", () => {
    const malformedPort = createMutableContentSnapshot();
    malformedPort.machines.smelter = {
      ...malformedPort.machines.smelter,
      ports: [{ id: "input", kind: "input", offset: null, accepts: [null] }],
    };
    const malformedRecipeInputs = createMutableContentSnapshot();
    malformedRecipeInputs.recipes.copperIngot = {
      ...malformedRecipeInputs.recipes.copperIngot,
      inputs: [],
    };
    const missingOutput = createMutableContentSnapshot();
    delete missingOutput.recipes.copperIngot.output;
    const malformedSnapshots: unknown[] = [
      null,
      [],
      {},
      { resources: "invalid", machines: 1, recipes: false, unlocks: null },
      malformedPort,
      malformedRecipeInputs,
      missingOutput,
    ];

    for (const input of malformedSnapshots) {
      let errors: string[] = [];
      expect(() => {
        errors = validateContent(input);
      }).not.toThrow();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((error) => typeof error === "string" && error.trim().length > 0)).toBe(true);
    }

    expect(validateContent(missingOutput)).toContain('Recipe "copperIngot" must define an output.');
  });

  it("reports mutable content snapshots as a validation error", () => {
    const errors = validateContent(createMutableContentSnapshot());

    expect(errors.some((error) => error.includes("deeply frozen"))).toBe(true);
  });

  it("requires initial unlock consistency in both directions and for both tables", () => {
    const missingInitialMachine = createMutableContentSnapshot();
    missingInitialMachine.unlocks.machines = ["belt", "depot"];
    const extraInitialMachine = createMutableContentSnapshot();
    extraInitialMachine.unlocks.machines.push("smelter");
    const zeroCostRecipe = createMutableContentSnapshot();
    zeroCostRecipe.recipes.copperIngot = {
      ...zeroCostRecipe.recipes.copperIngot,
      unlockCost: 0,
    };
    const extraInitialRecipe = createMutableContentSnapshot();
    extraInitialRecipe.unlocks.recipes.push("copperIngot");

    expect(validateContent(missingInitialMachine)).toContain(
      'Machine "extractor" has zero unlock cost but is not initially unlocked.',
    );
    expect(validateContent(extraInitialMachine)).toContain(
      'Initially unlocked machine "smelter" must have a zero unlock cost.',
    );
    expect(validateContent(extraInitialMachine).some((error) => error.includes("Initial machine unlocks"))).toBe(true);
    expect(validateContent(zeroCostRecipe)).toContain(
      'Recipe "copperIngot" has zero unlock cost but is not initially unlocked.',
    );
    expect(validateContent(extraInitialRecipe)).toContain(
      'Initially unlocked recipe "copperIngot" must have a zero unlock cost.',
    );
    expect(validateContent(extraInitialRecipe).some((error) => error.includes("Initial recipe unlocks"))).toBe(true);
  });

  it("requires paid entries to declare unlock requirements that match the content tables", () => {
    const missingMachineRequirement = createMutableContentSnapshot();
    delete missingMachineRequirement.unlocks.machineUnlocks.smelter;
    const missingRecipeRequirement = createMutableContentSnapshot();
    delete missingRecipeRequirement.unlocks.recipeUnlocks.copperIngot;
    const mismatchedMachineCost = createMutableContentSnapshot();
    mismatchedMachineCost.unlocks.machineUnlocks.smelter = {
      ...mismatchedMachineCost.unlocks.machineUnlocks.smelter,
      cost: 999,
    };
    const mismatchedRecipeCost = createMutableContentSnapshot();
    mismatchedRecipeCost.unlocks.recipeUnlocks.motor = {
      ...mismatchedRecipeCost.unlocks.recipeUnlocks.motor,
      cost: 1,
    };
    const unknownRequirement = createMutableContentSnapshot();
    unknownRequirement.unlocks.machineUnlocks.fabricator = {
      cost: 10,
      requiresMachines: [],
      requiresRecipes: [],
    };

    expect(validateContent(missingMachineRequirement)).toContain(
      'Machine "smelter" has a paid unlock and must declare unlock requirements.',
    );
    expect(validateContent(missingRecipeRequirement)).toContain(
      'Recipe "copperIngot" has a paid unlock and must declare unlock requirements.',
    );
    expect(validateContent(mismatchedMachineCost)).toContain(
      'Machine unlock cost for "smelter" must match its machine unlockCost 250.',
    );
    expect(validateContent(mismatchedRecipeCost)).toContain(
      'Recipe unlock cost for "motor" must match its recipe unlockCost 12000.',
    );
    expect(validateContent(unknownRequirement)).toContain(
      'Machine unlock requirements references unknown ID "fabricator".',
    );
  });

  it("rejects unusable unlock prerequisites", () => {
    const unknownMachine = createMutableContentSnapshot();
    unknownMachine.unlocks.machineUnlocks.assembler = {
      ...unknownMachine.unlocks.machineUnlocks.assembler,
      requiresMachines: ["teleporter"],
    };
    const unknownRecipe = createMutableContentSnapshot();
    unknownRecipe.unlocks.recipeUnlocks.gear = {
      ...unknownRecipe.unlocks.recipeUnlocks.gear,
      requiresRecipes: ["alloy"],
    };
    const selfDependent = createMutableContentSnapshot();
    selfDependent.unlocks.recipeUnlocks.wire = {
      ...selfDependent.unlocks.recipeUnlocks.wire,
      requiresRecipes: ["wire"],
    };
    const duplicate = createMutableContentSnapshot();
    duplicate.unlocks.recipeUnlocks.plate = {
      ...duplicate.unlocks.recipeUnlocks.plate,
      requiresRecipes: ["refinedStone", "refinedStone"],
    };
    const expensivePrerequisite = createMutableContentSnapshot();
    expensivePrerequisite.unlocks.recipeUnlocks.copperIngot = {
      ...expensivePrerequisite.unlocks.recipeUnlocks.copperIngot,
      cost: 100,
    };
    expensivePrerequisite.recipes.copperIngot = {
      ...expensivePrerequisite.recipes.copperIngot,
      unlockCost: 100,
    };
    const missingMachineRequirement = createMutableContentSnapshot();
    missingMachineRequirement.unlocks.recipeUnlocks.copperIngot = {
      ...missingMachineRequirement.unlocks.recipeUnlocks.copperIngot,
      requiresMachines: [],
    };
    const malformed = createMutableContentSnapshot();
    malformed.unlocks.machineUnlocks.silo = {
      cost: 150,
      requiresMachines: "none",
    } as unknown as MutableUnlockRequirement;

    expect(validateContent(unknownMachine)).toContain(
      'Machine unlock requirements "assembler" requiresMachines references unknown ID "teleporter".',
    );
    expect(validateContent(unknownRecipe)).toContain(
      'Recipe unlock requirements "gear" requiresRecipes references unknown ID "alloy".',
    );
    expect(validateContent(selfDependent)).toContain(
      'Recipe unlock requirements "wire" must not require itself.',
    );
    expect(validateContent(duplicate)).toContain(
      'Recipe unlock requirements "plate" duplicates requiresRecipes prerequisite "refinedStone".',
    );
    expect(validateContent(expensivePrerequisite)).toContain(
      'Recipe unlock requirements "copperIngot" cost must exceed prerequisite cost 250 of "smelter".',
    );
    expect(validateContent(missingMachineRequirement)).toContain(
      'Recipe unlock requirements for "copperIngot" must require its machine "smelter".',
    );
    expect(validateContent(malformed)).toContain(
      'Machine unlock requirements "silo" requiresMachines must be an array.',
    );
  });

  it("requires a recipe to unlock every recipe that produces one of its inputs", () => {
    const shipped = validateContent(deepFreeze(createMutableContentSnapshot()));
    expect(shipped).toEqual([]);

    const missingIronIngot = createMutableContentSnapshot();
    missingIronIngot.unlocks.recipeUnlocks.plate = {
      ...missingIronIngot.unlocks.recipeUnlocks.plate,
      requiresRecipes: ["refinedStone"],
    };
    const missingPlate = createMutableContentSnapshot();
    missingPlate.unlocks.recipeUnlocks.frame = {
      ...missingPlate.unlocks.recipeUnlocks.frame,
      requiresRecipes: ["gear"],
    };
    const missingGear = createMutableContentSnapshot();
    missingGear.unlocks.recipeUnlocks.circuit = {
      ...missingGear.unlocks.recipeUnlocks.circuit,
      requiresRecipes: ["wire"],
    };

    expect(validateContent(missingIronIngot)).toContain(
      'Recipe unlock requirements for "plate" must require "ironIngot" to produce input "ironIngot".',
    );
    expect(validateContent(missingPlate)).toContain(
      'Recipe unlock requirements for "frame" must require "plate" to produce input "plate".',
    );
    expect(validateContent(deepFreeze(missingGear))).toEqual([
      'Recipe unlock requirements for "circuit" must require "gear" to produce input "gear".',
    ]);
  });

  it("accepts a recipe input with no producer recipe", () => {
    expect(UNLOCKS.recipeUnlocks.copperIngot?.requiresRecipes).toEqual([]);
    expect(UNLOCKS.recipeUnlocks.ironIngot?.requiresRecipes).toEqual([]);
    expect(UNLOCKS.recipeUnlocks.refinedStone?.requiresRecipes).toEqual([]);
    expect(validateContent(deepFreeze(createMutableContentSnapshot()))).toEqual([]);
  });

  it("accepts a recipe that consumes its own output without requiring itself", () => {
    const selfConsuming = createMutableContentSnapshot();
    selfConsuming.recipes.wire = {
      ...selfConsuming.recipes.wire,
      inputs: { wire: 1 },
    };

    expect(validateContent(deepFreeze(selfConsuming))).toEqual([]);
  });

  it("requires a positive integer cost for every machine a level can affect", () => {
    expect(validateContent(deepFreeze(createMutableContentSnapshot()))).toEqual([]);

    const freeExtractor = createMutableContentSnapshot();
    freeExtractor.machines.extractor = { ...freeExtractor.machines.extractor, cost: 0 };
    const fractionalSmelter = createMutableContentSnapshot();
    fractionalSmelter.machines.smelter = { ...fractionalSmelter.machines.smelter, cost: 12.5 };
    const negativeAssembler = createMutableContentSnapshot();
    negativeAssembler.machines.assembler = {
      ...negativeAssembler.machines.assembler,
      cost: -1,
    };
    const freeBelt = createMutableContentSnapshot();
    freeBelt.machines.belt = { ...freeBelt.machines.belt, cost: 0 };

    expect(validateContent(deepFreeze(freeExtractor))).toContain(
      'Machine "extractor" must have a positive integer cost because a level upgrade is priced from it.',
    );
    expect(validateContent(deepFreeze(fractionalSmelter))).toContain(
      'Machine "smelter" must have a positive integer cost because a level upgrade is priced from it.',
    );
    expect(validateContent(deepFreeze(negativeAssembler))).toContain(
      'Machine "assembler" must have a positive integer cost because a level upgrade is priced from it.',
    );
    expect(validateContent(deepFreeze(freeBelt))).not.toContain(
      'Machine "belt" must have a positive integer cost because a level upgrade is priced from it.',
    );
  });

  it("declares the sale terminal in the machine table and nowhere else", () => {
    expect(getMachine("depot")?.saleTerminal).toBe(true);
    for (const type of ["extractor", "belt", "smelter", "assembler", "silo"] as const) {
      expect(getMachine(type)?.saleTerminal).toBeUndefined();
    }
  });

  it("requires a sale terminal to accept every resource on an input port", () => {
    expect(validateContent(deepFreeze(createMutableContentSnapshot()))).toEqual([]);

    const narrowDepot = createMutableContentSnapshot();
    narrowDepot.machines.depot = {
      ...narrowDepot.machines.depot,
      ports: [
        {
          id: "input",
          kind: "input",
          offset: { x: -1, y: 0 },
          accepts: ["copperOre"],
        },
      ],
    };

    expect(validateContent(deepFreeze(narrowDepot))).toContain(
      'Machine "depot" must accept every resource on an input port because a sale terminal sells everything it receives.',
    );
  });

  it("rejects a non boolean sale terminal flag", () => {
    const flag = createMutableContentSnapshot();
    flag.machines.depot = { ...flag.machines.depot, saleTerminal: "yes" };

    expect(validateContent(deepFreeze(flag))).toContain(
      'Machine "depot" saleTerminal must be a boolean.',
    );
  });

  it("reports no producer gap for a declared cycle between two recipes", () => {
    const cycle = createMutableContentSnapshot();
    cycle.recipes.wire = { ...cycle.recipes.wire, inputs: { gear: 1 } };
    cycle.recipes.gear = { ...cycle.recipes.gear, inputs: { wire: 1 } };
    cycle.unlocks.recipeUnlocks.wire = {
      ...cycle.unlocks.recipeUnlocks.wire,
      requiresRecipes: ["copperIngot", "gear"],
    };
    cycle.unlocks.recipeUnlocks.gear = {
      ...cycle.unlocks.recipeUnlocks.gear,
      requiresRecipes: ["ironIngot", "wire"],
    };

    const errors = validateContent(deepFreeze(cycle));

    expect(errors.some((error) => error.includes("to produce input"))).toBe(false);
    expect(errors).toEqual([
      'Recipe unlock requirements "wire" cost must exceed prerequisite cost 1200 of "gear".',
    ]);
  });

  it("requires every smelter recipe input to be accepted by some smelter input port", () => {
    const snapshot = createMutableContentSnapshot();
    const smelterPorts = snapshot.machines.smelter.ports as Array<Record<string, unknown>>;
    const smelterInputs = smelterPorts
      .filter((port) => port.kind === "input")
      .map((port) => ({ ...port, accepts: ["copperOre"] }));
    smelterPorts.length = 0;
    smelterPorts.push(...smelterInputs, smelterPorts.find((port) => port.kind === "output")!);
    const assemblerSnapshot = createMutableContentSnapshot();
    const assemblerPorts = assemblerSnapshot.machines.assembler.ports as Array<Record<string, unknown>>;
    assemblerPorts[1] = { ...assemblerPorts[1], offset: assemblerPorts[0].offset };

    expect(validateContent(snapshot)).toContain(
      'Recipe "ironIngot" input "coal" is not accepted by smelter input port "input-1".',
    );
    expect(validateContent(assemblerSnapshot)).toContain(
      'Machine "assembler" must use unique adjacent port offsets.',
    );
  });

  it("allows shared storage only on the 100-unit silo", () => {
    const separateSilo = createMutableContentSnapshot();
    separateSilo.machines.silo = { ...separateSilo.machines.silo, bufferMode: "separate" };
    const wrongCapacity = createMutableContentSnapshot();
    wrongCapacity.machines.silo = { ...wrongCapacity.machines.silo, storageCapacity: 99 };
    const sharedBelt = createMutableContentSnapshot();
    sharedBelt.machines.belt = { ...sharedBelt.machines.belt, bufferMode: "shared", storageCapacity: 10 };

    expect(validateContent(separateSilo)).toContain('Machine "silo" must use shared buffer mode.');
    expect(validateContent(wrongCapacity)).toContain('Machine "silo" storage capacity must be exactly 100.');
    expect(validateContent(sharedBelt)).toContain('Machine "belt" must use separate buffer mode.');
    expect(validateContent(sharedBelt)).toContain('Machine "belt" must not define storageCapacity.');
  });

  it("keeps recipe duration authoritative over the machine timing fallback", () => {
    const invalidFallback = createMutableContentSnapshot();
    invalidFallback.machines.smelter = {
      ...invalidFallback.machines.smelter,
      defaultProcessTicks: 0,
    };
    const invalidRecipeDuration = createMutableContentSnapshot();
    invalidRecipeDuration.recipes.copperIngot = {
      ...invalidRecipeDuration.recipes.copperIngot,
      durationTicks: 0,
    };

    expect(MACHINES.assembler.defaultProcessTicks).toBe(30);
    expect(RECIPES.circuit.durationTicks).toBe(40);
    expect(validateContent(deepFreeze(createMutableContentSnapshot()))).toEqual([]);
    expect(validateContent(invalidFallback)).toContain(
      'Machine "smelter" must have a positive integer defaultProcessTicks.',
    );
    expect(validateContent(invalidRecipeDuration)).toContain(
      'Recipe "copperIngot" must have a positive integer durationTicks.',
    );
  });
});
