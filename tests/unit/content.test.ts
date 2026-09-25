import { describe, expect, it } from "vitest";
import { MACHINES, getMachine, type MachineDefinition } from "../../src/content/machines";
import { RECIPES, getRecipe } from "../../src/content/recipes";
import { RESOURCES, getResource, type ResourceId } from "../../src/content/resources";
import { UNLOCKS } from "../../src/content/unlocks";
import { validateContent } from "../../src/content/validation";

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
      Object.values(MACHINES).map(
        ({
          type,
          footprint,
          cost,
          unlockCost,
          inputBuffer,
          outputBuffer,
          processTicks,
          spriteKey,
          activeSpriteKey,
        }) => ({
          type,
          footprint,
          cost,
          unlockCost,
          inputBuffer,
          outputBuffer,
          processTicks,
          spriteKey,
          activeSpriteKey,
        }),
      ),
    ).toEqual([
      {
        type: "extractor",
        footprint: { width: 1, height: 1 },
        cost: 50,
        unlockCost: 0,
        inputBuffer: 0,
        outputBuffer: 1,
        processTicks: 20,
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
        processTicks: 10,
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
        processTicks: 20,
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
        processTicks: 30,
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
        processTicks: 10,
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
        processTicks: 1,
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
          id: "input",
          kind: "input",
          offset: { x: -1, y: 0 },
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

  it("starts with only the raw-loop machines unlocked", () => {
    expect(UNLOCKS).toEqual({
      machines: ["extractor", "belt", "depot"],
      recipes: [],
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

  it("validates the shipped tables and reports human-readable integrity errors", () => {
    const invalidRecipes = {
      ...RECIPES,
      copperIngot: {
        ...RECIPES.copperIngot,
        inputs: { missingResource: 1 } as Partial<Record<ResourceId, number>>,
      },
    };

    expect(validateContent()).toEqual([]);
    expect(
      validateContent({
        resources: RESOURCES,
        machines: MACHINES,
        recipes: invalidRecipes,
        unlocks: UNLOCKS,
      }),
    ).toContain('Recipe "copperIngot" references unknown resource "missingResource".');
  });
});
