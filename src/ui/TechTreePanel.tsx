import { useEffect } from 'react';
import { useUiStore } from './store';
import { techEntries, type NodeStatus } from './techTreeView';

const STATUS_LABEL: Record<NodeStatus, string> = {
  unlocked: 'owned',
  available: 'unlock',
  unaffordable: 'too expensive',
  locked: 'locked',
};

const STATUS_COLOR: Record<NodeStatus, string> = {
  unlocked: 'var(--color-success)',
  available: 'var(--color-accent)',
  unaffordable: 'var(--color-muted)',
  locked: 'var(--color-muted)',
};

/**
 * The tech tree. Every entry comes from `techEntries`, so the labels, costs and
 * prerequisites the player reads are the same ones the sim enforces — the panel
 * never decides for itself whether a node is buyable.
 */
export default function TechTreePanel({ onClose }: { onClose: () => void }) {
  const unlocks = useUiStore((state) => state.unlocks);
  const currency = useUiStore((state) => state.currency);
  const unlockNode = useUiStore((state) => state.unlockNode);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // No tree reported yet means no scene, i.e. nothing to spend on.
  if (!unlocks) return null;
  const entries = techEntries(unlocks, currency);

  return (
    <div
      data-testid="tech-panel"
      className="tech-panel"
      style={{
        padding: 12,
        borderRadius: 10,
        background: 'var(--color-panel-strong)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)',
        font: '12px system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Tech tree</strong>
        <span style={{ color: 'var(--color-muted)' }}>
          unlocks cost credits · prerequisites gate the order
        </span>
        <button
          type="button"
          data-testid="tech-close"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            padding: '2px 8px',
            borderRadius: 6,
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-control)',
            color: 'var(--color-text)',
            font: '12px system-ui, sans-serif',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      {entries.map((entry) => {
        const buyable = entry.status === 'available';
        return (
          <div
            key={entry.id}
            data-testid={`tech-entry-${entry.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <span style={{ minWidth: 110 }}>{entry.label}</span>
            <span style={{ color: 'var(--color-muted)', minWidth: 44 }}>{entry.cost} cr</span>
            <span
              data-testid={`tech-status-${entry.id}`}
              data-status={entry.status}
              style={{ color: STATUS_COLOR[entry.status], minWidth: 96 }}
            >
              {entry.status === 'locked'
                ? `needs ${entry.missing.join(' + ')}`
                : STATUS_LABEL[entry.status]}
            </span>
            <button
              type="button"
              data-testid={`tech-buy-${entry.id}`}
              disabled={!buyable}
              title={
                buyable
                  ? `Spend ${entry.cost} cr on ${entry.label}`
                  : `${entry.label} is ${STATUS_LABEL[entry.status]}`
              }
              onClick={() => unlockNode(entry.id)}
              style={{
                marginLeft: 'auto',
                padding: '3px 10px',
                borderRadius: 6,
                border: `1px solid ${buyable ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                background: buyable ? 'var(--color-control-active)' : 'var(--color-control-disabled)',
                color: buyable ? 'var(--color-text)' : 'var(--color-muted)',
                font: '12px system-ui, sans-serif',
                cursor: buyable ? 'pointer' : 'not-allowed',
              }}
            >
              Unlock
            </button>
          </div>
        );
      })}
    </div>
  );
}
