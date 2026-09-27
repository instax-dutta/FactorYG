import type { MachineType } from "../content/types";
import type { SaveFailureReason } from "../persistence/migrate";

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
  insufficientLifetimeCurrency: "This run has not earned a prestige yet.",
  outOfRange: "That is not a plot size this game can build.",
  invalidGridStep: "The plot only grows in fixed steps.",
  expansionLocked: "Prestige to unlock more plot.",
  gridShrink: "The plot cannot shrink.",
  gridAlreadyExpanded: "The plot is already that size.",
  entityOutOfBounds: "Something is standing outside the plot.",
  nodeOutOfBounds: "The plot does not cover the whole world.",
  insufficientExpansionCost: "The plot costs more currency than this run holds.",
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

export const saveRecoveryFallback =
  "The saved run could not be read, for a reason this build does not name.";

const saveRecoveryMessages: Readonly<Record<SaveFailureReason, string>> = {
  malformedJson: "The saved run was damaged partway through and could not be read back.",
  unsupportedVersion: "The saved run was written by a version of the game this build cannot read.",
  invalidSave: "The saved run was not in a shape this game can read.",
  storageUnavailable: "This browser will not let the game read saved runs at all.",
  storageError: "This browser refused to read the saved run back.",
};

export function getSaveRecoveryMessage(reason: SaveFailureReason): string;
export function getSaveRecoveryMessage(reason: string | undefined): string;
export function getSaveRecoveryMessage(reason: string | undefined): string {
  if (reason === undefined) {
    return saveRecoveryFallback;
  }

  return saveRecoveryMessages[reason as SaveFailureReason] ?? saveRecoveryFallback;
}
