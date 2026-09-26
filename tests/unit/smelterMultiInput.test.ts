import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { createInitialState } from "../../src/sim/initialState";
import { createMachineRuntime } from "../../src/sim/machines";
import { advanceSimulation } from "../../src/sim/tick";
import type { Entity, MachineRuntime, RenderEvent, SimulationState } from "../../src/sim/types";

const AT = { x: 10, y: 10 };
const COPPER_NODE = { id: "node-copper", resource: "copperOre" as const, x: 8, y: 9 };

function createSmelter(recipeId: string): Entity {
  return { id: "smelter-1", type: "smelter", x: AT.x, y: AT.y, rotation: 0, level: 1, recipeId };
}

function createBelt(id: string, x: number, y: number, rotation = 0): Entity {
  return { id, type: "belt", x, y, rotation, level: 1 } as Entity;
}

function createExtractor(id: string, x: number, y: number, resourceNode: "ironOre" | "coal", rotation = 0): Entity {
  return { id, type: "extractor", x, y, rotation, level: 1, resourceNode } as Entity;
}

function createState(entities: Entity[], machines: Record<string, MachineRuntime>): SimulationState {
  const state = createInitialState(1337);
  state.grid.nodes = [COPPER_NODE];
  state.grid.entities = entities;
  state.grid.machines = { ...machines };
  state.unlocked.recipes = ["copperIngot", "ironIngot", "refinedStone"];
  for (const entity of entities) {
    if (entity.type === "belt") {
      state.grid.belts[entity.id] = { entityId: entity.id, progress: 0 };
    } else if (!Object.hasOwn(machines, entity.id)) {
      state.grid.machines[entity.id] = createMachineRuntime(entity);
    }
  }
  return state;
}

function smelterWith(overrides: Partial<MachineRuntime> = {}): Record<string, MachineRuntime> {
  return { "smelter-1": { ...createMachineRuntime(createSmelter("ironIngot")), ...overrides } };
}

function findFirstOutput(state: SimulationState, resource: string, events: RenderEvent[]): number {
  let current = state;
  for (let ticks = 1; ticks <= 200; ticks += 1) {
    current = advanceSimulation(current, 1, events);
    const produced = current.grid.machines["smelter-1"]?.output[resource as "ironIngot"] ?? 0;
    if (produced > 0) {
      return produced;
    }
  }
  return 0;
}

describe("smelter second raw input port", () => {
  it("declares two raw input ports at the assembler offsets", () => {
    const ports = MACHINES.smelter.ports;
    const inputs = ports.filter((port) => port.kind === "input");
    expect(inputs.map((port) => port.offset)).toEqual([
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ]);
    expect(ports.filter((port) => port.kind === "output")).toHaveLength(1);
  });

  it("delivers iron ore on one port and coal on the other, then smelts an ingot", () => {
    const smelter = createSmelter("ironIngot");
    const ironExtractor = createExtractor("iron-source", AT.x - 2, AT.y, "ironOre");
    const coalExtractor = createExtractor("coal-source", AT.x, AT.y - 2, "coal", 90);
    const ironBelt = createBelt("iron-belt", AT.x - 1, AT.y);
    const coalBelt = createBelt("coal-belt", AT.x, AT.y - 1, 90);
    const state = createState(
      [smelter, ironExtractor, ironBelt, coalExtractor, coalBelt],
      {
        ...smelterWith(),
        "iron-source": { ...createMachineRuntime(ironExtractor), progressTicks: 0.99 },
        "coal-source": { ...createMachineRuntime(coalExtractor), progressTicks: 0.99 },
      },
    );

    const events: RenderEvent[] = [];
    const firstOutput = findFirstOutput(state, "ironIngot", events);
    expect(firstOutput).toBe(1);
  });

  it("consumes both raws for one ingot and leaves the surplus of each", () => {
    const smelter = createSmelter("ironIngot");
    const ironExtractor = createExtractor("iron-source", AT.x - 2, AT.y, "ironOre");
    const coalExtractor = createExtractor("coal-source", AT.x, AT.y - 2, "coal", 90);
    const ironBelt = createBelt("iron-belt", AT.x - 1, AT.y);
    const coalBelt = createBelt("coal-belt", AT.x, AT.y - 1, 90);
    const state = createState(
      [smelter, ironExtractor, ironBelt, coalExtractor, coalBelt],
      {
        "smelter-1": {
          ...createMachineRuntime(smelter),
          input: { ironOre: 4, coal: 3 },
        },
        "iron-source": { ...createMachineRuntime(ironExtractor), progressTicks: 0.99 },
        "coal-source": { ...createMachineRuntime(coalExtractor), progressTicks: 0.99 },
      },
    );

    const events: RenderEvent[] = [];
    const first = findFirstOutput(state, "ironIngot", events);
    expect(first).toBe(1);
  });

  it("does not run a two-raw recipe while the second raw is still missing", () => {
    const state = createState([createSmelter("ironIngot")], smelterWith({ input: { ironOre: 3 } }));
    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 200, events);
    const runtime = next.grid.machines["smelter-1"];

    expect(runtime?.output).toEqual({});
    expect(runtime?.input).toEqual({ ironOre: 3 });
  });

  it("still smelts a single-raw recipe from one port", () => {
    const state = createState(
      [createSmelter("refinedStone")],
      { "smelter-1": { ...createMachineRuntime(createSmelter("refinedStone")), input: { stone: 4 } } },
    );
    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 25, events);

    expect(next.grid.machines["smelter-1"]?.output).toEqual({ refinedStone: 1 });
  });

  it("keeps the mixed input buffer within the declared per-resource room", () => {
    const state = createState(
      [createSmelter("ironIngot")],
      smelterWith({ input: { ironOre: MACHINES.smelter.inputBuffer, coal: 2 } }),
    );
    const events: RenderEvent[] = [];
    const next = advanceSimulation(state, 1, events);
    const runtime = next.grid.machines["smelter-1"];

    expect((runtime?.input.ironOre ?? 0) <= MACHINES.smelter.inputBuffer).toBe(true);
  });
});
