import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { ASSET_MANIFEST } from "../../src/content/assetManifest";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import { TILE_SIZE_PX } from "../../src/sim/constants";
import { cellToWorld } from "../../src/sim/grid";
import type { Entity, RenderEvent, ResourceId, SimulationState } from "../../src/sim/types";
import {
  createBeltItemRenderer,
  type BeltItemView,
  type BeltItemViewDescriptor,
  type BeltItemViewFactory,
} from "../../src/phaser/render/BeltItemRenderer";
import {
  ACTIVE_FRAME_INTERVAL_MS,
  createEntityRenderer,
  type EntityView,
  type EntityViewDescriptor,
  type EntityViewFactory,
} from "../../src/phaser/render/EntityRenderer";
import { frameTextureKey } from "../../src/phaser/render/textureKeys";

const IDLE_EXTRACTOR_FRAME = frameTextureKey("machine.extractor.idle", 0);
const EXTRACTOR_ACTIVE_FRAMES = [
  frameTextureKey("machine.extractor.active", 0),
  frameTextureKey("machine.extractor.active", 1),
] as const;

interface RecordedView extends EntityView {
  textureKey: string | undefined;
  readonly textureWrites: string[];
  readonly angleWrites: number[];
  destroyed: boolean;
}

interface FakeFactory {
  readonly factory: EntityViewFactory;
  readonly views: Map<string, RecordedView>;
  readonly created: Array<EntityViewDescriptor>;
}

function createFakeFactory(overrides: Partial<EntityViewFactory> = {}): FakeFactory {
  const views = new Map<string, RecordedView>();
  const created: Array<EntityViewDescriptor> = [];

  return {
    views,
    created,
    factory: {
      hasTexture: (textureKey) =>
        textureKey.startsWith("factor-y:machine.") ||
        textureKey.startsWith("factor-y:resource."),
      createView: (descriptor) => {
        created.push(descriptor);
        const view: RecordedView = {
          entityId: descriptor.entityId,
          textureKey: descriptor.textureKey,
          baseTint: 0xffffff,
          alpha: 1,
          destroyed: false,
          textureWrites: [],
          angleWrites: [],
          setTexture: (textureKey) => {
            view.textureKey = textureKey;
            view.textureWrites.push(textureKey);
          },
          setAngle: (degrees) => {
            view.angleWrites.push(degrees);
          },
          setTint: () => undefined,
          destroy: () => {
            view.destroyed = true;
          },
        };
        views.set(descriptor.entityId, view);
        return view;
      },
      ...overrides,
    },
  };
}

function createEntity(overrides: Partial<Entity> & Pick<Entity, "id" | "type">): Entity {
  return Object.freeze({
    x: 0,
    y: 0,
    rotation: 0 as const,
    level: 1,
    ...overrides,
  });
}

interface World {
  readonly store: SimulationStore;
  readonly node: { x: number; y: number };
}

function createWorld(): World {
  const state: SimulationState = createInitialState(1337);
  const node = state.grid.nodes.find((candidate) => candidate.resource === ("copperOre" satisfies ResourceId));
  if (node === undefined) {
    throw new Error("No copperOre node in the initial world");
  }
  return {
    store: new SimulationStore(state),
    node: { x: node.x, y: node.y },
  };
}

function placeRawLine(
  store: SimulationStore,
  node: { x: number; y: number },
  beltCount: number,
): readonly string[] {
  const placed: string[] = [];
  for (const result of [
    store.dispatch({
      type: "placeEntity",
      machine: "extractor",
      x: node.x,
      y: node.y,
      rotation: 0,
      resourceNode: "copperOre",
    }),
    ...Array.from({ length: beltCount }, (_unused, index) =>
      store.dispatch({
        type: "placeEntity",
        machine: "belt",
        x: node.x + index + 1,
        y: node.y,
        rotation: 0,
      }),
    ),
    store.dispatch({
      type: "placeEntity",
      machine: "depot",
      x: node.x + beltCount + 1,
      y: node.y,
      rotation: 0,
    }),
  ]) {
    if (!result.ok) {
      throw new Error(`Expected the raw line to place: ${result.reason ?? "unknown"}`);
    }
    placed.push(result.ok ? "ok" : "refused");
  }
  return placed;
}

