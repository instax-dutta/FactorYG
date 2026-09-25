import { deepFreeze } from "./freeze";
import type { RecipeDefinition, RecipeId } from "./types";

export type { RecipeDefinition, RecipeId } from "./types";

export const RECIPES = deepFreeze({
  copperIngot: {
    id: "copperIngot",
    machine: "smelter",
    inputs: { copperOre: 1 },
    output: { resource: "copperIngot", amount: 1 },
    durationTicks: 20,
    unlockCost: 300,
    sellValue: 6,
  },
  ironIngot: {
    id: "ironIngot",
    machine: "smelter",
    inputs: { ironOre: 1, coal: 1 },
    output: { resource: "ironIngot", amount: 1 },
    durationTicks: 30,
    unlockCost: 450,
    sellValue: 10,
  },
  refinedStone: {
    id: "refinedStone",
    machine: "smelter",
    inputs: { stone: 1 },
    output: { resource: "refinedStone", amount: 1 },
    durationTicks: 20,
    unlockCost: 600,
    sellValue: 5,
  },
  wire: {
    id: "wire",
    machine: "assembler",
    inputs: { copperIngot: 2 },
    output: { resource: "wire", amount: 1 },
    durationTicks: 30,
    unlockCost: 900,
    sellValue: 24,
  },
  gear: {
    id: "gear",
    machine: "assembler",
    inputs: { ironIngot: 2 },
    output: { resource: "gear", amount: 1 },
    durationTicks: 30,
    unlockCost: 1_200,
    sellValue: 30,
  },
  plate: {
    id: "plate",
    machine: "assembler",
    inputs: { ironIngot: 1, refinedStone: 1 },
    output: { resource: "plate", amount: 1 },
    durationTicks: 30,
    unlockCost: 1_600,
    sellValue: 36,
  },
  circuit: {
    id: "circuit",
    machine: "assembler",
    inputs: { wire: 1, gear: 1 },
    output: { resource: "circuit", amount: 1 },
    durationTicks: 40,
    unlockCost: 4_000,
    sellValue: 120,
  },
  frame: {
    id: "frame",
    machine: "assembler",
    inputs: { plate: 2, gear: 1 },
    output: { resource: "frame", amount: 1 },
    durationTicks: 40,
    unlockCost: 6_000,
    sellValue: 180,
  },
  motor: {
    id: "motor",
    machine: "assembler",
    inputs: { circuit: 1, frame: 1 },
    output: { resource: "motor", amount: 1 },
    durationTicks: 50,
    unlockCost: 12_000,
    sellValue: 600,
  },
} satisfies Record<RecipeId, RecipeDefinition>);

export function getRecipe(id: string): RecipeDefinition | undefined {
  return Object.hasOwn(RECIPES, id) ? RECIPES[id as RecipeId] : undefined;
}
