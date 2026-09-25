import { useEffect, useRef } from "react";
import { createFactoryGame } from "../phaser/createGame";
import {
  createBrowserSimulationRuntime,
  installRuntimeBridge,
  type SimulationRuntime,
} from "./runtime";

export function GameCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SimulationRuntime | null>(null);

  useEffect(() => {
    const container = canvasRef.current;
    if (container === null) {
      return undefined;
    }
    const runtime = runtimeRef.current ?? createBrowserSimulationRuntime();
    runtimeRef.current = runtime;

    let disposed = false;
    let cleaned = false;
    let removeBridge: (() => void) | undefined;
    const game = createFactoryGame(
      container,
      runtime.store,
      () => {
        if (disposed) {
          return;
        }
        container.setAttribute("data-factor-y-status", "ready");
        removeBridge = installRuntimeBridge(runtime);
        runtime.start();
      },
      (telemetry) => {
        if (!disposed) {
          runtime.setSceneTelemetry(telemetry);
        }
      },
    );

    return () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      disposed = true;
      removeBridge?.();
      removeBridge = undefined;
      runtime.stop();
      game.destroy(true);
      container.setAttribute("data-factor-y-status", "booting");
    };
  }, []);

  return (
    <div
      ref={canvasRef}
      data-testid="game-canvas"
      data-factor-y-status="booting"
      style={{
        width: "100vw",
        height: "100vh",
        minHeight: 320,
        overflow: "hidden",
        backgroundColor: "#101820",
        touchAction: "none",
      }}
    />
  );
}

export default GameCanvas;
