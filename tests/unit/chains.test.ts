import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { RESOURCES } from "../../src/content/resources";
import { parseSave, serializeSave } from "../../src/persistence/save";
import {
  analyzeProductionChains,
  getSteadyStateThroughput,
  traceChainNodes,
} from "../../src/sim/chains";
import {
  CURRENCY_RATE_WINDOW_SECONDS,
  CURRENCY_RATE_WINDOW_TICKS,
  getCurrencyPerSecond,
} from "../../src/sim/economy";
import { createInitialState } from "../../src/sim/initialState";
import { advanceSimulation, createRuntimeRecords } from "../../src/sim/tick";
import type {
  Entity,
  MachineType,
  ProductionChainSummary,
  ResourceNode,
  Rotation,
  SimulationState,
} from "../../src/sim/types";

const COPPER_NODES: ResourceNode[] = [
  { id: "node-copper-north", resource: "copperOre", x: 20, y: 20 },
  { id: "node-copper-spare", resource: "copperOre", x: 20, y: 30 },
  { id: "node-copper-store", resource: "copperOre", x: 20, y: 40 },
  { id: "node-copper-scaled", resource: "copperOre", x: 20, y: 50 },
  { id: "node-copper-smelted", resource: "copperOre", x: 20, y: 60 },
];
const COPPER_SELL_VALUE = RESOURCES.copperOre.sellValue;
const STEADY_TICKS = CURRENCY_RATE_WINDOW_TICKS * 2;
const LEVEL_ONE_THROUGHPUT = 1 / (MACHINES.extractor.defaultProcessTicks / 10);
const CHAIN_SUMMARY_KEYS = ["id", "outputResource", "sellValue", "steadyStateThroughput"];

describe("production chain discovery", () => {
  it("reports an unconnected chain with zero throughput", () => {
    const extractor = createExtractor("extractor-lone", COPPER_NODES[0]);
    const state = runWorld([extractor], [COPPER_NODES[0]]);

    const chains = analyzeProductionChains(state);

    expect(Object.keys(chains)).toEqual([chainId(extractor)]);
    expect(chains[chainId(extractor)]).toEqual({
      id: chainId(extractor),
      outputResource: "copperOre",
      steadyStateThroughput: 0,
      sellValue: COPPER_SELL_VALUE,
    });
    expect(getSteadyStateThroughput(state)).toBe(0);
  });

  it("reports a positive rate for an extractor, belt, and depot chain", () => {
    const [extractor, beltOne, beltTwo, depot] = createCopperLine("sold", COPPER_NODES[0]);
    const state = runWorld([extractor, beltOne, beltTwo, depot], [COPPER_NODES[0]]);

    const chains = analyzeProductionChains(state);
    const chain = chains[chainId(extractor)];

    expect(Object.keys(chains)).toEqual([chainId(extractor)]);
    expect(chain?.outputResource).toBe("copperOre");
    expect(chain?.sellValue).toBe(COPPER_SELL_VALUE);
    expect(chain?.steadyStateThroughput).toBeCloseTo(LEVEL_ONE_THROUGHPUT, 10);
    expect(getSteadyStateThroughput(state)).toBeCloseTo(LEVEL_ONE_THROUGHPUT, 10);
    expect(getCurrencyPerSecond(state)).toBeCloseTo(
      (chain?.steadyStateThroughput ?? 0) * COPPER_SELL_VALUE,
      10,
    );
  });

  it("keeps two branches distinct instead of merging them", () => {
    const [extractorA, beltA1, beltA2, depotA] = createCopperLine("branch-a", COPPER_NODES[0]);
    const [extractorB, beltB1, beltB2, depotB] = createCopperLine("branch-b", COPPER_NODES[1], {
      level: 2,
    });
    const state = runWorld(
      [extractorA, beltA1, beltA2, depotA, extractorB, beltB1, beltB2, depotB],
      [COPPER_NODES[0], COPPER_NODES[1]],
    );

    const chains = analyzeProductionChains(state);

    expect(Object.keys(chains)).toEqual([chainId(extractorA), chainId(extractorB)]);
    expect(chains[chainId(extractorA)]?.steadyStateThroughput).toBeCloseTo(LEVEL_ONE_THROUGHPUT, 10);
    expect(chains[chainId(extractorB)]?.steadyStateThroughput).toBeCloseTo(
      LEVEL_ONE_THROUGHPUT * 2,
      10,
    );
    expect(getSteadyStateThroughput(state)).toBeCloseTo(LEVEL_ONE_THROUGHPUT * 3, 10);
  });

  it("returns identical values and ordering when the same state is analyzed twice", () => {
    const [extractorTen, beltTen1, beltTen2, depotTen] = createCopperLine("10", COPPER_NODES[0]);
    const [extractorNine, beltNine1, beltNine2, depotNine] = createCopperLine("9", COPPER_NODES[1]);
    const state = runWorld(
      [extractorTen, beltTen1, beltTen2, depotTen, extractorNine, beltNine1, beltNine2, depotNine],
      [COPPER_NODES[0], COPPER_NODES[1]],
    );

    const first = analyzeProductionChains(state);
    const second = analyzeProductionChains(state);

    expect(Object.keys(first)).toEqual([chainId(extractorTen), chainId(extractorNine)]);
    expect(Object.keys(second)).toEqual(Object.keys(first));
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(getSteadyStateThroughput(state)).toBe(getSteadyStateThroughput(state));
    expect(state.productionChains).toEqual({});
  });

  it("reports the last producer output of a chain as its output resource", () => {
    const node = COPPER_NODES[4];
    const extractor = createExtractor("smelted", node);
    const beltIn = createMachine("belt", "smelted-belt-in", node.x + 1, node.y);
    const smelter = createMachine("smelter", "smelted-smelter", node.x + 2, node.y, "copperIngot");
    const beltOut = createMachine("belt", "smelted-belt-out", node.x + 3, node.y);
    const depot = createMachine("depot", "smelted-depot", node.x + 4, node.y);
    const state = runWorld([extractor, beltIn, smelter, beltOut, depot], [node]);

    const chains = analyzeProductionChains(state);

    expect(Object.keys(chains)).toEqual([chainId(extractor)]);
    expect(chains[chainId(extractor)]?.outputResource).toBe("copperIngot");
    expect(chains[chainId(extractor)]?.sellValue).toBe(RESOURCES.copperIngot.sellValue);
    expect(chains[chainId(extractor)]?.steadyStateThroughput).toBeCloseTo(LEVEL_ONE_THROUGHPUT, 10);
    expect(getCurrencyPerSecond(state)).toBeCloseTo(
      LEVEL_ONE_THROUGHPUT * RESOURCES.copperIngot.sellValue,
      10,
    );
  });
});

