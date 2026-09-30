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
const SCENARIO_ROW = /^\|\s*[`](grid-\d+)[`]\s*\|\s*(\d+)\s*\|\s*\d+x\d+\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/;

interface CommittedBaseline {
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

  const rows: CommittedBaseline[] = [];
  for (const line of document.split("\n")) {
    const match = SCENARIO_ROW.exec(line.trim());
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

  if (rows.length === 0) {
    throw new Error(
      `${BASELINE_PATH} carries no scenario rows. The table must have one row per grid scenario, ` +
        "written as a markdown table row whose first cell is the scenario name in backticks, then " +
        "entity count, grid, tick count, mean ms, p95 ms and max ms.",
    );
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

      expect(
        measurement.connectionChecksPerTick,
        `${target.name} performed ${measurement.connectionChecksPerTick.toFixed(1)} connection checks ` +
          `per tick for ${measurement.entityCount} entities, over the ${CONNECTION_CHECKS_PER_ENTITY} ` +
          `per entity budget. A linear scan for a neighbour is back.`,
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