describe("entity renderer placement and removal", () => {
  it("gives every placed machine its own idle frame from its own machine art", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });

    expect(renderer.place(createEntity({ id: "e1", type: "extractor" }))).toBe(true);
    expect(renderer.place(createEntity({ id: "e2", type: "belt" }))).toBe(true);
    expect(renderer.place(createEntity({ id: "e3", type: "smelter" }))).toBe(true);

    expect(fake.views.get("e1")?.textureKey).toBe(frameTextureKey("machine.extractor.idle", 0));
    expect(fake.views.get("e2")?.textureKey).toBe(frameTextureKey("machine.belt.idle", 0));
    expect(fake.views.get("e3")?.textureKey).toBe(frameTextureKey("machine.smelter.idle", 0));
    expect(renderer.getEntityIds()).toEqual(["e1", "e2", "e3"]);
  });

  it("puts a belt on the belt layer and every other machine on the machine layer", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });

    renderer.place(createEntity({ id: "e1", type: "belt" }));
    renderer.place(createEntity({ id: "e2", type: "depot" }));

    expect(fake.created.map((descriptor) => descriptor.layer)).toEqual(["belt", "machine"]);
  });

  it("turns a placed machine to its placed rotation", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });

    renderer.place(createEntity({ id: "e1", type: "belt", rotation: 270 }));

    expect(fake.views.get("e1")?.angleWrites).toEqual([270]);
  });

  it("centres a placed machine on the centre of its cell", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });

    renderer.place(createEntity({ id: "e1", type: "extractor", x: 3, y: 5 }));

    const world = cellToWorld({ x: 3, y: 5 }, TILE_SIZE_PX);
    expect(fake.created[0]?.worldX).toBe(world.x + TILE_SIZE_PX / 2);
    expect(fake.created[0]?.worldY).toBe(world.y + TILE_SIZE_PX / 2);
  });

  it("places no view at all for art the manifest does not register rather than substituting another machine's art", () => {
    const unregistered = "machine.extractor.unregistered";
    expect(Object.hasOwn(ASSET_MANIFEST, unregistered)).toBe(false);

    const fake = createFakeFactory();
    const renderer = createEntityRenderer({
      factory: {
        ...fake.factory,
        hasTexture: (textureKey) => textureKey === frameTextureKey(unregistered, 0),
      },
    });

    expect(renderer.place(createEntity({ id: "e1", type: "extractor" }))).toBe(false);
    expect(fake.views.size).toBe(0);
    expect(renderer.getEntityIds()).toEqual([]);
  });

  it("disposes one removed entity's view and leaves its neighbours drawn", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    renderer.place(createEntity({ id: "e1", type: "extractor", x: 0 }));
    renderer.place(createEntity({ id: "e2", type: "belt", x: 1 }));
    renderer.place(createEntity({ id: "e3", type: "depot", x: 2 }));
    renderer.setActive("e1");
    renderer.setActive("e2");

    renderer.remove("e2");

    expect(fake.views.get("e2")?.destroyed).toBe(true);
    expect(fake.views.get("e1")?.destroyed).toBe(false);
    expect(fake.views.get("e3")?.destroyed).toBe(false);
    expect(renderer.getEntityIds()).toEqual(["e1", "e3"]);
    expect(renderer.getActiveEntityIds()).toEqual(["e1"]);
    expect(renderer.getEntity("e2")).toBeUndefined();
  });

  it("reports no removal for an entity the renderer never placed", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });

    expect(renderer.remove("never-placed")).toBeUndefined();
    expect(renderer.getEntityIds()).toEqual([]);
  });

  it("disposes the previous view rather than leaking one when the same entity id is placed twice", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });

    renderer.place(createEntity({ id: "e1", type: "extractor", x: 0 }));
    renderer.place(createEntity({ id: "e1", type: "extractor", x: 0 }));

    expect(fake.created).toHaveLength(2);
    expect(fake.views.get("e1")?.destroyed).toBe(false);
    expect(renderer.getEntityIds()).toEqual(["e1"]);
  });
});

