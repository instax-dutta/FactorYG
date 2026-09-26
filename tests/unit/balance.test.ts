import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GRID_EXPANSION_COST,
  PRESTIGE_PRODUCTION_BONUS_PER_POINT,
  PRESTIGE_SELL_BONUS_PER_POINT,
  PRESTIGE_THRESHOLD,
  RAW_SELL_VALUE_CEILING,
  SELL_VALUE_BANDS,
  STARTING_CURRENCY,
} from "../../src/content/balance";
import { RESOURCES } from "../../src/content/resources";
import type { ResourceDefinition, ResourceTier } from "../../src/content/types";

const RESOURCE_IDS = Object.keys(RESOURCES) as ReadonlyArray<ResourceDefinition["id"]>;

const TIERS: readonly ResourceTier[] = [0, 1, 2, 3];

const balanceSource = readFileSync(
  resolve(process.cwd(), "src", "content", "balance.ts"),
  "utf8",
);

const constantsSource = readFileSync(
  resolve(process.cwd(), "src", "sim", "constants.ts"),
  "utf8",
);

const resourcesSource = readFileSync(
  resolve(process.cwd(), "src", "content", "resources.ts"),
  "utf8",
);

function shippedValues(tier: ResourceTier): number[] {
  return RESOURCE_IDS.filter((id) => RESOURCES[id].tier === tier).map(
    (id) => RESOURCES[id].sellValue,
  );
}

function expectWholeNumber(value: number, label: string): void {
  expect(Number.isFinite(value), label).toBe(true);
  expect(Number.isInteger(value), label).toBe(true);
  expect(value, label).toBeGreaterThan(0);
}

describe("balance module ownership", () => {
  it("declares every balance number exactly once, in the balance module", () => {
    for (const name of [
      "STARTING_CURRENCY",
      "PRESTIGE_THRESHOLD",
      "PRESTIGE_PRODUCTION_BONUS_PER_POINT",
      "PRESTIGE_SELL_BONUS_PER_POINT",
      "GRID_EXPANSION_COST",
    ]) {
      const declarations = balanceSource.match(new RegExp(`export const ${name}\\b`, "g"));

      expect(declarations, name).toHaveLength(1);
    }
  });

  it("no longer restates a balance number in the simulation constants", () => {
    for (const name of [
      "STARTING_CURRENCY",
      "PRESTIGE_THRESHOLD",
      "PRESTIGE_PRODUCTION_BONUS_PER_POINT",
      "PRESTIGE_SELL_BONUS_PER_POINT",
      "GRID_EXPANSION_COST",
    ]) {
      expect(constantsSource, name).not.toMatch(new RegExp(`export const ${name}\\b`));
    }
  });

  it("keeps the tick, grid, tile, and save-key constants in the simulation constants", () => {
    for (const name of [
      "GRID_WIDTH",
      "GRID_HEIGHT",
      "TILE_SIZE_PX",
      "GRID_EXPANSION_STEP",
      "GRID_MIN_SIZE",
      "GRID_MAX_SIZE",
      "TICKS_PER_SECOND",
      "TICK_MS",
      "SAVE_KEY",
      "NEW_GAME_TIMESTAMP",
    ]) {
      expect(constantsSource, name).toMatch(new RegExp(`export const ${name}\\b`));
    }
  });

  it("keeps every sell value in the resource data instead of copying it into balance", () => {
    for (const id of RESOURCE_IDS) {
      expect(balanceSource, id).not.toContain(id);
    }
    expect(resourcesSource).toMatch(/sellValue/);
    for (const id of RESOURCE_IDS) {
      const definition = RESOURCES[id];

      expect(definition.sellValue, id).toBeGreaterThan(0);
    }
  });

  it("deep-freezes the shipped sell value bands so a scenario cannot edit them", () => {
    expect(Object.isFrozen(SELL_VALUE_BANDS)).toBe(true);
    for (const tier of TIERS) {
      expect(Object.isFrozen(SELL_VALUE_BANDS[tier]), `tier ${tier}`).toBe(true);
    }
  });
});

describe("starting economy", () => {
  it("starts a run on a whole positive amount of currency", () => {
    expectWholeNumber(STARTING_CURRENCY, "STARTING_CURRENCY");
  });

  it("starts a run with less currency than a prestige costs to reach", () => {
    expect(STARTING_CURRENCY).toBeLessThan(PRESTIGE_THRESHOLD);
  });
});

