import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  dismissOnBackdrop?: boolean;
  overlayTestId?: string;
  panelTestId?: string;
  titleTestId?: string;
}

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let scrollLockCount = 0;
let previousBodyOverflow: string | null = null;
let previousAppShellOverflowY: string | null = null;

function lockBodyScroll(): void {
  if (scrollLockCount === 0) {
    const appShell = document.querySelector<HTMLElement>('.app-shell');
    previousBodyOverflow = document.body.style.overflow;
    previousAppShellOverflowY = appShell?.style.overflowY ?? null;
    document.body.style.overflow = 'hidden';
    if (appShell) appShell.style.overflowY = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    const appShell = document.querySelector<HTMLElement>('.app-shell');
    document.body.style.overflow = previousBodyOverflow ?? '';
    if (appShell && previousAppShellOverflowY !== null) appShell.style.overflowY = previousAppShellOverflowY;
    previousBodyOverflow = null;
    previousAppShellOverflowY = null;
  }
}

function getFocusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
  );
}

function focusFirst(panel: HTMLElement | null): void {
  if (!panel) return;
  const firstFocusable = getFocusableElements(panel)[0];
  (firstFocusable ?? panel).focus();
}

export default function Dialog({
  open,
  title,
  children,
  onClose,
  dismissOnBackdrop = false,
  overlayTestId = 'dialog-overlay',
  panelTestId = 'dialog-panel',
  titleTestId,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = `${useId()}-title`;

  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const panel = panelRef.current;
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      const focusOutside = activeElement === panel || !panel.contains(activeElement);
      if (event.shiftKey && (focusOutside || activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focusOutside || activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const activeElement = document.activeElement;
    previousFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    const panel = panelRef.current;
    focusFirst(panel);

    return () => {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      } else {
        document.body.focus();
      }
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-testid={overlayTestId}
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (dismissOnBackdrop) onClose();
        else focusFirst(panelRef.current);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        padding: 12,
        background: 'var(--color-overlay)',
        pointerEvents: 'auto',
      }}
    >
      <div
        ref={panelRef}
        data-testid={panelTestId}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          position: 'relative',
          zIndex: 1,
          width: 'min(360px, calc(100vw - 24px))',
          maxWidth: 'calc(100vw - 24px)',
          maxHeight: 'calc(100vh - 24px)',
          overflow: 'auto',
          padding: 20,
          borderRadius: 12,
          background: 'var(--color-panel-solid)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
          font: '13px system-ui, sans-serif',
        }}
      >
        <h2
          id={titleId}
          data-testid={titleTestId}
          style={{ margin: 0, fontSize: 18, fontWeight: 600 }}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
