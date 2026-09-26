import { describe, expect, it, vi } from "vitest";
import { createCameraConfig } from "../../src/phaser/cameraConfig";
import { createFloorTileData } from "../../src/phaser/render/floorGrid";
import { canExpandGrid, expandGrid } from "../../src/sim/commands";
import {
  GRID_EXPANSION_STEP,
  GRID_HEIGHT,
  GRID_MAX_SIZE,
  GRID_MIN_SIZE,
  GRID_WIDTH,
  PRESTIGE_THRESHOLD,
  TILE_SIZE_PX,
} from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import type { Entity, ResourceNode, SimulationState } from "../../src/sim/types";

const EXPANDED_WIDTH = 96;
const EXPANDED_HEIGHT = 96;

function stateWithPlotRights(): SimulationState {
  const state = createInitialState();
  state.prestige.totalPrestiges = 1;
  return state;
}

function stateWithDepot(id: string, x: number, y: number): SimulationState {
  const state = stateWithPlotRights();
  const entity: Entity = { id, type: "depot", x, y, rotation: 90, level: 3 };
  state.grid.entities = [entity];
  state.grid.machines[id] = {
    entityId: id,
    progressTicks: 4,
    input: {},
    output: { copperIngot: 2 },
    active: true,
    alreadyNotifiedBlocked: false,
  };
  return state;
}

function stateWithNodeAt(x: number, y: number): SimulationState {
  const state = stateWithPlotRights();
  const node: ResourceNode = { id: "node-outside", resource: "coal", x, y };
  state.grid.nodes = [...state.grid.nodes, node];
  return state;
}

function nodeInNewArea(state: SimulationState): ResourceNode {
  const node = state.grid.nodes.find(
    (candidate) => candidate.x >= GRID_WIDTH || candidate.y >= GRID_HEIGHT,
  );
  if (node === undefined) {
    throw new Error("expected a resource node inside the expanded area");
  }

  return node;
}

function storeWithPlotRights(): SimulationStore {
  return new SimulationStore(stateWithPlotRights());
}

describe("grid expansion dimensions", () => {
  it("rejects a request that shrinks the plot on either axis", () => {
    const state = { ...stateWithPlotRights() };
    state.grid = { ...state.grid, width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT };

    expect(canExpandGrid(state, 64, EXPANDED_HEIGHT)).toEqual({
      ok: false,
      reason: "gridShrink",
    });
    expect(canExpandGrid(state, EXPANDED_WIDTH, 64)).toEqual({
      ok: false,
      reason: "gridShrink",
    });
  });

  it("rejects dimensions that are not a whole number of expansion steps", () => {
    const state = stateWithPlotRights();

    expect(canExpandGrid(state, 100, EXPANDED_HEIGHT)).toEqual({
      ok: false,
      reason: "invalidGridStep",
    });
    expect(canExpandGrid(state, EXPANDED_WIDTH, 100)).toEqual({
      ok: false,
      reason: "invalidGridStep",
    });
  });

  it("rejects a dimension that is not a whole number of cells", () => {
    const state = stateWithPlotRights();

    expect(canExpandGrid(state, 96.5, EXPANDED_HEIGHT)).toEqual({
      ok: false,
      reason: "outOfRange",
    });
  });

  it.each([
    ["zero", 0, EXPANDED_HEIGHT],
    ["negative", -GRID_EXPANSION_STEP, EXPANDED_HEIGHT],
    ["below the smallest legal plot", GRID_MIN_SIZE - 1, EXPANDED_HEIGHT],
    ["above the largest legal plot", GRID_MAX_SIZE + GRID_EXPANSION_STEP, EXPANDED_HEIGHT],
    ["not finite", Number.NaN, EXPANDED_HEIGHT],
    ["infinite", Number.POSITIVE_INFINITY, EXPANDED_HEIGHT],
    ["an out-of-range height", EXPANDED_WIDTH, 0],
    ["an out-of-range non-integer height", EXPANDED_WIDTH, 96.5],
  ])("rejects %s dimensions as out of range", (_label, width, height) => {
    expect(canExpandGrid(stateWithPlotRights(), width, height)).toEqual({
      ok: false,
      reason: "outOfRange",
    });
  });

  it("rejects a request that does not grow the plot", () => {
    const state = stateWithPlotRights();

    expect(canExpandGrid(state, GRID_WIDTH, GRID_HEIGHT)).toEqual({
      ok: false,
      reason: "gridAlreadyExpanded",
    });
  });

  it("reports the first malformed dimension before checking the unlock", () => {
    const state = createInitialState();

    expect(state.prestige.totalPrestiges).toBe(0);
    expect(canExpandGrid(state, 100, EXPANDED_HEIGHT)).toEqual({
      ok: false,
      reason: "invalidGridStep",
    });
  });

  it("bounds the plot between the starting grid and the locked ceiling", () => {
    expect(GRID_EXPANSION_STEP).toBe(32);
    expect(GRID_MIN_SIZE).toBe(GRID_WIDTH);
    expect(GRID_MAX_SIZE % GRID_EXPANSION_STEP).toBe(0);
  });
});

