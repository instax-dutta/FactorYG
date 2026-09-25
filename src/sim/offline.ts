import { NEW_GAME_TIMESTAMP } from "./constants";
import type {
  OfflineSummary,
  ResourceId,
  SaveGame,
  SimulationState,
} from "./types";

const OFFLINE_CAP_SECONDS = 43_200;
const OFFLINE_SUMMARY_THRESHOLD_SECONDS = 60;

export function calculateOfflineProgress(save: SaveGame, now: number): OfflineSummary {
  const elapsedSeconds = calculateElapsedSeconds(save.lastSavedAt, now);
  const cappedSeconds = Math.min(elapsedSeconds, OFFLINE_CAP_SECONDS);
  const sellMultiplier = save.prestige.permanentMultipliers.sellValue;
  const unitsByResource = new Map<ResourceId, number>();
  let earnedCurrency = 0;

  if (isPositiveFinite(sellMultiplier)) {
    for (const chainId of Object.keys(save.productionChains).sort()) {
      const chain = save.productionChains[chainId];
      if (
        !isPositiveFinite(chain.steadyStateThroughput) ||
        !isPositiveFinite(chain.sellValue)
      ) {
        continue;
      }

      const units = chain.steadyStateThroughput * cappedSeconds;
      const chainCurrency = units * chain.sellValue * sellMultiplier;
      if (!isPositiveFinite(units) || !isPositiveFinite(chainCurrency)) {
        continue;
      }

      const currentUnits = unitsByResource.get(chain.outputResource) ?? 0;
      const nextUnits = currentUnits + units;
      const nextCurrency = earnedCurrency + chainCurrency;
      if (!Number.isFinite(nextUnits) || !Number.isFinite(nextCurrency)) {
        continue;
      }

      unitsByResource.set(chain.outputResource, nextUnits);
      earnedCurrency = nextCurrency;
    }
  }

  return {
    elapsedSeconds,
    cappedSeconds,
    earnedCurrency,
    chainUnits: projectChainUnits(unitsByResource),
  };
}

export function applyOfflineProgress(
  state: SimulationState,
  summary: OfflineSummary,
): SimulationState {
  const earnedCurrency = isPositiveFinite(summary.earnedCurrency)
    ? summary.earnedCurrency
    : 0;

  return {
    ...state,
    currency: state.currency + earnedCurrency,
    lifetimeCurrency: state.lifetimeCurrency + earnedCurrency,
    offlineSummary: copyOfflineSummary(summary),
  };
}

export function shouldShowOfflineSummary(summary: OfflineSummary): boolean {
  return (
    Number.isFinite(summary.elapsedSeconds) &&
    summary.elapsedSeconds > OFFLINE_SUMMARY_THRESHOLD_SECONDS &&
    isPositiveFinite(summary.earnedCurrency) &&
    Object.values(summary.chainUnits).some(isPositiveFinite)
  );
}

function calculateElapsedSeconds(lastSavedAt: number, now: number): number {
  if (
    lastSavedAt === NEW_GAME_TIMESTAMP ||
    !Number.isFinite(lastSavedAt) ||
    lastSavedAt < 0 ||
    !Number.isFinite(now)
  ) {
    return 0;
  }

  return Math.max(0, (now - lastSavedAt) / 1_000);
}

function projectChainUnits(
  unitsByResource: ReadonlyMap<ResourceId, number>,
): OfflineSummary["chainUnits"] {
  const chainUnits: OfflineSummary["chainUnits"] = {};
  for (const resource of [...unitsByResource.keys()].sort()) {
    const units = unitsByResource.get(resource);
    if (units !== undefined) {
      setChainUnits(chainUnits, resource, units);
    }
  }
  return chainUnits;
}

function copyOfflineSummary(summary: OfflineSummary): OfflineSummary {
  const chainUnits: OfflineSummary["chainUnits"] = {};
  for (const resource of Object.keys(summary.chainUnits).sort() as ResourceId[]) {
    const units = summary.chainUnits[resource];
    if (units !== undefined) {
      setChainUnits(chainUnits, resource, units);
    }
  }

  return {
    elapsedSeconds: summary.elapsedSeconds,
    cappedSeconds: summary.cappedSeconds,
    earnedCurrency: summary.earnedCurrency,
    chainUnits,
  };
}

function setChainUnits(
  chainUnits: OfflineSummary["chainUnits"],
  resource: ResourceId,
  units: number,
): void {
  Object.defineProperty(chainUnits, resource, {
    configurable: true,
    enumerable: true,
    value: units,
    writable: true,
  });
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
