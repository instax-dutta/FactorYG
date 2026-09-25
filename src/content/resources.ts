import { deepFreeze } from "./freeze";
import type { ResourceDefinition, ResourceId } from "./types";

export type { ResourceDefinition, ResourceId, ResourceTier } from "./types";

export const RESOURCES = deepFreeze({
  copperOre: {
    id: "copperOre",
    tier: 0,
    label: "Copper Ore",
    sellValue: 1,
    iconKey: "resource.copperOre",
    color: "#c98245",
  },
  ironOre: {
    id: "ironOre",
    tier: 0,
    label: "Iron Ore",
    sellValue: 1,
    iconKey: "resource.ironOre",
    color: "#8fa6b8",
  },
  coal: {
    id: "coal",
    tier: 0,
    label: "Coal",
    sellValue: 2,
    iconKey: "resource.coal",
    color: "#343a40",
  },
  stone: {
    id: "stone",
    tier: 0,
    label: "Stone",
    sellValue: 1,
    iconKey: "resource.stone",
    color: "#8d938e",
  },
  copperIngot: {
    id: "copperIngot",
    tier: 1,
    label: "Copper Ingot",
    sellValue: 6,
    iconKey: "resource.copperIngot",
    color: "#e0a458",
  },
  ironIngot: {
    id: "ironIngot",
    tier: 1,
    label: "Iron Ingot",
    sellValue: 10,
    iconKey: "resource.ironIngot",
    color: "#c7d0d9",
  },
  refinedStone: {
    id: "refinedStone",
    tier: 1,
    label: "Refined Stone",
    sellValue: 5,
    iconKey: "resource.refinedStone",
    color: "#b6c2c9",
  },
  wire: {
    id: "wire",
    tier: 2,
    label: "Wire",
    sellValue: 24,
    iconKey: "resource.wire",
    color: "#f2c14e",
  },
  gear: {
    id: "gear",
    tier: 2,
    label: "Gear",
    sellValue: 30,
    iconKey: "resource.gear",
    color: "#6f8494",
  },
  plate: {
    id: "plate",
    tier: 2,
    label: "Plate",
    sellValue: 36,
    iconKey: "resource.plate",
    color: "#4d6875",
  },
  circuit: {
    id: "circuit",
    tier: 3,
    label: "Circuit",
    sellValue: 120,
    iconKey: "resource.circuit",
    color: "#36c5b5",
  },
  frame: {
    id: "frame",
    tier: 3,
    label: "Frame",
    sellValue: 180,
    iconKey: "resource.frame",
    color: "#58758a",
  },
  motor: {
    id: "motor",
    tier: 3,
    label: "Motor",
    sellValue: 600,
    iconKey: "resource.motor",
    color: "#d85b3f",
  },
} satisfies Record<ResourceId, ResourceDefinition>);

export function getResource(id: string): ResourceDefinition | undefined {
  return Object.hasOwn(RESOURCES, id) ? RESOURCES[id as ResourceId] : undefined;
}
