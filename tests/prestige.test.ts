import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { pointsFor, multipliersFor } from '../src/sim/prestige';
import { sellValueFor } from '../src/sim/recipes';

/**
 * Phase 3, slice 3.1: prestige points from lifetime motors, permanent global
 * multipliers, and the reset flow.
 *
 * The formula is `points = floor(lifetimeMotors / 25)`, `productionSpeed =
 * 1 + 0.25 x points`, `sellValue = 1 + 0.5 x points`. Points are derived from
 * lifetime motors rather than banked per reset, so a player who keeps building
 * is credited for the whole run instead of only the last cycle's surplus.
 */

/**
 * Sells `count` motors one per tick through a real depot. The feeder is
 * re-restored holding a motor each time because a parked machine is not in the
 * active set: restoring it is what wakes it, so the sale still travels the real
 * delivery path instead of being credited directly.
 */
function sellMotors(sim: Simulation, count: number): void {
  for (let i = 0; i < count; i++) {
    sim.restoreEntity({
      id: 'feeder',
      type: 'assembler',
      x: 29,
      y: 30,
      rotation: 90,
      level: 1,
      resourceNode: null,
      item: 'motor',
    });
    sim.tick();
  }
}

/** A depot plus a machine feeding it, so a sale can be driven one motor at a time. */
function motorFarm(): Simulation {
  const sim = new Simulation();
  expect(sim.place('depot', 30, 30, 0).ok).toBe(true);
  sim.restoreEntity({
    id: 'e1',
    type: 'assembler',
    x: 29,
    y: 30,
    rotation: 90,
    level: 1,
    resourceNode: null,
    item: null,
  });
  return sim;
}

/** Extractor on a real copper node -> belt -> depot. */
function addOreLine(sim: Simulation): void {
  expect(sim.place('extractor', 27, 30, 90).ok).toBe(true);
  expect(sim.place('belt', 28, 30, 90).ok).toBe(true);
  expect(sim.place('depot', 29, 30, 0).ok).toBe(true);
}

/** Ticks until the depot first sells something. */
function ticksToFirstSale(sim: Simulation): number {
  let ticks = 0;
  while (ticks < 200 && sim.currency === 0) {
    sim.tick();
    ticks += 1;
  }
  expect(sim.currency).toBeGreaterThan(0);
  return ticks;
}

describe('prestige math', () => {
  it('pays nothing below the motor threshold', () => {
    for (const motors of [0, 1, 24]) {
      expect({ motors, points: pointsFor(motors) }).toEqual({ motors, points: 0 });
      expect(multipliersFor(pointsFor(motors))).toEqual({ productionSpeed: 1, sellValue: 1 });
    }
  });

  it('pays a point at 25 motors and every 25 after that', () => {
    expect(pointsFor(25)).toBe(1);
    expect(pointsFor(49)).toBe(1);
    expect(pointsFor(50)).toBe(2);
    expect(pointsFor(100)).toBe(4);
  });

  it('scales the multipliers per point', () => {
    expect(multipliersFor(1)).toEqual({ productionSpeed: 1.25, sellValue: 1.5 });
    expect(multipliersFor(2)).toEqual({ productionSpeed: 1.5, sellValue: 2 });
  });
});

