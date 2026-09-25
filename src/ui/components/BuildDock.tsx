import type { MachineType } from "../../sim/types";
import type { SimulationStore } from "../../sim/store";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";

interface BuildDockProps {
  store: SimulationStore;
}

const machineOptions: ReadonlyArray<{ type: MachineType; label: string }> = [
  { type: "extractor", label: "Extractor" },
  { type: "belt", label: "Conveyor Belt" },
  { type: "smelter", label: "Smelter" },
  { type: "assembler", label: "Assembler" },
  { type: "silo", label: "Storage Silo" },
  { type: "depot", label: "Shipping Depot" },
];

export function BuildDock({ store }: BuildDockProps) {
  const snapshot = useSimulationSnapshot(store);

  return (
    <section
      aria-label="Build dock"
      data-testid="build-dock"
      style={{
        position: "absolute",
        right: 24,
        bottom: 24,
        zIndex: 3,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: 8,
        maxWidth: "min(560px, calc(100vw - 48px))",
        padding: 12,
        border: "1px solid rgba(229, 242, 246, 0.28)",
        borderRadius: 8,
        background: "rgba(16, 24, 32, 0.88)",
        color: "#f5f7fa",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      {machineOptions.map(({ type, label }) => {
        const unlocked = snapshot.unlockedMachines.includes(type);
        const active = snapshot.placementMode === type;

        return (
          <button
            key={type}
            type="button"
            aria-label={label}
            aria-pressed={active}
            data-testid={`build-${type}`}
            disabled={!unlocked}
            onClick={() => store.dispatch({ type: "setPlacementMode", machine: type })}
            style={{
              pointerEvents: "auto",
              minWidth: 92,
              minHeight: 38,
              padding: "0 12px",
              border: active ? "2px solid #36c5b5" : "1px solid #58758a",
              borderRadius: 6,
              background: active ? "#244a50" : "#263746",
              color: unlocked ? "#f5f7fa" : "#8b98a1",
              cursor: unlocked ? "pointer" : "not-allowed",
              font: "inherit",
              opacity: unlocked ? 1 : 0.65,
            }}
          >
            {label}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Rotate placement"
        data-testid="rotate-placement"
        onClick={() => store.dispatch({ type: "rotatePlacement" })}
        style={{
          pointerEvents: "auto",
          minHeight: 38,
          padding: "0 12px",
          border: "1px solid #c98245",
          borderRadius: 6,
          background: "#263746",
          color: "#f5f7fa",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        Rotate
      </button>
    </section>
  );
}

export default BuildDock;
