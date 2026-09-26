import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export interface ModalFocusOptions {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialFocusRef: RefObject<HTMLElement | null>;
  readonly dialogRef: RefObject<HTMLElement | null>;
}

interface AppliedInert {
  readonly element: HTMLElement;
  readonly inertAttribute: string | null;
  readonly ariaHiddenAttribute: string | null;
}

const focusableSelector =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";

const openDialogs: HTMLElement[] = [];
let appliedInert: readonly AppliedInert[] = [];

export function useModalFocus({
  open,
  onClose,
  initialFocusRef,
  dialogRef,
}: ModalFocusOptions): void {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    const dialog = dialogRef.current;
    if (dialog === null) {
      return undefined;
    }

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openDialog(dialog);
    initialFocusRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!isTopDialog(dialog)) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
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
      closeDialog(dialog);
      if (previousFocus?.isConnected === true) {
        previousFocus.focus();
      }
    };
  }, [dialogRef, initialFocusRef, open]);
}

function isTopDialog(dialog: HTMLElement): boolean {
  return openDialogs[openDialogs.length - 1] === dialog;
}

function openDialog(dialog: HTMLElement): void {
  openDialogs.push(dialog);
  applyInertToBackground();
}

function closeDialog(dialog: HTMLElement): void {
  const index = openDialogs.lastIndexOf(dialog);

  if (index >= 0) {
    openDialogs.splice(index, 1);
  }
  applyInertToBackground();
}

function applyInertToBackground(): void {
  restoreInert();

  const dialog = openDialogs[openDialogs.length - 1];
  if (dialog === undefined) {
    return;
  }

  const portal = dialog.parentElement === document.body ? dialog : dialog.parentElement;
  const targets = Array.from(document.body.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child !== portal &&
      !(portal?.contains(child) ?? false),
  );
  appliedInert = targets.map((element) => ({
    element,
    inertAttribute: element.getAttribute("inert"),
    ariaHiddenAttribute: element.getAttribute("aria-hidden"),
  }));
  for (const { element } of appliedInert) {
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  }
}

function restoreInert(): void {
  for (const { element, inertAttribute, ariaHiddenAttribute } of appliedInert) {
    if (inertAttribute === null) {
      element.removeAttribute("inert");
    } else {
      element.setAttribute("inert", inertAttribute);
    }
    if (ariaHiddenAttribute === null) {
      element.removeAttribute("aria-hidden");
    } else {
      element.setAttribute("aria-hidden", ariaHiddenAttribute);
    }
  }

  appliedInert = [];
}