describe("entity renderer animation frames", () => {
  it("switches an extractor to active frames only while it is producing", () => {
    const { store, node } = createWorld();
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    store.subscribeEvents((event) => renderer.apply(event));

    expect(
      store.dispatch({
        type: "placeEntity",
        machine: "extractor",
        x: node.x,
        y: node.y,
        rotation: 0,
        resourceNode: "copperOre",
      }).ok,
    ).toBe(true);
    expect(fake.views.get("entity-1")?.textureKey).toBe(IDLE_EXTRACTOR_FRAME);

    store.advanceTicks(1);
    renderer.advanceFrames(ACTIVE_FRAME_INTERVAL_MS);
    expect(renderer.isActive("entity-1")).toBe(true);
    expect(fake.views.get("entity-1")?.textureKey).toBe(EXTRACTOR_ACTIVE_FRAMES[1]);

    store.advanceTicks(40);
    renderer.advanceFrames(ACTIVE_FRAME_INTERVAL_MS * 41);
    expect(renderer.isActive("entity-1")).toBe(false);
    expect(fake.views.get("entity-1")?.textureKey).toBe(IDLE_EXTRACTOR_FRAME);
  });

  it("cycles an active machine through its own active frames as the bucket advances", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    renderer.place(createEntity({ id: "e1", type: "extractor" }));
    renderer.setActive("e1");

    const written: Array<string | undefined> = [];
    for (let bucket = 1; bucket <= 4; bucket += 1) {
      renderer.advanceFrames(bucket * ACTIVE_FRAME_INTERVAL_MS);
      written.push(fake.views.get("e1")?.textureKey);
    }

    expect(written).toEqual([
      EXTRACTOR_ACTIVE_FRAMES[1],
      EXTRACTOR_ACTIVE_FRAMES[0],
      EXTRACTOR_ACTIVE_FRAMES[1],
      EXTRACTOR_ACTIVE_FRAMES[0],
    ]);
  });

  it("writes no frame texture while the animation bucket has not advanced", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    renderer.place(createEntity({ id: "e1", type: "extractor" }));
    renderer.setActive("e1");
    renderer.advanceFrames(ACTIVE_FRAME_INTERVAL_MS);

    const before = renderer.getWork().frameWrites;
    for (let frame = 1; frame <= 60; frame += 1) {
      renderer.advanceFrames(ACTIVE_FRAME_INTERVAL_MS + frame);
    }

    expect(renderer.getWork().frameWrites).toBe(before);
  });

  it("resolves each machine's active frames once rather than once per frame", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    renderer.place(createEntity({ id: "e1", type: "extractor" }));
    renderer.place(createEntity({ id: "e2", type: "extractor" }));
    renderer.place(createEntity({ id: "e3", type: "depot" }));
    renderer.setActive("e1");
    renderer.setActive("e2");
    renderer.setActive("e3");

    for (let bucket = 1; bucket <= 200; bucket += 1) {
      renderer.advanceFrames(bucket * ACTIVE_FRAME_INTERVAL_MS);
    }

    expect(renderer.getWork().frameKeyResolutions).toBe(
      new Set([MACHINES.extractor.type, MACHINES.depot.type]).size,
    );
    expect(renderer.getWork().frameWrites).toBe(200 * 3);
  });

  it("never animates a machine whose active art the renderer cannot load", () => {
    const fake = createFakeFactory({
      hasTexture: (textureKey) =>
        textureKey === frameTextureKey("machine.smelter.idle", 0) ||
        textureKey.startsWith("factor-y:machine.extractor."),
    });
    const renderer = createEntityRenderer({ factory: fake.factory });
    renderer.place(createEntity({ id: "e1", type: "smelter" }));
    renderer.setActive("e1");

    renderer.advanceFrames(ACTIVE_FRAME_INTERVAL_MS);

    expect(renderer.isActive("e1")).toBe(false);
    expect(renderer.setActive("e1")).toBe(false);
    expect(fake.views.get("e1")?.textureKey).toBe(frameTextureKey("machine.smelter.idle", 0));
    expect(fake.views.get("e1")?.textureWrites).toEqual([]);
  });

  it("reports whether an animation bucket advanced so a caller can decide to republish", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    renderer.place(createEntity({ id: "e1", type: "extractor" }));
    renderer.setActive("e1");

    expect(renderer.advanceFrames(ACTIVE_FRAME_INTERVAL_MS)).toBe(true);
    expect(renderer.advanceFrames(ACTIVE_FRAME_INTERVAL_MS + 1)).toBe(false);
    expect(renderer.advanceFrames(ACTIVE_FRAME_INTERVAL_MS * 2)).toBe(true);
  });

  it("writes the first active frame of a machine that becomes active between buckets", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    renderer.place(createEntity({ id: "e1", type: "extractor" }));
    renderer.advanceFrames(ACTIVE_FRAME_INTERVAL_MS);
    expect(fake.views.get("e1")?.textureWrites).toEqual([]);

    renderer.setActive("e1");
    renderer.advanceFrames(ACTIVE_FRAME_INTERVAL_MS + 1);

    expect(fake.views.get("e1")?.textureKey).toBe(EXTRACTOR_ACTIVE_FRAMES[1]);
  });
});

