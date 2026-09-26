import { getUpgradeLevel, isLevelAffected } from "../content/machines";
import { UNLOCKS } from "../content/unlocks";
import type { UnlockRequirement } from "../content/types";
import { PRESTIGE_PRODUCTION_BONUS_PER_POINT, PRESTIGE_SELL_BONUS_PER_POINT } from "./constants";
import { createResetState } from "./initialState";
import { getUpgradeCost } from "./machines";
import { calculatePrestigePoints, canPrestige } from "./prestige";
import type {
  CommandResult,
  Entity,
  MachineType,
  Notification,
  PrestigeState,
  RenderEvent,
  SimulationCommand,
  SimulationState,
} from "./types";

export type UnlockMachineCommand = Extract<SimulationCommand, { type: "unlockMachine" }>;
export type UnlockRecipeCommand = Extract<SimulationCommand, { type: "unlockRecipe" }>;

export type UnlockTarget =
  | { readonly kind: "machine"; readonly machine: string }
  | { readonly kind: "recipe"; readonly recipeId: string };

export interface UnlockApplication {
  state: SimulationState;
  changed: boolean;
  result: CommandResult;
  notification?: Notification;
}

export function canUnlock(state: SimulationState, target: UnlockTarget): CommandResult {
  const requirement = findRequirement(target);
  if (requirement === undefined) {
    return { ok: false, reason: "unknownUnlock" };
  }

  if (isUnlocked(state, target)) {
    return { ok: false, reason: "alreadyUnlocked" };
  }

  if (!hasPrerequisites(state, requirement)) {
    return { ok: false, reason: "prerequisiteLocked" };
  }

  if (state.currency < requirement.cost) {
    return { ok: false, reason: "insufficientCurrency" };
  }

  return { ok: true };
}

export function applyUnlock(state: SimulationState, target: UnlockTarget): UnlockApplication {
  const result = canUnlock(state, target);
  if (!result.ok) {
    return { state, changed: false, result };
  }

  const requirement = findRequirement(target);
  if (requirement === undefined) {
    return { state, changed: false, result: { ok: false, reason: "unknownUnlock" } };
  }

  const notification = createNotification(state, target);

  return {
    state: {
      ...state,
      currency: state.currency - requirement.cost,
      unlocked: addUnlocked(state.unlocked, target),
      notifications: [...state.notifications, notification],
    },
    changed: true,
    result: { ok: true },
    notification,
  };
}

export function unlockMachine(
  state: SimulationState,
  command: UnlockMachineCommand,
): UnlockApplication {
  return applyUnlock(state, { kind: "machine", machine: command.machine });
}

export function unlockRecipe(
  state: SimulationState,
  command: UnlockRecipeCommand,
): UnlockApplication {
  return applyUnlock(state, { kind: "recipe", recipeId: command.recipeId });
}

function findRequirement(target: UnlockTarget): UnlockRequirement | undefined {
  const table =
    target.kind === "machine" ? UNLOCKS.machineUnlocks : UNLOCKS.recipeUnlocks;
  const key = target.kind === "machine" ? target.machine : target.recipeId;

  if (!Object.hasOwn(table, key)) {
    return undefined;
  }

  return (table as Readonly<Record<string, UnlockRequirement>>)[key];
}

function isUnlocked(state: SimulationState, target: UnlockTarget): boolean {
  if (target.kind === "machine") {
    return state.unlocked.machines.includes(target.machine as MachineType);
  }

  return state.unlocked.recipes.includes(target.recipeId);
}

function hasPrerequisites(
  state: SimulationState,
  requirement: UnlockRequirement,
): boolean {
  return (
    requirement.requiresMachines.every((machine) => state.unlocked.machines.includes(machine)) &&
    requirement.requiresRecipes.every((recipe) => state.unlocked.recipes.includes(recipe))
  );
}

function addUnlocked(
  unlocked: SimulationState["unlocked"],
  target: UnlockTarget,
): SimulationState["unlocked"] {
  if (target.kind === "machine") {
    return {
      ...unlocked,
      machines: [...unlocked.machines, target.machine as MachineType],
    };
  }

  return {
    ...unlocked,
    recipes: [...unlocked.recipes, target.recipeId],
  };
}