describe("the expansion unlock", () => {
  it("refuses a plot a run that has never prestiged does not own", () => {
    const state = createInitialState();

    expect(canExpandGrid(state, EXPANDED_WIDTH, EXPANDED_HEIGHT)).toEqual({
      ok: false,
      reason: "expansionLocked",
    });
  });

  it("grants the plot after a completed prestige", () => {
    const state = createInitialState();
    state.lifetimeCurrency = PRESTIGE_THRESHOLD;
    const store = new SimulationStore(state);

    expect(store.canExpandGrid(EXPANDED_WIDTH, EXPANDED_HEIGHT)).toEqual({
      ok: false,
      reason: "expansionLocked",
    });

    expect(store.dispatch({ type: "prestige" })).toEqual({ ok: true });

    expect(store.canExpandGrid(EXPANDED_WIDTH, EXPANDED_HEIGHT)).toEqual({ ok: true });
  });

  it("accepts the plot for a run that has prestiged", () => {
    expect(canExpandGrid(stateWithPlotRights(), EXPANDED_WIDTH, EXPANDED_HEIGHT)).toEqual({
      ok: true,
    });
  });
});

describe("world integrity when the plot grows", () => {
  it("rejects an expansion that would leave an existing entity outside the new bounds", () => {
    const state = stateWithDepot("entity-1", 200, 3);

    expect(canExpandGrid(state, EXPANDED_WIDTH, EXPANDED_HEIGHT)).toEqual({
      ok: false,
      reason: "entityOutOfBounds",
    });
  });

  it("rejects an expansion that would leave an existing resource node outside the new bounds", () => {
    const state = stateWithNodeAt(200, 3);

    expect(canExpandGrid(state, EXPANDED_WIDTH, EXPANDED_HEIGHT)).toEqual({
      ok: false,
      reason: "nodeOutOfBounds",
    });
  });

  it("accepts an entity that sits on the last cell of the new plot", () => {
    const state = stateWithDepot("entity-1", EXPANDED_WIDTH - 1, EXPANDED_HEIGHT - 1);

    expect(canExpandGrid(state, EXPANDED_WIDTH, EXPANDED_HEIGHT)).toEqual({ ok: true });
  });
});

