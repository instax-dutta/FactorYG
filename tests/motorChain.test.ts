import { describe, it, expect } from 'vitest';
import { THROUGHPUT_WINDOW_TICKS } from '../src/config/constants';
import { Simulation } from '../src/sim/simulation';
import type { Cell } from '../src/sim/placement';
import type { MachineType, Rotation } from '../src/sim/machines';
import { sellValueFor } from '../src/sim/recipes';
import type { RawResourceId } from '../src/sim/worldgen';

/**
 * Slice 2.3, case 4: the full Tier 0 -> Tier 3 chain, end to end.
 *
 * The four raw streams enter through silos seeded with ore rather than through
 * extractors, and this is deliberate: this file is about the *chain*, not about
 * getting ore to it. The map-scale half — extractors on real nodes, belts all
 * the way in for all eight raw lines — is `mapCorridors.test.ts`, and the two
 * are joined only conceptually: this refinery's raw silos sit inside the block
 * and cannot be fed from outside, which is why `chain.test.ts` still skips the
 * read-it-off-the-map version. Extractor-on-node behaviour is covered by
 * `sim.tick` and `chain` cases 1-3. What is under test here is the composition:
 * every recipe in spec §7 matching in the right order, through buffers, with
 * backpressure.
 *
 * A motor can only exist if every tier ran, and a motor is the only item whose
 * line reaches the depot, so "the depot sold a motor" is a complete proof that
 * ore became product.
 */

const cell = (x: number, y: number): Cell => ({ x, y });

const DELTA_ROTATION: Record<string, Rotation> = {
  '0,-1': 0,
  '1,0': 90,
  '0,1': 180,
  '-1,0': 270,
};

/** Rotation that faces from `from` toward `to` (axis-aligned neighbours only). */
function rotationToward(from: Cell, to: Cell): Rotation {
  const key = `${Math.sign(to.x - from.x)},${Math.sign(to.y - from.y)}`;
  const rotation = DELTA_ROTATION[key];
  if (rotation === undefined) throw new Error(`not axis-aligned: ${from.x},${from.y} -> ${to.x},${to.y}`);
  return rotation;
}

interface Machine {
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
}

/**
 * The refinery, hand-laid in the empty south-east quadrant. Every connection is
 * axis-aligned, so a link is a straight run with no bends: the only edges that
 * change direction are the ones reaching a machine's north or south input from
 * the row above or below.
 */
const REFINERY: Record<string, Machine> = {
  // Row 46, west to east: ore -> ingot -> wire -> circuit -> motor -> depot.
  siloCu: { type: 'silo', x: 36, y: 46, rotation: 90 },
  sCu: { type: 'smelter', x: 37, y: 46, rotation: 90 },
  aWire: { type: 'assembler', x: 40, y: 46, rotation: 90 },
  aCircuit: { type: 'assembler', x: 44, y: 46, rotation: 90 },
  aMotor: { type: 'assembler', x: 50, y: 46, rotation: 90 },
  depot: { type: 'depot', x: 52, y: 46, rotation: 0 },

  // Iron line 1: ore + coal -> ingot -> gear -> circuit (the circuit's second input).
  siloFeOre1: { type: 'silo', x: 40, y: 50, rotation: 90 },
  sFe1: { type: 'smelter', x: 41, y: 50, rotation: 90 },
  siloCoal1: { type: 'silo', x: 41, y: 49, rotation: 180 },
  aGear1: { type: 'assembler', x: 44, y: 50, rotation: 0 },

  // Stone line: stone -> refined stone -> plate.
  siloStone: { type: 'silo', x: 45, y: 50, rotation: 90 },
  sStone: { type: 'smelter', x: 46, y: 50, rotation: 180 },

  // Iron line 2: ore + coal -> ingot -> gear -> frame.
  siloFeOre2: { type: 'silo', x: 46, y: 58, rotation: 90 },
  sFe2: { type: 'smelter', x: 47, y: 58, rotation: 90 },
  siloCoal2: { type: 'silo', x: 47, y: 57, rotation: 180 },
  aGear2: { type: 'assembler', x: 50, y: 58, rotation: 0 },

  // Iron line 3: ore + coal -> ingot -> plate.
  siloFeOre3: { type: 'silo', x: 42, y: 54, rotation: 90 },
  sFe3: { type: 'smelter', x: 43, y: 54, rotation: 90 },
  siloCoal3: { type: 'silo', x: 43, y: 53, rotation: 180 },
  aPlate: { type: 'assembler', x: 46, y: 54, rotation: 90 },

  // Plates + the second gear -> frame -> motor.
  aFrame: { type: 'assembler', x: 50, y: 54, rotation: 0 },
};

/** Every producer -> consumer edge in the graph, including the depot. */
const LINKS: [string, string][] = [
  ['siloCu', 'sCu'],
  ['sCu', 'aWire'],
  ['aWire', 'aCircuit'],
  ['aCircuit', 'aMotor'],
  ['aMotor', 'depot'],
  ['siloFeOre1', 'sFe1'],
  ['siloCoal1', 'sFe1'],
  ['sFe1', 'aGear1'],
  ['aGear1', 'aCircuit'],
  ['siloStone', 'sStone'],
  ['sStone', 'aPlate'],
  ['siloFeOre2', 'sFe2'],
  ['siloCoal2', 'sFe2'],
  ['sFe2', 'aGear2'],
  ['aGear2', 'aFrame'],
  ['siloFeOre3', 'sFe3'],
  ['siloCoal3', 'sFe3'],
  ['sFe3', 'aPlate'],
  ['aPlate', 'aFrame'],
  ['aFrame', 'aMotor'],
];

