import { describe, it, expect } from 'vitest';
import { RECIPES, matchRecipe, type RecipeId, recipeFor, sellValueFor } from '../src/sim/recipes';
import { SELL_VALUES, timeToFirstMotor } from '../src/sim/balance';

describe('recipes (Phase 1: raw ores sold directly)', () => {
  it('copperOre has direct-sell value near zero', () => {
    const value = sellValueFor('copperOre');
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
    expect(RECIPES.copperOre.directSell).toBe(value);
  });

  it('ironOre has direct-sell value near zero', () => {
    const value = sellValueFor('ironOre');
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
    expect(RECIPES.ironOre.directSell).toBe(value);
    // Raw ores are deliberately not worth selling directly.
    expect(sellValueFor('ironOre')).toBeLessThan(1);
  });

  it('unknown resource throws / returns undefined (no silent sale)', () => {
    expect(() => sellValueFor('unobtanium' as never)).toThrow(/unknown resource/i);
    expect(() => recipeFor('unobtanium' as never)).toThrow(/unknown resource/i);
  });

  it('each recipe describes where its resource comes from', () => {
    expect(RECIPES.copperOre.output).toBe('copperOre');
    expect(RECIPES.ironOre.output).toBe('ironOre');
    expect(RECIPES.copperOre.inputs).toEqual({});
  });
});

/** Spec §7: Tier 0 raw, T1 smelter, T2 components, T3 products. */
const TIER_0 = ['copperOre', 'ironOre', 'coal', 'stone'] as const;
const TIER_1 = ['copperIngot', 'ironIngot', 'refinedStone'] as const;
const TIER_2 = ['wire', 'gear', 'plate'] as const;
const TIER_3 = ['circuit', 'frame', 'motor'] as const;
const TIERS = [TIER_0, TIER_1, TIER_2, TIER_3];
const ALL_ITEMS = [...TIER_0, ...TIER_1, ...TIER_2, ...TIER_3] as RecipeId[];

const itemsInTier = (tier: 0 | 1 | 2 | 3): RecipeId[] => TIERS[tier] as unknown as RecipeId[];

describe('matchRecipe (auto-matching, the act-3 stall)', () => {
  it('prefers the recipe that consumes every input type the machine is holding', () => {
    // The browser playthrough's act-3 stall: an assembler held
    // {ironIngot: 2, refinedStone: 1}. The declared-first matching recipe is
    // gear (2x ironIngot), so the machine crafted gears forever and plate —
    // which its refinedStone was delivered FOR — never ran. Downstream starved
    // while every belt stayed busy. A recipe that consumes everything held is
    // strictly better: it is either what the player is feeding it for, or it
    // cannot run at all.
    const held = { ironIngot: 2, refinedStone: 1 };
    const picked = matchRecipe('assembler', held);
    expect(picked?.id).toBe('plate');
  });

  it('still picks the declared-first match when no recipe consumes everything', () => {
    // {copperIngot: 2} matches wire first and no other assembler recipe
    // consumes copper at all — the old behavior is correct there.
    const picked = matchRecipe('assembler', { copperIngot: 2 });
    expect(picked?.id).toBe('wire');
  });

  it('respects the tech gate while preferring full-consume matches', () => {
    // Plate unlocked, gear NOT: {ironIngot:2, refinedStone:1} must pick plate
    // even though gear is declared first — and a locked recipe must never win
    // the preference either.
    const held = { ironIngot: 2, refinedStone: 1 };
    const picked = matchRecipe('assembler', held, (id) => id === 'plate');
    expect(picked?.id).toBe('plate');
  });

  it('returns null when only locked recipes match', () => {
    expect(matchRecipe('assembler', { ironIngot: 2 }, () => false)).toBeNull();
  });
});

const valuesInTier = (tier: 0 | 1 | 2 | 3): number[] =>
  itemsInTier(tier).map((item) => sellValueFor(item));

describe('recipes (Phase 2: full tier 0-3 set)', () => {
  it('has a recipe for every item in the tier list', () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...ALL_ITEMS].sort());
  });

  it('each §7 recipe exists with correct inputs/outputs', () => {
    // Tier 1 — smelter
    expect(RECIPES.copperIngot.inputs).toEqual({ copperOre: 1 });
    expect(RECIPES.ironIngot.inputs).toEqual({ ironOre: 1, coal: 1 });
    expect(RECIPES.refinedStone.inputs).toEqual({ stone: 1 });

    // Tier 2 — assembler
    expect(RECIPES.wire.inputs).toEqual({ copperIngot: 2 });
    expect(RECIPES.gear.inputs).toEqual({ ironIngot: 2 });
    expect(RECIPES.plate.inputs).toEqual({ ironIngot: 1, refinedStone: 1 });

    // Tier 3 — assembler
    expect(RECIPES.circuit.inputs).toEqual({ wire: 1, gear: 1 });
    expect(RECIPES.frame.inputs).toEqual({ plate: 2, gear: 1 });
    expect(RECIPES.motor.inputs).toEqual({ circuit: 1, frame: 1 });

    // Raw resources are extracted, never crafted.
    for (const raw of TIER_0) expect(RECIPES[raw].inputs).toEqual({});

    // Every recipe outputs exactly what it is keyed by.
    for (const item of ALL_ITEMS) {
      expect(RECIPES[item].id).toBe(item);
      expect(RECIPES[item].output).toBe(item);
    }
  });

  it('runs each tier on the right machine', () => {
    for (const raw of TIER_0) expect(RECIPES[raw].machine).toBeNull();
    for (const item of TIER_1) expect(RECIPES[item].machine).toBe('smelter');
    for (const item of [...TIER_2, ...TIER_3]) expect(RECIPES[item].machine).toBe('assembler');
  });

  it('tags every recipe with its tier', () => {
    TIERS.forEach((items, tier) => {
      for (const item of items) expect(RECIPES[item].tier).toBe(tier);
    });
  });

  it('sell values scale exponentially by tier (T3 > T2 > T1 > T0)', () => {
    for (let tier = 0; tier < 3; tier++) {
      const highest = Math.max(...valuesInTier(tier as 0 | 1 | 2));
      const lowestAbove = Math.min(...valuesInTier((tier + 1) as 1 | 2 | 3));

      // Strictly better in the next tier, and roughly an order of magnitude so
      // the idle curve keeps up with the extra machine count.
      expect(lowestAbove).toBeGreaterThan(highest);
      expect(lowestAbove).toBeGreaterThanOrEqual(highest * 5);
    }
  });

  it('raw direct-sell stays near zero', () => {
    for (const raw of TIER_0) {
      const value = sellValueFor(raw);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('motor sells for the highest v1 value', () => {
    const motor = sellValueFor('motor');
    for (const item of ALL_ITEMS.filter((item) => item !== 'motor')) {
      expect(motor).toBeGreaterThan(sellValueFor(item));
    }
  });

  it('exposes the sell table for balance tuning', () => {
    for (const item of ALL_ITEMS) expect(SELL_VALUES[item]).toBe(sellValueFor(item));
  });

  it('estimates the work in the first motor', () => {
    // Sequential work for one motor: 8 assembler crafts at 3s, 10 smelts at 2s,
    // and 16 pieces of ore at 1/s. Transport is not counted.
    expect(timeToFirstMotor()).toBe(60);
  });
});
