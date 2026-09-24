import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { serializeSim, applySave } from '../src/sim/save';
import {
  expansionCostFor,
  applyExpansion,
  MAX_EXPANSIONS_PER_AXIS,
  EXPANSION_STEP,
  BASE_GRID,
} from '../src/sim/expansion';

/**
 * Grid expansion — slice 3.2.
 *
 * Why it exists: the prestige loop (spec §51–52) asks the player to scale into
 * grid expansion as a currency sink, and the plan's slice 3.2 specifies +16 per
 * axis, refusal when unaffordable, and persistence through save.
 */

describe('expansion rules', () => {
  it('starts as the 64x64 base grid with nothing bought', () => {
    expect(BASE_GRID).toEqual({ width: 64, height: 64 });
    expect(MAX_EXPANSIONS_PER_AXIS).toBeGreaterThan(0);
  });

  it('grows bounds by EXPANSION_STEP per axis when purchased', () => {
    const first = applyExpansion({ width: 64, height: 64 }, 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.bounds.width).toBe(64 + EXPANSION_STEP);
    expect(first.bounds.height).toBe(64 + EXPANSION_STEP);
  });

  it('refuses to grow past the per-axis cap', () => {
    const maxed = {
      width: BASE_GRID.width + EXPANSION_STEP * MAX_EXPANSIONS_PER_AXIS,
      height: BASE_GRID.height + EXPANSION_STEP * MAX_EXPANSIONS_PER_AXIS,
    };
    expect(applyExpansion(maxed, MAX_EXPANSIONS_PER_AXIS).ok).toBe(false);
  });

  it('prices steps on a rising curve', () => {
    expect(expansionCostFor(0)).toBeGreaterThan(0);
    expect(expansionCostFor(1)).toBeGreaterThan(expansionCostFor(0));
    expect(expansionCostFor(2)).toBeGreaterThan(expansionCostFor(1));
  });
});

describe('Simulation expansion', () => {
  it('a fresh sim has the base bounds and zero expansions', () => {
    const sim = new Simulation();
    expect(sim.bounds()).toEqual(BASE_GRID);
    expect(sim.expansionsBought()).toBe(0);
  });

  it('buying an expansion grows placeable bounds and deducts currency', () => {
    const sim = new Simulation();
    const cost = expansionCostFor(0);
    sim.currency = cost;
    const before = sim.currency;

    const result = sim.buyExpansion();

    expect(result.ok).toBe(true);
    expect(sim.bounds().width).toBe(BASE_GRID.width + EXPANSION_STEP);
    expect(sim.bounds().height).toBe(BASE_GRID.height + EXPANSION_STEP);
    expect(sim.expansionsBought()).toBe(1);
    expect(sim.currency).toBe(before - cost);
  });

  it('refuses when currency is insufficient and nothing changes', () => {
    const sim = new Simulation();
    const result = sim.buyExpansion();
    expect(result.ok).toBe(false);
    expect(sim.bounds()).toEqual(BASE_GRID);
    expect(sim.expansionsBought()).toBe(0);
  });

  it('cells opened by expansion are placeable and closed cells are not', () => {
    const sim = new Simulation();
    // Just outside the base grid on the east edge.
    const outside = { x: BASE_GRID.width, y: 10 };
    expect(sim.canPlaceAt('belt', outside.x, outside.y).ok).toBe(false);

    sim.currency = expansionCostFor(0) * 10;
    expect(sim.buyExpansion().ok).toBe(true);

    // The band the step opened: everything up to the new bound is legal now.
    expect(sim.canPlaceAt('belt', outside.x, outside.y).ok).toBe(true);
    expect(
      sim.canPlaceAt('belt', sim.bounds().width, 10).ok,
    ).toBe(false);
  });

  it('serializes bounds + count and a save round-trips an expanded plot', () => {
    const sim = new Simulation();
    sim.currency = expansionCostFor(0) * 10;
    sim.buyExpansion();
    sim.place('belt', BASE_GRID.width + 2, 10, 0);

    const save = serializeSim(sim);
    expect(save.grid.width).toBe(BASE_GRID.width + EXPANSION_STEP);
    expect(save.grid.expansionsBought).toBe(1);

    const restored = new Simulation();
    applySave(restored, save);
    expect(restored.bounds().width).toBe(BASE_GRID.width + EXPANSION_STEP);
    expect(restored.expansionsBought()).toBe(1);
    // The machine placed in the expanded band survives the round trip.
    expect(restored.canPlaceAt('belt', BASE_GRID.width + 2, 10).ok).toBe(false);
  });

  it('an old save without the field loads at base bounds (migration-safe)', () => {
    const legacy = {
      version: 1,
      lastSavedAt: 0,
      currency: 0,
      grid: { width: BASE_GRID.width, height: BASE_GRID.height, entities: [] },
      productionChains: {},
    };
    const restored = new Simulation();
    applySave(restored, legacy);
    expect(restored.bounds()).toEqual(BASE_GRID);
    expect(restored.expansionsBought()).toBe(0);
  });

  it('prestige reset clears the factory and reverts the plot to base bounds', () => {
    const sim = new Simulation();
    sim.currency = expansionCostFor(0) * 10;
    sim.buyExpansion();
    sim.place('belt', 5, 5, 0);
    // A prestige refuses below the threshold — grant a real cycle's worth.
    sim.lifetimeMotors = 25;

    sim.prestige();

    expect(sim.bounds()).toEqual(BASE_GRID);
    expect(sim.expansionsBought()).toBe(0);
    expect(sim.entities().length).toBe(0);
  });
});
