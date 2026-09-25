import { deepFreeze } from "./freeze";
import type { UnlockTable } from "./types";

export type { UnlockRequirement, UnlockTable } from "./types";

export const UNLOCKS = deepFreeze({
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
    plate: { cost: 1_600, requiresMachines: ["assembler"], requiresRecipes: ["refinedStone"] },
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
} satisfies UnlockTable);