describe("a rejected expansion", () => {
  it("returns the same state object so nothing is published", () => {
    const state = createInitialState();
    const application = expandGrid(state, {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    });

    expect(application.changed).toBe(false);
    expect(application.state).toBe(state);
    expect(application.result).toEqual({ ok: false, reason: "expansionLocked" });
  });

  it("returns the same state object for a malformed request", () => {
    const state = stateWithPlotRights();
    const application = expandGrid(state, { type: "expandGrid", width: 100, height: 100 });

    expect(application.changed).toBe(false);
    expect(application.state).toBe(state);
    expect(application.result).toEqual({ ok: false, reason: "invalidGridStep" });
  });

  it("publishes no snapshot and no render event through the store", () => {
    const store = new SimulationStore(createInitialState());
    const listener = vi.fn();
    const eventListener = vi.fn();
    const initialSnapshot = store.getSnapshot();
    store.subscribe(listener);
    store.subscribeEvents(eventListener);

    const result = store.dispatch({
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    });

    expect(result).toEqual({ ok: false, reason: "expansionLocked" });
    expect(listener).not.toHaveBeenCalled();
    expect(eventListener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(initialSnapshot);
  });
});

describe("a valid expansion", () => {
  it("updates the width and the height", () => {
    const application = expandGrid(stateWithPlotRights(), {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    });

    expect(application.result).toEqual({ ok: true });
    expect(application.changed).toBe(true);
    expect(application.state.grid.width).toBe(EXPANDED_WIDTH);
    expect(application.state.grid.height).toBe(EXPANDED_HEIGHT);
  });

  it("preserves every existing entity and its machine runtime", () => {
    const state = stateWithDepot("entity-1", 40, 37);

    const application = expandGrid(state, {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    });

    expect(application.state.grid.entities).toEqual([
      { id: "entity-1", type: "depot", x: 40, y: 37, rotation: 90, level: 3 },
    ]);
    expect(application.state.grid.machines["entity-1"]).toEqual(
      state.grid.machines["entity-1"],
    );
  });

  it("grows only upward and rightward from the current origin", () => {
    const state = stateWithDepot("entity-1", 40, 37);

    const expanded = expandGrid(state, {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    }).state;

    expect(expanded.grid.entities[0]).toMatchObject({ x: 40, y: 37 });
    for (const node of expanded.grid.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThan(EXPANDED_WIDTH);
      expect(node.y).toBeLessThan(EXPANDED_HEIGHT);
    }
  });

  it("leaves the starting plot exactly as it was", () => {
    const state = stateWithPlotRights();
    const before = state.grid.nodes.map((node) => ({ ...node }));

    const after = expandGrid(state, {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    }).state.grid.nodes;

    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("scatters resource nodes across the newly added area", () => {
    const expanded = expandGrid(stateWithPlotRights(), {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    }).state;

    const added = expanded.grid.nodes.filter(
      (node) => node.x >= GRID_WIDTH || node.y >= GRID_HEIGHT,
    );
    const resources = [...new Set(added.map((node) => node.resource))].sort();

    expect(added.length).toBeGreaterThan(0);
    expect(resources).toEqual(["coal", "copperOre", "ironOre", "stone"]);
    for (const node of added) {
      expect(node.x >= GRID_WIDTH || node.y >= GRID_HEIGHT).toBe(true);
      expect(node.x).toBeLessThan(EXPANDED_WIDTH);
      expect(node.y).toBeLessThan(EXPANDED_HEIGHT);
    }
  });

  it("gives every raw type a node in the newly added area", () => {
    const expanded = expandGrid(stateWithPlotRights(), {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    }).state;

    for (const resource of ["copperOre", "ironOre", "coal", "stone"]) {
      const inNewArea = expanded.grid.nodes.filter(
        (node) => node.resource === resource && (node.x >= GRID_WIDTH || node.y >= GRID_HEIGHT),
      );

      expect(inNewArea.length, `${resource} in the expanded area`).toBeGreaterThan(0);
    }
  });

  it("never places two resource nodes on the same cell", () => {
    const expanded = expandGrid(stateWithPlotRights(), {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    }).state;
    const cells = expanded.grid.nodes.map((node) => `${node.x},${node.y}`);
    const ids = expanded.grid.nodes.map((node) => node.id);

    expect(new Set(cells).size).toBe(cells.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("scatters the same new nodes for the same world every time", () => {
    const first = expandGrid(stateWithPlotRights(), {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    }).state;
    const second = expandGrid(stateWithPlotRights(), {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    }).state;

    expect(second.grid.nodes).toEqual(first.grid.nodes);
  });

  it("expands one axis at a time", () => {
    const widened = expandGrid(stateWithPlotRights(), {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: GRID_HEIGHT,
    }).state;

    expect(widened.grid).toMatchObject({ width: EXPANDED_WIDTH, height: GRID_HEIGHT });

    const squared = expandGrid(widened, {
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    }).state;

    expect(squared.grid).toMatchObject({ width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT });
  });

  it("publishes exactly one snapshot and no render event through the store", () => {
    const store = storeWithPlotRights();
    const listener = vi.fn();
    const eventListener = vi.fn();
    store.subscribe(listener);
    store.subscribeEvents(eventListener);

    const result = store.dispatch({
      type: "expandGrid",
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    });

    expect(result).toEqual({ ok: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(eventListener).not.toHaveBeenCalled();
  });
});

describe("the store expansion preflight", () => {
  it("routes expandGrid to the same validator the preflight reads", () => {
    const store = storeWithPlotRights();

    expect(store.canExpandGrid(EXPANDED_WIDTH, EXPANDED_HEIGHT)).toEqual({ ok: true });
    expect(store.dispatch({ type: "expandGrid", width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT })).toEqual(
      { ok: true },
    );
    expect(store.canExpandGrid(EXPANDED_WIDTH, EXPANDED_HEIGHT)).toEqual({
      ok: false,
      reason: "gridAlreadyExpanded",
    });
    expect(store.dispatch({ type: "expandGrid", width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT })).toEqual(
      { ok: false, reason: "gridAlreadyExpanded" },
    );
  });

  it("reports the expanded dimensions to the renderer", () => {
    const store = storeWithPlotRights();

    expect(store.getGridDimensions()).toEqual({ width: GRID_WIDTH, height: GRID_HEIGHT });

    store.dispatch({ type: "expandGrid", width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT });

    expect(store.getGridDimensions()).toEqual({
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    });
  });

  it("hands out a frozen dimensions view", () => {
    const dimensions = storeWithPlotRights().getGridDimensions();

    expect(Object.isFrozen(dimensions)).toBe(true);
  });
});

describe("expansion across a prestige reset", () => {
  function storeWithExpandedPlot(): SimulationStore {
    const store = new SimulationStore({
      ...stateWithPlotRights(),
      lifetimeCurrency: PRESTIGE_THRESHOLD,
    });

    expect(
      store.dispatch({ type: "expandGrid", width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT }),
    ).toEqual({ ok: true });

    return store;
  }

  it("keeps the expanded dimensions through a reset", () => {
    const store = storeWithExpandedPlot();

    expect(store.dispatch({ type: "prestige" })).toEqual({ ok: true });

    expect(store.getGridDimensions()).toEqual({
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    });
  });

  it("keeps a run placeable in the expanded area after a reset", () => {
    const store = storeWithExpandedPlot();
    const before = nodeInNewArea(store.getSaveGame());
    expect(
      store.dispatch({ type: "placeEntity", machine: "extractor", x: before.x, y: before.y, rotation: 0 }),
    ).toEqual({ ok: true });

    expect(store.dispatch({ type: "prestige" })).toEqual({ ok: true });

    expect(store.validatePlacement({ type: "placeEntity", machine: "depot", x: 0, y: 0, rotation: 0 })).toEqual(
      { ok: true },
    );
    const after = nodeInNewArea(store.getSaveGame());
    expect(after.x >= GRID_WIDTH || after.y >= GRID_HEIGHT).toBe(true);
    expect(
      store.dispatch({ type: "placeEntity", machine: "extractor", x: after.x, y: after.y, rotation: 0 }),
    ).toEqual({ ok: true });
  });

  it("scatters the reset world across the whole expanded plot", () => {
    const store = storeWithExpandedPlot();

    store.dispatch({ type: "prestige" });

    const state = store.getSaveGame();
    const resources = [...new Set(state.grid.nodes.map((node) => node.resource))].sort();

    expect(resources).toEqual(["coal", "copperOre", "ironOre", "stone"]);
    expect(state.grid.nodes.length).toBeGreaterThan(createInitialState().grid.nodes.length);
    for (const node of state.grid.nodes) {
      expect(node.x).toBeLessThan(EXPANDED_WIDTH);
      expect(node.y).toBeLessThan(EXPANDED_HEIGHT);
    }
  });

  it("still emits one entityRemoved per removed entity after an expansion", () => {
    const store = storeWithExpandedPlot();
    const node = nodeInNewArea(store.getSaveGame());
    store.dispatch({ type: "placeEntity", machine: "extractor", x: node.x, y: node.y, rotation: 0 });
    const entityIds = store.getEntities().map((entity) => entity.id);
    const removed: string[] = [];
    store.subscribeEvents((event) => {
      if (event.type === "entityRemoved") {
        removed.push(event.entityId);
      }
    });

    expect(store.dispatch({ type: "prestige" })).toEqual({ ok: true });

    expect(removed).toEqual(entityIds);
  });
});

describe("the expanded camera and floor", () => {
  it("scales camera bounds to the expanded plot", () => {
    const config = createCameraConfig(EXPANDED_WIDTH, EXPANDED_HEIGHT);

    expect(config.boundsWidth).toBe(EXPANDED_WIDTH * TILE_SIZE_PX + 256);
    expect(config.boundsHeight).toBe(EXPANDED_HEIGHT * TILE_SIZE_PX + 256);
    expect(config.boundsWidth).toBeGreaterThan(createCameraConfig(GRID_WIDTH, GRID_HEIGHT).boundsWidth);
  });

  it("rebuilds the floor at the expanded dimensions", () => {
    const floor = createFloorTileData(EXPANDED_WIDTH, EXPANDED_HEIGHT);

    expect(floor).toHaveLength(EXPANDED_HEIGHT);
    for (const row of floor) {
      expect(row).toHaveLength(EXPANDED_WIDTH);
      expect([...new Set(row)]).toEqual([1]);
    }
  });

  it("builds the starting floor exactly as before", () => {
    const floor = createFloorTileData(GRID_WIDTH, GRID_HEIGHT);

    expect(floor).toHaveLength(64);
    expect(floor[0]).toHaveLength(64);
    expect(floor[63]?.[63]).toBe(1);
  });
});
