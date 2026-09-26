import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GRID_EXPANSION_COST } from "../../content/balance";
import type { SimulationStore } from "../../sim/store";
import type { CommandResult } from "../../sim/types";
import { useModalFocus } from "../hooks/useModalFocus";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";
import { getCommandReasonMessage } from "../presentation";

interface PrestigeModalProps {
  store: SimulationStore;
  open: boolean;
  onClose: () => void;
}

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function PrestigeModal({ store, open, onClose }: PrestigeModalProps) {
  const snapshot = useSimulationSnapshot(store);
  const [rejection, setRejection] = useState<CommandResult>({ ok: true });
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const shownRejection = resolveRejection(rejection, store);
  const confirm = useCallback(() => {
    const result = store.dispatch({ type: "prestige" });

    if (result.ok) {
      onClose();
      return;
    }

    setRejection(result);
  }, [onClose, store]);

  useModalFocus({ open, onClose, initialFocusRef: confirmRef, dialogRef });

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={true}
      aria-labelledby="prestige-title"
      data-testid="prestige-modal"
      tabIndex={-1}
      style={backdropStyle}
    >
      <section aria-label="Prestige confirmation" style={panelStyle}>
        <header style={panelHeaderStyle}>
          <h2 id="prestige-title" style={{ margin: 0, fontSize: "1.25rem" }}>
            Prestige
          </h2>
          <button
            type="button"
            aria-label="Close prestige confirmation"
            data-testid="prestige-cancel"
            onClick={onClose}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
        </header>
        {shownRejection.ok ? null : (
          <p
            role="alert"
            data-testid="prestige-error"
            data-reason={shownRejection.reason}
            style={alertStyle}
          >
            {getCommandReasonMessage(shownRejection.reason)}
          </p>
        )}
        <p data-testid="prestige-warning" style={paragraphStyle}>
          This wipes the run: its currency, machines, and unlocks all reset to the start.
        </p>
        <p data-testid="prestige-plot-survives" style={paragraphStyle}>
          Prestige points, permanent multipliers, and the plot you already expanded all survive.
        </p>
        <dl style={listStyle}>
          <dt>Prestige points awarded</dt>
          <dd data-testid="prestige-preview-award" style={valueStyle}>
            {formatNumber(snapshot.prestigeAwardPoints)}
          </dd>
          <dt>Prestige points after</dt>
          <dd data-testid="prestige-preview-points" style={valueStyle}>
            {formatNumber(snapshot.prestigePoints + snapshot.prestigeAwardPoints)}
          </dd>
          <dt>Production speed</dt>
          <dd style={valueStyle}>
            <span data-testid="prestige-current-production">
              {formatNumber(snapshot.permanentMultipliers.productionSpeed)}
            </span>
            {" -> "}
            <strong data-testid="prestige-preview-production">
              {formatNumber(snapshot.prestigeNextMultipliers.productionSpeed)}
            </strong>
          </dd>
          <dt>Sell value</dt>
          <dd style={valueStyle}>
            <span data-testid="prestige-current-sell">
              {formatNumber(snapshot.permanentMultipliers.sellValue)}
            </span>
            {" -> "}
            <strong data-testid="prestige-preview-sell">
              {formatNumber(snapshot.prestigeNextMultipliers.sellValue)}
            </strong>
          </dd>
          <dt>Permanent plot expansion</dt>
          <dd style={valueStyle}>
            <span data-testid="prestige-expansion-cost">{formatNumber(GRID_EXPANSION_COST)}</span>
            {snapshot.expansionUnlocked ? " unlocked" : " after your first prestige"}
          </dd>
        </dl>
        <div style={actionsStyle}>
          <button
            ref={confirmRef}
            type="button"
            aria-label="Confirm prestige"
            data-testid="prestige-confirm"
            onClick={confirm}
            style={primaryButtonStyle}
          >
            Prestige now
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function resolveRejection(rejection: CommandResult, store: SimulationStore): CommandResult {
  if (rejection.ok) {
    return rejection;
  }

  return store.canResetPrestige();
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? numberFormatter.format(value) : "0";
}

const backdropStyle = {
  position: "fixed" as const,
  inset: 0,
  zIndex: 1000,
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "rgba(4, 8, 12, 0.68)",
  color: "#f5f7fa",
  fontFamily: "system-ui, sans-serif",
  pointerEvents: "auto" as const,
};

const panelStyle = {
  boxSizing: "border-box" as const,
  width: "min(480px, calc(100vw - 48px))",
  maxHeight: "calc(100vh - 48px)",
  overflowY: "auto" as const,
  padding: 24,
  border: "1px solid rgba(229, 242, 246, 0.35)",
  borderRadius: 10,
  background: "#101820",
  boxShadow: "0 18px 48px rgba(0, 0, 0, 0.4)",
  pointerEvents: "auto" as const,
};

const panelHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 16,
};

const paragraphStyle = {
  margin: "0 0 12px",
  fontSize: "0.9rem",
  lineHeight: 1.5,
};

const listStyle = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: "8px 16px",
  margin: "0 0 20px",
};

const valueStyle = {
  margin: 0,
  textAlign: "right" as const,
};

const actionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const alertStyle = {
  margin: "0 0 16px",
  padding: "10px 12px",
  border: "1px solid #a4553f",
  borderRadius: 6,
  background: "rgba(120, 45, 30, 0.35)",
  color: "#f7d9d0",
  fontSize: "0.9rem",
};

const primaryButtonStyle = {
  minHeight: 38,
  padding: "0 16px",
  border: 0,
  borderRadius: 6,
  background: "#36c5b5",
  color: "#101820",
  cursor: "pointer",
  font: "inherit" as const,
  fontWeight: 700,
};

const secondaryButtonStyle = {
  minHeight: 38,
  padding: "0 16px",
  border: "1px solid #58758a",
  borderRadius: 6,
  background: "#263746",
  color: "#f5f7fa",
  cursor: "pointer",
  font: "inherit" as const,
};

export default PrestigeModal;
