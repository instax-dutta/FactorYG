import type { MachineType } from "./machines";
import type { RecipeId } from "./recipes";

export interface UnlockTable {
  machines: readonly MachineType[];
  recipes: readonly RecipeId[];
}

export const UNLOCKS = {
  machines: ["extractor", "belt", "depot"],
  recipes: [],
} as const satisfies UnlockTable;
