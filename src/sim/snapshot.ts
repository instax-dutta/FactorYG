import { PRESTIGE_THRESHOLD } from "./constants";
import type {
  Entity,
  MachineType,
  Notification,
  SimulationSnapshot,
  SimulationState,
} from "./types";

export function createSnapshot(state: SimulationState): SimulationSnapshot {
  const unlockedMachines: MachineType[] = [...state.unlocked.machines];
  const unlockedRecipes: string[] = [...state.unlocked.recipes];
  Object.freeze(unlockedMachines);
  Object.freeze(unlockedRecipes);

  const selectedEntity = state.grid.entities.find((entity) => entity.id === state.selectedEntityId);
  const selectedEntitySnapshot = selectedEntity === undefined ? undefined : copyEntity(selectedEntity);
  const notifications: Notification[] = state.notifications.map((notification) =>
    copyNotification(notification),
  );
  Object.freeze(notifications);

  const snapshot: SimulationSnapshot = {
    currency: state.currency,
    currencyPerSecond: 0,
    prestigePoints: state.prestige.points,
    prestigeReady: state.lifetimeCurrency >= PRESTIGE_THRESHOLD,
    unlockedMachines,
    unlockedRecipes,
    selectedEntity: selectedEntitySnapshot,
    selectedThroughput: 0,
    placementMode: state.placementMode,
    pendingRotation: state.pendingRotation,
    notifications,
    offlineSummary: undefined,
  };

  return Object.freeze(snapshot);
}

function copyEntity(entity: Entity): Entity {
  const copy: Entity = { ...entity };
  Object.freeze(copy);
  return copy;
}

function copyNotification(notification: Notification): Notification {
  const copy: Notification = { ...notification };
  Object.freeze(copy);
  return copy;
}
