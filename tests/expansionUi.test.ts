import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { useUiStore, createThrottledPush } from '../src/ui/store';
import { expansionCostFor, EXPANSION_STEP, BASE_GRID } from '../src/sim/expansion';
import { expansionView } from '../src/ui/expansionView';

/**
 * Expansion UI — the browser half of slice 3.2.
 *
 * The sim already refuses unaffordable purchases; this layer only has to show
 * the truth: what the plot is now, what the next step costs, and whether the
 * player can afford it.
 */

describe('sim snapshot', () => {
  it('carries plot bounds and expansion count', () => {
    const sim = new Simulation();
    const snap = sim.snapshot();
    expect(snap.plot).toEqual({ ...BASE_GRID, expansionsBought: 0 });

    sim.currency = expansionCostFor(0);
    sim.buyExpansion();
    expect(sim.snapshot().plot).toEqual({
      width: BASE_GRID.width + EXPANSION_STEP,
      height: BASE_GRID.height + EXPANSION_STEP,
      expansionsBought: 1,
    });
  });
});

describe('expansionView', () => {
  it('offers the next step with its price while affordable', () => {
    const view = expansionView({
      currency: expansionCostFor(0),
      width: BASE_GRID.width,
      height: BASE_GRID.height,
      expansionsBought: 0,
    });
    expect(view.affordable).toBe(true);
    expect(view.price).toBe(expansionCostFor(0));
    expect(view.nextSize).toBe(BASE_GRID.width + EXPANSION_STEP);
    expect(view.maxed).toBe(false);
  });

  it('reads unaffordable without lying about the price', () => {
    const view = expansionView({
      currency: 1,
      width: BASE_GRID.width,
      height: BASE_GRID.height,
      expansionsBought: 0,
    });
    expect(view.affordable).toBe(false);
    expect(view.price).toBe(expansionCostFor(0));
  });

  it('is maxed at the per-axis cap and prices nothing', () => {
    const view = expansionView({
      currency: 1e9,
      width: BASE_GRID.width + EXPANSION_STEP * 4,
      height: BASE_GRID.height + EXPANSION_STEP * 4,
      expansionsBought: 4,
    });
    expect(view.maxed).toBe(true);
    expect(view.affordable).toBe(false);
    expect(view.price).toBeNull();
  });
});

describe('store bridge', () => {
  it('setPlot stores the reported plot', () => {
    useUiStore.getState().setPlot({ width: 80, height: 80, expansionsBought: 1 });
    expect(useUiStore.getState().plot).toEqual({ width: 80, height: 80, expansionsBought: 1 });
  });

  it('throttled push applies the snapshot plot into the store', () => {
    const sim = new Simulation();
    sim.currency = expansionCostFor(0);
    sim.buyExpansion();

    const push = createThrottledPush<ReturnType<Simulation['snapshot']>>({
      // Exactly the wiring SceneView will use: the apply callback lands the
      // snapshot's plot in the store.
      apply: (snapshot) => useUiStore.getState().setPlot(snapshot.plot),
      hz: 10_000,
      now: () => 0,
    });
    push(sim.snapshot());
    expect(useUiStore.getState().plot?.width).toBe(BASE_GRID.width + EXPANSION_STEP);
  });

  it('buyExpansion forwards to the registered scene action', () => {
    let calls = 0;
    useUiStore.getState().registerActions({
      ...useUiStore.getState().actions,
      buyExpansion: () => {
        calls += 1;
      },
    });
    useUiStore.getState().actions.buyExpansion();
    expect(calls).toBe(1);
  });
});
