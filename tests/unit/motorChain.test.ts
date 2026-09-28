import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { NEW_GAME_SEED, createInitialState } from "../../src/sim/initialState";
import { arePortsConnected, getWorldPortCells } from "../../src/sim/connections";
import { advanceSimulation, createRuntimeRecords } from "../../src/sim/tick";
import { planChain } from "../../scripts/solve-motor-chain";
import type { Entity, MachineType, Rotation, SimulationState } from "../../src/sim/types";

const ALL_MACHINES = Object.keys(MACHINES) as MachineType[];
const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

function machine(
  id: string,
  type: MachineType,
  x: number,
  y: number,
  rotation: Rotation = 0,
  recipeId?: string,
): Entity {
  return {
    id,
    type,
    x,
    y,
    rotation,
    level: 1,
    ...(recipeId === undefined ? {} : { recipeId }),
  };
}

function stateWith(entities: Entity[], recipes: string[]): SimulationState {
  const state = createInitialState(NEW_GAME_SEED);
  const records = createRuntimeRecords(entities);
  return {
    ...state,
    unlocked: { machines: ALL_MACHINES, recipes },
    grid: { ...state.grid, entities, machines: records.machines, belts: records.belts },
  };
}

describe("a producer serves exactly one consumer", () => {
  it("reaches only the entity standing on its output port cell", () => {
    const producer = machine("producer", "assembler", 10, 10, 0, "gear");
    const straight = machine("straight", "assembler", 11, 10, 0, "frame");
    const turned = machine("turned", "assembler", 11, 10, 90, "frame");

    expect(getWorldPortCells(producer)[2]).toEqual({
      port: MACHINES.assembler.ports[2],
      x: 11,
      y: 10,
    });
    expect(arePortsConnected(producer, straight)).toBe(true);
    expect(arePortsConnected(producer, turned)).toBe(false);
  });

  it("reaches one cell and therefore one consumer, never two cells", () => {
    let checked = 0;

    for (const rotation of ROTATIONS) {
      const producer = machine(`producer-${rotation}`, "assembler", 20, 20, rotation, "circuit");
      const output = getWorldPortCells(producer).find((cell) => cell.port.kind === "output");
      const consumers: Entity[] = ROTATIONS.flatMap((consumerRotation) =>
        NEIGHBOURS.map(([dx, dy]) =>
          machine(
            `consumer-${rotation}-${consumerRotation}-${dx}-${dy}`,
            "assembler",
            20 + dx,
            20 + dy,
            consumerRotation,
            "motor",
          ),
        ),
      );

      const connected = consumers.filter((consumer) => arePortsConnected(producer, consumer));
      const cells = new Set(connected.map((consumer) => `${consumer.x},${consumer.y}`));

      expect(output).toBeDefined();
      expect([...cells]).toEqual([`${output?.x},${output?.y}`]);
      checked += 1;
    }

    expect(checked).toBe(ROTATIONS.length);
  });

  it("leaves a second consumer unreachable once the port cell is occupied", () => {
    const producer = machine("producer", "assembler", 20, 20, 0, "circuit");
    const first = machine("first", "assembler", 21, 20, 0, "motor");
    const rivalRotation = 270;
    const rival = machine("rival", "assembler", 21, 20, rivalRotation, "motor");

    expect(arePortsConnected(producer, first)).toBe(true);
    expect(arePortsConnected(producer, rival)).toBe(true);
    expect(`${first.x},${first.y}`).toBe(`${rival.x},${rival.y}`);
  });
});

describe("a belt run can never turn", () => {
  it("connects a belt to the next entity only when it points straight at it", () => {
    const belt = machine("belt", "belt", 5, 5, 0);
    const ahead = machine("ahead", "belt", 6, 5, 0);
    const sideOn = machine("side-on", "belt", 6, 4, 0);
    const sideOnTurned = machine("side-on-turned", "belt", 6, 4, 90);
    const behind = machine("behind", "belt", 4, 5, 0);

    expect(arePortsConnected(belt, ahead)).toBe(true);
    expect(arePortsConnected(belt, sideOn)).toBe(false);
    expect(arePortsConnected(belt, sideOnTurned)).toBe(false);
    expect(arePortsConnected(belt, behind)).toBe(false);
  });

  it("leaves a belt whose sideways neighbour exists unable to hand anything to it", () => {
    const belts = [
      machine("source", "extractor", 5, 5, 90, undefined),
      machine("corner", "belt", 5, 6, 0),
      machine("side", "belt", 6, 6, 0),
      machine("reader", "depot", 6, 7, 270),
    ];
    belts[0] = { ...belts[0], resourceNode: "copperOre" };
    const advanced = advanceSimulation(stateWith(belts, []), 400);

    expect(advanced.currency).toBe(500);
  });
});

describe("a belt feed must reach the reader's input port cell", () => {
  it("delivers a smelter's ingot when the run ends on the port cell", () => {
    const smelter = machine("smelter", "smelter", 22, 20, 90, "copperIngot");
    const extractor = { ...machine("extractor", "extractor", 22, 19, 90), resourceNode: "copperOre" } as Entity;
    const belts = [21, 22, 23, 24].map((y) => machine(`belt-${y}`, "belt", 22, y, 90));
    const depot = machine("depot", "depot", 22, 25, 90);
    const state = stateWith([extractor, smelter, ...belts, depot], ["copperIngot"]);

    const advanced = advanceSimulation(state, 3000);

    expect(advanced.currency).toBeGreaterThan(500);
  });

  it("delivers nothing when the run stops one cell short of the port cell", () => {
    const smelter = machine("smelter", "smelter", 22, 20, 90, "copperIngot");
    const extractor = { ...machine("extractor", "extractor", 22, 19, 90), resourceNode: "copperOre" } as Entity;
    const belts = [22, 23, 24].map((y) => machine(`belt-${y}`, "belt", 22, y, 90));
    const depot = machine("depot", "depot", 22, 25, 90);
    const state = stateWith([extractor, smelter, ...belts, depot], ["copperIngot"]);

    const advanced = advanceSimulation(state, 3000);

    expect(advanced.currency).toBe(500);
    expect(advanced.grid.machines.depot?.input).toEqual({});
  });
});

describe("the motor chain plan", () => {
  it("gives every consumer its own producer and counts the machines the chain needs", () => {
    const plan = planChain("motor");
    const root = plan[0];
    const consumers = new Map<string, number>();
    for (const node of plan) {
      for (const feeder of node.feeders) {
        if (feeder.child !== undefined) {
          consumers.set(feeder.child.id, (consumers.get(feeder.child.id) ?? 0) + 1);
        }
      }
    }

    expect(root.recipe).toBe("motor");
    expect([...consumers.values()].every((count) => count === 1)).toBe(true);
    expect(plan.filter((node) => node.type === "assembler").length).toBe(7);
    expect(plan.filter((node) => node.type === "smelter").length).toBe(5);
    expect(plan.length).toBe(12);
  });

  it("gives a recipe needing two units of one input a single producer", () => {
    const plan = planChain("motor");
    const frame = plan.find((node) => node.recipe === "frame");
    const motor = plan.find((node) => node.recipe === "motor");

    expect(motor?.feeders.map((feeder) => feeder.resource).sort()).toEqual(["circuit", "frame"]);
    expect(frame?.feeders.map((feeder) => feeder.resource).sort()).toEqual(["gear", "plate"]);
    expect(plan.filter((node) => node.recipe === "plate").length).toBe(1);
    expect(plan.filter((node) => node.recipe === "gear").length).toBe(2);
  });
});