describe("chain terminals", () => {
  it("reports a chain whose terminal output is not a sale as zero throughput", () => {
    const [soldExtractor, soldBelt1, soldBelt2, depot] = createCopperLine("sold", COPPER_NODES[0]);
    const [storedExtractor, storedBelt1, storedBelt2, silo] = createCopperLine("stored", COPPER_NODES[2], {
      terminal: "silo",
    });
    const state = runWorld(
      [soldExtractor, soldBelt1, soldBelt2, depot, storedExtractor, storedBelt1, storedBelt2, silo],
      [COPPER_NODES[0], COPPER_NODES[2]],
    );

    const chains = analyzeProductionChains(state);

    expect(chains[chainId(storedExtractor)]).toEqual({
      id: chainId(storedExtractor),
      outputResource: "copperOre",
      steadyStateThroughput: 0,
      sellValue: COPPER_SELL_VALUE,
    });
    expect(chains[chainId(soldExtractor)]?.steadyStateThroughput).toBeCloseTo(
      LEVEL_ONE_THROUGHPUT,
      10,
    );
    expect(getSteadyStateThroughput(state)).toBeCloseTo(LEVEL_ONE_THROUGHPUT, 10);
  });

  it("keeps selling after storage while a machine behind the silo stays connected", () => {
    const [extractor, beltOne, beltTwo, silo, beltThree, depot] = createCopperLineThroughSilo(
      "through-silo",
      COPPER_NODES[2],
    );
    const state = runWorld([extractor, beltOne, beltTwo, silo, beltThree, depot], [COPPER_NODES[2]]);

    const chains = analyzeProductionChains(state);

    expect(Object.keys(chains)).toEqual([chainId(extractor)]);
    expect(chains[chainId(extractor)]?.steadyStateThroughput).toBeCloseTo(LEVEL_ONE_THROUGHPUT, 10);
  });

  it("reports no chain for a machine with no output port and no producer", () => {
    const node = COPPER_NODES[0];
    const depot = createMachine("depot", "depot-lone", node.x, node.y);
    const belt = createMachine("belt", "belt-lone", node.x, node.y);

    expect(analyzeProductionChains(createWorld([depot], [node]))).toEqual({});
    expect(analyzeProductionChains(createWorld([belt], [node]))).toEqual({});
    expect(analyzeProductionChains(createWorld([], []))).toEqual({});
  });

  it("reports zero throughput before the rolling window has filled", () => {
    const [extractor, beltOne, beltTwo, depot] = createCopperLine("fresh", COPPER_NODES[0]);
    const state = runWorld(
      [extractor, beltOne, beltTwo, depot],
      [COPPER_NODES[0]],
      CURRENCY_RATE_WINDOW_TICKS - 1,
    );

    const chains = analyzeProductionChains(state);

    expect(chains[chainId(extractor)]?.outputResource).toBe("copperOre");
    expect(chains[chainId(extractor)]?.steadyStateThroughput).toBe(0);
    expect(getSteadyStateThroughput(state)).toBe(0);
  });
});

