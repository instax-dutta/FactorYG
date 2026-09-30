import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ActiveEntityIndex } from "../../src/sim/activeIndex";
import {
  CONNECTION_CHECKS_PER_ENTITY,
  SCALING_BUDGET,
  buildBeltRows,
  buildMotorLayoutEntities,
  measureScenario,
  scenarioTargets,
  type TickMeasurement,
} from "../../scripts/benchmark-grid";

const BASELINE_PATH = "docs/performance-baseline.md";
const P95_TOLERANCE = 3;
const BASELINE_HEADING = "## Committed baseline";
const SCENARIO_ROW = /^\|\s*[`](grid-\d+)[`]\s*\|\s*(\d+)\s*\|\s*\d+x\d+\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/;
const SCENARIO_ROW_GLOBAL = new RegExp(SCENARIO_ROW.source, "gm");

export interface CommittedBaseline {
  readonly name: string;
  readonly entityCount: number;
  readonly tickCount: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

function readCommittedBaseline(): CommittedBaseline[] {
  let document: string;
  try {
    document = readFileSync(BASELINE_PATH, "utf8");
  } catch {
    throw new Error(
      `No committed performance baseline at ${BASELINE_PATH}. Record the environment and the ` +
        "measured mean, p95 and maximum for each grid scenario, or this spec has nothing to hold " +
        "the simulation to.",
    );
  }

  const rows = parseCommittedBaseline(document);
  if (rows.length === 0) {
    throw new Error(
      `${BASELINE_PATH} carries no scenario rows beneath its "${BASELINE_HEADING}" heading. The ` +
        "table must have one row per grid scenario, written as a markdown table row whose first " +
        "cell is the scenario name in backticks, then entity count, grid, tick count, mean ms, " +
        "p95 ms and max ms.",
    );
  }

  return rows;
}

export function parseCommittedBaseline(document: string): CommittedBaseline[] {
  const lines = document.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === BASELINE_HEADING);
  if (headingIndex === -1) {
    return [];
  }

  const rows: CommittedBaseline[] = [];
  for (let offset = headingIndex + 1; offset < lines.length; offset += 1) {
    const line = (lines[offset] ?? "").trim();
    if (line.startsWith("## ")) {
      break;
    }

    const match = SCENARIO_ROW.exec(line);
    if (match === null) {
      continue;
    }

    rows.push({
      name: match[1] ?? "",
      entityCount: Number(match[2]),
      tickCount: Number(match[3]),
      meanMs: Number(match[4]),
      p95Ms: Number(match[5]),
      maxMs: Number(match[6]),
    });
  }

  return rows;
}

function createIndex(): ActiveEntityIndex {
  return new ActiveEntityIndex();
}

