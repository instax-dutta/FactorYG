import { useEffect, useState } from "react";
import { GameCanvas } from "./GameCanvas";
import { GameHeader } from "../ui/components/GameHeader";

export const LIFECYCLE_TOGGLE_EVENT = "factor-y:lifecycle-toggle";

function lifecycleToggleEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === "test";
}

export function App() {
  const [canvasMounted, setCanvasMounted] = useState(true);

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
      {canvasMounted ? <GameCanvas /> : null}
    </main>
  );
}

export default App;
