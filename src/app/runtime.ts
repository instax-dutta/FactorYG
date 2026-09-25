import { createInitialState } from "../sim/initialState";
import { SimulationStore } from "../sim/store";
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

export interface SimulationRuntime {
  readonly store: SimulationStore;
  start(): void;
  stop(): void;
}

type RuntimeWindow = Window & {
  __FACTOR_Y__?: SimulationRuntimeBridge;
};

export function createRuntimeBridge(store: SimulationStore): SimulationRuntimeBridge {
  return Object.freeze({
    dispatch: (command: SimulationCommand): CommandResult => store.dispatch(command),
    advanceTicks: (count: number): void => store.advanceTicks(count),
    getSnapshot: (): SimulationSnapshot => store.getSnapshot(),
  });
}

export function createSimulationRuntime(
  initialState: SimulationState = createInitialState(),
): SimulationRuntime {
  const store = new SimulationStore(initialState);
  return {
    store,
    start: (): void => store.start(),
    stop: (): void => store.stop(),
  };
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
  Object.defineProperty(runtimeWindow, "__FACTOR_Y__", {
    configurable: true,
    enumerable: false,
    value: bridge,
    writable: false,
  });

  return () => {
    if (runtimeWindow.__FACTOR_Y__ === bridge) {
      delete runtimeWindow.__FACTOR_Y__;
    }
  };
}
