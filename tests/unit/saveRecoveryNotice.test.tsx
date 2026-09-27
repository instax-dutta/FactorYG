// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveRecoveryNotice } from "../../src/ui/components/SaveRecoveryNotice";
import { getSaveRecoveryMessage } from "../../src/ui/presentation";

const REJECTED = { reason: "invalidSave", message: 'Save field "grid" is invalid.' } as const;

describe("SaveRecoveryNotice", () => {
  it("renders nothing for a run that loaded without a rejection", () => {
    render(<SaveRecoveryNotice recovery={undefined} onAcknowledge={vi.fn()} />);

    expect(screen.queryByTestId("save-recovery-notice")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("tells the player the run started fresh, why, and takes focus to read it", () => {
    render(<SaveRecoveryNotice recovery={REJECTED} onAcknowledge={vi.fn()} />);

    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveAttribute("data-testid", "save-recovery-notice");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("data-reason", "invalidSave");
    expect(dialog).toHaveAttribute("data-recovery-message", 'Save field "grid" is invalid.');
    expect(screen.getByTestId("save-recovery-summary")).toHaveTextContent("started a new one");
    expect(screen.getByTestId("save-recovery-explanation")).toHaveTextContent(
      getSaveRecoveryMessage("invalidSave"),
    );
    expect(dialog).not.toHaveTextContent("invalidSave");
    expect(dialog).not.toHaveTextContent("Save field");
    expect(document.activeElement).toBe(screen.getByTestId("dismiss-save-recovery"));
  });

  it("reports the acknowledgement once and closes on the control", () => {
    const onAcknowledge = vi.fn();
    render(<SaveRecoveryNotice recovery={REJECTED} onAcknowledge={onAcknowledge} />);

    fireEvent.click(screen.getByTestId("dismiss-save-recovery"));

    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("save-recovery-notice")).toBeNull();
  });

  it("closes on Escape and still reports the acknowledgement", () => {
    const onAcknowledge = vi.fn();
    render(<SaveRecoveryNotice recovery={REJECTED} onAcknowledge={onAcknowledge} />);

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("save-recovery-notice")).toBeNull();
  });
});
