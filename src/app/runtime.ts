import { createInitialState } from "../sim/initialState";
import { analyzeProductionChains } from "../sim/chains";
import {
  loadSaveWithOfflineResult,
  projectSaveGame,
  saveToStorage,
  type LoadSaveResult,
  type SaveStorage,
} from "../persistence/save";
import type { SaveFailureReason } from "../persistence/migrate";
import { SimulationStore } from "../sim/store";
import {
  createSceneTelemetry,
  INITIAL_SCENE_TELEMETRY,
  type SceneTelemetry,
} from "../phaser/telemetry";
import type {
  CommandResult,
  SaveGame,
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

export interface SimulationRuntimeAutosave {
  sync(): void;
  flush(): void;
  getWriteCount(): number;
  dispose(): void;
}

export interface RuntimeAutosaveOptions {
  readonly minimumIntervalMs?: number;
  readonly listenForLifecycleEvents?: boolean;
  readonly isWriteSuspended?: () => boolean;
}

export interface SaveRecovery {
  readonly reason: SaveFailureReason;
  readonly message?: string;
}

export interface BrowserSimulationLoad {
  readonly state: SimulationState;
  readonly recovery: SaveRecovery | undefined;
}

export interface SimulationRuntime {
  readonly store: SimulationStore;
  readonly autosave: SimulationRuntimeAutosave | undefined;
  readonly saveRecovery: SaveRecovery | undefined;
  readonly acknowledgeSaveRecovery: () => void;
  start(): void;
  stop(): void;
  setSceneTelemetry(telemetry: SceneTelemetry): void;
  getSceneTelemetry(): SceneTelemetry;
}

type RuntimeWindow = Window & {
  __FACTOR_Y__?: SimulationRuntimeBridge;
  __FACTOR_Y_TELEMETRY__?: SimulationRuntimeTelemetryBridge;
};

const DEFAULT_MINIMUM_WRITE_INTERVAL_MS = 1_000;
const autosaves = new WeakMap<SimulationStore, SimulationRuntimeAutosave>();

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

export function projectRuntimeSave(state: SimulationState, now: number): SaveGame {
  const lastSavedAt =
    Number.isFinite(now) && now >= 0 ? Math.max(state.lastSavedAt, now) : state.lastSavedAt;
  return projectSaveGame({
    ...state,
    lastSavedAt,
    productionChains: analyzeProductionChains(state),
  });
}

export function createRuntimeAutosave(
  store: SimulationStore,
  storage: SaveStorage | undefined,
  now: () => number = Date.now,
  options: RuntimeAutosaveOptions = {},
): SimulationRuntimeAutosave {
  const attached = autosaves.get(store);
  if (attached !== undefined) {
    return attached;
  }

  const minimumIntervalMs = options.minimumIntervalMs ?? DEFAULT_MINIMUM_WRITE_INTERVAL_MS;
  const listenForLifecycleEvents = options.listenForLifecycleEvents ?? true;
  const isWriteSuspended = options.isWriteSuspended ?? ((): boolean => false);
  let lastWriteAt = now();
  let writeCount = 0;
  let disposed = false;
  let lastValueSignature = "";
  let lastStructureSignature = "";

  const commit = (projection: SaveGame, savedAt: number): void => {
    saveToStorage(storage, projection);
    lastWriteAt = savedAt;
    lastValueSignature = valueSignature(projection);
    lastStructureSignature = structureSignature(projection);
    writeCount += 1;
  };

  const flush = (): void => {
    if (disposed || storage === undefined || isWriteSuspended()) {
      return;
    }

    const savedAt = now();
    const projection = projectRuntimeSave(store.getSaveGame(), savedAt);
    if (
      valueSignature(projection) === lastValueSignature &&
      structureSignature(projection) === lastStructureSignature
    ) {
      return;
    }

    commit(projection, savedAt);
  };

  const sync = (): void => {
    if (disposed || storage === undefined || isWriteSuspended()) {
      return;
    }

    const savedAt = now();
    const projection = projectRuntimeSave(store.getSaveGame(), savedAt);
    const structureChanged = structureSignature(projection) !== lastStructureSignature;
    if (!structureChanged && valueSignature(projection) === lastValueSignature) {
      return;
    }

    if (!structureChanged && savedAt - lastWriteAt < minimumIntervalMs) {
      return;
    }

    commit(projection, savedAt);
  };

  const seed = projectRuntimeSave(store.getSaveGame(), lastWriteAt);
  lastValueSignature = valueSignature(seed);
  lastStructureSignature = structureSignature(seed);

  const handlePageHide = (): void => {
    flush();
  };

  const handleVisibilityChange = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      flush();
    }
  };

  const autosave: SimulationRuntimeAutosave = {
    sync,
    flush,
    getWriteCount: () => writeCount,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribe();
      if (listenForLifecycleEvents && typeof window !== "undefined") {
        window.removeEventListener("pagehide", handlePageHide);
      }
      if (listenForLifecycleEvents && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (autosaves.get(store) === autosave) {
        autosaves.delete(store);
      }
    },
  };

  const unsubscribe = store.subscribe(sync);
  if (listenForLifecycleEvents && typeof window !== "undefined") {
    window.addEventListener("pagehide", handlePageHide);
  }
  if (listenForLifecycleEvents && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
  autosaves.set(store, autosave);

  return autosave;
}

