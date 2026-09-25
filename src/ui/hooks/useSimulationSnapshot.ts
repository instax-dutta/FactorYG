import { useCallback, useSyncExternalStore } from "react";
import type { SimulationStore } from "../../sim/store";
import type { SimulationSnapshot } from "../../sim/types";

export function useSimulationSnapshot(store: SimulationStore): SimulationSnapshot {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
