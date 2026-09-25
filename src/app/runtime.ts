import { createInitialState } from "../sim/initialState";
import { loadSaveWithOfflineResult, type SaveStorage } from "../persistence/save";
import { SimulationStore } from "../sim/store";
import {
  createSceneTelemetry,
  INITIAL_SCENE_TELEMETRY,
  type SceneTelemetry,
} from "../phaser/telemetry";
import type {
  CommandResult,
  SimulationCommand,
  SimulationSnapshot,
  SimulationState,
} from "../sim/types";

export interface SimulationRuntimeBridge {
  dispatch(command: SimulationCommand): CommandResult;
  advanceTicks(count: number): void;
  getSnapshot(): SimulationSnapshot;
}

export interface SimulationRuntimeTelemetryBridge {
  getSnapshot(): SceneTelemetry;
}

export interface SimulationRuntime {
  readonly store: SimulationStore;
  start(): void;
  stop(): void;
  setSceneTelemetry(telemetry: SceneTelemetry): void;
  getSceneTelemetry(): SceneTelemetry;
}

type RuntimeWindow = Window & {
  __FACTOR_Y__?: SimulationRuntimeBridge;
  __FACTOR_Y_TELEMETRY__?: SimulationRuntimeTelemetryBridge;
};

export function createRuntimeBridge(store: SimulationStore): SimulationRuntimeBridge {
  return Object.freeze({
    dispatch: (command: SimulationCommand): CommandResult => store.dispatch(command),
    advanceTicks: (count: number): void => store.advanceTicks(count),
    getSnapshot: (): SimulationSnapshot => store.getSnapshot(),
  });
}

export function createRuntimeTelemetryBridge(
  getSnapshot: () => SceneTelemetry,
): SimulationRuntimeTelemetryBridge {
  return Object.freeze({
    getSnapshot: (): SceneTelemetry => getSnapshot(),
  });
}

export function loadBrowserSimulationState(now = Date.now()): SimulationState {
  const storage = getBrowserStorage();
  return storage === undefined
    ? createInitialState()
    : loadSaveWithOfflineResult(storage, now).state;
}

export function createBrowserSimulationRuntime(
  now = Date.now(),
): SimulationRuntime {
  return createSimulationRuntime(loadBrowserSimulationState(now));
}

export function createSimulationRuntime(
  initialState: SimulationState = createInitialState(),
): SimulationRuntime {
  const store = new SimulationStore(initialState);
  let sceneTelemetry = INITIAL_SCENE_TELEMETRY;

  return {
    store,
    start: (): void => store.start(),
    stop: (): void => store.stop(),
    setSceneTelemetry: (telemetry: SceneTelemetry): void => {
      sceneTelemetry = createSceneTelemetry(telemetry);
    },
    getSceneTelemetry: (): SceneTelemetry => sceneTelemetry,
  };
}

function getBrowserStorage(): SaveStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function installRuntimeBridge(runtime: SimulationRuntime): () => void {
  if (
    typeof window === "undefined" ||
    (!import.meta.env.DEV && import.meta.env.MODE !== "test")
  ) {
    return () => undefined;
  }

  const runtimeWindow = window as RuntimeWindow;
  const bridge = createRuntimeBridge(runtime.store);
  const telemetryBridge = createRuntimeTelemetryBridge(() => runtime.getSceneTelemetry());
  Object.defineProperty(runtimeWindow, "__FACTOR_Y__", {
    configurable: true,
    enumerable: false,
    value: bridge,
    writable: false,
  });
  Object.defineProperty(runtimeWindow, "__FACTOR_Y_TELEMETRY__", {
    configurable: true,
    enumerable: false,
    value: telemetryBridge,
    writable: false,
  });

  return () => {
    if (runtimeWindow.__FACTOR_Y__ === bridge) {
      delete runtimeWindow.__FACTOR_Y__;
    }
    if (runtimeWindow.__FACTOR_Y_TELEMETRY__ === telemetryBridge) {
      delete runtimeWindow.__FACTOR_Y_TELEMETRY__;
    }
  };
}
