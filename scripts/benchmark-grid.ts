import { cpus, totalmem } from "node:os";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MACHINES } from "../src/content/machines";
import { RECIPES } from "../src/content/recipes";
import { NEW_GAME_SEED, createInitialState } from "../src/sim/initialState";
import { createRuntimeRecords, advanceSimulation } from "../src/sim/tick";
import { GRID_HEIGHT, GRID_MAX_SIZE, GRID_WIDTH } from "../src/sim/constants";
import type { ActiveEntityIndex } from "../src/sim/activeIndex";
import type {
  Entity,
  MachineType,
  RenderEvent,
  Rotation,
  SimulationState,
} from "../src/sim/types";

export const BENCHMARK_GRID_WIDTH = GRID_MAX_SIZE;
export const BENCHMARK_GRID_HEIGHT = GRID_MAX_SIZE;
export const BENCHMARK_RUN_BELTS = 24;
export const BENCHMARK_ROW_GAP = 6;
export const BENCHMARK_WARMUP_TICKS = 30;
export const BENCHMARK_SAMPLE_TICKS = 150;
export const BENCHMARK_EXTRACTOR_LEVEL = 40;

export const CONNECTION_CHECKS_PER_ENTITY = 1.5;
export const SCALING_BUDGET = 12;

const ENTITIES_PER_ROW = BENCHMARK_RUN_BELTS + 2;

interface LayoutEntry {
  id: string;
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
  recipeId?: string;
  resourceNode?: string;
}

export interface TickMeasurement {
  readonly name: string;
  readonly entityCount: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly tickCount: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly connectionChecksPerTick: number;
  readonly productionVisitsPerTick: number;
  readonly productionSkipsPerTick: number;
  readonly chunksSkippedPerTick: number;
}

export interface ScenarioTarget {
  readonly name: string;
  readonly rows: number;
  readonly entityCount: number;
}

export function scenarioTargets(): ScenarioTarget[] {
  return [
    { name: "grid-100", rows: 4, entityCount: 4 * ENTITIES_PER_ROW },
    { name: "grid-500", rows: 19, entityCount: 19 * ENTITIES_PER_ROW },
    { name: "grid-1000", rows: 38, entityCount: 38 * ENTITIES_PER_ROW },
  ];
}

export function buildBeltRows(rows: number): Entity[] {
  const entities: Entity[] = [];
  for (let row = 0; row < rows; row += 1) {
    const y = 2 + row * BENCHMARK_ROW_GAP;
    entities.push({
      id: `row-${row}-extractor`,
      type: "extractor",
      x: 1,
      y,
      rotation: 0,
      level: BENCHMARK_EXTRACTOR_LEVEL,
      resourceNode: "ironOre",
    });
    for (let step = 0; step < BENCHMARK_RUN_BELTS; step += 1) {
      entities.push({
        id: `row-${row}-belt-${step}`,
        type: "belt",
        x: 2 + step,
        y,
        rotation: 0,
        level: 1,
      });
    }
    entities.push({
      id: `row-${row}-depot`,
      type: "depot",
      x: 2 + BENCHMARK_RUN_BELTS,
      y,
      rotation: 0,
      level: 1,
    });
  }
  return entities;
}

export function buildMotorLayoutEntities(): Entity[] {
  const layout = JSON.parse(
    readFileSync("scripts/motor-chain-layout.json", "utf8"),
  ) as LayoutEntry[];
  return layout.map((entry) => ({
    id: entry.id,
    type: entry.type,
    x: entry.x,
    y: entry.y,
    rotation: entry.rotation,
    level: entry.type === "extractor" ? 20 : 1,
    ...(entry.recipeId === undefined ? {} : { recipeId: entry.recipeId }),
    ...(entry.resourceNode === undefined
      ? {}
      : { resourceNode: entry.resourceNode as Entity["resourceNode"] }),
  }));
}

export function buildBenchmarkState(
  entities: readonly Entity[],
  width = BENCHMARK_GRID_WIDTH,
  height = BENCHMARK_GRID_HEIGHT,
): SimulationState {
  const base = createInitialState(NEW_GAME_SEED, width, height);
  const { machines, belts } = createRuntimeRecords(entities);
  return {
    ...base,
    currency: 10_000_000,
    unlocked: {
      machines: Object.keys(MACHINES) as MachineType[],
      recipes: Object.keys(RECIPES),
    },
    grid: { ...base.grid, entities: [...entities], machines, belts },
  };
}

