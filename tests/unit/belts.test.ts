import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import * as tick from "../../src/sim/tick";
import type {
  BeltCell,
  Entity,
  MachineRuntime,
  MachineType,
  ResourceId,
  Rotation,
  SimulationState,
} from "../../src/sim/types";

interface BeltFixture {
  entity: Entity;
  cell: BeltCell;
}

describe("belt movement", () => {
  it("moves an item to only the next connected belt cell", () => {
    const first = createBelt("belt-1", 1, "copperOre", 0.75);
    const second = createBelt("belt-2", 2, undefined, 0.4);
    const third = createBelt("belt-3", 3);
    const state = createState([first, second, third]);

    expect(tick.moveBelts(state)).toBe(true);

    expect(state.grid.belts["belt-1"]?.item).toBeUndefined();
    expect(state.grid.belts["belt-1"]?.progress).toBe(0);
    expect(state.grid.belts["belt-2"]?.item).toBe("copperOre");
    expect(state.grid.belts["belt-2"]?.progress).toBe(0);
    expect(state.grid.belts["belt-3"]?.item).toBeUndefined();
    expect(state.grid.belts["belt-3"]?.progress).toBe(0);
  });

  it("keeps both items in place when the destination is occupied", () => {
    const first = createBelt("belt-1", 1, "copperOre", 0.7);
    const second = createBelt("belt-2", 2, "ironOre", 0.8);
    const state = createState([first, second]);

    expect(tick.moveBelts(state)).toBe(false);

    expect(state.grid.belts["belt-1"]).toEqual({
      entityId: "belt-1",
      item: "copperOre",
      progress: 0.7,
    });
    expect(state.grid.belts["belt-2"]).toEqual({
      entityId: "belt-2",
      item: "ironOre",
      progress: 0.8,
    });
  });

  it("does not let two items cross an occupied cell in one tick", () => {
    const first = createBelt("belt-1", 1, "copperOre", 0.6);
    const second = createBelt("belt-2", 2, "ironOre", 0.4);
    const third = createBelt("belt-3", 3, undefined, 0.2);
    const state = createState([first, second, third]);

    expect(tick.moveBelts(state)).toBe(true);

    expect(state.grid.belts["belt-1"]?.item).toBe("copperOre");
    expect(state.grid.belts["belt-1"]?.progress).toBe(0.6);
    expect(state.grid.belts["belt-2"]?.item).toBeUndefined();
    expect(state.grid.belts["belt-2"]?.progress).toBe(0);
    expect(state.grid.belts["belt-3"]?.item).toBe("ironOre");
    expect(state.grid.belts["belt-3"]?.progress).toBe(0);
  });

  it("preserves the resource type across multiple hops", () => {
    const first = createBelt("belt-1", 1, "copperIngot");
    const second = createBelt("belt-2", 2);
    const third = createBelt("belt-3", 3);
    const state = createState([first, second, third]);

    expect(tick.moveBelts(state)).toBe(true);
    expect(tick.moveBelts(state)).toBe(true);
    expect(tick.moveBelts(state)).toBe(false);

    expect(state.grid.belts["belt-1"]?.item).toBeUndefined();
    expect(state.grid.belts["belt-2"]?.item).toBeUndefined();
    expect(state.grid.belts["belt-3"]?.item).toBe("copperIngot");
    expect(state.grid.belts["belt-3"]?.progress).toBe(0);
  });

  it("does not mutate unrelated simulation state", () => {
    const first = createBelt("belt-1", 1, "coal");
    const second = createBelt("belt-2", 2);
    const smelter = createEntity("smelter-1", "smelter", 10);
    const smelterRuntime = createMachineRuntime("smelter-1");
    const state = createState([first, second], {
      "smelter-1": smelterRuntime,
    }, smelter);
    state.currency = 4321;
    state.lifetimeCurrency = 9876;
    state.selectedEntityId = smelter.id;
    const before = structuredClone(state);

    expect(tick.moveBelts(state)).toBe(true);

    expect({ ...state, grid: { ...state.grid, belts: {} } }).toEqual({
      ...before,
      grid: { ...before.grid, belts: {} },
    });
  });
});

describe("belt deposits", () => {
  it("transfers into a compatible machine input and resets belt progress", () => {
    const belt = createBelt("belt-1", 4, "copperOre", 0.65);
    const smelter = createEntity("smelter-1", "smelter", 5);
    const state = createState([belt], {
      "smelter-1": createMachineRuntime("smelter-1"),
    }, smelter);

    expect(tick.depositBeltItems(state)).toBe(true);

    expect(state.grid.belts["belt-1"]?.item).toBeUndefined();
    expect(state.grid.belts["belt-1"]?.progress).toBe(0);
    expect(state.grid.machines["smelter-1"]?.input).toEqual({ copperOre: 1 });
  });

  it("retains an item at an incompatible machine input", () => {
    const belt = createBelt("belt-1", 4, "copperIngot", 0.65);
    const smelter = createEntity("smelter-1", "smelter", 5);
    const smelterRuntime = createMachineRuntime("smelter-1");
    const state = createState([belt], {
      "smelter-1": smelterRuntime,
    }, smelter);

    expect(tick.depositBeltItems(state)).toBe(false);

    expect(state.grid.belts["belt-1"]).toEqual({
      entityId: "belt-1",
      item: "copperIngot",
      progress: 0.65,
    });
    expect(state.grid.machines["smelter-1"]).toBe(smelterRuntime);
    expect(smelterRuntime.input).toEqual({});
  });

  it("retains an item on a disconnected belt", () => {
    const belt = createBelt("belt-1", 4, "stone", 0.35);
    const state = createState([belt]);

    expect(tick.depositBeltItems(state)).toBe(false);

    expect(state.grid.belts["belt-1"]).toEqual({
      entityId: "belt-1",
      item: "stone",
      progress: 0.35,
    });
  });

  it("runs the belt transfer as part of the normal simulation tick", () => {
    const belt = createBelt("belt-1", 4, "copperOre");
    const smelter = createEntity("smelter-1", "smelter", 5);
    const state = createState([belt], {
      "smelter-1": createMachineRuntime("smelter-1"),
    }, smelter);

    const nextState = tick.advanceSimulation(state, 1);

    expect(nextState).not.toBe(state);
    expect(nextState.grid.belts["belt-1"]?.item).toBeUndefined();
    expect(nextState.grid.machines["smelter-1"]?.input).toEqual({ copperOre: 1 });
  });
});

function createBelt(
  id: string,
  x: number,
  item?: ResourceId,
  progress = 0,
): BeltFixture {
  return {
    entity: createEntity(id, "belt", x, 0),
    cell: { entityId: id, item, progress },
  };
}

function createState(
  belts: readonly BeltFixture[],
  machines: SimulationState["grid"]["machines"] = {},
  ...additionalEntities: readonly Entity[]
): SimulationState {
  const state = createInitialState(1337);
  state.grid.entities = [...belts.map(({ entity }) => entity), ...additionalEntities];
  state.grid.belts = Object.fromEntries(
    belts.map(({ cell }) => [cell.entityId, cell]),
  );
  state.grid.machines = machines;
  return state;
}

function createEntity(
  id: string,
  type: MachineType,
  x: number,
  y = 0,
  rotation: Rotation = 0,
): Entity {
  return { id, type, x, y, rotation, level: 1 };
}

function createMachineRuntime(entityId: string): MachineRuntime {
  return {
    entityId,
    progressTicks: 0,
    input: {},
    output: {},
    active: false,
  };
}
