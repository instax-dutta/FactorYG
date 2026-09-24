import type { Cell } from './placement';
import type { Entity, Simulation } from './simulation';

/**
 * Undo for factory edits.
 *
 * Machines are free, so this is not about money: it is about not having to
 * re-click a 20-belt run because the fourth belt is one cell off. Each entry
 * stores how to reverse *that* edit, so undo is exact rather than a replay of
 * the whole session — the rest of the factory is never touched.
 *
 * In-memory only, on purpose: undoing an edit made before a reload would need
 * the pre-reload world in the save, and a player who reloaded has already
 * accepted that state as the truth. Load and prestige clear it.
 */

export type HistoryEntry =
  | { kind: 'place'; cell: Cell }
  /** A dragged belt run: one edit, so one entry, however many cells it covered. */
  | { kind: 'run'; cells: Cell[] }
  | { kind: 'demolish'; entity: Entity }
  | { kind: 'move'; from: Cell; to: Cell };

export interface History {
  recordPlace(cell: Cell): void;
  recordRun(cells: Cell[]): void;
  /** Snapshots the machine, so a silo's buffer survives the round trip. */
  recordDemolish(entity: Entity): void;
  recordMove(from: Cell, to: Cell): void;
  undo(sim: Simulation): boolean;
  canUndo(): boolean;
  clear(): void;
}

export interface HistoryOptions {
  /** How many edits back the player can go. TUNE_AFTER_PLAYABLE. */
  limit?: number;
}

export const DEFAULT_HISTORY_LIMIT = 64;

export function createHistory(options: HistoryOptions = {}): History {
  const limit = Math.max(1, options.limit ?? DEFAULT_HISTORY_LIMIT);
  const entries: HistoryEntry[] = [];

  const push = (entry: HistoryEntry): void => {
    entries.push(entry);
    if (entries.length > limit) entries.shift();
  };

  return {
    recordPlace: (cell) => push({ kind: 'place', cell }),
    // Copied, and reversed: undo removes the run back-to-front, which is the
    // order downstream cells went in.
    recordRun: (cells) => push({ kind: 'run', cells: [...cells].reverse() }),
    recordDemolish: (entity) =>
      // A copy: the entry has to describe the machine as it was, not alias an
      // object the sim might keep mutating.
      push({ kind: 'demolish', entity: { ...entity, inputs: { ...entity.inputs } } }),
    recordMove: (from, to) => push({ kind: 'move', from, to }),
    canUndo: () => entries.length > 0,
    clear: () => {
      entries.length = 0;
    },
    undo: (sim) => {
      const entry = entries.pop();
      if (!entry) return false;
      if (entry.kind === 'place') {
        return sim.removeAt(entry.cell);
      }
      if (entry.kind === 'run') {
        // Whatever stands on these cells now is the player's, not ours: a belt
        // the player has since replaced with a smelter must survive the undo.
        for (const cell of entry.cells) {
          if (sim.entityAt(cell)?.type === 'belt') sim.removeAt(cell);
        }
        return true;
      }
      if (entry.kind === 'demolish') {
        sim.restoreEntity(entry.entity);
        return true;
      }
      // A move is undone by moving back. If the player has since built on the
      // original cell the move is refused, and the edit is simply skipped.
      return sim.move(entry.to, entry.from).ok;
    },
  };
}
