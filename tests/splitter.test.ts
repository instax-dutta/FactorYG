import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { MACHINES, acceptsFrom } from '../src/sim/machines';
import { serializeSim, applySave } from '../src/sim/save';
import { startingUnlocks, ALL_UNLOCKED } from '../src/sim/techTree';
import { stateLabel } from '../src/ui/machineInfo';

/**
 * The splitter — one belt stream serving two consumers.
 *
 * Why it exists: the act-3 playthrough (PLAYTEST.md §6) found that a stream
 * serving two consumers needs duplicate machines, which doubles extractor load
 * on a hand-designed map with a fixed node count.
 *
 * Design (mirrors the crossing slice's shape):
 * - One item slot, belt-like: it HOLDS the item it is about to hand off, so the
 *   Entity schema and the save format need nothing new (a save already carries
 *   `item` for every entity).
 * - Takes from behind only, exits facing + right-of-facing, so rotation picks
 *   the T's orientation and two splitters can make a 4-way.
 * - Alternates exits when both accept (fair halves); falls back when one is
 *   blocked so backpressure never stops the open branch.
 *
 * Fixture note: extractors only place on resource nodes, so every stream here
 * boots on a real copper node from `RESOURCE_NODES` (the (22–27, 24–30)
 * cluster). Sinks are SILOS, not depots: a silo's buffer is public entity
 * state, so per-branch delivery counts are observable without instrumenting
 * the sim. Depots sell instantly and leave nothing to read.
 */

const R = { N: 0, E: 90, S: 180, W: 270 } as const;

function entityAt(sim: Simulation, x: number, y: number) {
  return sim.entities().find((e) => e.x === x && e.y === y);
}

/** Everything a sink silo is holding: its buffer plus the item it is releasing. */
function heldInSilo(sim: Simulation, x: number, y: number): number {
  const silo = entityAt(sim, x, y);
  if (!silo) return 0;
  const buffered = Object.values(silo.inputs).reduce((total, count) => total + (count ?? 0), 0);
  return buffered + (silo.item !== null ? 1 : 0);
}

describe('splitter: definition and ports', () => {
  it('is a one-in, two-out belt-like tile that takes only from behind', () => {
    const def = MACHINES.splitter;
    expect(def.inputs).toBe(1);
    expect(def.outputs).toBe(2);
    expect(def.ticksPerItem).toBe(1); // belt pace: the T costs no throughput
    expect(def.requiresNode).toBe(false);
    expect(acceptsFrom('splitter', R.E, { x: -1, y: 0 })).toBe(true);
    expect(acceptsFrom('splitter', R.E, { x: 0, y: -1 })).toBe(false); // not from ahead
    expect(acceptsFrom('splitter', R.E, { x: 0, y: 1 })).toBe(false); // only behind
  });
});