export function loadBrowserSimulationResult(
  now = Date.now(),
  storage: SaveStorage | undefined = getBrowserStorage(),
): BrowserSimulationLoad {
  const result = loadSaveWithOfflineResult(storage, now);

  return { state: result.state, recovery: toSaveRecovery(result) };
}

export function createBrowserSimulationRuntime(
  now = Date.now(),
  storage: SaveStorage | undefined = getBrowserStorage(),
  clock: () => number = Date.now,
): SimulationRuntime {
  const loaded = loadBrowserSimulationResult(now, storage);
  const runtime = createSimulationRuntime(loaded.state);
  let recoveryTold = false;
  const autosave =
    storage === undefined
      ? undefined
      : createRuntimeAutosave(runtime.store, storage, clock, {
          isWriteSuspended: () => loaded.recovery !== undefined && !recoveryTold,
        });

  return {
    ...runtime,
    autosave,
    saveRecovery: loaded.recovery,
    acknowledgeSaveRecovery: (): void => {
      recoveryTold = true;
    },
  };
}

export function createSimulationRuntime(
  initialState: SimulationState = createInitialState(),
): SimulationRuntime {
  const store = new SimulationStore(initialState);
  let sceneTelemetry = INITIAL_SCENE_TELEMETRY;

  return {
    store,
    autosave: undefined,
    saveRecovery: undefined,
    acknowledgeSaveRecovery: (): void => undefined,
    start: (): void => store.start(),
    stop: (): void => store.stop(),
    setSceneTelemetry: (telemetry: SceneTelemetry): void => {
      sceneTelemetry = createSceneTelemetry(telemetry);
    },
    getSceneTelemetry: (): SceneTelemetry => sceneTelemetry,
  };
}

function toSaveRecovery(result: LoadSaveResult): SaveRecovery | undefined {
  if (result.reason === undefined) {
    return undefined;
  }

  return { reason: result.reason, message: result.message };
}

function valueSignature(save: SaveGame): string {
  return JSON.stringify({ ...save, lastSavedAt: 0 });
}

function structureSignature(save: SaveGame): string {
  return JSON.stringify({
    grid: {
      width: save.grid.width,
      height: save.grid.height,
      tileSizePx: save.grid.tileSizePx,
      nodes: save.grid.nodes,
      entities: save.grid.entities,
    },
    prestige: save.prestige,
    unlocked: save.unlocked,
    productionChains: save.productionChains,
  });
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
