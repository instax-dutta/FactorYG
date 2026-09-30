import { describe, expect, it } from "vitest";
import {
  createNodeRenderer,
  type NodeSprite,
  type NodeViewFactory,
} from "../../src/phaser/render/NodeRenderer";
import { TILE_SIZE_PX } from "../../src/sim/constants";
import { RECIPES } from "../../src/content/recipes";
import { NEW_GAME_SEED, createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";

interface FakeFactory extends NodeViewFactory {
  readonly created: { worldX: number; worldY: number; textureKey: string }[];
  readonly destroyed: number;
  readonly loadable: Set<string>;
}

function fakeFactory(loadable?: readonly string[]): FakeFactory {
  const created: { worldX: number; worldY: number; textureKey: string }[] = [];
  let destroyed = 0;
  const loadableSet = new Set<string>(loadable ?? []);

  return {
    created,
    get destroyed() {
      return destroyed;
    },
    loadable: loadableSet,
    hasTexture: (textureKey) => loadableSet.size === 0 || loadableSet.has(textureKey),
    createView: (worldX, worldY, textureKey): NodeSprite => {
      created.push({ worldX, worldY, textureKey });
      return {
        destroy: () => {
          destroyed += 1;
        },
      };
    },
  };
}

function everyLoadableFactory(): FakeFactory {
  const created: { worldX: number; worldY: number; textureKey: string }[] = [];
  let destroyed = 0;
  return {
    created,
    get destroyed() {
      return destroyed;
    },
    loadable: new Set<string>(),
    hasTexture: () => true,
    createView: (worldX, worldY, textureKey): NodeSprite => {
      created.push({ worldX, worldY, textureKey });
      return { destroy: () => { destroyed += 1; } };
    },
  };
}

describe("the resource node renderer", () => {
  it("draws one sprite per node in the world, which is what makes a node findable", () => {
    const state = createInitialState(NEW_GAME_SEED);
    const factory = everyLoadableFactory();
    const renderer = createNodeRenderer({ factory });

    renderer.sync(state.grid.nodes);

    expect(state.grid.nodes.length).toBeGreaterThan(0);
    expect(renderer.getSpriteCount()).toBe(state.grid.nodes.length);
    expect(factory.created).toHaveLength(state.grid.nodes.length);
  });

  it("centres each node sprite on its own cell", () => {
    const state = createInitialState(NEW_GAME_SEED);
    const factory = everyLoadableFactory();
    const renderer = createNodeRenderer({ factory });

    renderer.sync(state.grid.nodes);

    const node = state.grid.nodes[0];
    const sprite = factory.created.find(
      (view) => view.worldX === node.x * TILE_SIZE_PX + TILE_SIZE_PX / 2,
    );
    expect(sprite).toBeDefined();
    expect(sprite?.worldY).toBe(node.y * TILE_SIZE_PX + TILE_SIZE_PX / 2);
  });

  it("resolves each node to its own resource's art rather than a shared placeholder", () => {
    const state = createInitialState(NEW_GAME_SEED);
    const factory = everyLoadableFactory();
    const renderer = createNodeRenderer({ factory });

    renderer.sync(state.grid.nodes);

    const keys = new Set(factory.created.map((view) => view.textureKey));
    expect(keys.size).toBeGreaterThan(1);
  });

  it("is idempotent, because the scene syncs on boot and a repeat must not stack sprites", () => {
    const state = createInitialState(NEW_GAME_SEED);
    const factory = everyLoadableFactory();
    const renderer = createNodeRenderer({ factory });

    renderer.sync(state.grid.nodes);
    renderer.sync(state.grid.nodes);

    expect(renderer.getSpriteCount()).toBe(state.grid.nodes.length);
  });

  it("destroys a sprite for a node that is no longer in the world", () => {
    const state = createInitialState(NEW_GAME_SEED);
    const factory = everyLoadableFactory();
    const renderer = createNodeRenderer({ factory });

    renderer.sync(state.grid.nodes);
    const dropped = state.grid.nodes[0];
    renderer.sync(state.grid.nodes.slice(1));

    expect(renderer.getSpriteCount()).toBe(state.grid.nodes.length - 1);
    expect(factory.destroyed).toBe(1);
    expect(renderer.getSpriteCells()).not.toContain(`${dropped.x},${dropped.y}`);
  });

  it("reports the store's own nodes, so the scene cannot draw a second world", () => {
    const store = new SimulationStore(createInitialState(NEW_GAME_SEED));

    const nodes = store.getNodes();

    expect(nodes).toHaveLength(createInitialState(NEW_GAME_SEED).grid.nodes.length);
    for (const node of nodes) {
      expect(typeof node.x).toBe("number");
      expect(typeof node.y).toBe("number");
      expect(node.resource).toBeTruthy();
    }
  });

  it("degrades to no sprite rather than throwing when a node's art is missing", () => {
    const factory = fakeFactory(["factor-y:resource.copperOre:0"]);
    const renderer = createNodeRenderer({ factory });

    const placed = renderer.add({ x: 1, y: 1, resource: "copperOre" });
    const missing = renderer.add({ x: 2, y: 2, resource: "coal" });

    expect(placed).toBe(true);
    expect(missing).toBe(false);
    expect(renderer.getSpriteCount()).toBe(1);
  });

  it("knows which raw resources it can actually draw", () => {
    const renderer = createNodeRenderer({ factory: fakeFactory(["factor-y:resource.copperOre:0"]) });

    expect(renderer.hasTextureFor("copperOre")).toBe(true);
    expect(renderer.hasTextureFor("coal")).toBe(false);
  });

  it("destroys every sprite on teardown so a scene restart cannot leak nodes", () => {
    const state = createInitialState(NEW_GAME_SEED);
    const factory = everyLoadableFactory();
    const renderer = createNodeRenderer({ factory });

    renderer.sync(state.grid.nodes);
    renderer.destroy();

    expect(renderer.getSpriteCount()).toBe(0);
    expect(factory.destroyed).toBe(state.grid.nodes.length);
  });

  it("keeps node art and machine art distinct, so a node can never borrow a machine sprite", () => {
    const state = createInitialState(NEW_GAME_SEED);
    const factory = everyLoadableFactory();
    const renderer = createNodeRenderer({ factory });

    renderer.sync(state.grid.nodes);

    for (const node of state.grid.nodes) {
      const key = factory.created.find(
        (view) =>
          view.worldX === node.x * TILE_SIZE_PX + TILE_SIZE_PX / 2 &&
          view.worldY === node.y * TILE_SIZE_PX + TILE_SIZE_PX / 2,
      )?.textureKey;
      expect(key).toContain("resource.");
    }
    expect(RECIPES.motor.output.resource).toBe("motor");
  });
});
