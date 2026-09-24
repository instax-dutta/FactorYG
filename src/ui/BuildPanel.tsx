import { useRef, useState } from 'react';
import { useUiStore, type Tool } from './store';
import { techEntries, toolLocks } from './techTreeView';
import { expansionView } from './expansionView';
import TechTreePanel from './TechTreePanel';
import Toasts from './Toasts';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'extractor', label: 'Extractor', hint: 'place on a resource node' },
  { id: 'belt', label: 'Belt', hint: 'carries one item per tick, and turns corners' },
  { id: 'crossing', label: 'Crossing', hint: 'two lines pass over one another; facing does not matter' },
  { id: 'splitter', label: 'Splitter', hint: 'one line feeds two; alternates exits, skips a blocked one' },
  { id: 'smelter', label: 'Smelter', hint: 'ore -> ingot; iron needs coal too' },
  { id: 'assembler', label: 'Assembler', hint: 'ingots -> components and products' },
  { id: 'silo', label: 'Silo', hint: 'buffers 50 items so a line cannot stall' },
  { id: 'depot', label: 'Depot', hint: 'sells deliveries' },
];

const ROTATION_LABEL: Record<string, string> = {
  '0': 'N',
  '90': 'E',
  '180': 'S',
  '270': 'W',
};

const MACHINE_LABELS: Record<Tool, string> = {
  extractor: 'Extractor',
  belt: 'Belt',
  crossing: 'Crossing',
  splitter: 'Splitter',
  smelter: 'Smelter',
  assembler: 'Assembler',
  silo: 'Storage Silo',
  depot: 'Depot',
};

