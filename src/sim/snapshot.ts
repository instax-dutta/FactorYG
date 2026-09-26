import { getCurrencyPerSecond } from "./economy";
import { isGridExpansionUnlocked } from "./grid";
import { calculatePrestigePoints, canPrestige, permanentMultipliersForPoints } from "./prestige";
import type {
  Entity,
  MachineType,
  Notification,
  OfflineSummary,
  PermanentMultipliers,
  ResourceId,
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
  const permanentMultipliers = copyPermanentMultipliers(state.prestige.permanentMultipliers);

  const snapshot: SimulationSnapshot = {
    currency: state.currency,
    currencyPerSecond: getCurrencyPerSecond(state),
    prestigePoints: state.prestige.points,
    prestigeReady: canPrestige(state),
    permanentMultipliers,
    prestigeAwardPoints: calculatePrestigePoints(state.lifetimeCurrency),
    prestigeNextMultipliers: permanentMultipliersForPoints(
      state.prestige.points + calculatePrestigePoints(state.lifetimeCurrency),
    ),
    expansionUnlocked: isGridExpansionUnlocked(state),
    gridWidth: state.grid.width,
    gridHeight: state.grid.height,
    unlockedMachines,
    unlockedRecipes,
    selectedEntity: selectedEntitySnapshot,
    selectedThroughput: 0,
    placementMode: state.placementMode,
    pendingRotation: state.pendingRotation,
    notifications,
    offlineSummary:
      state.offlineSummary === undefined ? undefined : copyOfflineSummary(state.offlineSummary),
  };

  return Object.freeze(snapshot);
}

function copyPermanentMultipliers(multipliers: PermanentMultipliers): PermanentMultipliers {
  const copy: PermanentMultipliers = {
    productionSpeed: multipliers.productionSpeed,
    sellValue: multipliers.sellValue,
  };
  Object.freeze(copy);
  return copy;
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

function copyOfflineSummary(summary: OfflineSummary): OfflineSummary {
  const chainUnits: OfflineSummary["chainUnits"] = {};
  for (const resource of Object.keys(summary.chainUnits).sort() as ResourceId[]) {
    const units = summary.chainUnits[resource];
    if (units !== undefined) {
      Object.defineProperty(chainUnits, resource, {
        configurable: true,
        enumerable: true,
        value: units,
        writable: true,
      });
    }
  }
  Object.freeze(chainUnits);

  const copy = {
    elapsedSeconds: summary.elapsedSeconds,
    cappedSeconds: summary.cappedSeconds,
    earnedCurrency: summary.earnedCurrency,
    chainUnits,
  };
  Object.freeze(copy);
  return copy;
}
