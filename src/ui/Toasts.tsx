import { useEffect } from 'react';
import { useUiStore } from './store';

const TOAST_DURATION_MS = 6_000;

export default function Toasts() {
  const status = useUiStore((state) => state.placementStatus);
  const toast = useUiStore((state) => state.toast);
  const recoveryPending = useUiStore((state) => state.recoveryPending);
  const setRecoveryPending = useUiStore((state) => state.setRecoveryPending);
  const showToast = useUiStore((state) => state.showToast);
  const clearToast = useUiStore((state) => state.clearToast);
  const message = toast?.message ?? status?.message ?? null;
  const tone =
    toast?.tone ??
    (status?.check.ok === false || status?.connection === 'disconnected' ? 'warning' : 'info');

  useEffect(() => {
    if (!recoveryPending) return;
    setRecoveryPending(false);
    showToast('Recovered from an unreadable save. A fresh factory is ready.', 'warning');
  }, [recoveryPending, setRecoveryPending, showToast]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => clearToast(toast.id), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [clearToast, toast]);

  return (
    <div
      data-testid="toasts"
      className="placement-toasts"
      data-connection={status?.connection}
      data-tone={tone}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        width: '100%',
        maxWidth: 'min(520px, calc(100vw - 24px))',
        minHeight: message ? 28 : 0,
        flex: '0 0 auto',
        alignSelf: 'center',
        pointerEvents: 'none',
        display: 'block',
        padding: message ? '6px 10px' : 0,
        borderRadius: 8,
        background: message ? 'var(--color-panel-strong)' : 'transparent',
        border: message ? '1px solid var(--color-border)' : 'none',
        color:
          tone === 'warning'
            ? 'var(--color-warning)'
            : tone === 'danger'
              ? 'var(--color-danger)'
              : tone === 'success'
                ? 'var(--color-success)'
                : 'var(--color-text)',
        font: '12px system-ui, sans-serif',
        lineHeight: message ? '18px' : 0,
        textAlign: 'center',
        overflowWrap: 'anywhere',
      }}
    >
      {toast ? (
        <span data-testid="toast-message">{toast.message}</span>
      ) : (
        <span data-testid="placement-status">{status?.message}</span>
      )}
    </div>
  );
}
