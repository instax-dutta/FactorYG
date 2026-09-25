import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getResource } from "../../content/resources";
import type { SimulationStore } from "../../sim/store";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";

interface OfflineSummaryModalProps {
  store: SimulationStore;
}

interface BackgroundState {
  element: HTMLElement;
  inertAttribute: string | null;
  ariaHiddenAttribute: string | null;
}

const focusableSelector =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function OfflineSummaryModal({ store }: OfflineSummaryModalProps) {
  const snapshot = useSimulationSnapshot(store);
  const summary = snapshot.offlineSummary;
  const isOpen = summary !== undefined;
  const dialogRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => {
    store.dispatch({ type: "dismissOfflineSummary" });
  }, [store]);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") {
      return undefined;
    }

    const dialog = dialogRef.current;
    if (dialog === null) {
      return undefined;
    }

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const portalElement = dialog.parentElement === document.body ? dialog : dialog.parentElement;
    const background = Array.from(document.body.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child !== portalElement &&
        !(portalElement?.contains(child) ?? false),
    );
    const backgroundStates = background.map<BackgroundState>((element) => ({
      element,
      inertAttribute: element.getAttribute("inert"),
      ariaHiddenAttribute: element.getAttribute("aria-hidden"),
    }));
    for (const { element } of backgroundStates) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }

    continueRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.getAttribute("aria-hidden") !== "true",
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const activeElement = document.activeElement;
      if (!(activeElement instanceof Node) || !dialog.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      for (const state of backgroundStates) {
        if (state.inertAttribute === null) {
          state.element.removeAttribute("inert");
        } else {
          state.element.setAttribute("inert", state.inertAttribute);
        }
        if (state.ariaHiddenAttribute === null) {
          state.element.removeAttribute("aria-hidden");
        } else {
          state.element.setAttribute("aria-hidden", state.ariaHiddenAttribute);
        }
      }
      if (previousFocus?.isConnected === true) {
        previousFocus.focus();
      }
    };
  }, [dismiss, isOpen]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={true}
      aria-labelledby="offline-summary-title"
      data-testid="offline-summary-modal"
      tabIndex={-1}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        background: "rgba(4, 8, 12, 0.68)",
        color: "#f5f7fa",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "auto",
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
              {Object.entries(summary.chainUnits).map(([resource, units]) => {
                const label = getResource(resource)?.label ?? resource;
                return (
                  <li key={resource} data-testid={`offline-chain-${resource}`}>
                    {label}: {formatNumber(units)}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
          <button
            ref={continueRef}
            type="button"
            aria-label="Dismiss offline summary"
            data-testid="dismiss-offline-summary"
            onClick={dismiss}
            style={{
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
          <button
            type="button"
            aria-label="Close offline summary"
            data-testid="offline-close"
            onClick={dismiss}
            style={{
              minHeight: 38,
              padding: "0 16px",
              border: "1px solid #58758a",
              borderRadius: 6,
              background: "#263746",
              color: "#f5f7fa",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Close
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? numberFormatter.format(value) : "0";
}

function formatSeconds(value: number): string {
  return `${Number.isFinite(value) ? numberFormatter.format(value) : "0"}s`;
}

export default OfflineSummaryModal;
