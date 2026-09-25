import { useEffect, useRef } from "react";
import { createFactoryGame } from "../phaser/createGame";
import { createSimulationRuntime, installRuntimeBridge, type SimulationRuntime } from "./runtime";

export function GameCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SimulationRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = createSimulationRuntime();
  }

  useEffect(() => {
    const container = canvasRef.current;
    const runtime = runtimeRef.current;
    if (container === null || runtime === null) {
      return undefined;
    }

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
    };
  }, []);

  return (
    <div
      ref={canvasRef}
      data-testid="game-canvas"
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
