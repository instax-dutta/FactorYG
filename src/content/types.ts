export type ResourceId =
  | "copperOre"
  | "ironOre"
  | "coal"
  | "stone"
  | "copperIngot"
  | "ironIngot"
  | "refinedStone"
  | "wire"
  | "gear"
  | "plate"
  | "circuit"
  | "frame"
  | "motor";

export type MachineType = "extractor" | "belt" | "smelter" | "assembler" | "silo" | "depot";

export type RecipeId =
  | "copperIngot"
  | "ironIngot"
  | "refinedStone"
  | "wire"
  | "gear"
  | "plate"
  | "circuit"
  | "frame"
  | "motor";

export type ResourceTier = 0 | 1 | 2 | 3;

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface ResourceDefinition {
  readonly id: ResourceId;
  readonly tier: ResourceTier;
  readonly label: string;
  readonly sellValue: number;
  readonly iconKey: string;
  readonly color: string;
}

export interface PortDefinition {
  readonly id: string;
  readonly kind: "input" | "output";
  readonly offset: GridPoint;
  readonly accepts?: readonly ResourceId[];
  readonly produces?: ResourceId;
}

export interface MachineDefinition {
  readonly type: MachineType;
  readonly footprint: { readonly width: 1; readonly height: 1 };
  readonly cost: number;
  readonly unlockCost: number;
  readonly inputBuffer: number;
  readonly outputBuffer: number;
  readonly bufferMode: "separate" | "shared";
  readonly storageCapacity?: number;
  readonly defaultProcessTicks: number;
  readonly ports: readonly PortDefinition[];
  readonly spriteKey: string;
  readonly activeSpriteKey?: string;
}

export interface RecipeDefinition {
  readonly id: RecipeId;
  readonly machine: "smelter" | "assembler";
  readonly inputs: Readonly<Partial<Record<ResourceId, number>>>;
  readonly output: { readonly resource: ResourceId; readonly amount: number };
  readonly durationTicks: number;
  readonly unlockCost: number;
  readonly sellValue: number;
}

export interface UnlockRequirement {
  readonly cost: number;
  readonly requiresMachines: readonly MachineType[];
  readonly requiresRecipes: readonly RecipeId[];
}

export interface UnlockTable {
  readonly machines: readonly MachineType[];
  readonly recipes: readonly RecipeId[];
  readonly machineUnlocks: Readonly<Partial<Record<MachineType, UnlockRequirement>>>;
  readonly recipeUnlocks: Readonly<Partial<Record<RecipeId, UnlockRequirement>>>;
}