/**
 * Ore for exactly one motor, read straight off the recipe tree: 2 copper ore ->
 * 2 ingots -> wire; 6 iron ore + 6 coal across three smelters -> 6 ingots -> two
 * gears and two plates; 2 stone -> 2 refined stone; then circuit, frame, motor.
 * Seeding exactly one motor's worth keeps every buffer cycling rather than
 * letting a surplus pile up and pick a different recipe.
 */
const SEED: { silo: string; resource: RawResourceId; count: number }[] = [
  { silo: 'siloCu', resource: 'copperOre', count: 2 },
  { silo: 'siloFeOre1', resource: 'ironOre', count: 2 },
  { silo: 'siloCoal1', resource: 'coal', count: 2 },
  { silo: 'siloFeOre2', resource: 'ironOre', count: 2 },
  { silo: 'siloCoal2', resource: 'coal', count: 2 },
  { silo: 'siloFeOre3', resource: 'ironOre', count: 2 },
  { silo: 'siloCoal3', resource: 'coal', count: 2 },
  { silo: 'siloStone', resource: 'stone', count: 2 },
];

/** Places a straight belt run from a producer's output cell up to its consumer. */
function link(sim: Simulation, from: Machine, to: Machine): void {
  const delta = { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
  const rotation = rotationToward(cell(from.x, from.y), cell(to.x, to.y));
  let current = cell(from.x + delta.x, from.y + delta.y);
  while (current.x !== to.x || current.y !== to.y) {
    const placed = sim.place('belt', current.x, current.y, rotation);
    expect({ at: `${current.x},${current.y}`, ok: placed.ok }).toEqual({
      at: `${current.x},${current.y}`,
      ok: true,
    });
    current = cell(current.x + delta.x, current.y + delta.y);
  }
}

function buildRefinery(): Simulation {
  const sim = new Simulation();

  // Every machine first, so a belt can never pave over a machine it is meant to
  // reach, then the links.
  for (const [id, machine] of Object.entries(REFINERY)) {
    if (machine.type === 'silo') continue; // silos are seeded below, not left empty
    const placed = sim.place(machine.type, machine.x, machine.y, machine.rotation);
    expect({ id, ok: placed.ok }).toEqual({ id, ok: true });
  }

  for (const [producer, consumer] of LINKS) {
    link(sim, REFINERY[producer], REFINERY[consumer]);
  }

  // Silos are the raw streams: a silo cannot be filled by anything else, so it
  // is restored pre-loaded instead of placed empty.
  SEED.forEach(({ silo, resource, count }, index) => {
    const machine = REFINERY[silo];
    sim.restoreEntity({
      id: `seed${index}`,
      type: 'silo',
      x: machine.x,
      y: machine.y,
      rotation: machine.rotation,
      level: 1,
      resourceNode: null,
      item: null,
      inputs: { [resource]: count },
    });
  });

  return sim;
}

describe('full production chain (Phase 2, slice 2.3 case 4)', () => {
  it('turns raw ore into a Motor and sells it at the depot', () => {
    const sim = buildRefinery();

    // Nothing is sold until a whole motor exists, and only the motor line
    // reaches the depot, so the first sale can only be a motor.
    let ticks = 0;
    while (ticks < 5000 && sim.currency === 0) {
      sim.tick();
      ticks += 1;
    }

    expect(ticks).toBeLessThan(5000);
    expect(sim.currency).toBeCloseTo(sellValueFor('motor'), 6);

    // The depot is the only sink, so exactly one item was sold and no
    // intermediate was silently dumped.
    expect(sim.currency).toBe(1500);
  });

  it('records a real production-to-depot Motor sale in the throughput ledger', () => {
    const sim = buildRefinery();
    while (sim.currency === 0) sim.tick();
    for (let tick = 0; tick < THROUGHPUT_WINDOW_TICKS && sim.chains().length === 0; tick += 1) {
      sim.tick();
    }

    expect(sim.chains()).toEqual([
      { id: 'sold-motor', outputResource: 'motor', steadyStateThroughput: 0.2 },
    ]);
  });

  it('runs every tier, not just the last one', () => {
    const sim = buildRefinery();
    // Watch every resource that is held or being crafted anywhere, for as long
    // as the factory runs.
    const seen = new Set<string>();
    const observe = (): void => {
      for (const entity of sim.entities()) {
        if (entity.item !== null) seen.add(entity.item);
        if (entity.recipe !== null) seen.add(entity.recipe);
        for (const resource of Object.keys(entity.inputs)) seen.add(resource);
      }
    };

    for (let i = 0; i < 5000 && sim.currency === 0; i++) {
      sim.tick();
      observe();
    }
    expect(sim.currency).toBe(1500);

    // A short-circuit that jumped straight to a motor could not show all of
    // these: every tier of spec §7 actually ran, in order.
    for (const resource of [
      'copperIngot',
      'ironIngot',
      'refinedStone',
      'wire',
      'gear',
      'plate',
      'circuit',
      'frame',
    ]) {
      expect({ seen: resource, present: seen.has(resource) }).toEqual({ seen: resource, present: true });
    }
  });

  it('cannot make a second motor out of one motor of ore', () => {
    const sim = buildRefinery();
    for (let i = 0; i < 5000 && sim.currency === 0; i++) sim.tick();
    expect(sim.currency).toBe(1500);

    // The raw inputs are spent, so extra time must not conjure more product:
    // this is what fails if any stage duplicates an item it consumed.
    for (let i = 0; i < 2000; i++) sim.tick();
    expect(sim.currency).toBe(1500);
  });
});
