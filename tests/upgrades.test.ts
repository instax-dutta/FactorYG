import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { TICK_HZ } from '../src/config/constants';
import {
  MAX_MACHINE_LEVEL,
  UPGRADE_BASE_COST,
  UPGRADE_COST_GROWTH,
  UPGRADE_SPEED_STEP,
  applyUpgrade,
  canUpgrade,
  nextUpgradeCost,
  speedMultiplierFor,
} from '../src/sim/upgrades';


/** extractor(22,24) -> belt -> belt -> depot(25,24); ore sells for 0.4. */
function copperChain(): Simulation {
  const sim = new Simulation();
  expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
  expect(sim.place('belt', 23, 24, 90).ok).toBe(true);
  expect(sim.place('belt', 24, 24, 90).ok).toBe(true);
  expect(sim.place('depot', 25, 24, 0).ok).toBe(true);
  return sim;
}

/**
 * Ticks between two consecutive deliveries, measured after the pipeline has
 * filled. This is the machine's own rate: counting sales over a window would
 * also measure belt travel and backpressure, which is not what a level changes.
 */
function ticksPerDelivery(sim: Simulation): number {
  // Watches the purse rather than a count of it, so a sim that starts with
  // seeded credits still measures the gap between its first two deliveries.
  const sales: number[] = [];
  let previous = sim.currency;
  for (let tick = 1; tick <= 2000 && sales.length < 2; tick++) {
    sim.tick();
    if (sim.currency > previous) {
      sales.push(tick);
      previous = sim.currency;
    }
  }
  expect(sales.length).toBe(2);
  return sales[1] - sales[0];
}

describe('machine upgrades', () => {
  it('level 1 is the speed a machine is placed at, and one step per level above it', () => {
    expect(speedMultiplierFor(1)).toBe(1);
    expect(speedMultiplierFor(2)).toBeCloseTo(1 + UPGRADE_SPEED_STEP, 10);
    expect(speedMultiplierFor(MAX_MACHINE_LEVEL)).toBeCloseTo(
      1 + UPGRADE_SPEED_STEP * (MAX_MACHINE_LEVEL - 1),
      10,
    );

    // Every level is a real step, and one step is worth the same everywhere.
    for (let level = 2; level <= MAX_MACHINE_LEVEL; level++) {
      expect(speedMultiplierFor(level) - speedMultiplierFor(level - 1)).toBeCloseTo(
        UPGRADE_SPEED_STEP,
        10,
      );
    }
  });

  it('refuses a level below 1 rather than inventing a speed for it', () => {
    expect(() => speedMultiplierFor(0)).toThrow(/level/i);
    expect(() => speedMultiplierFor(-1)).toThrow(/level/i);
  });

  it('follows a strictly increasing cost curve, pinned at its stub values', () => {
    expect(UPGRADE_BASE_COST).toBe(60);
    expect(UPGRADE_COST_GROWTH).toBe(1.9);
    expect(nextUpgradeCost(1)).toBe(60);
    expect(nextUpgradeCost(2)).toBe(114);

    let previous = 0;
    for (let level = 1; level < MAX_MACHINE_LEVEL; level++) {
      const cost = nextUpgradeCost(level) as number;
      expect(cost).toBeGreaterThan(previous);
      previous = cost;
    }

    // Whole credits only: a price nobody can pay exactly would be a trap.
    for (let level = 1; level < MAX_MACHINE_LEVEL; level++) {
      expect(Number.isInteger(nextUpgradeCost(level))).toBe(true);
    }
  });

  it('has no next price once a machine is maxed out', () => {
    expect(nextUpgradeCost(MAX_MACHINE_LEVEL)).toBeNull();
    expect(canUpgrade(MAX_MACHINE_LEVEL, 1_000_000)).toEqual({ ok: false, reason: 'max-level' });
  });

  it('needs exactly the asking price, and refuses a credit less', () => {
    const price = nextUpgradeCost(1) as number;
    expect(canUpgrade(1, price)).toEqual({ ok: true, cost: price });
    expect(canUpgrade(1, price - 1)).toEqual({ ok: false, reason: 'insufficient-currency' });
  });

  it('hands back the level and the purse untouched when it refuses', () => {
    const refused = applyUpgrade(1, 10);
    expect(refused).toEqual({ ok: false, reason: 'insufficient-currency', level: 1, currency: 10 });

    const maxed = applyUpgrade(MAX_MACHINE_LEVEL, 1_000_000);
    expect(maxed).toEqual({ ok: false, reason: 'max-level', level: MAX_MACHINE_LEVEL, currency: 1_000_000 });
  });

  it('spends exactly the price and raises the level by one', () => {
    expect(applyUpgrade(2, 500)).toEqual({ ok: true, level: 3, currency: 500 - 114 });
  });
});

