// @vitest-environment jsdom
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useModalFocus } from "../../src/ui/hooks/useModalFocus";

interface HarnessProps {
  readonly id: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

function Harness({ id, open, onClose }: HarnessProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocus({ open, onClose, initialFocusRef: closeRef, dialogRef });

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={true}
      data-testid={`dialog-${id}`}
      tabIndex={-1}
    >
      <button ref={closeRef} type="button" data-testid={`close-${id}`} onClick={onClose}>
        {`Close ${id}`}
      </button>
      <button type="button">{`Extra ${id}`}</button>
    </div>,
    document.body,
  );
}

function SingleDialog() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open first
      </button>
      <Harness id="first" open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function StackedDialogs({ startSecond }: { readonly startSecond: boolean }) {
  const [first, setFirst] = useState(true);
  const [secondClosed, setSecondClosed] = useState(false);

  return (
    <>
      <Harness id="first" open={first} onClose={() => setFirst(false)} />
      <Harness
        id="second"
        open={startSecond && !secondClosed}
        onClose={() => setSecondClosed(true)}
      />
    </>
  );
}

describe("useModalFocus", () => {
  it("moves focus to the initial control and makes the background inert while open", () => {
    const background = appendBackground({ inert: null, ariaHidden: null });

    try {
      render(<SingleDialog />);
      const dialog = screen.getByTestId("dialog-first");

      expect(screen.getByRole("button", { name: "Close first" })).toHaveFocus();
      expect(background.wrapper).toHaveAttribute("inert", "");
      expect(background.wrapper).toHaveAttribute("aria-hidden", "true");
      expect(dialog).not.toHaveAttribute("inert");
    } finally {
      background.wrapper.remove();
    }
  });

  it("traps Tab in both directions and pulls focus back from outside the dialog", () => {
    const background = appendBackground({ inert: null, ariaHidden: null });

    try {
      render(<SingleDialog />);
      const dialog = screen.getByTestId("dialog-first");
      const close = screen.getByRole("button", { name: "Close first" });
      const extra = screen.getByRole("button", { name: "Extra first" });

      close.focus();
      fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
      expect(extra).toHaveFocus();

      fireEvent.keyDown(extra, { key: "Tab" });
      expect(close).toHaveFocus();

      fireEvent.keyDown(close, { key: "Tab" });
      expect(close).toHaveFocus();

      fireEvent.keyDown(extra, { key: "Tab", shiftKey: true });
      expect(extra).toHaveFocus();

      background.button.focus();
      fireEvent.keyDown(background.button, { key: "Tab" });
      expect(close).toHaveFocus();

      background.button.focus();
      fireEvent.keyDown(background.button, { key: "Tab", shiftKey: true });
      expect(extra).toHaveFocus();

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      background.wrapper.remove();
    }
  });

  it("restores the background attributes it found and returns focus to the opener", () => {
    const background = appendBackground({ inert: "", ariaHidden: "true" });
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "Opener";
    document.body.append(opener);

    try {
      opener.focus();
      const view = render(<SingleDialog />);
      expect(background.wrapper).toHaveAttribute("aria-hidden", "true");

      fireEvent.keyDown(screen.getByTestId("dialog-first"), { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(background.wrapper).toHaveAttribute("inert", "");
      expect(background.wrapper).toHaveAttribute("aria-hidden", "true");
      expect(opener).toHaveFocus();
      view.unmount();
    } finally {
      opener.remove();
      background.wrapper.remove();
    }
  });

  it("keeps the open dialog steady when the owner re-renders with a new close handler", () => {
    const view = render(<SingleDialog />);
    const extra = screen.getByRole("button", { name: "Extra first" });

    extra.focus();
    view.rerender(<SingleDialog />);

    expect(extra).toHaveFocus();
    expect(screen.getByTestId("dialog-first")).not.toHaveAttribute("inert");

    fireEvent.keyDown(screen.getByTestId("dialog-first"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("gives the topmost dialog the keyboard and the focus when two are open", () => {
    const view = render(<StackedDialogs startSecond={false} />);
    const firstClose = screen.getByTestId("close-first");

    expect(firstClose).toHaveFocus();
    expect(screen.getByTestId("dialog-first")).not.toHaveAttribute("inert");
    expect(screen.queryByTestId("dialog-second")).not.toBeInTheDocument();

    view.rerender(<StackedDialogs startSecond />);

    const second = screen.getByTestId("dialog-second");

    expect(screen.getByRole("button", { name: "Close second" })).toHaveFocus();
    expect(second).not.toHaveAttribute("inert");
    expect(screen.getByTestId("dialog-first")).toHaveAttribute("inert", "");
    expect(screen.getByTestId("dialog-first")).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(second, { key: "Escape" });

    expect(screen.queryByTestId("dialog-second")).not.toBeInTheDocument();
    expect(screen.getByTestId("dialog-first")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("dialog-first")).not.toHaveAttribute("aria-hidden");
    expect(firstClose).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId("dialog-first"), { key: "Escape" });

    expect(screen.queryByTestId("dialog-first")).not.toBeInTheDocument();
  });
});

interface BackgroundElements {
  readonly wrapper: HTMLDivElement;
  readonly button: HTMLButtonElement;
}

function appendBackground(attributes: {
  inert: string | null;
  ariaHidden: string | null;
}): BackgroundElements {
  const wrapper = document.createElement("div");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Background action";
  wrapper.append(button);
  if (attributes.inert !== null) {
    wrapper.setAttribute("inert", attributes.inert);
  }
  if (attributes.ariaHidden !== null) {
    wrapper.setAttribute("aria-hidden", attributes.ariaHidden);
  }
  document.body.append(wrapper);
  return { wrapper, button };
}
