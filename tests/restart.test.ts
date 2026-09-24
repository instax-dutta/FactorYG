import { describe, it, expect } from 'vitest';
import { ALL_UNLOCKED, startingUnlocks } from '../src/sim/techTree';
import { Simulation } from '../src/sim/simulation';

/**
 * Starting over: a fresh factory *and* a fresh player.
 *
 * `reset()` is the prestige wipe — it clears the grid for the next cycle and
 * deliberately keeps lifetime motors, points and the tech tree. `restart()` is
 * the other thing: the "this factory is a mess, give me a clean save" control,
 * which has to take the prestige counters and the unlocks with it or the player
 * is not actually back at the start.
 */

describe('Simulation.restart', () => {
  it('wipes the grid, the purse and the prestige counters', () => {
    const sim = new Simulation();
    sim.currency = 500;
    sim.lifetimeMotors = 50;
    sim.claimedPrestigePoints = 2;
    sim.totalPrestiges = 3;
    expect(sim.place('belt', 30, 30, 90).ok).toBe(true);

    sim.restart();

    expect(sim.entities()).toEqual([]);
    expect(sim.currency).toBe(0);
    expect(sim.lifetimeMotors).toBe(0);
    expect(sim.claimedPrestigePoints).toBe(0);
    expect(sim.totalPrestiges).toBe(0);
    expect(sim.prestigeState()).toEqual({
      lifetimeMotors: 0,
      points: 0,
      claimedPoints: 0,
      availablePoints: 0,
      totalPrestiges: 0,
      permanentMultipliers: { productionSpeed: 1, sellValue: 1 },
    });
  });

  it('puts a player sim back to the tech tree it started with', () => {
    const player = new Simulation({ unlocked: startingUnlocks() });
    player.currency = 10_000;
    expect(player.unlock('assembler').ok).toBe(true);
    expect(player.unlocks().machines).toContain('assembler');

    player.restart();

    // Not just "fewer unlocks": exactly the starting set, so the paid-for
    // machines are gone rather than half-cleared.
    expect(player.unlocks()).toEqual(startingUnlocks());
  });

  it('does not lock a sandbox sim out of its own machines', () => {
    // A bare `Simulation` is ALL_UNLOCKED by design (tests and tooling), so a
    // restart has to hand that back. Restoring `startingUnlocks()` instead would
    // silently turn the sandbox into a fresh player.
    const sandbox = new Simulation();
    sandbox.restart();
    expect(sandbox.unlocks()).toEqual(ALL_UNLOCKED);
  });

  it('leaves a factory that works', () => {
    const sim = new Simulation();
    sim.restart();
    expect(sim.place('extractor', 22, 24, 90).ok).toBe(true);
    expect(sim.place('belt', 23, 24, 90).ok).toBe(true);
    expect(sim.place('depot', 24, 24, 0).ok).toBe(true);

    for (let i = 0; i < 40 && sim.currency === 0; i++) sim.tick();
    expect(sim.currency).toBeGreaterThan(0);
  });
});
