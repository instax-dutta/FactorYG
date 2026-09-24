import { describe, it, expect } from 'vitest';
import { useUiStore, createThrottledPush } from '../src/ui/store';

describe('ui store bridge', () => {
  it('store exposes currency, cps, selectedTool, backend', () => {
    const state = useUiStore.getState();
    expect(state.currency).toBe(0);
    expect(state.cps).toBe(0);
    expect(state.selectedTool).toBeNull();
    expect(state.backend).toBeNull();

    let notified = 0;
    const unsubscribe = useUiStore.subscribe(() => {
      notified++;
    });

    useUiStore.getState().setSelectedTool('extractor');
    useUiStore.getState().setBackend('webgpu');

    expect(useUiStore.getState().selectedTool).toBe('extractor');
    expect(useUiStore.getState().backend).toBe('webgpu');
    expect(notified).toBeGreaterThan(0);
    unsubscribe();
  });

  it('tracks the keyboard cursor and its announcement', () => {
    expect(useUiStore.getState().keyboardCursor).toBeNull();
    expect(useUiStore.getState().keyboardAnnouncement).toBe('');

    useUiStore.getState().setKeyboardCursor({ x: 22, y: 24 });
    useUiStore.getState().setKeyboardAnnouncement('Placed Belt');

    expect(useUiStore.getState().keyboardCursor).toEqual({ x: 22, y: 24 });
    expect(useUiStore.getState().keyboardAnnouncement).toBe('Placed Belt');

    useUiStore.getState().setKeyboardCursor(null);
    useUiStore.getState().setKeyboardAnnouncement('');
  });

  it('clears placement status when the selected tool changes or is deselected', () => {
    const status = {
      check: { ok: true as const },
      connection: 'disconnected' as const,
      message: 'Disconnected - this machine will idle',
    };

    try {
      useUiStore.getState().setSelectedTool(null);
      useUiStore.getState().setPlacementStatus(status);
      useUiStore.getState().setSelectedTool('belt');
      expect(useUiStore.getState().placementStatus).toBeNull();

      useUiStore.getState().setPlacementStatus(status);
      useUiStore.getState().setSelectedTool('depot');
      expect(useUiStore.getState().placementStatus).toBeNull();

      useUiStore.getState().setPlacementStatus(status);
      useUiStore.getState().setSelectedTool(null);
      expect(useUiStore.getState().placementStatus).toBeNull();
    } finally {
      useUiStore.getState().setPlacementStatus(null);
      useUiStore.getState().setSelectedTool(null);
    }
  });

  it('exposes rotation and cycles it in 90° steps', () => {
    expect(useUiStore.getState().rotation).toBe(0);

    useUiStore.getState().rotate();
    expect(useUiStore.getState().rotation).toBe(90);
    useUiStore.getState().rotate();
    useUiStore.getState().rotate();
    useUiStore.getState().rotate();
    expect(useUiStore.getState().rotation).toBe(0);
  });

  it('tracks the inspected machine and cell for the info panel', () => {
    expect(useUiStore.getState().selected).toBeNull();
    expect(useUiStore.getState().inspectedCell).toBeNull();

    const info = {
      id: 'e1',
      type: 'extractor' as const,
      x: 22,
      y: 24,
      level: 1,
      item: null,
      recipe: null,
      buffer: {},
      throughput: 1,
      grossValuePerSecond: null,
      upgradeable: true,
      upgradeCost: 60,
      reachesDepot: false,
    };
    useUiStore.getState().selectMachine({ x: 22, y: 24 }, info);
    expect(useUiStore.getState().selected).toEqual(info);
    expect(useUiStore.getState().inspectedCell).toEqual({ x: 22, y: 24 });

    // Inspecting an empty cell still reports where the click landed.
    useUiStore.getState().selectMachine({ x: 5, y: 5 }, null);
    expect(useUiStore.getState().selected).toBeNull();
    expect(useUiStore.getState().inspectedCell).toEqual({ x: 5, y: 5 });
  });

  it('clears the inspected cell and machine together', () => {
    useUiStore.getState().selectMachine(
      { x: 22, y: 24 },
      {
        id: 'e1',
        type: 'extractor',
        x: 22,
        y: 24,
        level: 1,
        item: null,
        recipe: null,
        buffer: {},
        throughput: 1,
        grossValuePerSecond: null,
        upgradeable: true,
        upgradeCost: 60,
        reachesDepot: true,
      },
    );

    useUiStore.getState().clearSelection();

    // Clicking off the plot must leave nothing to show, not a stale machine.
    expect(useUiStore.getState().selected).toBeNull();
    expect(useUiStore.getState().inspectedCell).toBeNull();
  });

  it('shows and dismisses the offline summary', () => {
    expect(useUiStore.getState().offline).toBeNull();

    const report = {
      elapsedSec: 3600,
      creditedSec: 3600,
      gains: [{ chainId: 'chain-e1', outputResource: 'copperOre' as const, amount: 3600, currency: 1440 }],
      totalCurrency: 1440,
    };
    useUiStore.getState().showOffline(report);
    expect(useUiStore.getState().offline?.totalCurrency).toBe(1440);

    useUiStore.getState().dismissOffline();
    expect(useUiStore.getState().offline).toBeNull();
  });

  it('routes UI commands to the registered scene actions', () => {
    let demolished = 0;
    useUiStore.getState().registerActions({
      togglePause: () => {},
      demolishSelected: () => demolished++,
      unlockNode: () => {},
      upgradeSelected: () => {},
      undo: () => {},
      prestige: () => {},
      restart: () => {},
      buyExpansion: () => {},
    });
    useUiStore.getState().demolishSelected();
    expect(demolished).toBe(1);
  });

  it('carries the prestige state the prestige panel previews', () => {
    expect(useUiStore.getState().prestigeState).toBeNull();

    useUiStore.getState().setPrestigeState({
      lifetimeMotors: 50,
      points: 2,
      claimedPoints: 1,
      availablePoints: 1,
      totalPrestiges: 1,
      permanentMultipliers: { productionSpeed: 1.5, sellValue: 2 },
    });
    expect(useUiStore.getState().prestigeState).toMatchObject({
      points: 2,
      claimedPoints: 1,
      availablePoints: 1,
    });
  });

  it('forwards a prestige and a start-over to the scene, which owns the sim', () => {
    let prestiged = 0;
    let restarted = 0;
    useUiStore.getState().registerActions({
      togglePause: () => {},
      demolishSelected: () => {},
      unlockNode: () => {},
      upgradeSelected: () => {},
      undo: () => {},
      prestige: () => prestiged++,
      restart: () => restarted++,
      buyExpansion: () => {},
    });

    useUiStore.getState().prestige();
    useUiStore.getState().restart();

    // The store holds no factory state of its own: it asks the scene, so a
    // reset cannot half-happen in React and leave the sim behind.
    expect(prestiged).toBe(1);
    expect(restarted).toBe(1);
  });

  it('carries the unlock state the build panel gates on', () => {
    expect(useUiStore.getState().unlocks).toBeNull();

    const unlocks = { machines: ['extractor', 'belt', 'depot', 'smelter'] as const, recipes: [] };
    useUiStore.getState().setUnlocks({ machines: [...unlocks.machines], recipes: [] });
    expect(useUiStore.getState().unlocks?.machines).toEqual([...unlocks.machines]);
  });

  it('forwards an upgrade request to the scene, which owns the spending', () => {
    let upgraded = 0;
    useUiStore.getState().registerActions({
      togglePause: () => {},
      demolishSelected: () => {},
      unlockNode: () => {},
      upgradeSelected: () => upgraded++,
      undo: () => {},
      prestige: () => {},
      restart: () => {},
      buyExpansion: () => {},
    });

    useUiStore.getState().upgradeSelected();
    expect(upgraded).toBe(1);
  });

  it('carries whether there is an edit to undo, and forwards the request', () => {
    expect(useUiStore.getState().canUndo).toBe(false);
    useUiStore.getState().setCanUndo(true);
    expect(useUiStore.getState().canUndo).toBe(true);

    let undone = 0;
    useUiStore.getState().registerActions({
      togglePause: () => {},
      demolishSelected: () => {},
      unlockNode: () => {},
      upgradeSelected: () => {},
      undo: () => undone++,
      prestige: () => {},
      restart: () => {},
      buyExpansion: () => {},
    });
    useUiStore.getState().undo();
    expect(undone).toBe(1);
  });

  it('forwards an unlock request to the scene, which owns the spending', () => {
    const asked: string[] = [];
    useUiStore.getState().registerActions({
      togglePause: () => {},
      demolishSelected: () => {},
      unlockNode: (id) => asked.push(id),
      upgradeSelected: () => {},
      undo: () => {},
      prestige: () => {},
      restart: () => {},
      buyExpansion: () => {},
    });

    useUiStore.getState().unlockNode('assembler');

    // The store never spends currency itself: the sim is the single owner of
    // the purse, so a double click cannot cost the player twice.
    expect(asked).toEqual(['assembler']);
  });

  it('starts unpaused and routes pause toggles through the scene', () => {
    const previousActions = useUiStore.getState().actions;
    useUiStore.setState({ paused: false });
    useUiStore.getState().registerActions({
      ...previousActions,
      togglePause: () => useUiStore.getState().setPaused(!useUiStore.getState().paused),
    });

    expect(useUiStore.getState().paused).toBe(false);
    useUiStore.getState().togglePause();
    expect(useUiStore.getState().paused).toBe(true);
    useUiStore.getState().togglePause();
    expect(useUiStore.getState().paused).toBe(false);

    useUiStore.getState().registerActions(previousActions);
  });

  it('coalesces repeated save transitions and keeps the last successful timestamp on failure', () => {
    useUiStore.setState({ saveStatus: 'idle', lastSavedAt: null });
    const transitions: Array<[string, number | null]> = [];
    const unsubscribe = useUiStore.subscribe((state) => {
      transitions.push([state.saveStatus, state.lastSavedAt]);
    });

    try {
      useUiStore.getState().setSaveStatus('saving');
      useUiStore.getState().setSaveStatus('saving');
      useUiStore.getState().setSaveStatus('saved', 1_234);
      useUiStore.getState().setSaveStatus('saved', 1_234);
      useUiStore.getState().setSaveStatus('error');

      expect(transitions).toEqual([
        ['saving', null],
        ['saved', 1_234],
        ['error', 1_234],
      ]);
      expect(useUiStore.getState().lastSavedAt).toBe(1_234);
    } finally {
      unsubscribe();
    }
  });

  it('coalesces unchanged placement and live-region updates', () => {
    const status = {
      check: { ok: true as const },
      connection: 'disconnected' as const,
      message: 'Disconnected - this machine will idle',
    };
    let notifications = 0;
    const unsubscribe = useUiStore.subscribe(() => {
      notifications += 1;
    });

    try {
      useUiStore.getState().setPlacementStatus(status);
      useUiStore.getState().setPlacementStatus({ ...status, check: { ok: true } });
      useUiStore.getState().setKeyboardAnnouncement(status.message);
      useUiStore.getState().setKeyboardAnnouncement(status.message);

      expect(notifications).toBe(2);
    } finally {
      unsubscribe();
      useUiStore.getState().setPlacementStatus(null);
      useUiStore.getState().setKeyboardAnnouncement('');
    }
  });

  it('replaces one transient toast and clears placement feedback when it is shown', () => {
    useUiStore.setState({
      toast: null,
      placementStatus: {
        check: { ok: true },
        connection: 'disconnected',
        message: 'Disconnected - this machine will idle',
      },
    });

    useUiStore.getState().showToast('Unlocked Wire', 'success');
    useUiStore.getState().showToast('Factory paused', 'info');

    expect(useUiStore.getState().placementStatus).toBeNull();
    expect(useUiStore.getState().toast).toMatchObject({
      message: 'Factory paused',
      tone: 'info',
    });
    const toast = useUiStore.getState().toast;
    expect(toast).not.toBeNull();
    useUiStore.getState().clearToast(toast?.id);
    expect(useUiStore.getState().toast).toBeNull();
  });

  it('sim push updates subscribers at most ~10Hz (assert coalescing, not exact timing)', () => {
    let now = 1_000;
    const applied: number[] = [];
    const push = createThrottledPush<number>({
      apply: (value) => applied.push(value),
      hz: 10,
      now: () => now,
    });

    // Leading edge: the first value of a window goes straight through.
    push(1);
    expect(applied).toEqual([1]);

    // Burst inside the same window coalesces to the latest value only.
    push(2);
    push(3);
    push(4);
    expect(applied).toEqual([1]);

    // Next window drains the pending latest value and applies the new one.
    now += 100;
    push(5);
    expect(applied).toEqual([1, 4, 5]);

    // A window with no pushes applies nothing at all.
    now += 100;
    expect(applied).toEqual([1, 4, 5]);
    expect(push.flush()).toBe(false);

    // flush drains a coalesced value immediately (e.g. on save/tab-hide).
    now += 100;
    push(6);
    push(7);
    expect(push.flush()).toBe(true);
    expect(applied).toEqual([1, 4, 5, 6, 7]);
    expect(push.flush()).toBe(false);
  });
});
