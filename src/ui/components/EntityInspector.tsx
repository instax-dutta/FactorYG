import { useState } from "react";
import { getMachineUpgradeCost, getUpgradeLevel } from "../../content/machines";
import type { SimulationStore } from "../../sim/store";
import type { Entity, SimulationSnapshot } from "../../sim/types";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";
import { getCommandReasonMessage, getMachineLabel } from "../presentation";

interface EntityInspectorProps {
  store: SimulationStore;
}

interface UpgradeState {
  readonly blocked: boolean;
  readonly reason: string | undefined;
  readonly message: string;
}

interface Refusal {
  readonly snapshot: SimulationSnapshot;
  readonly reason: string;
}

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function EntityInspector({ store }: EntityInspectorProps) {
  const snapshot = useSimulationSnapshot(store);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const entity = snapshot.selectedEntity;
  const throughput =
    snapshot.selectedThroughput > 0 ? `${formatNumber(snapshot.selectedThroughput)} / sec` : "Pending";
  const upgrade = resolveUpgrade(entity, snapshot, store, refusal);

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
                setRefusal(null);
                const result = store.dispatch({ type: "upgradeEntity", entityId: entity.id });
                setRefusal(
                  result.ok
                    ? null
                    : { snapshot: store.getSnapshot(), reason: result.reason ?? "notImplemented" },
                );
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
};

function resolveUpgrade(
  entity: Entity | undefined,
  snapshot: SimulationSnapshot,
  store: SimulationStore,
  refusal: Refusal | null,
): UpgradeState {
  if (entity === undefined) {
    return {
      blocked: true,
      reason: "entityNotFound",
      message: "Select an entity to upgrade it.",
    };
  }

  const preflight = store.canUpgrade(entity.id);
  if (!preflight.ok) {
    const reason = preflight.reason ?? "notImplemented";
    return { blocked: true, reason, message: getCommandReasonMessage(reason) };
  }

  if (refusal !== null && refusal.snapshot === snapshot) {
    return {
      blocked: true,
      reason: refusal.reason,
      message: getCommandReasonMessage(refusal.reason),
    };
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