test.describe("large grid tick cost", () => {
  test("holds the committed p95 for every grid scenario within a machine relative tolerance", () => {
    const baseline = readCommittedBaseline();
    const results: TickMeasurement[] = [];
    const failures: string[] = [];

    for (const target of scenarioTargets()) {
      const committed = baseline.find((row) => row.name === target.name);
      if (committed === undefined) {
        failures.push(`${target.name} has no committed baseline row in ${BASELINE_PATH}`);
        continue;
      }

      const measurement = measureScenario(target.name, buildBeltRows(target.rows), createIndex);
      results.push(measurement);

      if (measurement.entityCount !== committed.entityCount) {
        failures.push(
          `${target.name} builds ${measurement.entityCount} entities but the baseline recorded ` +
            `${committed.entityCount}, so the two are not measuring the same world`,
        );
      }

      const budget = committed.p95Ms * P95_TOLERANCE;
      if (measurement.p95Ms > budget) {
        failures.push(
          `${target.name} p95 is ${measurement.p95Ms.toFixed(3)} ms against a recorded ` +
            `${committed.p95Ms.toFixed(3)} ms and a ${budget.toFixed(3)} ms budget. That figure was ` +
            `measured on the machine named in ${BASELINE_PATH}, so it is a regression signal rather ` +
            `than a portable limit; confirm the run on comparable hardware before acting on it.`,
        );
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
    expect(results).toHaveLength(scenarioTargets().length);
  });

  test("keeps port connection checks proportional to the world rather than to its square", () => {
    for (const target of scenarioTargets()) {
      const measurement = measureScenario(target.name, buildBeltRows(target.rows), createIndex);
      const budget = measurement.entityCount * CONNECTION_CHECKS_PER_ENTITY;
      const observed = measurement.connectionChecksPerTick;

      expect(
        observed,
        `${target.name} performed ${observed.toFixed(1)} connection checks per tick, so the index ` +
          "resolved no neighbours at all. An upper bound alone cannot tell a linear tick from a " +
          "tick that never consults the index, which is why this is a two-sided assertion.",
      ).toBeGreaterThan(0);

      expect(
        observed,
        `${target.name} performed ${observed.toFixed(1)} connection checks per tick for ` +
          `${measurement.entityCount} entities, over the ${CONNECTION_CHECKS_PER_ENTITY} per entity ` +
          `budget. A linear scan for a neighbour is back.`,
      ).toBeLessThanOrEqual(budget);
    }
  });

  test("grows the tick cost no faster than the entity count times the scaling budget", () => {
    const targets = scenarioTargets();
    const smallestTarget = targets[0];
    const largestTarget = targets[targets.length - 1];
    if (smallestTarget === undefined || largestTarget === undefined) {
      throw new Error("The benchmark must publish a smallest and a largest grid scenario to scale against");
    }

    const smallest = measureScenario(
      smallestTarget.name,
      buildBeltRows(smallestTarget.rows),
      createIndex,
    );
    const largest = measureScenario(
      largestTarget.name,
      buildBeltRows(largestTarget.rows),
      createIndex,
    );
    const ratio = largest.meanMs / smallest.meanMs;
    const entityRatio = largest.entityCount / smallest.entityCount;

    expect(
      ratio,
      `${largestTarget.name} costs ${ratio.toFixed(1)}x ${smallest.name} for ${entityRatio.toFixed(1)}x ` +
        `the entities, over the ${SCALING_BUDGET}x budget. The tick is super-linear in entity count.`,
    ).toBeLessThanOrEqual(SCALING_BUDGET);
  });

  test("reads the committed table rather than the pre-optimisation one", () => {
    const document = readFileSync(BASELINE_PATH, "utf8");
    const committed = parseCommittedBaseline(document);
    const everyRow = [...document.matchAll(SCENARIO_ROW_GLOBAL)].map((match) => match[1] ?? "");

    expect(everyRow.filter((name) => name === "grid-1000")).toHaveLength(2);
    expect(committed.filter((row) => row.name === "grid-1000")).toHaveLength(1);

    const largest = committed.find((row) => row.name === "grid-1000");
    expect(largest?.p95Ms).toBe(12.07);
    expect(largest?.p95Ms).toBeLessThan(20);
  });

  test("gates on the committed p95 even when the slow table is read first", () => {
    const document = readFileSync(BASELINE_PATH, "utf8");
    const lines = document.split("\n");
    const headingIndex = lines.findIndex((line) => line.trim() === "## Committed baseline");
    expect(headingIndex).toBeGreaterThan(-1);

    const slow = "| `grid-1000` | 988 | 256x256 | 150 | 252.35 | 262.06 | 290.67 |";
    const scrambled = [
      ...lines.slice(0, headingIndex),
      slow,
      ...lines.slice(headingIndex),
    ].join("\n");

    const parsed = parseCommittedBaseline(scrambled);
    const largest = parsed.find((row) => row.name === "grid-1000");

    expect(parsed.filter((row) => row.name === "grid-1000")).toHaveLength(1);
    expect(largest?.p95Ms).toBe(12.07);
  });

  test("finds no baseline at all when the committed heading is absent", () => {
    const document = readFileSync(BASELINE_PATH, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "## Committed baseline")
      .join("\n");

    expect(parseCommittedBaseline(document)).toEqual([]);
  });

  test("runs the committed motor layout tick without falling back to a full world scan", () => {
    const index = createIndex();
    const measurement = measureScenario(
      "motor-layout",
      buildMotorLayoutEntities(),
      () => index,
      64,
      64,
    );
    const entityCount = buildMotorLayoutEntities().length;

    expect(entityCount).toBe(133);
    expect(measurement.connectionChecksPerTick).toBeGreaterThan(0);
    expect(measurement.connectionChecksPerTick).toBeLessThanOrEqual(entityCount);
  });
});
