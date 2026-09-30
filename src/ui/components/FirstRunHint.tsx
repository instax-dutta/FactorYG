import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";
import { firstRunHintHeading, firstRunHintSteps } from "../presentation";
import type { SimulationStore } from "../../sim/store";

interface FirstRunHintProps {
  store: SimulationStore;
}

const panelStyle = {
  position: "absolute" as const,
  top: 96,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 3,
  boxSizing: "border-box" as const,
  width: 460,
  padding: "12px 16px",
  border: "1px solid rgba(229, 242, 246, 0.28)",
  borderRadius: 8,
  background: "rgba(16, 24, 32, 0.92)",
  color: "#f5f7fa",
  fontFamily: "system-ui, sans-serif",
  pointerEvents: "none" as const,
};

export function FirstRunHint({ store }: FirstRunHintProps): React.ReactElement | null {
  const snapshot = useSimulationSnapshot(store);
  if (snapshot.entityCount > 0) {
    return null;
  }

  return (
    <section
      aria-label="How to start"
      data-testid="first-run-hint"
      style={panelStyle}
    >
      <h2 style={{ margin: "0 0 6px", fontSize: "0.95rem" }}>{firstRunHintHeading}</h2>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: "0.85rem", lineHeight: 1.5 }}>
        {firstRunHintSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
