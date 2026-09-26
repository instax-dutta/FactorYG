import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESTIGE_THRESHOLD } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import { calculatePrestigePoints, canPrestige } from "../../src/sim/prestige";
import type { SimulationState } from "../../src/sim/types";

const prestigeSource = readFileSync(
  resolve(process.cwd(), "src", "sim", "prestige.ts"),
  "utf8",
);

const constantsSource = readFileSync(
  resolve(process.cwd(), "src", "sim", "constants.ts"),
  "utf8",
);

const snapshotSource = readFileSync(
  resolve(process.cwd(), "src", "sim", "snapshot.ts"),
  "utf8",
);

const REJECTED_LIFETIME_VALUES = [
  -1,
  -0.5,
  -1e9,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

function stateWithLifetimeCurrency(lifetimeCurrency: number): SimulationState {
  return { ...createInitialState(), lifetimeCurrency };
}

function expectSafePoints(lifetimeCurrency: number): void {
  const points = calculatePrestigePoints(lifetimeCurrency);

  expect(Number.isFinite(points)).toBe(true);
  expect(points).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(points)).toBe(true);
  expect(points).toBe(0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("calculatePrestigePoints", () => {
  it("awards no points for a zero lifetime", () => {
    expect(calculatePrestigePoints(0)).toBe(0);
  });

  it("awards the first point exactly at the threshold", () => {
    expect(calculatePrestigePoints(PRESTIGE_THRESHOLD)).toBe(1);
  });

  it("awards no points just below the threshold", () => {
    expect(calculatePrestigePoints(PRESTIGE_THRESHOLD - 1)).toBe(0);
  });

  it("keeps the first point boundary exact so a value just above the threshold earns one point, not two", () => {
    expect(calculatePrestigePoints(PRESTIGE_THRESHOLD + 1)).toBe(1);
    expect(calculatePrestigePoints(4 * PRESTIGE_THRESHOLD - 1)).toBe(1);
    expect(calculatePrestigePoints(4 * PRESTIGE_THRESHOLD)).toBe(2);
  });

  it("floors a perfect square of the scaled lifetime rather than approximating it", () => {
    expect(calculatePrestigePoints(PRESTIGE_THRESHOLD)).toBe(1);
    expect(calculatePrestigePoints(4 * PRESTIGE_THRESHOLD)).toBe(2);
    expect(calculatePrestigePoints(9 * PRESTIGE_THRESHOLD)).toBe(3);
    expect(calculatePrestigePoints(16 * PRESTIGE_THRESHOLD)).toBe(4);
    expect(calculatePrestigePoints(25 * PRESTIGE_THRESHOLD)).toBe(5);
  });

  it("drops one whole point for a value just below each perfect square", () => {
    expect(calculatePrestigePoints(4 * PRESTIGE_THRESHOLD - 1)).toBe(1);
    expect(calculatePrestigePoints(9 * PRESTIGE_THRESHOLD - 1)).toBe(2);
    expect(calculatePrestigePoints(16 * PRESTIGE_THRESHOLD - 1)).toBe(3);
    expect(calculatePrestigePoints(25 * PRESTIGE_THRESHOLD - 1)).toBe(4);
  });

  it("never awards fewer points as lifetime currency grows", () => {
    const lifetimes = [
      0, 1, 2, 500, 12_345, PRESTIGE_THRESHOLD - 1, PRESTIGE_THRESHOLD,
      PRESTIGE_THRESHOLD + 1, 250_000, 399_999, 400_000, 401_000, 899_999,
      900_000, 1_599_999, 1_600_000, 5_000_000, 100_000_000, 1_000_000_000,
      1e12, Number.MAX_SAFE_INTEGER,
    ];

    for (let index = 1; index < lifetimes.length; index += 1) {
      const previous = calculatePrestigePoints(lifetimes[index - 1]);
      const current = calculatePrestigePoints(lifetimes[index]);

      expect(current).toBeGreaterThanOrEqual(previous);
    }
  });

  it("holds the monotonic floor across the whole threshold neighbourhood", () => {
    let previous = -1;

    for (let lifetime = PRESTIGE_THRESHOLD - 10; lifetime <= PRESTIGE_THRESHOLD + 10; lifetime += 1) {
      const points = calculatePrestigePoints(lifetime);

      expect(points).toBeGreaterThanOrEqual(previous);
      previous = points;
    }

    expect(previous).toBe(1);
  });

  it("holds the monotonic floor across the second point neighbourhood", () => {
    let previous = -1;

    for (
      let lifetime = 4 * PRESTIGE_THRESHOLD - 10;
      lifetime <= 4 * PRESTIGE_THRESHOLD + 10;
      lifetime += 1
    ) {
      const points = calculatePrestigePoints(lifetime);

      expect(points).toBeGreaterThanOrEqual(previous);
      previous = points;
    }

    expect(previous).toBe(2);
  });

  it("returns the same points for the same lifetime on every call", () => {
    for (const lifetime of [0, PRESTIGE_THRESHOLD, 4 * PRESTIGE_THRESHOLD, 7_654_321]) {
      const first = calculatePrestigePoints(lifetime);
      const second = calculatePrestigePoints(lifetime);
      const third = calculatePrestigePoints(lifetime);

      expect(second).toBe(first);
      expect(third).toBe(first);
    }
  });

  it("awards a non-round point count for a large lifetime so a scaled formula cannot pass", () => {
    expect(calculatePrestigePoints(1e12)).toBe(3162);
    expect(calculatePrestigePoints(1e12 - 1)).toBe(3162);
    expect(calculatePrestigePoints(7_654_321)).toBe(8);
  });

  it("reads neither a clock nor a random source", () => {
    const now = vi.spyOn(Date, "now");
    const random = vi.spyOn(Math, "random");

    expect(calculatePrestigePoints(7_654_321)).toBe(8);
    expect(now).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });

  it.each(REJECTED_LIFETIME_VALUES)(
    "rejects the unusable lifetime %p as zero rather than NaN or a negative",
    (lifetimeCurrency) => {
      expectSafePoints(lifetimeCurrency);
    },
  );

  it("rejects every unusable lifetime without producing NaN anywhere in the sweep", () => {
    for (const lifetime of REJECTED_LIFETIME_VALUES) {
      const points = calculatePrestigePoints(lifetime);

      expect(Number.isNaN(points)).toBe(false);
      expect(points < 0).toBe(false);
    }
  });
});

describe("canPrestige", () => {
  it("is false with zero lifetime currency", () => {
    expect(canPrestige(stateWithLifetimeCurrency(0))).toBe(false);
  });

  it("is true at exactly the threshold", () => {
    expect(canPrestige(stateWithLifetimeCurrency(PRESTIGE_THRESHOLD))).toBe(true);
  });

  it("is false one unit below the threshold", () => {
    expect(canPrestige(stateWithLifetimeCurrency(PRESTIGE_THRESHOLD - 1))).toBe(false);
  });

  it("is true one unit above the threshold", () => {
    expect(canPrestige(stateWithLifetimeCurrency(PRESTIGE_THRESHOLD + 1))).toBe(true);
  });

  it("is true for a starting lifetime far above the threshold", () => {
    expect(canPrestige(stateWithLifetimeCurrency(5_000_000))).toBe(true);
  });

  it("reads the lifetime currency and ignores the current spendable balance", () => {
    const state = {
      ...stateWithLifetimeCurrency(PRESTIGE_THRESHOLD),
      currency: 0,
    };

    expect(canPrestige(state)).toBe(true);
  });

  it.each(REJECTED_LIFETIME_VALUES)(
    "is false for the unusable lifetime %p",
    (lifetimeCurrency) => {
      expect(canPrestige(stateWithLifetimeCurrency(lifetimeCurrency))).toBe(false);
    },
  );
});

describe("prestige threshold contract", () => {
  it("shares the threshold from the constants module", () => {
    expect(PRESTIGE_THRESHOLD).toBe(100_000);
  });

  it("declares the threshold once, in the constants module", () => {
    const declarations = constantsSource.match(
      /export const PRESTIGE_THRESHOLD/g,
    );

    expect(declarations).toHaveLength(1);
  });

  it("imports the threshold into the prestige module instead of redeclaring it", () => {
    expect(prestigeSource).toMatch(/PRESTIGE_THRESHOLD/);
    expect(prestigeSource).not.toMatch(/(export\s+)?const\s+PRESTIGE_THRESHOLD/);
  });

  it("pivots points and eligibility on the shared constant rather than a private literal", () => {
    expect(calculatePrestigePoints(PRESTIGE_THRESHOLD)).toBe(
      calculatePrestigePoints(100_000),
    );
    expect(canPrestige(stateWithLifetimeCurrency(PRESTIGE_THRESHOLD))).toBe(
      canPrestige(stateWithLifetimeCurrency(100_000)),
    );
  });

  it("routes the snapshot eligibility flag through the shared validator", () => {
    expect(snapshotSource).toMatch(/canPrestige\(state\)/);
    expect(snapshotSource).not.toMatch(/lifetimeCurrency\s*>=\s*PRESTIGE_THRESHOLD/);
  });
});
