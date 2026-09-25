import type { SimulationStore } from "../../sim/store";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";

interface HudProps {
  store: SimulationStore;
}

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function Hud({ store }: HudProps) {
  const snapshot = useSimulationSnapshot(store);

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
        aria-describedby="prestige-unavailable"
        data-prestige-ready={snapshot.prestigeReady}
        data-testid="prestige-button"
        disabled
        title="Prestige will be available in a later phase"
        style={{
          pointerEvents: "auto",
          minHeight: 36,
          border: "1px solid #58758a",
          borderRadius: 6,
          background: "#34424c",
          color: "#c2cbd1",
          cursor: "not-allowed",
          font: "inherit",
          fontWeight: 700,
        }}
      >
        Prestige
      </button>
      <span
        id="prestige-unavailable"
        data-testid="prestige-unavailable"
        style={{ color: "#aab7bf", fontSize: "0.8rem" }}
      >
        Prestige is not available yet.
      </span>
    </section>
  );
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? numberFormatter.format(value) : "0";
}

export default Hud;