describe("chain rate and the extractor level", () => {
  it("scales a chain rate with the extractor level instead of saturating it", () => {
    const throughputAtLevel = (level: number): number => {
      const node = COPPER_NODES[3];
      const extractor = createExtractor("scaled", node, { level });
      const depot = createMachine("depot", "scaled-depot", node.x + 1, node.y);
      const state = runWorld([extractor, depot], [node]);

      return analyzeProductionChains(state)[chainId(extractor)]?.steadyStateThroughput ?? 0;
    };

    expect(throughputAtLevel(1)).toBeCloseTo(LEVEL_ONE_THROUGHPUT, 10);
    expect(throughputAtLevel(20)).toBeCloseTo(10, 10);
    expect(throughputAtLevel(40)).toBeCloseTo(20, 10);
    expect(throughputAtLevel(40)).toBeGreaterThan(throughputAtLevel(20));
  });

  it("reads a chain rate in the units the rolling window is measured in", () => {
    const [extractor, beltOne, beltTwo, depot] = createCopperLine("units", COPPER_NODES[0]);
    const state = runWorld([extractor, beltOne, beltTwo, depot], [COPPER_NODES[0]]);

    const chain = analyzeProductionChains(state)[chainId(extractor)];

    expect((chain?.steadyStateThroughput ?? 0) * CURRENCY_RATE_WINDOW_SECONDS).toBeCloseTo(
      CURRENCY_RATE_WINDOW_TICKS / MACHINES.extractor.defaultProcessTicks,
      10,
    );
  });
});

describe("directed chain traversal", () => {
  it("stops a cyclic adjacency instead of looping forever", () => {
    const cyclic = new Map<string, string[]>([
      ["alpha", ["beta"]],
      ["beta", ["gamma"]],
      ["gamma", ["alpha"]],
    ]);
    const selfLoop = new Map<string, string[]>([["alpha", ["alpha"]]]);

    expect(traceChainNodes("alpha", cyclic)).toEqual(["alpha", "beta", "gamma"]);
    expect(traceChainNodes("gamma", cyclic)).toEqual(["gamma", "alpha", "beta"]);
    expect(traceChainNodes("alpha", selfLoop)).toEqual(["alpha"]);
    expect(traceChainNodes("absent", cyclic)).toEqual([]);
  });

  it("refuses a neighbour whose input port rejects the resource", () => {
    const node = COPPER_NODES[3];
    const extractor = createExtractor("gated", node);
    const assembler = createMachine("assembler", "gated-assembler", node.x + 1, node.y, "wire");
    const belt = createMachine("belt", "gated-belt", node.x + 2, node.y);
    const depot = createMachine("depot", "gated-depot", node.x + 3, node.y);
    const state = runWorld([extractor, assembler, belt, depot], [node]);

    const chains = analyzeProductionChains(state);

    expect(Object.keys(chains).sort()).toEqual([chainId(extractor), chainId(assembler)].sort());
    expect(chains[chainId(extractor)]?.steadyStateThroughput).toBe(0);
    expect(chains[chainId(extractor)]?.outputResource).toBe("copperOre");
    expect(chains[chainId(assembler)]?.outputResource).toBe("wire");
    expect(chains[chainId(assembler)]?.steadyStateThroughput).toBe(0);
    expect(getSteadyStateThroughput(state)).toBe(0);
  });

  it("refuses a neighbour that is adjacent but not facing the port", () => {
    const node = COPPER_NODES[0];
    const extractor = createExtractor("turned", node, { rotation: 90 });
    const belt = createMachine("belt", "turned-belt", node.x + 1, node.y);
    const state = runWorld([extractor, belt], [node]);

    const chains = analyzeProductionChains(state);

    expect(Object.keys(chains)).toEqual([chainId(extractor)]);
    expect(chains[chainId(extractor)]?.steadyStateThroughput).toBe(0);
  });
});

