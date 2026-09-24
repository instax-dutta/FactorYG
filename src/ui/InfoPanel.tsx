import { useUiStore } from './store';
import { stateLabel, type MachineInfo } from './machineInfo';
import { resourceLabel } from './resourceLabels';
import type { ResourceId } from '../sim/worldgen';

/**
 * A depot has no rate because it is a sink; an idle crafter has none because it
 * has nothing to work on. Both are null in the sim, so the type tells them apart.
 */
function throughputLabel(info: MachineInfo): string {
  if (info.throughput !== null) return `${info.throughput.toFixed(1)} item/s`;
  return info.type === 'depot' ? 'sink' : 'idle';
}

/** What a machine is holding, or a dash when it is holding nothing. */
function formatBuffer(buffer: Partial<Record<ResourceId, number>>): string {
  const entries = Object.entries(buffer).filter(([, count]) => (count ?? 0) > 0);
  if (entries.length === 0) return 'nothing held';
  return entries
    .map(([resource, count]) => `${count}× ${resourceLabel(resource as ResourceId)}`)
    .join(', ');
}

export default function InfoPanel() {
  const selected = useUiStore((state) => state.selected);
  const inspectedCell = useUiStore((state) => state.inspectedCell);
  const currency = useUiStore((state) => state.currency);
  const demolishSelected = useUiStore((state) => state.demolishSelected);
  const upgradeSelected = useUiStore((state) => state.upgradeSelected);

  if (!inspectedCell) return null;

  // The panel only decides the affordance; the sim refuses a purchase the
  // player cannot pay for, so a stale readout can never spend for them.
  const upgradeCost = selected?.upgradeCost ?? null;
  const canAfford = upgradeCost !== null && currency >= upgradeCost;

  return (
    <div
      data-testid="info-panel"
      className="panel-card"
      style={{
        width: '100%',
        padding: '10px 14px',
        borderRadius: 10,
        background: 'var(--color-panel)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)',
        font: '13px system-ui, sans-serif',
      }}
    >
      <div style={{ color: 'var(--color-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
        Inspect
      </div>
      <div data-testid="info-type" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
        {selected ? selected.type : 'empty'}
      </div>
      <div data-testid="info-cell" style={{ color: 'var(--color-muted)' }}>
        {inspectedCell ? `${inspectedCell.x},${inspectedCell.y}` : '—'}
      </div>

      {selected && (
        <>
          <div data-testid="info-level" style={{ color: 'var(--color-muted)', marginTop: 6 }}>
            level {selected.level}
          </div>
          <div data-testid="info-throughput" style={{ color: 'var(--color-muted)' }}>
            {throughputLabel(selected)}
          </div>
          <div data-testid="info-gross" style={{ color: 'var(--color-muted)' }}>
            gross at current output:{' '}
            {selected.grossValuePerSecond === null
              ? '—'
              : `${selected.grossValuePerSecond.toFixed(1)} cr/s`}
          </div>
          <div data-testid="info-item" style={{ color: 'var(--color-muted)' }}>
            {stateLabel(selected.type, selected.item)}
          </div>
          <div data-testid="info-recipe" style={{ color: 'var(--color-muted)' }}>
            {selected.recipe ? `crafting ${resourceLabel(selected.recipe)}` : 'idle'}
          </div>
          <div data-testid="info-buffer" style={{ color: 'var(--color-muted)' }}>
            {formatBuffer(selected.buffer)}
          </div>
          <div data-testid="info-chain" style={{ color: 'var(--color-muted)' }}>
            {selected.reachesDepot ? 'feeding depot' : 'no depot on route'}
          </div>
          {upgradeCost !== null ? (
            <button
              type="button"
              data-testid="upgrade"
              disabled={!canAfford}
              title={
                canAfford
                  ? `Spend ${upgradeCost} cr to make this machine faster`
                  : `Needs ${upgradeCost} cr`
              }
              onClick={upgradeSelected}
              style={{
                marginTop: 8,
                width: '100%',
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${canAfford ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                background: canAfford ? 'var(--color-control-active)' : 'var(--color-control-disabled)',
                color: canAfford ? 'var(--color-text)' : 'var(--color-muted)',
                cursor: canAfford ? 'pointer' : 'not-allowed',
                font: '13px system-ui, sans-serif',
              }}
            >
              <span data-testid="upgrade-cost">Upgrade · {upgradeCost} cr</span>
            </button>
          ) : (
            <div
              data-testid="upgrade-cost"
              style={{ color: 'var(--color-muted)', marginTop: 8, textAlign: 'center' }}
            >
              {selected.upgradeable ? 'max level' : 'not upgradeable'}
            </div>
          )}
          <button
            type="button"
            data-testid="demolish"
            onClick={demolishSelected}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--color-danger-border)',
              background: 'var(--color-danger-surface)',
              color: 'var(--color-danger)',
              cursor: 'pointer',
              font: '13px system-ui, sans-serif',
            }}
          >
            Demolish
          </button>
        </>
      )}
    </div>
  );
}
