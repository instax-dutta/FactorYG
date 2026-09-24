import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { startingUnlocks, ALL_UNLOCKED, TECH_NODES, techNode } from '../src/sim/techTree';
import { RECIPES, sellValueFor } from '../src/sim/recipes';
import { timeToFirstMotor, TECH_TOTAL_COST, ACT2_INCOME_CPS, fullLadderCostSeconds } from '../src/sim/balance';
import { MOTOR_THRESHOLD } from '../src/config/constants';
import { E2E_PLAN } from './support/e2ePlan';

/**
 * The pacing contract, from the September 2026 playtest measurements.
 *
 * Every window here is a measured number with margin, not an aspiration: the
 * headless probes (`PLAYTEST.md` §5b) put the real values at first sale 3.4s,
 * one-line income 2.3 cr/s, act-2 techs 18–64s, motor tech at ~115s of act-2
 * saving, and a first prestige point ~2.5 min after the endgame factory lands.
 * If a knob change pushes a scenario out of its window, that change has made
 * pacing worse and needs a reason.
 *
 * Map note: the resource layout is hand-designed (`RESOURCE_NODES`), so these
 * scenarios are deterministic — the copper node at (22,24) is the canonical
 * starting node, the same one the e2e playthrough boots on.
 */

const R = { N: 0, E: 90, S: 180, W: 270 } as const;

/** One full act-1 line on the first copper node: extractor → smelter → depot. */
function oneCopperLine(sim: Simulation): void {
  sim.place('extractor', 22, 24, R.E);
  sim.place('belt', 23, 24, R.E);
  sim.place('belt', 24, 24, R.E);
  sim.place('smelter', 25, 24, R.E);
  sim.place('belt', 26, 24, R.E);
  sim.place('depot', 27, 24, R.E);
}

/** The same node sold raw, no smelter: the "skip processing" shortcut. */
function oneRawLine(sim: Simulation): void {
  sim.place('extractor', 22, 24, R.E);
  sim.place('belt', 23, 24, R.E);
  sim.place('belt', 24, 24, R.E);
  sim.place('depot', 25, 24, R.E);
}

function currencyPerSecondAt(sim: Simulation, atSec: number): number {
  return sim.currency / atSec;
}

describe('balance: early game (act 1)', () => {
  it('pays out within 10 seconds of a fresh single line', () => {
    const sim = new Simulation({ unlocked: startingUnlocks() });
    oneCopperLine(sim);
    let firstSale = -1;
    for (let t = 0; t < 600 && firstSale < 0; t++) {
      sim.tick();
      if (sim.currency > 0) firstSale = t;
    }
    expect(firstSale).toBeGreaterThanOrEqual(0);
    expect(firstSale / 10).toBeLessThanOrEqual(10);
  });

  it('a processed line earns 1.5–4.5 cr/s by the 3-minute mark', () => {
    const sim = new Simulation({ unlocked: startingUnlocks() });
    oneCopperLine(sim);
    for (let t = 0; t < 1800; t++) sim.tick();
    const cps = currencyPerSecondAt(sim, 180);
    expect(cps).toBeGreaterThanOrEqual(1.5);
    expect(cps).toBeLessThanOrEqual(4.5);
  });

  it('selling raw stays under a third of the processed line (processing must dominate)', () => {
    const raw = new Simulation({ unlocked: startingUnlocks() });
    oneRawLine(raw);
    for (let t = 0; t < 1800; t++) raw.tick();

    const processed = new Simulation({ unlocked: startingUnlocks() });
    oneCopperLine(processed);
    for (let t = 0; t < 1800; t++) processed.tick();

    expect(raw.currency).toBeLessThan(processed.currency / 3);
  });
});

