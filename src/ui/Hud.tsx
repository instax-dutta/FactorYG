import { useUiStore } from './store';
import { goalView } from './goalView';

function savedTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Hud() {
  const currency = useUiStore((state) => state.currency);
  const cps = useUiStore((state) => state.cps);
  const extractors = useUiStore((state) => state.extractors);
  const prestigeState = useUiStore((state) => state.prestigeState);
  const unlocks = useUiStore((state) => state.unlocks);
  const paused = useUiStore((state) => state.paused);
  const togglePause = useUiStore((state) => state.togglePause);
  const saveStatus = useUiStore((state) => state.saveStatus);
  const lastSavedAt = useUiStore((state) => state.lastSavedAt);

  // Until the scene has reported, there is no goal line: an empty factory that
  // has not been read yet must not be told it has built nothing.
  const goal = prestigeState
    ? goalView({
        lifetimeMotors: prestigeState.lifetimeMotors,
        extractors,
        motorRecipeUnlocked: (unlocks?.recipes ?? []).includes('motor'),
      })
    : null;
  const saveLabel =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'error'
        ? 'Save failed'
        : saveStatus === 'saved'
          ? `Saved${lastSavedAt === null ? '' : ` ${savedTime(lastSavedAt)}`}`
          : 'Not saved yet';

  return (
    <div
      data-testid="hud-panel"
      className="hud-panel"
      style={{
        padding: '10px 14px',
        borderRadius: 10,
        background: 'var(--color-panel)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)',
        font: '13px system-ui, sans-serif',
        pointerEvents: 'none',
      }}
    >
      <div data-testid="currency" style={{ fontSize: 20, fontWeight: 600 }}>
        {Math.floor(currency).toLocaleString()} cr
      </div>
      <div data-testid="cps" style={{ color: 'var(--color-muted)' }}>
        {cps.toFixed(1)} cr/s
      </div>
      {goal && (
        <div style={{ marginTop: 8 }}>
          <div data-testid="goal-title" style={{ fontWeight: 600 }}>
            {goal.title}
          </div>
          <div data-testid="goal-detail" style={{ color: 'var(--color-muted)', fontSize: 12 }}>
            {goal.detail}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <button
          type="button"
          data-testid="pause-toggle"
          aria-pressed={paused}
          onClick={togglePause}
          style={{
            pointerEvents: 'auto',
            padding: '3px 8px',
            borderRadius: 6,
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-control)',
            color: 'var(--color-text)',
            font: '12px system-ui, sans-serif',
            cursor: 'pointer',
          }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <div
          data-testid="save-status"
          data-status={saveStatus}
          data-last-saved-at={lastSavedAt ?? undefined}
          style={{ color: saveStatus === 'error' ? 'var(--color-danger)' : 'var(--color-muted)' }}
        >
          {saveLabel}
        </div>
      </div>
    </div>
  );
}