describe("prestige balance", () => {
  it("prices the first prestige at a whole positive lifetime threshold", () => {
    expectWholeNumber(PRESTIGE_THRESHOLD, "PRESTIGE_THRESHOLD");
  });

  it("pays every banked point in both permanent multipliers", () => {
    expect(PRESTIGE_PRODUCTION_BONUS_PER_POINT).toBeGreaterThan(0);
    expect(PRESTIGE_SELL_BONUS_PER_POINT).toBeGreaterThan(0);
  });

  it("pays prestige mostly in sell value, because selling is the player's lever", () => {
    expect(PRESTIGE_SELL_BONUS_PER_POINT).toBeGreaterThan(
      PRESTIGE_PRODUCTION_BONUS_PER_POINT,
    );
  });

  it("derives an exactly representable multiplier, so a preview cannot drift from the award", () => {
    for (let points = 0; points <= 64; points += 1) {
      for (const bonus of [PRESTIGE_PRODUCTION_BONUS_PER_POINT, PRESTIGE_SELL_BONUS_PER_POINT]) {
        const multiplier = 1 + points * bonus;

        expect(multiplier * 2 ** 20, `${bonus} at ${points} points`).toBe(
          Math.round(multiplier * 2 ** 20),
        );
      }
    }
  });

  it("raises both multipliers with every banked point", () => {
    let previousProduction = 0;
    let previousSell = 0;

    for (let points = 0; points <= 32; points += 1) {
      const productionSpeed = 1 + points * PRESTIGE_PRODUCTION_BONUS_PER_POINT;
      const sellValue = 1 + points * PRESTIGE_SELL_BONUS_PER_POINT;

      expect(productionSpeed, `production ${points}`).toBeGreaterThan(previousProduction);
      expect(sellValue, `sell ${points}`).toBeGreaterThan(previousSell);
      previousProduction = productionSpeed;
      previousSell = sellValue;
    }
  });

  it("never lets a point buy less than a whole percent", () => {
    expect(PRESTIGE_PRODUCTION_BONUS_PER_POINT).toBeGreaterThanOrEqual(0.01);
    expect(PRESTIGE_SELL_BONUS_PER_POINT).toBeGreaterThanOrEqual(0.01);
  });
});

describe("plot expansion balance", () => {
  it("prices an expansion at a whole positive amount of spendable currency", () => {
    expectWholeNumber(GRID_EXPANSION_COST, "GRID_EXPANSION_COST");
  });

  it("costs at least one full prestige run of currency, so a plot is a real second goal", () => {
    expect(GRID_EXPANSION_COST).toBeGreaterThanOrEqual(PRESTIGE_THRESHOLD);
  });

  it("costs more than the currency a run begins with", () => {
    expect(GRID_EXPANSION_COST).toBeGreaterThan(STARTING_CURRENCY);
  });
});

describe("the sell value bands the balance module declares", () => {
  it("gives every tier a band with an ascending, non-overlapping range", () => {
    for (let index = 1; index < TIERS.length; index += 1) {
      const previous = SELL_VALUE_BANDS[TIERS[index - 1]];
      const current = SELL_VALUE_BANDS[TIERS[index]];

      expect(previous.min, `tier ${TIERS[index - 1]} min`).toBeLessThanOrEqual(previous.max);
      expect(current.min, `tier ${TIERS[index]} min`).toBeLessThanOrEqual(current.max);
      expect(previous.max, `tier ${TIERS[index - 1]} max`).toBeLessThan(current.min);
    }
  });

  it("caps the raw tier at the named raw ceiling", () => {
    expect(SELL_VALUE_BANDS[0].max).toBe(RAW_SELL_VALUE_CEILING);
  });

  it("keeps the raw ceiling low enough that a raw unit is worth less than a tier one unit", () => {
    expectWholeNumber(RAW_SELL_VALUE_CEILING, "RAW_SELL_VALUE_CEILING");
    expect(RAW_SELL_VALUE_CEILING).toBeLessThan(SELL_VALUE_BANDS[1].min);
  });
});

describe("balance scenarios over the shipped resource data", () => {
  it("populates every declared tier", () => {
    for (const tier of TIERS) {
      expect(shippedValues(tier).length, `tier ${tier}`).toBeGreaterThan(0);
    }
  });

  it("keeps every shipped sell value inside the band its tier declares", () => {
    for (const id of RESOURCE_IDS) {
      const definition = RESOURCES[id];
      const band = SELL_VALUE_BANDS[definition.tier];

      expect(definition.sellValue, `${id} below tier ${definition.tier} floor`).toBeGreaterThanOrEqual(
        band.min,
      );
      expect(definition.sellValue, `${id} above tier ${definition.tier} ceiling`).toBeLessThanOrEqual(
        band.max,
      );
    }
  });

  it("keeps raw values low, so the first tier cannot be farmed past the rest of the tree", () => {
    for (const id of RESOURCE_IDS) {
      const definition = RESOURCES[id];

      if (definition.tier !== 0) {
        continue;
      }

      expect(definition.sellValue, id).toBeLessThanOrEqual(RAW_SELL_VALUE_CEILING);
    }
    expect(Math.max(...shippedValues(0))).toBeLessThan(Math.min(...shippedValues(1)));
  });

  it("makes every Tier 3 value worth more than every Tier 2 value", () => {
    const tierTwo = shippedValues(2);
    const tierThree = shippedValues(3);

    expect(Math.min(...tierThree)).toBeGreaterThan(Math.max(...tierTwo));
  });

  it("raises the value floor with every tier", () => {
    for (let index = 1; index < TIERS.length; index += 1) {
      const previous = Math.min(...shippedValues(TIERS[index - 1]));
      const current = Math.min(...shippedValues(TIERS[index]));

      expect(current, `tier ${TIERS[index]} over tier ${TIERS[index - 1]}`).toBeGreaterThan(
        previous,
      );
    }
  });

  it("keeps the shipped progression at least four times steeper from raw to Tier 3", () => {
    const rawBest = Math.max(...shippedValues(0));
    const tierThreeBest = Math.max(...shippedValues(3));

    expect(tierThreeBest).toBeGreaterThanOrEqual(rawBest * 4);
  });
});
