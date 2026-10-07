import { useCallback, useState } from "react";
import { GRID_EXPANSION_COST } from "../../content/balance";
import { GRID_EXPANSION_STEP, GRID_MAX_SIZE } from "../../sim/constants";
import type { SimulationStore } from "../../sim/store";
import type { CommandResult } from "../../sim/types";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";
import { getCommandReasonMessage } from "../presentation";
import { PrestigeModal } from "./PrestigeModal";

interface HudProps {
  store: SimulationStore;
}

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function Hud({ store }: HudProps) {
  const snapshot = useSimulationSnapshot(store);
  const [prestigeOpen, setPrestigeOpen] = useState(false);
  const [expansion, setExpansion] = useState<CommandResult>({ ok: true });
  const closePrestige = useCallback(() => {
    setPrestigeOpen(false);
  }, []);

  const targetWidth = Math.min(snapshot.gridWidth + GRID_EXPANSION_STEP, GRID_MAX_SIZE);
  const targetHeight = Math.min(snapshot.gridHeight + GRID_EXPANSION_STEP, GRID_MAX_SIZE);
  const expansionPreflight = store.canExpandGrid(targetWidth, targetHeight);
  const shownExpansion = resolveExpansion(expansion, expansionPreflight);
  const expand = useCallback(() => {
    setExpansion(store.dispatch({ type: "expandGrid", width: targetWidth, height: targetHeight }));
  }, [store, targetHeight, targetWidth]);

  return (
    <section
      aria-label="Game status"
      data-testid="hud"
      style={{
        position: "absolute",
        top: 24,
        right: 24,
        zIndex: 3,
        display: "grid",
        gap: 8,
        minWidth: 190,
        padding: 16,
        border: "1px solid rgba(229, 242, 246, 0.28)",
        borderRadius: 8,
        background: "rgba(16, 24, 32, 0.88)",
        color: "#f5f7fa",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span>Currency</span>
        <strong data-testid="hud-currency">{formatNumber(snapshot.currency)}</strong>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span>Currency/sec</span>
        <strong data-testid="hud-currency-rate">{formatNumber(snapshot.currencyPerSecond)} / sec</strong>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span>Prestige points</span>
        <strong data-testid="hud-prestige-points">{formatNumber(snapshot.prestigePoints)}</strong>
      </div>
      <button
        type="button"
        aria-label="Prestige"
        aria-describedby={snapshot.prestigeReady ? undefined : "prestige-unavailable"}
        aria-expanded={prestigeOpen}
        data-prestige-ready={snapshot.prestigeReady}
        data-testid="prestige-button"
        disabled={!snapshot.prestigeReady}
        onClick={() => {
          setPrestigeOpen(true);
        }}
        title={
          snapshot.prestigeReady
            ? "Reset this run for permanent prestige points"
            : getCommandReasonMessage("insufficientLifetimeCurrency")
        }
        style={snapshot.prestigeReady ? enabledButtonStyle : disabledButtonStyle}
      >
        Prestige
      </button>
      {snapshot.prestigeReady ? null : (
        <span
          id="prestige-unavailable"
          data-testid="prestige-unavailable"
          style={noteStyle}
        >
          {getCommandReasonMessage("insufficientLifetimeCurrency")}
        </span>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span>Plot size</span>
        <strong data-testid="expand-plot-size">
          {snapshot.gridWidth} x {snapshot.gridHeight}
        </strong>
      </div>
      <button
        type="button"
        aria-label="Expand plot"
        data-cost={GRID_EXPANSION_COST}
        data-reason={shownExpansion.reason ?? ""}
        data-testid="expand-grid-button"
        disabled={!expansionPreflight.ok}
        onClick={expand}
        title={
          expansionPreflight.ok
            ? `Grow the plot to ${targetWidth} x ${targetHeight} for ${formatNumber(GRID_EXPANSION_COST)}`
            : getCommandReasonMessage(shownExpansion.reason)
        }
        style={expansionPreflight.ok ? enabledButtonStyle : disabledButtonStyle}
      >
        Expand plot
      </button>
      <span data-testid="expand-cost" style={noteStyle}>
        Costs {formatNumber(GRID_EXPANSION_COST)}
      </span>
      {shownExpansion.ok ? null : (
        <span
          data-testid="expand-blocked"
          data-reason={shownExpansion.reason}
          style={noteStyle}
        >
          {getCommandReasonMessage(shownExpansion.reason)}
        </span>
      )}
      <PrestigeModal store={store} open={prestigeOpen} onClose={closePrestige} />
    </section>
  );
}

function resolveExpansion(
  expansion: CommandResult,
  preflight: CommandResult,
): CommandResult {
  if (!preflight.ok) {
    return preflight;
  }

  return expansion;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? numberFormatter.format(value) : "0";
}

const noteStyle = {
  color: "#aab7bf",
  fontSize: "0.8rem",
};

const enabledButtonStyle = {
  pointerEvents: "auto" as const,
  minHeight: 36,
  border: "1px solid #36c5b5",
  borderRadius: 6,
  background: "#1f4b4a",
  color: "#f5f7fa",
  cursor: "pointer",
  font: "inherit" as const,
  fontWeight: 700,
};

// A disabled control is inert for hit-testing as well, so clicks reach the canvas.
const disabledButtonStyle = {
  ...enabledButtonStyle,
  border: "1px solid #58758a",
  background: "#34424c",
  color: "#c2cbd1",
  cursor: "not-allowed",
  pointerEvents: "none" as const,
};

export default Hud;
