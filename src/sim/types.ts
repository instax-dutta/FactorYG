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

export type MachineType =
  | "extractor"
  | "belt"
  | "smelter"
  | "assembler"
  | "silo"
  | "depot";

export type Rotation = 0 | 90 | 180 | 270;

export interface GridPoint {
  x: number;
  y: number;
}

export interface ResourceDefinition {
  id: ResourceId;
  tier: 0 | 1 | 2 | 3;
  label: string;
  sellValue: number;
  iconKey: string;
  color: string;
}

export interface PortDefinition {
  id: string;
  kind: "input" | "output";
  offset: GridPoint;
  accepts?: ResourceId[];
  produces?: ResourceId;
}

export interface MachineDefinition {
  type: MachineType;
  footprint: { width: 1; height: 1 };
  cost: number;
  unlockCost: number;
  inputBuffer: number;
  outputBuffer: number;
  processTicks: number;
  ports: PortDefinition[];
  spriteKey: string;
  activeSpriteKey?: string;
}

export interface RecipeDefinition {
  id: string;
  machine: "smelter" | "assembler";
  inputs: Partial<Record<ResourceId, number>>;
  output: { resource: ResourceId; amount: number };
  durationTicks: number;
  unlockCost: number;
  sellValue: number;
}

export interface Entity {
  id: string;
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  resourceNode?: ResourceId;
  recipeId?: string;
}

export interface ResourceNode {
  id: string;
  resource: ResourceId;
  x: number;
  y: number;
}

export interface MachineRuntime {
  entityId: string;
  progressTicks: number;
  input: Partial<Record<ResourceId, number>>;
  output: Partial<Record<ResourceId, number>>;
  active: boolean;
}

export interface BeltCell {
  entityId: string;
  item?: ResourceId;
  progress: number;
}

export interface GridState {
  width: number;
  height: number;
  tileSizePx: 64;
  nodes: ResourceNode[];
  entities: Entity[];
  machines: Record<string, MachineRuntime>;
  belts: Record<string, BeltCell>;
}

export interface PrestigeState {
  points: number;
  totalPrestiges: number;
  permanentMultipliers: {
    productionSpeed: number;
    sellValue: number;
  };
}

export interface ProductionChainSummary {
  id: string;
  outputResource: ResourceId;
  steadyStateThroughput: number;
  sellValue: number;
}

export interface SaveGame {
  version: 1;
  lastSavedAt: number;
  currency: number;
  lifetimeCurrency: number;
  prestige: PrestigeState;
  unlocked: {
    machines: MachineType[];
    recipes: string[];
  };
  grid: GridState;
  productionChains: Record<string, ProductionChainSummary>;
}

export interface SimulationState extends SaveGame {
  nextEntitySequence: number;
  selectedEntityId?: string;
  placementMode?: MachineType;
  pendingRotation: Rotation;
  notifications: Notification[];
}

export interface SimulationSnapshot {
  currency: number;
  currencyPerSecond: number;
  prestigePoints: number;
  prestigeReady: boolean;
  unlockedMachines: MachineType[];
  unlockedRecipes: string[];
  selectedEntity?: Entity;
  selectedThroughput: number;
  placementMode?: MachineType;
  pendingRotation: Rotation;
  notifications: Notification[];
  offlineSummary?: OfflineSummary;
}

export interface OfflineSummary {
  elapsedSeconds: number;
  cappedSeconds: number;
  earnedCurrency: number;
  chainUnits: Partial<Record<ResourceId, number>>;
}

export interface Notification {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  message: string;
  createdAt: number;
}

export type RenderEvent =
  | { type: "entityPlaced"; entity: Entity }
  | { type: "entityRemoved"; entityId: string }
  | { type: "machineStateChanged"; entityId: string; active: boolean }
  | { type: "saleCompleted"; entityId: string; resource: ResourceId; currency: number; worldX: number; worldY: number };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

export type SimulationCommand =
  | { type: "placeEntity"; machine: MachineType; x: number; y: number; rotation: Rotation; resourceNode?: ResourceId; recipeId?: string }
  | { type: "demolishEntity"; entityId: string }
  | { type: "rotatePlacement" }
  | { type: "selectEntity"; entityId?: string }
  | { type: "setPlacementMode"; machine?: MachineType }
  | { type: "upgradeEntity"; entityId: string }
  | { type: "unlockRecipe"; recipeId: string }
  | { type: "prestige" }
  | { type: "expandGrid"; width: number; height: number }
  | { type: "dismissOfflineSummary" }
  | { type: "dismissNotification"; id: string };
