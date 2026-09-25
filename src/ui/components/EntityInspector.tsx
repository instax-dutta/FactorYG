import type { SimulationStore } from "../../sim/store";
import type { MachineType } from "../../sim/types";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";

interface EntityInspectorProps {
  store: SimulationStore;
}

const machineLabels: Record<MachineType, string> = {
  extractor: "Extractor",
  belt: "Conveyor Belt",
  smelter: "Smelter",
  assembler: "Assembler",
  silo: "Storage Silo",
  depot: "Shipping Depot",
};

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function EntityInspector({ store }: EntityInspectorProps) {
  const snapshot = useSimulationSnapshot(store);
  const entity = snapshot.selectedEntity;
  const throughput =
    snapshot.selectedThroughput > 0 ? `${formatNumber(snapshot.selectedThroughput)} / sec` : "Pending";

  return (
    <aside
      aria-label="Entity inspector"
      data-testid="entity-inspector"
      style={{
        position: "absolute",
        top: 128,
        left: 24,
        zIndex: 3,
        width: 240,
        padding: 16,
        border: "1px solid rgba(229, 242, 246, 0.28)",
        borderRadius: 8,
        background: "rgba(16, 24, 32, 0.88)",
        color: "#f5f7fa",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <h2 style={{ margin: "0 0 12px", fontSize: "1rem" }}>Entity inspector</h2>
      {entity === undefined ? (
        <p data-testid="inspector-empty" style={{ margin: 0 }}>
          Select an entity to inspect it.
        </p>
      ) : (
        <>
          <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 12px", margin: 0 }}>
            <dt>Type</dt>
            <dd data-testid="inspector-type" style={{ margin: 0 }}>
              {machineLabels[entity.type]}
            </dd>
            <dt>ID</dt>
            <dd data-testid="inspector-id" style={{ margin: 0 }}>
              {entity.id}
            </dd>
            <dt>Level</dt>
            <dd data-testid="inspector-level" style={{ margin: 0 }}>
              {formatNumber(entity.level)}
            </dd>
            <dt>Throughput</dt>
            <dd
              data-testid="inspector-throughput"
              data-throughput-status={snapshot.selectedThroughput > 0 ? "available" : "pending"}
              style={{ margin: 0 }}
            >
              {throughput}
            </dd>
          </dl>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            <button
              type="button"
              aria-label="Rotate"
              data-testid="inspector-rotate"
              onClick={() => store.dispatch({ type: "rotatePlacement" })}
              style={buttonStyle}
            >
              Rotate
            </button>
            <button
              type="button"
              aria-label="Demolish"
              data-testid="inspector-demolish"
              onClick={() => store.dispatch({ type: "demolishEntity", entityId: entity.id })}
              style={buttonStyle}
            >
              Demolish
            </button>
            <button
              type="button"
              aria-label="Upgrade"
              aria-describedby="inspector-upgrade-unavailable"
              data-testid="inspector-upgrade"
              disabled
              title="Upgrades will be available in a later phase"
              style={disabledButtonStyle}
            >
              Upgrade
            </button>
          </div>
          <span
            id="inspector-upgrade-unavailable"
            data-testid="inspector-upgrade-unavailable"
            style={{ display: "block", marginTop: 8, color: "#aab7bf", fontSize: "0.8rem" }}
          >
            Upgrade is not available yet.
          </span>
        </>
      )}
    </aside>
  );
}

const buttonStyle = {
  pointerEvents: "auto" as const,
  minHeight: 34,
  padding: "0 10px",
  border: "1px solid #58758a",
  borderRadius: 5,
  background: "#263746",
  color: "#f5f7fa",
  cursor: "pointer",
  font: "inherit",
};

const disabledButtonStyle = {
  ...buttonStyle,
  background: "#34424c",
  color: "#c2cbd1",
  cursor: "not-allowed",
};

function formatNumber(value: number): string {
  return Number.isFinite(value) ? numberFormatter.format(value) : "0";
}

export default EntityInspector;
