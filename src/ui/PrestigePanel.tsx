import { useState } from 'react';
import Dialog from './Dialog';
import { useUiStore } from './store';
import { prestigeView } from './prestigeView';

/**
 * Slice 3.3: the two destructive controls, and the confirmation they need.
 *
 * Both of them throw a factory away, so neither is a single click: the click
 * opens a modal that says what is lost. Prestige keeps the points and the tech
 * tree and is refused below the threshold; start over is the escape hatch for a
 * factory that is a mess, and takes everything.
 */

type Confirming = 'prestige' | 'restart' | null;

const buttonStyle = (enabled: boolean, danger = false) => ({
  width: '100%',
  marginTop: 8,
  padding: '6px 10px',
  borderRadius: 8,
  border: `1px solid ${enabled ? (danger ? 'var(--color-danger-border)' : 'var(--color-accent)') : 'var(--color-border-strong)'}`,
  background: enabled
    ? danger
      ? 'var(--color-danger-strong)'
      : 'var(--color-control-active)'
    : 'var(--color-control-disabled)',
  color: enabled ? 'var(--color-text)' : 'var(--color-muted)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  font: '13px system-ui, sans-serif',
});

export default function PrestigePanel() {
  const prestigeState = useUiStore((state) => state.prestigeState);
  const prestige = useUiStore((state) => state.prestige);
  const restart = useUiStore((state) => state.restart);
  const [confirming, setConfirming] = useState<Confirming>(null);

  // Null is "the scene has not reported yet", not "no points". Nothing is drawn
  // until there is real state, so the panel never offers a reset on a guess.
  if (!prestigeState) return null;
  const view = prestigeView(prestigeState);

  const accept = (): void => {
    if (confirming === 'prestige') prestige();
    if (confirming === 'restart') restart();
    setConfirming(null);
  };

  return (
    <>
      <div
        data-testid="prestige-panel"
        className="panel-card"
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 10,
          background: 'var(--color-panel)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
          font: '13px system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            color: 'var(--color-muted)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          <span>Prestige</span>
          <span data-testid="prestige-cycles">{view.cycles}</span>
        </div>

        <div data-testid="prestige-bonus" style={{ marginTop: 4 }}>
          {view.bonus}
        </div>
        <div data-testid="prestige-detail" style={{ color: 'var(--color-muted)', marginTop: 2 }}>
          {view.detail}
        </div>

        <button
          type="button"
          data-testid="prestige"
          data-enabled={view.enabled ? 'true' : 'false'}
          disabled={!view.enabled}
          title={view.enabled ? view.cost : view.detail}
          onClick={() => setConfirming('prestige')}
          style={buttonStyle(view.enabled)}
        >
          <span data-testid="prestige-label">{view.label}</span>
        </button>

        <button
          type="button"
          data-testid="reset"
          data-enabled="true"
          title="Wipe the save and start a new factory"
          onClick={() => setConfirming('restart')}
          style={buttonStyle(true, true)}
        >
          Start over
        </button>
      </div>

      {confirming && (
        <Dialog
          open
          title={
            confirming === 'prestige'
              ? `Prestige for ${view.points} point${view.points === 1 ? '' : 's'}?`
              : 'Start over from scratch?'
          }
          onClose={() => setConfirming(null)}
          overlayTestId="confirm-modal"
          panelTestId="confirm-dialog"
          titleTestId="confirm-title"
        >
          <div data-testid="confirm-body" style={{ color: 'var(--color-muted)', marginTop: 6 }}>
            {confirming === 'prestige'
              ? `${view.cost}. After the reset: ${view.detail}.`
              : 'Wipes the saved game, the factory, the tech tree and every prestige point. There is no undo for this one.'}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              data-testid="confirm-yes"
              onClick={accept}
              style={buttonStyle(true, confirming === 'restart')}
            >
              {confirming === 'prestige' ? 'Prestige' : 'Start over'}
            </button>
            <button
              type="button"
              data-testid="confirm-no"
              onClick={() => setConfirming(null)}
              style={buttonStyle(true)}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
