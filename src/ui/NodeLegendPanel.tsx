import { NODE_LEGEND, nodeLegendEntries } from './nodeLegend';
import { resourceLabel } from './resourceLabels';

/** The map legend (B5): what each resource-node disc color means. */
export default function NodeLegend() {
  return (
    <div
      data-testid="node-legend"
      className="node-legend"
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        background: 'var(--color-panel)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)',
        font: '12px system-ui, sans-serif',
      }}
    >
      <div style={{ color: 'var(--color-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        Resource nodes
      </div>
      {nodeLegendEntries().map(({ resource, color }) => (
        <div key={resource} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: `#${color.toString(16).padStart(6, '0')}`,
              display: 'inline-block',
            }}
          />
          <span>{resourceLabel(resource)}</span>
        </div>
      ))}
    </div>
  );
}

// Re-exported so App's single import stays tidy if consumers grow.
export { NODE_LEGEND };