export function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function measureScenario(
  name: string,
  entities: readonly Entity[],
  createIndex: (() => ActiveEntityIndex) | undefined,
  gridWidth = BENCHMARK_GRID_WIDTH,
  gridHeight = BENCHMARK_GRID_HEIGHT,
  sampleTicks = BENCHMARK_SAMPLE_TICKS,
): TickMeasurement {
  const index = createIndex?.();
  let state = buildBenchmarkState(entities, gridWidth, gridHeight);
  index?.rebuild(state.grid.entities);
  state = advanceSimulation(state, BENCHMARK_WARMUP_TICKS, [], index);
  index?.rebuild(state.grid.entities);
  index?.resetTelemetry();

  const events: RenderEvent[] = [];
  const samples: number[] = [];
  for (let tick = 0; tick < sampleTicks; tick += 1) {
    const started = performance.now();
    state = advanceSimulation(state, 1, events, index);
    samples.push(performance.now() - started);
  }

  const telemetry = index?.getTelemetry();
  return {
    name,
    entityCount: entities.length,
    gridWidth,
    gridHeight,
    tickCount: sampleTicks,
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p95Ms: percentile(samples, 0.95),
    maxMs: Math.max(...samples),
    connectionChecksPerTick: (telemetry?.connectionChecks ?? 0) / sampleTicks,
    productionVisitsPerTick: (telemetry?.productionVisits ?? 0) / sampleTicks,
    productionSkipsPerTick: (telemetry?.productionSkips ?? 0) / sampleTicks,
    chunksSkippedPerTick: (telemetry?.chunksSkipped ?? 0) / sampleTicks,
  };
}

export function describeEnvironment(): string {
  const model = cpus()[0]?.model ?? "unknown cpu";
  return `${model.trim()} | ${cpus().length} cores | ${Math.round(totalmem() / 1024 ** 3)} GiB | node ${process.version} | ${process.platform} ${process.arch}`;
}

export function checkPortableContract(
  measurements: readonly TickMeasurement[],
): string[] {
  const failures: string[] = [];
  for (const measurement of measurements) {
    if (measurement.connectionChecksPerTick > measurement.entityCount * CONNECTION_CHECKS_PER_ENTITY) {
      failures.push(
        `${measurement.name}: ${measurement.connectionChecksPerTick.toFixed(1)} connection checks per tick ` +
          `exceeds ${CONNECTION_CHECKS_PER_ENTITY} per entity`,
      );
    }
  }

  const smallest = measurements[0];
  const largest = measurements[measurements.length - 2];
  if (smallest !== undefined && largest !== undefined && smallest.meanMs > 0) {
    const ratio = largest.meanMs / smallest.meanMs;
    const entityRatio = largest.entityCount / smallest.entityCount;
    if (ratio > SCALING_BUDGET) {
      failures.push(
        `${largest.name} costs ${ratio.toFixed(1)}x ${smallest.name} for ${entityRatio.toFixed(1)}x the ` +
          `entities, over the ${SCALING_BUDGET}x budget`,
      );
    }
  }

  return failures;
}

function report(measurement: TickMeasurement): void {
  process.stdout.write(
    `${measurement.name}\tentities=${measurement.entityCount}\tgrid=${measurement.gridWidth}x${measurement.gridHeight}` +
      `\tticks=${measurement.tickCount}\tmean=${measurement.meanMs.toFixed(3)}ms\tp95=${measurement.p95Ms.toFixed(3)}ms` +
      `\tmax=${measurement.maxMs.toFixed(3)}ms\tchecks/tick=${measurement.connectionChecksPerTick.toFixed(1)}` +
      `\tprodVisits/tick=${measurement.productionVisitsPerTick.toFixed(1)}` +
      `\tprodSkips/tick=${measurement.productionSkipsPerTick.toFixed(1)}` +
      `\tchunksSkipped/tick=${measurement.chunksSkippedPerTick.toFixed(1)}\n`,
  );
}

async function main(): Promise<number> {
  const disabled = process.argv.includes("--no-index");
  let createIndex: (() => ActiveEntityIndex) | undefined;
  if (!disabled) {
    try {
      const module = await import("../src/sim/activeIndex");
      createIndex = () => new module.ActiveEntityIndex();
    } catch {
      createIndex = undefined;
    }
  }

  const measurements: TickMeasurement[] = [];
  for (const target of scenarioTargets()) {
    const measurement = measureScenario(target.name, buildBeltRows(target.rows), createIndex);
    measurements.push(measurement);
    report(measurement);
  }
  const motor = measureScenario(
    "motor-layout",
    buildMotorLayoutEntities(),
    createIndex,
    GRID_WIDTH,
    GRID_HEIGHT,
  );
  measurements.push(motor);
  report(motor);

  process.stdout.write(`environment\t${describeEnvironment()}\n`);
  process.stdout.write(`index\t${createIndex === undefined ? "unavailable" : "on"}\n`);

  const failures = checkPortableContract(measurements);
  for (const failure of failures) {
    process.stdout.write(`FAILED\t${failure}\n`);
  }
  process.stdout.write(
    failures.length === 0 ? "OK\tportable contract held\n" : `FAILED\t${failures.length} contract failure(s)\n`,
  );
  return failures.length === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exit(await main());
}
