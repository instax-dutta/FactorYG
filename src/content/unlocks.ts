import { deepFreeze } from "./freeze";
import type { UnlockTable } from "./types";

export type { UnlockTable } from "./types";

export const UNLOCKS = deepFreeze({
  machines: ["extractor", "belt", "depot"],
  recipes: [],
} satisfies UnlockTable);