describe('splitter: flow', () => {
  it('splits one stream alternately into its two exits when both accept', () => {
    const sim = new Simulation({ unlocked: ALL_UNLOCKED });
    // Copper node (22,24) feeds east; splitter faces east; exits east + south.
    sim.place('extractor', 22, 24, R.E);
    sim.place('belt', 23, 24, R.E);
    sim.place('splitter', 24, 24, R.E);
    sim.place('silo', 25, 24, R.S); // facing exit
    sim.place('silo', 24, 25, R.S); // right exit

    for (let t = 0; t < 250; t++) sim.tick();

    const east = heldInSilo(sim, 25, 24);
    const south = heldInSilo(sim, 24, 25);
    // ~1 item/s from the extractor; ~20 delivered over the window minus ramp.
    expect(east + south).toBeGreaterThanOrEqual(10);
    expect(east).toBeGreaterThan(0);
    expect(south).toBeGreaterThan(0);
    // Fair halves: neither branch starves the other.
    expect(Math.abs(east - south)).toBeLessThanOrEqual(2);
  });

  it('falls back to the open exit when the other is blocked (backpressure-safe)', () => {
    const sim = new Simulation({ unlocked: ALL_UNLOCKED });
    sim.place('extractor', 22, 24, R.E);
    sim.place('belt', 23, 24, R.E);
    sim.place('splitter', 24, 24, R.E);
    // Facing exit: a stalled belt (nothing beyond it) blocks that branch.
    sim.place('belt', 25, 24, R.E);
    // Right exit: open silo.
    sim.place('silo', 24, 25, R.S);

    for (let t = 0; t < 200; t++) sim.tick();

    // Everything that left the splitter went south; the splitter never jams.
    expect(heldInSilo(sim, 24, 25)).toBeGreaterThanOrEqual(10);
    expect(entityAt(sim, 24, 24)?.item).toBe(null);
    // The blocked branch took at most the one item it stalled on.
    expect(entityAt(sim, 25, 24)?.item).not.toBe(null);
    expect(heldInSilo(sim, 25, 24)).toBeLessThanOrEqual(1);
  });

  it('is not a merge: only the behind side can feed it', () => {
    const sim = new Simulation({ unlocked: ALL_UNLOCKED });
    sim.place('extractor', 22, 24, R.E); // the main feed, from behind (west)
    sim.place('belt', 23, 24, R.E);
    sim.place('splitter', 24, 24, R.E);
    sim.place('silo', 24, 25, R.S); // right exit open so the splitter flows
    // A second stream pushing into the splitter's FACING side with nowhere
    // else to go: node (26,25) north into a west-running relay into
    // (25,24), whose downstream is the splitter itself.
    sim.place('extractor', 26, 25, R.N);
    sim.place('belt', 26, 24, R.W);
    sim.place('belt', 25, 24, R.W);

    for (let t = 0; t < 100; t++) sim.tick();
    // The face-pushing belt's item was never accepted: it stays parked there,
    // and backs its relay up behind it.
    expect(entityAt(sim, 25, 24)?.item).not.toBe(null);
    expect(entityAt(sim, 26, 24)?.item).not.toBe(null);
    // The main stream still flows (fallback to the open right exit): the
    // parked belt blocks the facing exit, so everything goes south.
    expect(heldInSilo(sim, 24, 25)).toBeGreaterThanOrEqual(5);
  });

  it('measures sold Copper throughput after delivery through the right-hand splitter exit', () => {
    const sim = new Simulation({ unlocked: ALL_UNLOCKED });
    sim.place('extractor', 22, 24, R.E);
    sim.place('belt', 23, 24, R.E);
    sim.place('splitter', 24, 24, R.E);
    sim.place('belt', 25, 24, R.E);
    sim.place('depot', 24, 25, R.S);

    for (let t = 0; t < 250; t += 1) sim.tick();

    expect(sim.chains()).toEqual([
      {
        id: 'sold-copperOre',
        outputResource: 'copperOre',
        steadyStateThroughput: 1,
      },
    ]);
  });

  it('keeps belt pace: the T costs no throughput vs a straight run', () => {
    const straight = new Simulation({ unlocked: ALL_UNLOCKED });
    straight.place('extractor', 22, 24, R.E);
    straight.place('belt', 23, 24, R.E);
    straight.place('silo', 24, 24, R.S);
    for (let t = 0; t < 400; t++) straight.tick();

    const split = new Simulation({ unlocked: ALL_UNLOCKED });
    split.place('extractor', 22, 24, R.E);
    split.place('belt', 23, 24, R.E);
    split.place('splitter', 24, 24, R.E);
    split.place('silo', 25, 24, R.S);
    split.place('silo', 24, 25, R.S);
    for (let t = 0; t < 400; t++) split.tick();

    // Same source, same elapsed time: the split factory delivers everything
    // the straight one does, just across two sinks.
    const straightTotal = heldInSilo(straight, 24, 24);
    const splitTotal = heldInSilo(split, 25, 24) + heldInSilo(split, 24, 25);
    expect(straightTotal).toBeGreaterThan(0);
    expect(splitTotal).toBe(straightTotal);
  });

  it('carries an item through like a belt: feeding a belt continues the line', () => {
    const sim = new Simulation({ unlocked: ALL_UNLOCKED });
    sim.place('extractor', 22, 24, R.E);
    sim.place('belt', 23, 24, R.E);
    sim.place('splitter', 24, 24, R.E);
    sim.place('belt', 25, 24, R.E); // facing exit into a belt
    sim.place('silo', 26, 24, R.S);

    for (let t = 0; t < 150; t++) sim.tick();
    expect(heldInSilo(sim, 26, 24)).toBeGreaterThanOrEqual(5);
  });
});

describe('splitter: unlocks, save, info', () => {
  it('ships unlocked like the belt: it is road, not a tier', () => {
    const unlocks = startingUnlocks();
    expect(unlocks.machines).toContain('splitter');
  });

  it('round-trips through the save', () => {
    const sim = new Simulation({ unlocked: ALL_UNLOCKED });
    sim.place('extractor', 22, 24, R.E);
    sim.place('belt', 23, 24, R.E);
    sim.place('splitter', 24, 24, R.E);
    sim.place('silo', 25, 24, R.S);
    sim.place('silo', 24, 25, R.S);
    for (let t = 0; t < 40; t++) sim.tick();

    const save = serializeSim(sim);
    const restored = new Simulation({ unlocked: ALL_UNLOCKED });
    applySave(restored, JSON.parse(JSON.stringify(save)));

    const splitter = restored.entities().find((e) => e.type === 'splitter');
    expect(splitter).toBeDefined();
    expect(splitter!.rotation).toBe(R.E);
  });

  it('describes itself in the info panel', () => {
    expect(stateLabel('splitter', null)).toBe('splits left/right');
  });
});
