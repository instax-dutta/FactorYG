import type { MachineType } from "../content/types";

export const machineLabels: Readonly<Record<MachineType, string>> = {
  extractor: "Extractor",
  belt: "Conveyor Belt",
  smelter: "Smelter",
  assembler: "Assembler",
  silo: "Storage Silo",
  depot: "Shipping Depot",
};

const commandReasonMessages: Readonly<Record<string, string>> = {
  unknownUnlock: "No unlock requirement exists for this entry.",
  alreadyUnlocked: "Already unlocked.",
  prerequisiteLocked: "Unlock the prerequisites first.",
  insufficientCurrency: "Not enough currency.",
  entityNotFound: "That entity is gone.",
  unsupportedMachine: "This machine cannot be upgraded.",
  notImplemented: "That action is not available yet.",
};

export function getMachineLabel(type: string): string {
  return machineLabels[type as MachineType] ?? type;
}

export function getCommandReasonMessage(reason: string | undefined): string {
  if (reason === undefined) {
    return "The store refused that action.";
  }

  return commandReasonMessages[reason] ?? `The store refused that action: ${reason}.`;
}
