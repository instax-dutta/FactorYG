import { describe, it, expect } from 'vitest';
import { machineInfoFor, stateLabel } from '../src/ui/machineInfo';
import { TICK_HZ } from '../src/config/constants';
import { RECIPES } from '../src/sim/recipes';
import { MAX_MACHINE_LEVEL, nextUpgradeCost } from '../src/sim/upgrades';
import type { Entity } from '../src/sim/simulation';

const entity = (overrides: Partial<Entity>): Entity => ({
  id: 'e1',
  type: 'belt',
  x: 1,
  y: 2,
  rotation: 90,
  level: 1,
  resourceNode: null,
  item: null,
  inputs: {},
  recipe: null,
  progress: 0,
  ...overrides,
});

describe('inspector machine info', () => {
  it('reports an extractor at its extraction rate', () => {
    const info = machineInfoFor(
      entity({ type: 'extractor', resourceNode: 'copperOre', item: 'copperOre' }),
      false,
    );

    expect(info.throughput).toBeCloseTo(TICK_HZ / 10, 6);
    expect(info.item).toBe('copperOre');
    expect(info.recipe).toBeNull();
    expect(info.reachesDepot).toBe(false);
  });

  it('reports a crafter at the rate of the recipe it is running', () => {
    const info = machineInfoFor(entity({ type: 'smelter', recipe: 'ironIngot' }), true);

    expect(info.recipe).toBe('ironIngot');
    expect(info.throughput).toBeCloseTo(TICK_HZ / RECIPES.ironIngot.ticks, 6);
    expect(info.reachesDepot).toBe(true);
  });

  it('reports an idle crafter as having no throughput', () => {
    const info = machineInfoFor(entity({ type: 'assembler' }), false);

    expect(info.throughput).toBeNull();
    expect(info.recipe).toBeNull();
  });

  it('shows what a crafter is holding, so a stalled input is visible', () => {
    const info = machineInfoFor(
      entity({ type: 'assembler', inputs: { ironIngot: 1, refinedStone: 2 } }),
      false,
    );

    expect(info.buffer).toEqual({ ironIngot: 1, refinedStone: 2 });
  });

  it('reports a silo at its release rate along with what it still holds', () => {
    const info = machineInfoFor(entity({ type: 'silo', inputs: { stone: 30 } }), false);

    expect(info.throughput).toBe(TICK_HZ);
    expect(info.buffer).toEqual({ stone: 30 });
  });

  it('reports a depot as a sink with nothing buffered', () => {
    const info = machineInfoFor(entity({ type: 'depot' }), false);

    expect(info.throughput).toBeNull();
    expect(info.buffer).toEqual({});
  });

  it('scales the throughput of an upgraded machine by its level', () => {
    const info = machineInfoFor(
      entity({ type: 'extractor', resourceNode: 'copperOre', level: 3 }),
      false,
    );

    // The panel must show the rate the sim actually runs at, not the base rate
    // for the machine type.
    expect(info.throughput).toBeCloseTo((TICK_HZ / 10) * 1.5, 6);
  });

  it('includes permanent production speed in machine throughput', () => {
    const info = machineInfoFor(
      entity({ type: 'extractor', resourceNode: 'copperOre' }),
      false,
      1.25,
      1,
    );

    expect(info.throughput).toBeCloseTo((TICK_HZ / 10) * 1.25, 6);
  });

  it('estimates gross value from the current output rate and base sell value', () => {
    const info = machineInfoFor(
      entity({ type: 'assembler', recipe: 'motor' }),
      true,
      1.5,
      1,
    );

    expect(info.throughput).toBeCloseTo(0.5, 6);
    expect(info.grossValuePerSecond).toBeCloseTo(750, 6);
  });

  it('applies a sell multiplier greater than one to the gross value estimate', () => {
    const info = machineInfoFor(entity({ type: 'assembler', recipe: 'motor' }), true, 1.5, 2);

    expect(info.grossValuePerSecond).toBe(1500);
  });

  it('has no gross value estimate for a depot sink', () => {
    expect(machineInfoFor(entity({ type: 'depot' }), false, 1, 1).grossValuePerSecond).toBeNull();
  });

  it('scales the rate of an upgraded crafter the same way', () => {
    const info = machineInfoFor(entity({ type: 'smelter', recipe: 'copperIngot', level: 2 }), false);

    expect(info.throughput).toBeCloseTo((TICK_HZ / RECIPES.copperIngot.ticks) * 1.25, 6);
  });

  it('does not sell a level for a machine that a level cannot speed up', () => {
    // A belt is one item per tick at any level, so quoting a price would be
    // selling nothing — and reporting an inflated rate would be worse.
    const belt = machineInfoFor(entity({ type: 'belt', level: 3 }), false);
    expect(belt.upgradeable).toBe(false);
    expect(belt.upgradeCost).toBeNull();
    expect(belt.throughput).toBe(TICK_HZ);

    expect(machineInfoFor(entity({ type: 'silo', level: 3 }), false).upgradeable).toBe(false);
    expect(machineInfoFor(entity({ type: 'depot', level: 3 }), false).upgradeable).toBe(false);

    // A capped machine is a different thing from one nothing can be done for:
    // the panel has to tell the player which one they are looking at.
    const capped = machineInfoFor(
      entity({ type: 'extractor', resourceNode: 'copperOre', level: MAX_MACHINE_LEVEL }),
      false,
    );
    expect(capped.upgradeable).toBe(true);
    expect(capped.upgradeCost).toBeNull();
  });

  it('quotes the price of the next level, and nothing once capped', () => {
    const extractor = (level: number) => machineInfoFor(entity({ type: 'extractor', level }), false);

    expect(extractor(1).upgradeCost).toBe(nextUpgradeCost(1));
    expect(extractor(MAX_MACHINE_LEVEL).upgradeCost).toBeNull();
  });

  it('copies the buffer instead of exposing the live sim object', () => {
    const held = { copperIngot: 2 };
    const info = machineInfoFor(entity({ type: 'assembler', inputs: held }), false);

    held.copperIngot = 99;

    // The UI reads snapshots: a later tick must not mutate what React rendered.
    expect(info.buffer).toEqual({ copperIngot: 2 });
  });

  it('labels a crossing as pass-through, not idle', () => {
    // A crossing is never idle — it has no state to be idle from. Calling it
    // idle reads like the tile is broken when the player inspects one.
    expect(stateLabel('crossing', null)).toBe('pass-through');
  });

  it('keeps the existing labels for machines that do have state', () => {
    expect(stateLabel('belt', null)).toBe('empty');
    expect(stateLabel('smelter', null)).toBe('idle');
    expect(stateLabel('extractor', 'copperOre')).toBe('Copper Ore');
  });
});