describe('prestige in the sim', () => {
  it('counts lifetime motors as they sell', () => {
    const sim = motorFarm();
    sellMotors(sim, 25);
    expect(sim.lifetimeMotors).toBe(25);
    expect(sim.prestigeState().points).toBe(1);
  });

  it('multiplies what a motor sells for, on the real sale path', () => {
    const sim = motorFarm();
    sellMotors(sim, 25);
    const before = sim.currency;

    sellMotors(sim, 1);
    // 1500 base x 1.5 for one point, applied where the money is actually
    // credited rather than only in the helper the panel reads.
    expect(sim.currency - before).toBeCloseTo(sellValueFor('motor') * 1.5, 6);
  });

  it('runs the factory faster, measured on extraction', () => {
    const plain = new Simulation();
    addOreLine(plain);

    const boosted = new Simulation();
    // Earning is a counter assignment: points are derived from lifetime motors,
    // so this is the same state 25 real sales would produce.
    boosted.lifetimeMotors = 25;
    addOreLine(boosted);

    // 10 ticks of extraction at 1x against 8 at 1.25x, so the sale lands two
    // ticks earlier: a whole-tick difference, not a rounding artefact.
    expect({ plain: ticksToFirstSale(plain), boosted: ticksToFirstSale(boosted) }).toEqual({
      plain: 12,
      boosted: 10,
    });
  });

  it('refuses to reset before the factory has earned a point', () => {
    const sim = motorFarm();
    sellMotors(sim, 24);

    const result = sim.prestige();
    expect(result.ok).toBe(false);
    // A refused reset must not touch the factory.
    expect(sim.entities().length).toBe(2);
    expect(sim.lifetimeMotors).toBe(24);
    expect(sim.prestigeState().totalPrestiges).toBe(0);
  });

  it('carries the lifetime count the HUD previews its next point from', () => {
    const sim = motorFarm();
    sellMotors(sim, 30);

    // The saved prestige block already stores `lifetimeMotors`; the derived
    // state has to mirror it, or the panel would have to guess how far along
    // the run is from the points it has already banked.
    expect(sim.prestigeState()).toEqual({
      lifetimeMotors: 30,
      points: 1,
      claimedPoints: 0,
      availablePoints: 1,
      totalPrestiges: 0,
      permanentMultipliers: { productionSpeed: 1.25, sellValue: 1.5 },
    });

    // A restart really does start the count over.
    sim.restart();
    expect(sim.prestigeState().lifetimeMotors).toBe(0);
  });

  it('clears the factory but keeps the points, multipliers and unlocks', () => {
    const sim = motorFarm();
    sellMotors(sim, 25);
    const machinesBefore = [...sim.unlocks().machines].sort();

    const result = sim.prestige();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.points).toBe(1);

    expect(sim.entities()).toEqual([]);
    expect(sim.currency).toBe(0);
    expect(sim.prestigeState()).toEqual({
      lifetimeMotors: 25,
      points: 1,
      claimedPoints: 1,
      availablePoints: 0,
      totalPrestiges: 1,
      permanentMultipliers: { productionSpeed: 1.25, sellValue: 1.5 },
    });
    // The tech tree is meta-progression, not factory contents: re-buying it
    // every cycle would make the second run a grind rather than a speed-up.
    expect([...sim.unlocks().machines].sort()).toEqual(machinesBefore);
  });

  it('records claimed points separately from completed resets', () => {
    const sim = motorFarm();
    sellMotors(sim, 25);

    expect(sim.prestige().ok).toBe(true);
    expect({
      claimedPrestigePoints: sim.claimedPrestigePoints,
      totalPrestiges: sim.totalPrestiges,
    }).toEqual({ claimedPrestigePoints: 1, totalPrestiges: 1 });
  });

  it('refuses a second prestige when no fresh point is available', () => {
    const sim = motorFarm();
    sellMotors(sim, 25);

    expect(sim.prestige()).toEqual({ ok: true, points: 1, totalPrestiges: 1 });
    expect(sim.place('depot', 30, 30, 0).ok).toBe(true);
    sellMotors(sim, 1);

    const snapshot = () => ({
      entities: sim.entities().map((entity) => ({ ...entity, inputs: { ...entity.inputs } })),
      currency: sim.currency,
      lifetimeMotors: sim.lifetimeMotors,
      claimedPoints: sim.claimedPrestigePoints,
      totalPrestiges: sim.totalPrestiges,
    });
    const before = snapshot();
    expect(before.entities.length).toBeGreaterThan(0);
    expect(before.currency).toBeGreaterThan(0);

    expect(sim.prestige()).toEqual({ ok: false, reason: 'no-fresh-point' });
    expect(snapshot()).toEqual(before);
  });

  it('returns only the points that became available since the last claim', () => {
    const sim = motorFarm();
    sellMotors(sim, 50);

    expect(sim.prestige()).toEqual({ ok: true, points: 2, totalPrestiges: 1 });
    expect(sim.place('depot', 30, 30, 0).ok).toBe(true);
    sellMotors(sim, 25);
    expect(sim.prestige()).toEqual({ ok: true, points: 1, totalPrestiges: 2 });
    expect(sim.prestigeState()).toMatchObject({
      points: 3,
      claimedPoints: 3,
      availablePoints: 0,
    });
  });

  it('rebuilds measurably faster in the second cycle', () => {
    const first = new Simulation();
    addOreLine(first);
    const firstCycle = ticksToFirstSale(first);

    const second = new Simulation();
    addOreLine(second);
    second.lifetimeMotors = 25;
    second.prestige();
    // The grid is empty after the reset, so the second cycle is a real rebuild.
    expect(second.entities()).toEqual([]);
    addOreLine(second);

    expect(ticksToFirstSale(second)).toBeLessThan(firstCycle);
  });
});