describe("entity renderer belt item positions", () => {
  it("resolves the world centre of the cell a belt item occupies", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    renderer.place(createEntity({ id: "belt-1", type: "belt", x: 4, y: 7 }));

    const world = cellToWorld({ x: 4, y: 7 }, TILE_SIZE_PX);
    expect(renderer.resolveWorldPosition("belt-1")).toEqual({
      x: world.x + TILE_SIZE_PX / 2,
      y: world.y + TILE_SIZE_PX / 2,
    });
  });

  it("resolves no position for an entity that was removed", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    renderer.place(createEntity({ id: "belt-1", type: "belt" }));
    renderer.remove("belt-1");

    expect(renderer.resolveWorldPosition("belt-1")).toBeUndefined();
  });

  it("rebuilds a carried icon at the carrying belt's own cell when the carried resource changes", () => {
    const entityFake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: entityFake.factory });
    renderer.place(createEntity({ id: "belt-1", type: "belt", x: 2, y: 3 }));

    const icons: Array<{ descriptor: BeltItemViewDescriptor; x: number; y: number }> = [];
    const beltItems: BeltItemView[] = [];
    const iconFactory: BeltItemViewFactory = {
      hasTexture: (textureKey) => textureKey.startsWith("factor-y:resource."),
      createView: (descriptor, worldX, worldY) => {
        icons.push({ descriptor, x: worldX, y: worldY });
        const view: BeltItemView = {
          setPosition: () => undefined,
          destroy: () => undefined,
        };
        beltItems.push(view);
        return view;
      },
    };
    const items = createBeltItemRenderer({
      factory: iconFactory,
      resolvePosition: (entityId) => renderer.resolveWorldPosition(entityId),
    });

    const world = cellToWorld({ x: 2, y: 3 }, TILE_SIZE_PX);
    items.apply({ type: "beltItemChanged", entityId: "belt-1", item: "copperOre" });
    items.apply({ type: "beltItemChanged", entityId: "belt-1", item: "ironOre" });

    expect(icons).toHaveLength(2);
    expect(icons[0]?.descriptor.textureKey).toBe(frameTextureKey("resource.copperOre", 0));
    expect(icons[0]?.descriptor.glowColor).toBe(0xc98245);
    expect(icons[1]?.descriptor.textureKey).toBe(frameTextureKey("resource.ironOre", 0));
    expect(icons[1]?.descriptor.glowColor).toBe(0x8fa6b8);
    for (const icon of icons) {
      expect(icon.x).toBe(world.x + TILE_SIZE_PX / 2);
      expect(icon.y).toBe(world.y + TILE_SIZE_PX / 2);
    }
    expect(beltItems).toHaveLength(2);
  });
});

