import Dialog from './Dialog';
import { resourceLabel } from './resourceLabels';
import { useUiStore } from './store';

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}

function formatAmount(amount: number): string {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function OfflineModal() {
  const offline = useUiStore((state) => state.offline);
  const dismissOffline = useUiStore((state) => state.dismissOffline);
  if (!offline) return null;

  return (
    <Dialog
      open
      title="Welcome back"
      onClose={dismissOffline}
      dismissOnBackdrop
      overlayTestId="offline-modal"
      panelTestId="offline-dialog"
    >
      <div data-testid="offline-elapsed" style={{ color: 'var(--color-muted)', marginTop: 4 }}>
        Away for {formatDuration(offline.elapsedSec)} · credited {formatDuration(offline.creditedSec)}
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0 0' }}>
        {offline.gains.map((gain) => (
          <li key={gain.chainId} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--color-muted)' }}>
              {resourceLabel(gain.outputResource)} × {formatAmount(gain.amount)}
            </span>
            <span>{Math.round(gain.currency).toLocaleString()} cr</span>
          </li>
        ))}
      </ul>

      <div
        data-testid="offline-total"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--color-border)',
          fontSize: 16,
          fontWeight: 600,
        }}
      >
        <span>Earned</span>
        <span>{Math.round(offline.totalCurrency).toLocaleString()} cr</span>
      </div>

      <button
        type="button"
        data-testid="offline-dismiss"
        onClick={dismissOffline}
        style={{
          marginTop: 16,
          width: '100%',
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid var(--color-accent)',
          background: 'var(--color-control-active)',
          color: 'var(--color-text)',
          cursor: 'pointer',
          font: '14px system-ui, sans-serif',
        }}
      >
        Back to the factory
      </button>
    </Dialog>
  );
}
