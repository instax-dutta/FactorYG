import { create } from 'zustand';
import type { MachineType, Rotation } from '../sim/machines';
import { rotateCW } from '../sim/machines';
import type { OfflineReport } from '../sim/offline';
import type { UnlockState } from '../sim/techTree';
import type { PrestigeState } from '../sim/prestige';
import type { RenderBackend } from '../render/rendererFactory';
import type { MachineInfo } from './machineInfo';
import type { Cell, PlacementPreview } from '../sim/placement';

export type Tool = MachineType;
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

export type { MachineInfo } from './machineInfo';

/** Commands the scene (three.js) exposes so DOM UI can drive the factory. */
export interface UiActions {
  demolishSelected: () => void;
  togglePause: () => void;
  /** Spends sim currency on a tech node. The sim owns the purse, not the UI. */
  unlockNode: (id: string) => void;
  /** Buys one level for the inspected machine. */
  upgradeSelected: () => void;
  /** Reverses the last edit (place, demolish or move). */
  undo: () => void;
  /** Spends the factory for permanent multipliers (refused below the threshold). */
  prestige: () => void;
  /** Wipes the save and starts a new player. */
  restart: () => void;
  /** Buys one grid expansion step. The sim owns the purse and the refusal. */
  buyExpansion: () => void;
}

export interface UiState {
  currency: number;
  cps: number;
  selectedTool: Tool | null;
  rotation: Rotation;
  keyboardCursor: Cell | null;
  keyboardAnnouncement: string;
  backend: RenderBackend | null;
  /** Machine under inspection, or the last inspected cell (null = empty). */
  selected: MachineInfo | null;
  inspectedCell: { x: number; y: number } | null;
  offline: OfflineReport | null;
  recoveryPending: boolean;
  paused: boolean;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  toast: ToastMessage | null;
  /**
   * The player's tech tree, or null before the scene has reported one. A null
   * state is "not known yet", not "everything is locked": the panel holds off
   * on gating rather than flashing every tool as locked on first paint, and the
   * sim refuses locked placements either way.
   */
  unlocks: UnlockState | null;
  /** Whether the scene's edit history has anything to reverse. */
  canUndo: boolean;
  /** Points, resets and multipliers, or null before the scene reports them. */
  prestigeState: PrestigeState | null;
  /** Extractors on the map. The goal line uses it to tell a first minute from a first hour. */
  extractors: number;
  /** The placeable plot, or null before the scene has reported it. */
  plot: { width: number; height: number; expansionsBought: number } | null;
  placementStatus: PlacementPreview | null;
  actions: UiActions;
  setSelectedTool: (tool: Tool | null) => void;
  rotate: () => void;
  setKeyboardCursor: (cell: Cell | null) => void;
  setKeyboardAnnouncement: (announcement: string) => void;
  setBackend: (backend: RenderBackend | null) => void;
  setEconomy: (currency: number, cps: number) => void;
  setExtractors: (extractors: number) => void;
  setUnlocks: (unlocks: UnlockState) => void;
  unlockNode: (id: string) => void;
  upgradeSelected: () => void;
  setCanUndo: (canUndo: boolean) => void;
  undo: () => void;
  setPrestigeState: (prestigeState: PrestigeState) => void;
  prestige: () => void;
  restart: () => void;
  buyExpansion: () => void;
  setPlot: (plot: { width: number; height: number; expansionsBought: number }) => void;
  setPlacementStatus: (status: PlacementPreview | null) => void;
  selectMachine: (cell: { x: number; y: number }, info: MachineInfo | null) => void;
  /** Drops the inspected cell and machine, e.g. when clicking off the plot. */
  clearSelection: () => void;
  showOffline: (report: OfflineReport) => void;
  dismissOffline: () => void;
  setRecoveryPending: (recoveryPending: boolean) => void;
  setPaused: (paused: boolean) => void;
  togglePause: () => void;
  setSaveStatus: (saveStatus: SaveStatus, lastSavedAt?: number) => void;
  showToast: (message: string, tone?: ToastTone) => void;
  clearToast: (id?: number) => void;
  registerActions: (actions: UiActions) => void;
  demolishSelected: () => void;
}

let toastSequence = 0;

function sameCell(left: Cell | null, right: Cell | null): boolean {
  return left === right || (left !== null && right !== null && left.x === right.x && left.y === right.y);
}

function samePlacement(left: PlacementPreview | null, right: PlacementPreview | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  const sameCheck =
    left.check.ok && right.check.ok
      ? true
      : !left.check.ok && !right.check.ok && left.check.reason === right.check.reason;
  return left.connection === right.connection && left.message === right.message && sameCheck;
}

/**
 * React owns UI only. The sim never writes here directly — it pushes through
 * the throttled bridge below, so a 10tps sim cannot drive a render per tick.
 */