describe("entity renderer render event consumption", () => {
  it("drives a whole world from a real store's event stream with no snapshot reconcile", () => {
    const { store, node } = createWorld();
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    store.subscribeEvents((event) => renderer.apply(event));

    placeRawLine(store, node, 3);
    store.advanceTicks(40);

    expect(renderer.getEntityIds()).toEqual([
      "entity-1",
      "entity-2",
      "entity-3",
      "entity-4",
      "entity-5",
    ]);

    const removed = store.getEntities().find((entity) => entity.type === "belt");
    expect(removed).toBeDefined();
    store.dispatch({ type: "demolishEntity", entityId: removed!.id });

    expect(renderer.getEntityIds()).toEqual(["entity-1", "entity-3", "entity-4", "entity-5"]);
    expect(fake.views.get(removed!.id)?.destroyed).toBe(true);
    expect(fake.views.get("entity-1")?.destroyed).toBe(false);
  });

  it("reaches the store's own active set after every tick of a real run, so no machine state event is dropped", () => {
    const { store, node } = createWorld();
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    store.subscribeEvents((event) => renderer.apply(event));

    placeRawLine(store, node, 4);

    for (let tick = 1; tick <= 60; tick += 1) {
      store.advanceTicks(1);
      renderer.advanceFrames(tick * ACTIVE_FRAME_INTERVAL_MS);

      const expected = [
        ...new Set([...store.getActiveMachineIds(), ...Object.keys(store.getBeltItems())]),
      ].sort();
      expect([...renderer.getActiveEntityIds()].sort(), `tick ${tick}`).toEqual(expected);
    }
  });

  it("leaves the active set empty once every entity of a line is removed", () => {
    const { store, node } = createWorld();
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    store.subscribeEvents((event) => renderer.apply(event));

    placeRawLine(store, node, 2);
    store.advanceTicks(30);
    expect(renderer.getActiveEntityIds().length).toBeGreaterThan(0);

    for (const entity of [...store.getEntities()]) {
      store.dispatch({ type: "demolishEntity", entityId: entity.id });
    }

    expect(renderer.getEntityIds()).toEqual([]);
    expect(renderer.getActiveEntityIds()).toEqual([]);
    expect(renderer.getActiveFrameKeys()).toEqual([]);
    expect([...fake.views.values()].every((view) => view.destroyed)).toBe(true);
  });

  it("ignores render events that are not about an entity sprite", () => {
    const fake = createFakeFactory();
    const renderer = createEntityRenderer({ factory: fake.factory });
    renderer.place(createEntity({ id: "e1", type: "depot" }));

    const events: RenderEvent[] = [
      { type: "saleCompleted", entityId: "e1", resource: "copperOre", currency: 1, worldX: 0, worldY: 0 },
      { type: "blockedFull", entityId: "e1" },
      { type: "storageFull", entityId: "e1", resource: "copperOre", worldX: 0, worldY: 0 },
    ];

    for (const event of events) {
      expect(renderer.apply(event)).toBe(false);
    }
    expect(renderer.getEntityIds()).toEqual(["e1"]);
    expect(fake.views.get("e1")?.destroyed).toBe(false);
  });
});