export default function BuildPanel() {
  const selectedTool = useUiStore((state) => state.selectedTool);
  const rotation = useUiStore((state) => state.rotation);
  const keyboardCursor = useUiStore((state) => state.keyboardCursor);
  const keyboardAnnouncement = useUiStore((state) => state.keyboardAnnouncement);
  const selected = useUiStore((state) => state.selected);
  const unlocks = useUiStore((state) => state.unlocks);
  const canUndo = useUiStore((state) => state.canUndo);
  const plot = useUiStore((state) => state.plot);
  const currency = useUiStore((state) => state.currency);
  const buyExpansion = useUiStore((state) => state.buyExpansion);
  const setSelectedTool = useUiStore((state) => state.setSelectedTool);
  const rotate = useUiStore((state) => state.rotate);
  const undo = useUiStore((state) => state.undo);
  const techToggleRef = useRef<HTMLButtonElement>(null);
  const [techOpen, setTechOpen] = useState(false);

  const closeTech = (): void => {
    setTechOpen(false);
    requestAnimationFrame(() => techToggleRef.current?.focus());
  };

  // Until the scene reports a tree, gating is unknown, so nothing is disabled:
  // the sim still refuses a locked placement, this is only about the affordance.
  const locks = unlocks ? toolLocks(unlocks) : null;
  const tech = unlocks ? techEntries(unlocks, currency) : [];
  // Null until the first snapshot lands; the button simply stays idle until then.
  const expansion = plot ? expansionView({ currency, ...plot }) : null;
  const keyboardStatus = [
    keyboardCursor ? `Cell ${keyboardCursor.x}, ${keyboardCursor.y}` : '',
    `Selected machine: ${selected ? MACHINE_LABELS[selected.type] : 'empty'}`,
    `Tool: ${selectedTool ? MACHINE_LABELS[selectedTool] : 'none'}`,
    keyboardAnnouncement,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="build-stack">
      <div
        data-testid="keyboard-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          width: '100%',
          minHeight: 18,
          padding: '2px 8px',
          borderRadius: 6,
          background: 'var(--color-panel)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-muted)',
          font: '11px system-ui, sans-serif',
          lineHeight: '14px',
          textAlign: 'center',
          overflowWrap: 'anywhere',
          pointerEvents: 'none',
        }}
      >
        {keyboardStatus}
      </div>
      {techOpen && <TechTreePanel onClose={closeTech} />}
      <Toasts />
      <div
        data-testid="build-bar"
        className="build-bar"
        style={{
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 8,
          borderRadius: 10,
          background: 'var(--color-panel)',
          border: '1px solid var(--color-border)',
        }}
      >
        {TOOLS.map((tool) => {
          const locked = locks?.[tool.id] ?? false;
          const active = selectedTool === tool.id;
          const techEntry = tech.find((entry) => entry.id === tool.id && entry.kind === 'machine');
          const unlockable = techEntry?.status === 'available';
          const purse = Math.floor(currency);
          const fundsNeeded = techEntry ? Math.max(0, techEntry.cost - purse) : 0;
          const requirements = [
            ...(fundsNeeded > 0 ? [`${fundsNeeded} cr`] : []),
            ...(techEntry?.missing ?? []),
          ];
          const lockedState = techEntry
            ? requirements.length > 0
              ? `needs ${requirements.join(' + ')} in Tech`
              : 'ready in Tech'
            : `needs ${tool.label} in Tech`;
          const lockedLabel = techEntry
            ? `${techEntry.label} · ${techEntry.cost} cr · ${purse} cr purse · ${lockedState}`
            : tool.label;
          const lockedTitle = lockedLabel;
          return (
            <button
              key={tool.id}
              type="button"
              title={locked ? lockedTitle : tool.hint}
              data-testid={`tool-${tool.id}`}
              data-locked={locked ? 'true' : 'false'}
              data-affordable={unlockable ? 'true' : 'false'}
              disabled={locked}
              onClick={() => setSelectedTool(active ? null : tool.id)}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                background: active ? 'var(--color-control-active)' : 'var(--color-control)',
                color: locked ? 'var(--color-muted)' : 'var(--color-text)',
                font: '13px system-ui, sans-serif',
                cursor: locked ? 'not-allowed' : 'pointer',
              }}
            >
              {locked ? lockedLabel : tool.label}
            </button>
          );
        })}

        <button
          ref={techToggleRef}
          type="button"
          data-testid="tech-toggle"
          onClick={() => (techOpen ? closeTech() : setTechOpen(true))}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: `1px solid ${techOpen ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
            background: techOpen ? 'var(--color-control-active)' : 'var(--color-control)',
            color: 'var(--color-text)',
            font: '13px system-ui, sans-serif',
            cursor: 'pointer',
          }}
        >
          Tech
        </button>

        <button
          type="button"
          data-testid="rotate"
          onClick={rotate}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-control)',
            color: 'var(--color-text)',
            font: '13px system-ui, sans-serif',
            cursor: 'pointer',
          }}
        >
          ⟳ <span data-testid="rotation">{ROTATION_LABEL[String(rotation)]}</span>
        </button>

        <button
          type="button"
          data-testid="undo"
          data-enabled={canUndo ? 'true' : 'false'}
          disabled={!canUndo}
          title={canUndo ? 'Undo the last edit (⌘Z)' : 'Nothing to undo yet'}
          onClick={undo}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-control)',
            color: canUndo ? 'var(--color-text)' : 'var(--color-muted)',
            font: '13px system-ui, sans-serif',
            cursor: canUndo ? 'pointer' : 'not-allowed',
          }}
        >
          ↶ Undo
        </button>

        <button
          type="button"
          data-testid="expand-plot"
          data-affordable={expansion?.affordable ? 'true' : 'false'}
          disabled={!expansion?.affordable}
          title={
            expansion === null
              ? 'Waiting for the factory'
              : expansion.maxed
                ? 'The plot is fully expanded'
                : `Grow the plot to ${expansion.nextSize}x${expansion.nextSize} for ${expansion.price} cr`
          }
          onClick={buyExpansion}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-control)',
            color: expansion?.affordable ? 'var(--color-text)' : 'var(--color-muted)',
            font: '13px system-ui, sans-serif',
            cursor: expansion?.affordable ? 'pointer' : 'not-allowed',
          }}
        >
          {expansion?.maxed ? 'Plot maxed' : `⤢ Expand${expansion ? ` (${expansion.price})` : ''}`}
        </button>

        <span style={{ color: 'var(--color-muted)', font: '11px system-ui, sans-serif', marginLeft: 4 }}>
          R rotate · click place · click inspect · right-click demolish · ⇧drag move · ⌘Z undo ·
          drag/WASD pan · wheel zoom
        </span>
      </div>
    </div>
  );
}
