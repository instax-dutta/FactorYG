import { useEffect, useRef, useState } from "react";
import { GameCanvas } from "./GameCanvas";
import {
  createBrowserSimulationRuntime,
  type SimulationRuntime,
} from "./runtime";
import { GameHeader } from "../ui/components/GameHeader";
import { Hud } from "../ui/components/Hud";
import { BuildDock } from "../ui/components/BuildDock";
import { EntityInspector } from "../ui/components/EntityInspector";
import { FirstRunHint } from "../ui/components/FirstRunHint";
import { NotificationStack } from "../ui/components/NotificationStack";
import { OfflineSummaryModal } from "../ui/components/OfflineSummaryModal";
import { SaveRecoveryNotice } from "../ui/components/SaveRecoveryNotice";
import { TechTree } from "../ui/components/TechTree";

export const LIFECYCLE_TOGGLE_EVENT = "factor-y:lifecycle-toggle";

function lifecycleToggleEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === "test";
}

export function App() {
  const [canvasMounted, setCanvasMounted] = useState(true);
  const [runtime, setRuntime] = useState<SimulationRuntime | null>(null);
  const runtimeRef = useRef<SimulationRuntime | null>(null);
  const appMountedRef = useRef(false);

  useEffect(() => {
    appMountedRef.current = true;
    if (runtimeRef.current === null) {
      runtimeRef.current = createBrowserSimulationRuntime();
    }
    setRuntime(runtimeRef.current);

    return () => {
      appMountedRef.current = false;
      const activeRuntime = runtimeRef.current;
      queueMicrotask(() => {
        if (appMountedRef.current || activeRuntime === null) {
          return;
        }
        activeRuntime.stop();
        activeRuntime.autosave?.dispose();
        if (runtimeRef.current === activeRuntime) {
          runtimeRef.current = null;
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!lifecycleToggleEnabled()) {
      return undefined;
    }

    const toggleCanvas = (): void => {
      setCanvasMounted((mounted) => !mounted);
    };
    window.addEventListener(LIFECYCLE_TOGGLE_EVENT, toggleCanvas);

    return () => {
      window.removeEventListener(LIFECYCLE_TOGGLE_EVENT, toggleCanvas);
    };
  }, []);

  return (
    <main style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <GameHeader />
      {runtime !== null && canvasMounted ? <GameCanvas runtime={runtime} /> : null}
      {runtime !== null ? (
        <>
          <Hud store={runtime.store} />
          <FirstRunHint store={runtime.store} />
          <BuildDock store={runtime.store} />
          <EntityInspector store={runtime.store} />
          <TechTree store={runtime.store} />
          <NotificationStack store={runtime.store} />
          <SaveRecoveryNotice
            recovery={runtime.saveRecovery}
            onAcknowledge={runtime.acknowledgeSaveRecovery}
          />
          <OfflineSummaryModal store={runtime.store} />
        </>
      ) : null}
    </main>
  );
}

export default App;