describe("chain save projection", () => {
  it("serializes only sorted chain summaries and never item positions", () => {
    const [extractor, beltOne, beltTwo, depot] = createCopperLine("save", COPPER_NODES[0]);
    const state = runWorld([extractor, beltOne, beltTwo, depot], [COPPER_NODES[0]]);
    const analyzed = analyzeProductionChains(state);
    const withChains: SimulationState = { ...state, productionChains: analyzed };

    const raw = serializeSave(withChains);
    const parsed = parseSave(raw);

    expect(Object.keys(state.grid.belts).length).toBeGreaterThan(0);
    expect(JSON.stringify(analyzed)).not.toContain("belt");
    expect(JSON.stringify(analyzed)).not.toContain("item");
    expect(serializeSave(withChains)).toBe(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(`Expected a valid save, received ${parsed.reason}: ${parsed.message}`);
    }

    expect(Object.keys(parsed.save.productionChains)).toEqual(Object.keys(analyzed));
    expect(parsed.save.productionChains).toEqual(analyzed);
    for (const chain of Object.values(parsed.save.productionChains)) {
      expect(Object.keys(chain).sort()).toEqual(CHAIN_SUMMARY_KEYS);
    }
  });

  it("keeps a chain summary identical across a save and load round trip", () => {
    const [extractor, beltOne, beltTwo, depot] = createCopperLine("round-trip", COPPER_NODES[0]);
    const state = runWorld([extractor, beltOne, beltTwo, depot], [COPPER_NODES[0]]);
    const analyzed: Record<string, ProductionChainSummary> = analyzeProductionChains(state);
    const parsed = parseSave(serializeSave({ ...state, productionChains: analyzed }));

    if (!parsed.ok) {
      throw new Error(`Expected a valid save, received ${parsed.reason}: ${parsed.message}`);
    }

    expect(parsed.save.productionChains).toEqual(analyzed);
  });
});

function chainId(entity: Entity): string {
  return `chain-${entity.id}`;
}

function createWorld(entities: Entity[], nodes: ResourceNode[]): SimulationState {
  const state = createInitialState(1337);
  state.grid.nodes = nodes;
  state.grid.entities = entities;
  state.unlocked.machines = Object.keys(MACHINES) as MachineType[];
  state.unlocked.recipes = ["copperIngot", "wire"];
  const records = createRuntimeRecords(entities);
  state.grid.machines = records.machines;
  state.grid.belts = records.belts;
  return state;
}

function runWorld(
  entities: Entity[],
  nodes: ResourceNode[],
  tickCount = STEADY_TICKS,
): SimulationState {
  return advanceSimulation(createWorld(entities, nodes), tickCount);
}

function createCopperLine(
  prefix: string,
  node: ResourceNode,
  overrides: { level?: number; terminal?: "depot" | "silo" } = {},
): [Entity, Entity, Entity, Entity] {
  const terminalType = overrides.terminal ?? "depot";

  return [
    createExtractor(prefix, node, { level: overrides.level ?? 1 }),
    createMachine("belt", `${prefix}-belt-in`, node.x + 1, node.y),
    createMachine("belt", `${prefix}-belt-out`, node.x + 2, node.y),
    createMachine(terminalType, `${prefix}-${terminalType}`, node.x + 3, node.y),
  ];
}

function createCopperLineThroughSilo(
  prefix: string,
  node: ResourceNode,
): [Entity, Entity, Entity, Entity, Entity, Entity] {
  return [
    createExtractor(prefix, node),
    createMachine("belt", `${prefix}-belt-in`, node.x + 1, node.y),
    createMachine("belt", `${prefix}-belt-to-silo`, node.x + 2, node.y),
    createMachine("silo", `${prefix}-silo`, node.x + 3, node.y),
    createMachine("belt", `${prefix}-belt-from-silo`, node.x + 4, node.y),
    createMachine("depot", `${prefix}-depot`, node.x + 5, node.y),
  ];
}

function createExtractor(
  prefix: string,
  node: ResourceNode,
  overrides: { level?: number; rotation?: Rotation } = {},
): Entity {
  return {
    id: `${prefix}-extractor`,
    type: "extractor",
    x: node.x,
    y: node.y,
    rotation: overrides.rotation ?? 0,
    level: overrides.level ?? 1,
    resourceNode: node.resource,
  };
}

function createMachine(
  type: "belt" | "depot" | "silo" | "smelter" | "assembler",
  id: string,
  x: number,
  y: number,
  recipeId?: string,
): Entity {
  const entity: Entity = {
    id,
    type,
    x,
    y,
    rotation: 0,
    level: 1,
  };

  if (recipeId !== undefined) {
    entity.recipeId = recipeId;
  }

  return entity;
}