describe('balance: tech ladder', () => {
  it('act-2 techs arrive between 15s and 120s of a single fresh line', () => {
    const sim = new Simulation({ unlocked: startingUnlocks() });
    oneCopperLine(sim);
    const seen = new Map<string, number>();
    for (let t = 0; t < 1800; t++) {
      sim.tick();
      for (const node of TECH_NODES) {
        if (!seen.has(node.id) && sim.currency >= node.cost) seen.set(node.id, t / 10);
      }
    }
    for (const id of ['refinedStone', 'assembler', 'wire', 'gear', 'plate', 'silo']) {
      const at = seen.get(id);
      expect(at, `${id} never affordable`).toBeDefined();
      expect(at!, `${id} too early`).toBeGreaterThanOrEqual(15);
      expect(at!, `${id} too slow`).toBeLessThanOrEqual(120);
    }
  });

  it('the motor recipe demands scaling: never affordable from one line in 4 minutes', () => {
    // One line earns ~2.3 cr/s, i.e. ~550 cr by t+240s. The motor node at 1000
    // stays out of reach (scaling required); dropping it to ~400 would let a
    // single line grind it out, which this window catches.
    const sim = new Simulation({ unlocked: startingUnlocks() });
    oneCopperLine(sim);
    let reached = false;
    for (let t = 0; t < 2400 && !reached; t++) {
      sim.tick();
      if (sim.currency >= techNode('motor').cost) reached = true;
    }
    expect(reached).toBe(false);
  });

  it('the full ladder is still buyable: ~2.5 min of act-2 income covers every tech', () => {
    // 23 cr/s is the measured act-2 rate from the browser playthrough (four
    // lines into wire assemblers, PLAYTEST.md §5). The whole tree must be
    // reachable from a save that earns that, without grinding beyond 3 min.
    const totalTechCost = TECH_NODES.reduce((sum, node) => sum + node.cost, 0);
    const secondsOfSaving = totalTechCost / 23;
    expect(secondsOfSaving).toBeLessThanOrEqual(180);
  });
});

describe('balance: the crafting ladder', () => {
  /** Credits of profit per second an assembler earns running this recipe flat out. */
  function profitPerSecond(id: keyof typeof RECIPES): number {
    const recipe = RECIPES[id];
    const inputCost = Object.entries(recipe.inputs).reduce(
      (sum, [input, qty]) => sum + sellValueFor(input as keyof typeof RECIPES) * (qty ?? 1),
      0,
    );
    return (recipe.directSell - inputCost) / (recipe.ticks / 10);
  }

  it('each tier crafts strictly richer per second than the best of the tier below', () => {
    // Measured: tier-2 components earn 11.7–15.3 cr/s, tier-3 products 98–167.
    // The gap is the incentive to keep building.
    const tier2 = ['wire', 'gear', 'plate'] as const;
    const tier3 = ['circuit', 'frame', 'motor'] as const;
    const bestTier2 = Math.max(...tier2.map(profitPerSecond));
    const worstTier3 = Math.min(...tier3.map(profitPerSecond));
    expect(worstTier3).toBeGreaterThan(bestTier2);
  });

  it('tier-2 recipes stay within 25% of each other so no assembler recipe is a trap', () => {
    const rates = (['wire', 'gear', 'plate'] as const).map(profitPerSecond);
    const spread = (Math.max(...rates) - Math.min(...rates)) / Math.max(...rates);
    expect(spread).toBeLessThanOrEqual(0.25);
  });

  it('balance.ts exposes the derived tuning metrics future passes need', () => {
    // The one place the next balance pass reads from: total tree cost and the
    // act-2 income it assumes, so re-costing the ladder is one edit here.
    expect(TECH_TOTAL_COST).toBe(TECH_NODES.reduce((sum, node) => sum + node.cost, 0));
    expect(ACT2_INCOME_CPS).toBeGreaterThan(0);
    // ~2485 cr of tech at the measured 23 cr/s ≈ 108s of saving.
    expect(fullLadderCostSeconds()).toBeGreaterThan(60);
    expect(fullLadderCostSeconds()).toBeLessThanOrEqual(180);
  });

  it('the estimator keeps pinning the table it summarises', () => {
    // 60s of sequential work from the current tables; the real plan-factory
    // build lands at 21s headless / 48–66s browser (parallelism + transport).
    // If this drifts, either the tables or the estimator changed — revisit the
    // measured anchors in PLAYTEST.md §5b before moving the window.
    expect(timeToFirstMotor()).toBeGreaterThanOrEqual(40);
    expect(timeToFirstMotor()).toBeLessThanOrEqual(90);
  });
});

describe('balance: prestige attainability', () => {
  it('the endgame factory reaches the first prestige point within 5 minutes', () => {
    const sim = new Simulation({ unlocked: ALL_UNLOCKED });
    for (const m of E2E_PLAN.machines) sim.place(m.type as never, m.x, m.y, m.rotation as 0);
    for (const c of E2E_PLAN.crossings) sim.place('crossing', c.x, c.y, 0);
    for (const b of E2E_PLAN.belts) sim.place('belt', b.x, b.y, b.rotation as 0);

    let at25 = -1;
    for (let t = 0; t < 6000 && at25 < 0; t++) {
      sim.tick();
      if (sim.lifetimeMotors >= MOTOR_THRESHOLD) at25 = t;
    }
    expect(at25).toBeGreaterThanOrEqual(0);
    expect(at25 / 10).toBeLessThanOrEqual(300);
  });
});