export const useUiStore = create<UiState>((set, get) => ({
  currency: 0,
  cps: 0,
  selectedTool: null,
  rotation: 0,
  keyboardCursor: null,
  keyboardAnnouncement: '',
  backend: null,
  selected: null,
  inspectedCell: null,
  offline: null,
  recoveryPending: false,
  paused: false,
  saveStatus: 'idle',
  lastSavedAt: null,
  toast: null,
  unlocks: null,
  canUndo: false,
  prestigeState: null,
  extractors: 0,
  plot: null,
  placementStatus: null,
  actions: {
    demolishSelected: () => {},
    togglePause: () => {},
    unlockNode: () => {},
    upgradeSelected: () => {},
    undo: () => {},
    prestige: () => {},
    restart: () => {},
    buyExpansion: () => {},
  },
  setSelectedTool: (selectedTool) => set({ selectedTool, placementStatus: null, keyboardAnnouncement: '' }),
  rotate: () => set({ rotation: rotateCW(get().rotation) }),
  setKeyboardCursor: (keyboardCursor) => {
    if (sameCell(get().keyboardCursor, keyboardCursor)) return;
    set({ keyboardCursor });
  },
  setKeyboardAnnouncement: (keyboardAnnouncement) => {
    if (get().keyboardAnnouncement === keyboardAnnouncement) return;
    set({ keyboardAnnouncement });
  },
  setBackend: (backend) => set({ backend }),
  setEconomy: (currency, cps) => set({ currency, cps }),
  setExtractors: (extractors) => set({ extractors }),
  setUnlocks: (unlocks) => set({ unlocks }),
  unlockNode: (id) => get().actions.unlockNode(id),
  upgradeSelected: () => get().actions.upgradeSelected(),
  setCanUndo: (canUndo) => set({ canUndo }),
  undo: () => get().actions.undo(),
  setPrestigeState: (prestigeState) => set({ prestigeState }),
  setPlot: (plot) => set({ plot }),
  setPlacementStatus: (placementStatus) => {
    if (samePlacement(get().placementStatus, placementStatus)) return;
    set({ placementStatus });
  },
  prestige: () => get().actions.prestige(),
  restart: () => get().actions.restart(),
  buyExpansion: () => get().actions.buyExpansion(),
  selectMachine: (inspectedCell, selected) => set({ inspectedCell, selected }),
  clearSelection: () => set({ inspectedCell: null, selected: null }),
  showOffline: (offline) => set({ offline }),
  dismissOffline: () => set({ offline: null }),
  setRecoveryPending: (recoveryPending) => set({ recoveryPending }),
  setPaused: (paused) => set({ paused }),
  togglePause: () => get().actions.togglePause(),
  setSaveStatus: (saveStatus, lastSavedAt) => {
    const state = get();
    const nextLastSavedAt = lastSavedAt ?? state.lastSavedAt;
    if (state.saveStatus === saveStatus && state.lastSavedAt === nextLastSavedAt) return;
    set({ saveStatus, lastSavedAt: nextLastSavedAt });
  },
  showToast: (message, tone = 'info') => {
    toastSequence += 1;
    set({ toast: { id: toastSequence, message, tone }, placementStatus: null });
  },
  clearToast: (id) => {
    if (id !== undefined && get().toast?.id !== id) return;
    set({ toast: null });
  },
  registerActions: (actions) => set({ actions }),
  demolishSelected: () => get().actions.demolishSelected(),
}));

export interface ThrottledPush<T> {
  (value: T): void;
  /** Applies a pending coalesced value now. Returns whether anything was pending. */
  flush: () => boolean;
}

/**
 * Coalescing rate limiter for sim -> UI pushes: leading edge applies
 * immediately, everything else in the window collapses to the latest value.
 */
export function createThrottledPush<T>(options: {
  apply: (value: T) => void;
  hz: number;
  now: () => number;
}): ThrottledPush<T> {
  const intervalMs = 1000 / options.hz;
  let lastAppliedAt = Number.NEGATIVE_INFINITY;
  let pending: T | undefined;
  let hasPending = false;

  const push = ((value: T) => {
    const t = options.now();
    if (t - lastAppliedAt >= intervalMs) {
      if (hasPending) {
        const queued = pending as T;
        hasPending = false;
        pending = undefined;
        options.apply(queued);
      }
      options.apply(value);
      lastAppliedAt = t;
      return;
    }
    pending = value;
    hasPending = true;
  }) as ThrottledPush<T>;

  push.flush = () => {
    if (!hasPending) return false;
    const queued = pending as T;
    hasPending = false;
    pending = undefined;
    lastAppliedAt = options.now();
    options.apply(queued);
    return true;
  };

  return push;
}