describe('upgrades in the sim', () => {
  it('mines the same node in fewer ticks once it is upgraded', () => {
    // 10 ticks of extraction at level 1; at 1.25x progress a tick, 10 ticks of
    // work land on the 8th.
    expect(ticksPerDelivery(copperChain())).toBe(10);

    const upgraded = copperChain();
    upgraded.currency = 1000;
    expect(upgraded.upgrade({ x: 22, y: 24 }).ok).toBe(true);
    expect(ticksPerDelivery(upgraded)).toBe(8);
  });

  it('speeds a crafter up by cutting the ticks its recipe takes', () => {
    const base = new Simulation();
    expect(base.place('smelter', 22, 24, 90).ok).toBe(true);
    base.entityAt({ x: 22, y: 24 })!.inputs = { copperOre: 1 };

    // One tick to match the recipe, then 20 ticks of work.
    let baseTicks = 0;
    while (base.entityAt({ x: 22, y: 24 })!.item === null && baseTicks < 200) {
      base.tick();
      baseTicks++;
    }
    expect(baseTicks).toBe(1 + 20);

    const upgraded = new Simulation();
    expect(upgraded.place('smelter', 22, 24, 90).ok).toBe(true);
    upgraded.currency = 1000;
    expect(upgraded.upgrade({ x: 22, y: 24 }).ok).toBe(true);
    expect(upgraded.upgrade({ x: 22, y: 24 }).ok).toBe(true);
    upgraded.entityAt({ x: 22, y: 24 })!.inputs = { copperOre: 1 };

    let upgradedTicks = 0;
    while (upgradedTicks < 200 && upgraded.entityAt({ x: 22, y: 24 })!.item === null) {
      upgraded.tick();
      upgradedTicks++;
    }

    // Same shape at level 3: 1 match tick, then 14 ticks of 1.5 progress each
    // (21) to clear the 20 the recipe asks for.
    expect(upgradedTicks).toBe(1 + 14);
  });

  it('refuses a level for a machine a level would not speed up', () => {
    // A belt carries one item per tick and a silo releases one per tick whatever
    // their level, so selling them a level would be selling nothing. The depot
    // is a sink. Only progress-based work can be accelerated.
    const sim = copperChain();
    sim.currency = 10_000;
    expect(sim.place('silo', 30, 30, 0).ok).toBe(true);

    expect(sim.upgrade({ x: 23, y: 24 })).toEqual({ ok: false, reason: 'not-upgradeable' });
    expect(sim.upgrade({ x: 25, y: 24 })).toEqual({ ok: false, reason: 'not-upgradeable' });
    expect(sim.upgrade({ x: 30, y: 30 })).toEqual({ ok: false, reason: 'not-upgradeable' });

    expect(sim.currency).toBe(10_000);
    expect(sim.entityAt({ x: 23, y: 24 })?.level).toBe(1);
  });

  it('offers a level to every machine whose work a level can accelerate', () => {
    const sim = copperChain();
    sim.currency = 10_000;
    expect(sim.place('assembler', 30, 30, 0).ok).toBe(true);

    expect(sim.upgrade({ x: 22, y: 24 }).ok).toBe(true); // extractor
    expect(sim.upgrade({ x: 30, y: 30 }).ok).toBe(true); // assembler
  });

  it('deducts the exact price from the factory purse', () => {
    const sim = copperChain();
    sim.currency = 200;

    expect(sim.upgrade({ x: 22, y: 24 })).toEqual({
      ok: true,
      level: 2,
      cost: 60,
    });
    expect(sim.currency).toBe(140);
    expect(sim.entityAt({ x: 22, y: 24 })?.level).toBe(2);
  });

  it('rejects an upgrade the player cannot afford, and charges nothing', () => {
    const sim = copperChain();
    sim.currency = 59;

    expect(sim.upgrade({ x: 22, y: 24 })).toEqual({ ok: false, reason: 'insufficient-currency' });
    expect(sim.currency).toBe(59);
    expect(sim.entityAt({ x: 22, y: 24 })?.level).toBe(1);
  });

  it('rejects an upgrade of a cell with no machine on it', () => {
    const sim = copperChain();

    expect(sim.upgrade({ x: 40, y: 40 })).toEqual({ ok: false, reason: 'empty' });
  });

  it('stops at the level cap instead of taking the player past it', () => {
    const sim = copperChain();
    sim.currency = 1_000_000;

    for (let level = 2; level <= MAX_MACHINE_LEVEL; level++) {
      expect(sim.upgrade({ x: 22, y: 24 }).ok).toBe(true);
    }
    const before = sim.currency;

    expect(sim.upgrade({ x: 22, y: 24 })).toEqual({ ok: false, reason: 'max-level' });
    expect(sim.currency).toBe(before);
    expect(sim.entityAt({ x: 22, y: 24 })?.level).toBe(MAX_MACHINE_LEVEL);
  });

  it('reports the upgraded rate, so the panel and the sim cannot disagree', () => {
    const sim = copperChain();
    sim.currency = 1_000;
    expect(sim.upgrade({ x: 22, y: 24 }).ok).toBe(true);

    const entity = sim.entityAt({ x: 22, y: 24 })!;
    const extractor = TICK_HZ / 10;
    // Level 2 is 1.25x, i.e. 1.25 ore/sec instead of 1.
    expect(extractor * speedMultiplierFor(entity.level)).toBeCloseTo(1.25, 6);
  });
});
