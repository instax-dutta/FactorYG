import type { ResourceId } from "./resources";

export type MachineType = "extractor" | "belt" | "smelter" | "assembler" | "silo" | "depot";

export interface GridPoint {
  x: number;
  y: number;
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

const RAW_RESOURCES: ResourceId[] = ["copperOre", "ironOre", "coal", "stone"];
const PROCESSED_RESOURCES: ResourceId[] = [
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
const ALL_RESOURCES: ResourceId[] = [...RAW_RESOURCES, ...PROCESSED_RESOURCES];

export const MACHINES = {
  extractor: {
    type: "extractor",
    footprint: { width: 1, height: 1 },
    cost: 50,
    unlockCost: 0,
    inputBuffer: 0,
    outputBuffer: 1,
    processTicks: 20,
    ports: [
      {
        id: "output",
        kind: "output",
        offset: { x: 1, y: 0 },
      },
    ],
    spriteKey: "machine.extractor.idle",
    activeSpriteKey: "machine.extractor.active",
  },
  belt: {
    type: "belt",
    footprint: { width: 1, height: 1 },
    cost: 10,
    unlockCost: 0,
    inputBuffer: 1,
    outputBuffer: 1,
    processTicks: 10,
    ports: [
      {
        id: "input",
        kind: "input",
        offset: { x: -1, y: 0 },
        accepts: ALL_RESOURCES,
      },
      {
        id: "output",
        kind: "output",
        offset: { x: 1, y: 0 },
      },
    ],
    spriteKey: "machine.belt.idle",
    activeSpriteKey: "machine.belt.active",
  },
  smelter: {
    type: "smelter",
    footprint: { width: 1, height: 1 },
    cost: 250,
    unlockCost: 250,
    inputBuffer: 10,
    outputBuffer: 10,
    processTicks: 20,
    ports: [
      {
        id: "input",
        kind: "input",
        offset: { x: -1, y: 0 },
        accepts: RAW_RESOURCES,
      },
      {
        id: "output",
        kind: "output",
        offset: { x: 1, y: 0 },
      },
    ],
    spriteKey: "machine.smelter.idle",
    activeSpriteKey: "machine.smelter.active",
  },
  assembler: {
    type: "assembler",
    footprint: { width: 1, height: 1 },
    cost: 500,
    unlockCost: 500,
    inputBuffer: 20,
    outputBuffer: 10,
    processTicks: 30,
    ports: [
      {
        id: "input-1",
        kind: "input",
        offset: { x: -1, y: 0 },
        accepts: PROCESSED_RESOURCES,
      },
      {
        id: "input-2",
        kind: "input",
        offset: { x: 0, y: -1 },
        accepts: PROCESSED_RESOURCES,
      },
      {
        id: "output",
        kind: "output",
        offset: { x: 1, y: 0 },
      },
    ],
    spriteKey: "machine.assembler.idle",
    activeSpriteKey: "machine.assembler.active",
  },
  silo: {
    type: "silo",
    footprint: { width: 1, height: 1 },
    cost: 150,
    unlockCost: 150,
    inputBuffer: 100,
    outputBuffer: 100,
    processTicks: 10,
    ports: [
      {
        id: "input",
        kind: "input",
        offset: { x: -1, y: 0 },
        accepts: ALL_RESOURCES,
      },
      {
        id: "output",
        kind: "output",
        offset: { x: 1, y: 0 },
      },
    ],
    spriteKey: "machine.silo.idle",
    activeSpriteKey: "machine.silo.active",
  },
  depot: {
    type: "depot",
    footprint: { width: 1, height: 1 },
    cost: 100,
    unlockCost: 0,
    inputBuffer: 100,
    outputBuffer: 0,
    processTicks: 1,
    ports: [
      {
        id: "input",
        kind: "input",
        offset: { x: -1, y: 0 },
        accepts: ALL_RESOURCES,
      },
    ],
    spriteKey: "machine.depot.idle",
    activeSpriteKey: "machine.depot.active",
  },
} satisfies Record<MachineType, MachineDefinition>;

export function getMachine(type: string): MachineDefinition | undefined {
  return Object.hasOwn(MACHINES, type) ? MACHINES[type as MachineType] : undefined;
}