function createNotification(state: SimulationState, target: UnlockTarget): Notification {
  if (target.kind === "machine") {
    return {
      id: `unlock-machine-${target.machine}`,
      kind: "success",
      message: `Unlocked machine: ${target.machine}`,
      createdAt: state.tickCount,
    };
  }

  return {
    id: `unlock-recipe-${target.recipeId}`,
    kind: "success",
    message: `Unlocked recipe: ${target.recipeId}`,
    createdAt: state.tickCount,
  };
}

export interface UpgradeApplication {
  state: SimulationState;
  changed: boolean;
  result: CommandResult;
  notification?: Notification;
}

export function canUpgrade(state: SimulationState, entityId: string): CommandResult {
  const entity = findEntity(state, entityId);
  if (entity === undefined) {
    return { ok: false, reason: "entityNotFound" };
  }

  if (!isLevelAffected(entity.type)) {
    return { ok: false, reason: "unsupportedMachine" };
  }

  if (state.currency < getUpgradeCost(entity)) {
    return { ok: false, reason: "insufficientCurrency" };
  }

  return { ok: true };
}

export function upgradeEntity(state: SimulationState, entityId: string): UpgradeApplication {
  const result = canUpgrade(state, entityId);
  if (!result.ok) {
    return { state, changed: false, result };
  }

  const entity = findEntity(state, entityId);
  if (entity === undefined) {
    return { state, changed: false, result: { ok: false, reason: "entityNotFound" } };
  }

  const level = getUpgradeLevel(entity.level + 1);
  const upgraded: Entity = { ...entity, level };
  const notification: Notification = {
    id: `upgrade-${entityId}-l${level}`,
    kind: "success",
    message: `Upgraded ${entity.type} to level ${level}`,
    createdAt: state.tickCount,
  };

  return {
    state: {
      ...state,
      currency: state.currency - getUpgradeCost(entity),
      grid: {
        ...state.grid,
        entities: state.grid.entities.map((candidate) =>
          candidate.id === entityId ? upgraded : candidate,
        ),
      },
      notifications: [...state.notifications, notification],
    },
    changed: true,
    result: { ok: true },
    notification,
  };
}

function findEntity(state: SimulationState, entityId: string): Entity | undefined {
  return state.grid.entities.find((candidate) => candidate.id === entityId);
}

export type PermanentMultipliers = PrestigeState["permanentMultipliers"];

export interface PrestigeApplication {
  state: SimulationState;
  changed: boolean;
  result: CommandResult;
  awardedPoints?: number;
  notification?: Notification;
  events?: RenderEvent[];
}

export function getPermanentMultipliers(state: SimulationState): PermanentMultipliers {
  return permanentMultipliersForPoints(state.prestige.points);
}

export function canResetPrestige(state: SimulationState): CommandResult {
  return canPrestige(state) ? { ok: true } : { ok: false, reason: "insufficientLifetimeCurrency" };
}

export function performPrestige(state: SimulationState): PrestigeApplication {
  const result = canResetPrestige(state);
  if (!result.ok) {
    return { state, changed: false, result };
  }

  const awardedPoints = calculatePrestigePoints(state.lifetimeCurrency);
  const permanent: PrestigeState = {
    points: state.prestige.points + awardedPoints,
    totalPrestiges: state.prestige.totalPrestiges + 1,
    permanentMultipliers: permanentMultipliersForPoints(state.prestige.points + awardedPoints),
  };
  const notification: Notification = {
    id: `prestige-${permanent.totalPrestiges}`,
    kind: "success",
    message: `Prestige complete: +${awardedPoints} prestige points`,
    createdAt: state.tickCount,
  };

  return {
    state: { ...createResetState(permanent), notifications: [notification] },
    changed: true,
    result: { ok: true },
    awardedPoints,
    notification,
    events: removalEventsFor(state),
  };
}

function removalEventsFor(state: SimulationState): RenderEvent[] {
  return state.grid.entities.map((entity) => ({
    type: "entityRemoved",
    entityId: entity.id,
  }));
}

function permanentMultipliersForPoints(points: number): PermanentMultipliers {
  const earned = Number.isFinite(points) ? Math.max(0, points) : 0;
  return {
    productionSpeed: 1 + earned * PRESTIGE_PRODUCTION_BONUS_PER_POINT,
    sellValue: 1 + earned * PRESTIGE_SELL_BONUS_PER_POINT,
  };
}
