import { useState } from "react";
import { getMachineUpgradeCost, getUpgradeLevel } from "../../content/machines";
import type { SimulationStore } from "../../sim/store";
import type { Entity } from "../../sim/types";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";
import {
  LEFT_RAIL_INSPECTOR_MAX_HEIGHT,
  LEFT_RAIL_LEFT,
  LEFT_RAIL_TOP,
  LEFT_RAIL_WIDTH,
} from "../layout";
import { getCommandReasonMessage, getMachineLabel } from "../presentation";

interface EntityInspectorProps {
  store: SimulationStore;
}

interface UpgradeState {
  readonly blocked: boolean;
  readonly reason: string | undefined;
  readonly message: string;
}

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function EntityInspector({ store }: EntityInspectorProps) {
  const snapshot = useSimulationSnapshot(store);
  const [, setRefusedAttempts] = useState(0);
  const entity = snapshot.selectedEntity;
  const throughput =
    snapshot.selectedThroughput > 0 ? `${formatNumber(snapshot.selectedThroughput)} / sec` : "Pending";
  const upgrade = resolveUpgrade(entity, store);

  return (
    <aside
      aria-label="Entity inspector"
      data-testid="entity-inspector"
      style={{
        position: "absolute",
        top: LEFT_RAIL_TOP,
        left: LEFT_RAIL_LEFT,
        zIndex: 3,
        boxSizing: "border-box",
        width: LEFT_RAIL_WIDTH,
        maxHeight: LEFT_RAIL_INSPECTOR_MAX_HEIGHT,
        overflowY: "auto",
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
              {getMachineLabel(entity.type)}
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
              aria-describedby="inspector-upgrade-status"
              data-testid="inspector-upgrade"
              disabled={upgrade.blocked}
              title={upgrade.message}
              onClick={() => {
                const result = store.dispatch({ type: "upgradeEntity", entityId: entity.id });
                if (!result.ok) {
                  setRefusedAttempts((attempts) => attempts + 1);
                }
              }}
              style={upgrade.blocked ? disabledButtonStyle : buttonStyle}
            >
              Upgrade
            </button>
          </div>
          <span
            id="inspector-upgrade-status"
            data-testid="inspector-upgrade-status"
            data-reason={upgrade.reason ?? undefined}
            style={{ display: "block", marginTop: 8, color: "#aab7bf", fontSize: "0.8rem" }}
          >
            <span data-testid="inspector-upgrade-cost">{upgrade.message}</span>
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
  pointerEvents: "none" as const,
};

function resolveUpgrade(entity: Entity | undefined, store: SimulationStore): UpgradeState {
  if (entity === undefined) {
    return {
      blocked: true,
      reason: "entityNotFound",
      message: "Select an entity to upgrade it.",
    };
  }

  const preflight = store.canUpgrade(entity.id);
  if (!preflight.ok) {
    const reason = preflight.reason;
    return { blocked: true, reason, message: getCommandReasonMessage(reason) };
  }

  const cost = getMachineUpgradeCost(entity.type, entity.level);
  const level = getUpgradeLevel(entity.level + 1);

  return {
    blocked: false,
    reason: undefined,
    message: `Upgrade to level ${formatNumber(level)} for ${formatNumber(cost)}.`,
  };
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? numberFormatter.format(value) : "0";
}

export default EntityInspector;
