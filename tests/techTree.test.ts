import { describe, it, expect } from 'vitest';
import {
  ALL_UNLOCKED,
  TECH_NODES,
  canUnlock,
  isMachineUnlocked,
  isRecipeUnlocked,
  startingUnlocks,
  techNode,
  unlock,
} from '../src/sim/techTree';
import { Simulation } from '../src/sim/simulation';

const costOf = (id: string): number => techNode(id).cost;

/** A sim the player would actually start with, rather than the test sandbox. */
const gatedSim = (currency = 0): Simulation => {
  const sim = new Simulation({ unlocked: startingUnlocks() });
  sim.currency = currency;
  return sim;
};

describe('tech tree (Phase 2, slice 2.6)', () => {
  it('starts with the extractor, belt, smelter and depot plus copper and iron ingots', () => {
    const start = startingUnlocks();

    expect([...start.machines].sort()).toEqual([
      'belt',
      'crossing',
      'depot',
      'extractor',
      'smelter',
      'splitter',
    ]);
    expect([...start.recipes].sort()).toEqual(['copperIngot', 'ironIngot']);

    // `depot` is an addition to the plan's three machines: with nothing to sell
    // to, the game is not playable from its own starting set.
    expect(start.machines).toContain('depot');
  });

  it('spends currency to unlock the next tier', () => {
    const start = startingUnlocks();
    const budget = costOf('assembler') + costOf('wire') + 10;

    // Tiers open in order: wire needs an assembler to make it on.
    const withAssembler = unlock(start, 'assembler', budget);
    expect(withAssembler.ok).toBe(true);
    if (!withAssembler.ok) return;

    const result = unlock(withAssembler.state, 'wire', withAssembler.currency);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.currency).toBe(10);
    expect(isRecipeUnlocked(result.state, 'wire')).toBe(true);
    expect(isMachineUnlocked(result.state, 'assembler')).toBe(true);

    // Unlocking returns a new state: the caller's is untouched.
    expect(isRecipeUnlocked(start, 'wire')).toBe(false);
    expect(isMachineUnlocked(start, 'assembler')).toBe(false);
  });

  it('unlocks a machine as well as a recipe', () => {
    const result = unlock(startingUnlocks(), 'assembler', costOf('assembler'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isMachineUnlocked(result.state, 'assembler')).toBe(true);
    expect(result.currency).toBe(0);
  });

  it('refuses to unlock without the prerequisite', () => {
    // Motor needs both a circuit and a frame first.
    const check = canUnlock(startingUnlocks(), 'motor', 1_000_000);

    expect(check).toEqual({ ok: false, reason: 'missing-prerequisite' });
    expect(() => unlock(startingUnlocks(), 'motor', 1_000_000)).not.toThrow();
  });

  it('refuses to unlock without the currency, and charges nothing when it fails', () => {
    const start = startingUnlocks();
    const poor = costOf('assembler') - 1;

    expect(canUnlock(start, 'assembler', poor)).toEqual({ ok: false, reason: 'insufficient-currency' });

    const result = unlock(start, 'assembler', poor);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A failed unlock must not leave the player short.
    expect(result.currency).toBe(poor);
    expect(isMachineUnlocked(result.state, 'assembler')).toBe(false);
  });

  it('accepts exactly the asking price', () => {
    const result = unlock(startingUnlocks(), 'assembler', costOf('assembler'));
    expect(result.ok).toBe(true);
  });

  it('never charges twice for the same node', () => {
    const first = unlock(startingUnlocks(), 'assembler', 1000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(canUnlock(first.state, 'assembler', first.currency)).toEqual({
      ok: false,
      reason: 'already-unlocked',
    });

    const again = unlock(first.state, 'assembler', first.currency);
    if (again.ok) throw new Error('expected a second unlock to be refused');
    expect(again.currency).toBe(first.currency);
  });

  it('rejects an unknown node instead of quietly doing nothing', () => {
    expect(canUnlock(startingUnlocks(), 'teleporter', 999)).toEqual({ ok: false, reason: 'unknown' });
    expect(() => techNode('teleporter')).toThrow(/unknown tech/i);
  });

  it('cannot run a locked recipe in the sim', () => {
    const sim = gatedSim();
    // A smelter is unlocked from the start, but refining stone is not.
    expect(sim.place('extractor', 16, 38, 90).ok).toBe(true);
    expect(sim.place('belt', 17, 38, 90).ok).toBe(true);
    expect(sim.place('smelter', 18, 38, 90).ok).toBe(true);
    expect(sim.place('belt', 19, 38, 90).ok).toBe(true);
    expect(sim.place('depot', 20, 38, 0).ok).toBe(true);

    // Stone ore is extracted and sold raw, and never becomes a refined stone.
    for (let tick = 0; tick < 400; tick++) sim.tick();
    const smelter = sim.entityAt({ x: 18, y: 38 });
    expect(smelter?.recipe).toBeNull();
    expect(smelter?.item).toBeNull();

    // Unlocking the recipe lets the same factory start refining.
    const unlocked = unlock(startingUnlocks(), 'refinedStone', 1_000_000);
    if (!unlocked.ok) throw new Error('expected the unlock to succeed');
    const open = new Simulation({ unlocked: unlocked.state });
    expect(open.place('extractor', 16, 38, 90).ok).toBe(true);
    expect(open.place('belt', 17, 38, 90).ok).toBe(true);
    expect(open.place('smelter', 18, 38, 90).ok).toBe(true);
    for (let tick = 0; tick < 400; tick++) open.tick();
    expect(open.entityAt({ x: 18, y: 38 })?.item).toBe('refinedStone');
  });

  it('wakes a dormant assembler after its buffered Circuit recipe is unlocked', () => {
    const assembler = unlock(startingUnlocks(), 'assembler', 1_000);
    if (!assembler.ok) throw new Error('expected the assembler unlock to succeed');
    const wire = unlock(assembler.state, 'wire', 1_000);
    if (!wire.ok) throw new Error('expected the wire unlock to succeed');
    const gear = unlock(wire.state, 'gear', 1_000);
    if (!gear.ok) throw new Error('expected the gear unlock to succeed');

    const sim = new Simulation({ unlocked: gear.state });
    sim.currency = 1_000;
    const entity = sim.restoreEntity({
      id: 'e1',
      type: 'assembler',
      x: 30,
      y: 30,
      rotation: 90,
      level: 1,
      resourceNode: null,
      item: null,
      inputs: { wire: 1, gear: 1 },
    });

    sim.tick();
    sim.tick();
    expect(entity.recipe).toBeNull();
    expect(entity.inputs).toEqual({ wire: 1, gear: 1 });
    expect(sim.lastTickWork).toBe(0);

    const result = sim.unlock('circuit');
    expect(result.ok).toBe(true);

    sim.tick();
    expect(entity.recipe).toBe('circuit');
    expect(entity.inputs).toEqual({});
  });

  it('spends the factory currency when the sim unlocks a node', () => {
    const price = costOf('assembler');
    const sim = gatedSim(price + 5);

    expect(sim.unlock('assembler')).toEqual({ ok: true, node: techNode('assembler') });
    expect(sim.currency).toBe(5);
    expect(sim.canPlaceAt('assembler', 30, 30).ok).toBe(true);

    // A refusal leaves the purse alone, so a mis-click cannot drain a player.
    expect(sim.unlock('motor')).toEqual({ ok: false, reason: 'missing-prerequisite' });
    expect(sim.currency).toBe(5);
  });

  it('refuses to place a machine that is not unlocked', () => {
    const sim = gatedSim();
    expect(sim.place('assembler', 30, 30, 90)).toEqual({ ok: false, reason: 'locked' });
    expect(sim.canPlaceAt('assembler', 30, 30)).toEqual({ ok: false, reason: 'locked' });

    const unlocked = unlock(startingUnlocks(), 'assembler', 1_000_000);
    if (!unlocked.ok) throw new Error('expected the unlock to succeed');
    expect(new Simulation({ unlocked: unlocked.state }).canPlaceAt('assembler', 30, 30).ok).toBe(true);
  });

  it('leaves a test factory wide open unless it is given a gated state', () => {
    // ~130 existing tests place whatever they need; the sandbox default keeps
    // them honest, and the app always passes the player's save state instead.
    const sim = new Simulation();
    expect(sim.place('assembler', 30, 30, 90).ok).toBe(true);
    expect(sim.place('silo', 31, 30, 90).ok).toBe(true);
    expect(ALL_UNLOCKED.machines).toContain('silo');
    expect(TECH_NODES.length).toBeGreaterThan(0);
  });
});
