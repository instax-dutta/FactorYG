import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SaveFailureReason } from "../../persistence/migrate";
import { useModalFocus } from "../hooks/useModalFocus";
import { getSaveRecoveryMessage } from "../presentation";

export interface SaveRecoveryNoticeProps {
  readonly recovery: Readonly<{ reason: SaveFailureReason; message?: string }> | undefined;
  readonly onAcknowledge: () => void;
}

export function SaveRecoveryNotice({ recovery, onAcknowledge }: SaveRecoveryNoticeProps) {
  const [told, setTold] = useState(false);
  const open = recovery !== undefined && !told;
  const dialogRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const acknowledge = useCallback(() => {
    setTold(true);
    onAcknowledge();
  }, [onAcknowledge]);

  useModalFocus({ open, onClose: acknowledge, initialFocusRef: dismissRef, dialogRef });

  if (recovery === undefined || told || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={true}
      aria-labelledby="save-recovery-title"
      aria-describedby="save-recovery-summary save-recovery-explanation"
      data-testid="save-recovery-notice"
      data-reason={recovery.reason}
      data-recovery-message={recovery.message}
      tabIndex={-1}
      style={backdropStyle}
    >
      <section aria-label="Save could not be read" style={panelStyle}>
        <h2 id="save-recovery-title" style={titleStyle}>
          Save could not be read
        </h2>
        <p id="save-recovery-summary" data-testid="save-recovery-summary" style={paragraphStyle}>
          Factor-I could not read your last run, so it started a new one. Nothing from the previous
          run is here.
        </p>
        <p
          id="save-recovery-explanation"
          data-testid="save-recovery-explanation"
          style={explanationStyle}
        >
          {getSaveRecoveryMessage(recovery.reason)}
        </p>
        <div style={actionsStyle}>
          <button
            ref={dismissRef}
            type="button"
            aria-label="Dismiss save recovery notice"
            data-testid="dismiss-save-recovery"
            onClick={acknowledge}
            style={primaryButtonStyle}
          >
            Start playing
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
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

const titleStyle = {
  margin: "0 0 16px",
  fontSize: "1.25rem",
};

const paragraphStyle = {
  margin: "0 0 12px",
  fontSize: "0.9rem",
  lineHeight: 1.5,
};

const explanationStyle = {
  ...paragraphStyle,
  padding: "10px 12px",
  border: "1px solid #a4553f",
  borderRadius: 6,
  background: "rgba(120, 45, 30, 0.35)",
  color: "#f7d9d0",
};

const actionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
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

export default SaveRecoveryNotice;
