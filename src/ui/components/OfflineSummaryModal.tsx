import type { SimulationStore } from "../../sim/store";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";

interface OfflineSummaryModalProps {
  store: SimulationStore;
}

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function OfflineSummaryModal({ store }: OfflineSummaryModalProps) {
  const snapshot = useSimulationSnapshot(store);
  const summary = snapshot.offlineSummary;

  if (summary === undefined) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="offline-summary-title"
      data-testid="offline-summary-modal"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        display: "grid",
        placeItems: "center",
        background: "rgba(4, 8, 12, 0.68)",
        color: "#f5f7fa",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <section
        aria-label="Offline summary"
        style={{
          width: "min(420px, calc(100vw - 48px))",
          padding: 24,
          border: "1px solid rgba(229, 242, 246, 0.35)",
          borderRadius: 10,
          background: "#101820",
          boxShadow: "0 18px 48px rgba(0, 0, 0, 0.4)",
          pointerEvents: "auto",
        }}
      >
        <h2 id="offline-summary-title" style={{ margin: "0 0 16px", fontSize: "1.25rem" }}>
          Welcome back
        </h2>
        <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px 16px", margin: 0 }}>
          <dt>Elapsed time</dt>
          <dd data-testid="offline-elapsed" style={{ margin: 0 }}>
            {formatSeconds(summary.elapsedSeconds)}
          </dd>
          <dt>Capped time</dt>
          <dd data-testid="offline-capped" style={{ margin: 0 }}>
            {formatSeconds(summary.cappedSeconds)}
          </dd>
          <dt>Earned currency</dt>
          <dd data-testid="offline-earned" style={{ margin: 0 }}>
            {formatNumber(summary.earnedCurrency)}
          </dd>
        </dl>
        <section aria-label="Chain units" data-testid="offline-chain-units" style={{ marginTop: 20 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>Chain units</h3>
          {Object.entries(summary.chainUnits).length === 0 ? (
            <p style={{ margin: 0 }}>No chain units recorded.</p>
          ) : (
            <ul style={{ display: "grid", gap: 6, margin: 0, paddingLeft: 20 }}>
              {Object.entries(summary.chainUnits).map(([resource, units]) => (
                <li key={resource} data-testid={`offline-chain-${resource}`}>
                  {resource}: {formatNumber(units)}
                </li>
              ))}
            </ul>
          )}
        </section>
        <button
          type="button"
          aria-label="Dismiss offline summary"
          data-testid="dismiss-offline-summary"
          onClick={() => store.dispatch({ type: "dismissOfflineSummary" })}
          style={{
            marginTop: 24,
            minHeight: 38,
            padding: "0 16px",
            border: 0,
            borderRadius: 6,
            background: "#36c5b5",
            color: "#101820",
            cursor: "pointer",
            font: "inherit",
            fontWeight: 700,
          }}
        >
          Continue
        </button>
      </section>
    </div>
  );
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? numberFormatter.format(value) : "0";
}

function formatSeconds(value: number): string {
  return `${Number.isFinite(value) ? numberFormatter.format(value) : "0"}s`;
}

export default OfflineSummaryModal;
