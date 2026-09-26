import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSET_MANIFEST } from "../../src/content/assetManifest";
import { MACHINES } from "../../src/content/machines";
import { RESOURCES } from "../../src/content/resources";
import { createInitialState } from "../../src/sim/initialState";
import { advanceSimulation } from "../../src/sim/tick";
import type {
  BeltItemView,
  BeltItemViewDescriptor,
  BeltItemViewFactory,
} from "../../src/phaser/render/BeltItemRenderer";
import { createBeltItemRenderer, type BeltItemChangedEvent } from "../../src/phaser/render/BeltItemRenderer";
import {
  frameTextureKey,
  parseGlowColor,
  resolveActiveFrameTextureKeys,
  resolveIdleTextureKey,
  resolveResourceTextureKey,
} from "../../src/phaser/render/textureKeys";
import type { Entity, RenderEvent, ResourceId, SimulationState } from "../../src/sim/types";

const CONTENT_OVERRIDES = vi.hoisted((): {
  machines: Record<string, unknown>;
  resources: Record<string, unknown>;
} => ({ machines: {}, resources: {} }));

vi.mock("../../src/content/machines", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/content/machines")>();
  return {
    ...actual,
    getMachine: (type: string) => CONTENT_OVERRIDES.machines[type] ?? actual.getMachine(type),
  };
});

vi.mock("../../src/content/resources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/content/resources")>();
  return {
    ...actual,
    getResource: (id: string) => CONTENT_OVERRIDES.resources[id] ?? actual.getResource(id),
  };
});

beforeEach(() => {
  for (const key of Object.keys(CONTENT_OVERRIDES.machines)) {
    delete CONTENT_OVERRIDES.machines[key];
  }
  for (const key of Object.keys(CONTENT_OVERRIDES.resources)) {
    delete CONTENT_OVERRIDES.resources[key];
  }
});

interface ChainOptions {
  readonly beltCount: number;
  readonly resource: ResourceId;
  readonly startX?: number;
}

function createChainState({ beltCount, resource, startX = 1 }: ChainOptions): SimulationState {
  const state = createInitialState(1337);
  const entities: Entity[] = [
    {
      id: "entity-1",
      type: "extractor",
      x: startX,
      y: 0,
      rotation: 0,
      level: 1,
      resourceNode: resource,
    },
  ];
  for (let index = 0; index < beltCount; index += 1) {
    entities.push({
      id: `belt-${index + 1}`,
      type: "belt",
      x: startX + index + 1,
      y: 0,
      rotation: 0,
      level: 1,
    });
  }
  entities.push({
    id: "depot-1",
    type: "depot",
    x: startX + beltCount + 1,
    y: 0,
    rotation: 0,
    level: 1,
  });

  state.grid.entities = entities;
  state.grid.machines = {
    "entity-1": {
      entityId: "entity-1",
      progressTicks: 0,
      input: {},
      output: {},
      active: false,
      alreadyNotifiedBlocked: false,
    },
    "depot-1": {
      entityId: "depot-1",
      progressTicks: 0,
      input: {},
      output: {},
      active: false,
      alreadyNotifiedBlocked: false,
    },
  };
  state.grid.belts = Object.fromEntries(
    entities
      .filter((entity) => entity.type === "belt")
      .map((entity) => [entity.id, { entityId: entity.id, progress: 0 }]),
  );
  return state;
}

function advanceCollecting(
  state: SimulationState,
  ticks: number,
): { state: SimulationState; events: RenderEvent[] } {
  const events: RenderEvent[] = [];
  const next = advanceSimulation(state, ticks, events);
  return { state: next, events };
}

function beltEvents(events: readonly RenderEvent[]): BeltItemChangedEvent[] {
  return events.filter(
    (event): event is BeltItemChangedEvent => event.type === "beltItemChanged",
  );
}

function runToFirstItem(chain: ChainOptions): {
  state: SimulationState;
  events: RenderEvent[];
  ticks: number;
} {
  let state = createChainState(chain);
  const events: RenderEvent[] = [];
  for (let tick = 1; tick <= 40; tick += 1) {
    const produced = advanceSimulation(state, 1, events);
    state = produced;
    if (events.some((event) => event.type === "beltItemChanged")) {
      return { state, events, ticks: tick };
    }
  }
  throw new Error("No belt item event was emitted");
}

describe("belt item render events", () => {
  it("emits enter, move, and leave events in a deterministic order", () => {
    const first = runToFirstItem({ beltCount: 3, resource: "copperOre" });
    const second = runToFirstItem({ beltCount: 3, resource: "copperOre" });

    expect(first.ticks).toBe(20);
    expect(beltEvents(first.events)).toEqual([
      { type: "beltItemChanged", entityId: "belt-1", item: "copperOre" },
      { type: "beltItemChanged", entityId: "belt-1", item: undefined },
      { type: "beltItemChanged", entityId: "belt-2", item: "copperOre" },
    ]);
    expect(beltEvents(second.events)).toEqual(beltEvents(first.events));
  });

  it("reports the item leaving the belt line when the depot accepts it", () => {
    const first = runToFirstItem({ beltCount: 3, resource: "copperOre" });
    const { events } = advanceCollecting(first.state, 1);

    expect(beltEvents(events)).toEqual([
      { type: "beltItemChanged", entityId: "belt-2", item: undefined },
      { type: "beltItemChanged", entityId: "belt-3", item: "copperOre" },
      { type: "beltItemChanged", entityId: "belt-3", item: undefined },
    ]);
    expect(first.state.currency).toBe(500);
  });

  it("emits a transient enter and leave pair when a single belt carries an item", () => {
    const first = runToFirstItem({ beltCount: 1, resource: "ironOre" });

    expect(beltEvents(first.events)).toEqual([
      { type: "beltItemChanged", entityId: "belt-1", item: "ironOre" },
      { type: "beltItemChanged", entityId: "belt-1", item: undefined },
    ]);
  });

  it("emits no belt item events when the line is idle", () => {
    const { events } = advanceCollecting(createChainState({ beltCount: 2, resource: "copperOre" }), 5);

    expect(beltEvents(events)).toEqual([]);
  });

  it("emits the moved resource for iron without copper leftovers", () => {
    const first = runToFirstItem({ beltCount: 2, resource: "ironOre" });

    expect(beltEvents(first.events).map((event) => event.item)).toEqual([
      "ironOre",
      undefined,
      "ironOre",
      undefined,
    ]);
  });
});

describe("render texture keys", () => {
  it("resolves an idle frame from the machine's own idle art", () => {
    expect(resolveIdleTextureKey("extractor")).toBe(frameTextureKey("machine.extractor.idle", 0));
    expect(resolveIdleTextureKey("belt")).toBe(frameTextureKey("machine.belt.idle", 0));
    expect(resolveIdleTextureKey("depot")).toBe(frameTextureKey("machine.depot.idle", 0));
  });

  it("resolves every active frame for each raw machine", () => {
    expect(resolveActiveFrameTextureKeys("extractor")).toEqual([
      frameTextureKey("machine.extractor.active", 0),
      frameTextureKey("machine.extractor.active", 1),
    ]);
    expect(resolveActiveFrameTextureKeys("belt")).toEqual([
      frameTextureKey("machine.belt.active", 0),
      frameTextureKey("machine.belt.active", 1),
    ]);
    expect(resolveActiveFrameTextureKeys("depot")).toEqual([
      frameTextureKey("machine.depot.active", 0),
      frameTextureKey("machine.depot.active", 1),
    ]);
  });

  it("never substitutes another machine when active art is missing", () => {
    const overriddenMachines = ["smelter", "assembler", "silo"] as const;

    for (const machine of overriddenMachines) {
      expect(resolveIdleTextureKey(machine), `${machine} resolves before the override`).toBe(
        frameTextureKey(MACHINES[machine].spriteKey, 0),
      );
    }

    for (const machine of overriddenMachines) {
      CONTENT_OVERRIDES.machines[machine] = {
        ...MACHINES[machine],
        spriteKey: `machine.${machine}.unregistered`,
        activeSpriteKey: `machine.${machine}.unregistered-active`,
      };
    }

    for (const machine of overriddenMachines) {
      const override = CONTENT_OVERRIDES.machines[machine] as {
        spriteKey: string;
        activeSpriteKey: string;
      };

      expect(override.spriteKey, `${machine} override must still carry a key`).not.toBe("");
      expect(override.spriteKey, `${machine} override must differ from the shipped key`).not.toBe(
        MACHINES[machine].spriteKey,
      );
      expect(
        Object.hasOwn(ASSET_MANIFEST, override.spriteKey),
        `${machine} override key must be absent from the manifest so the guard reads isRegistered, not a missing key`,
      ).toBe(false);

      expect(resolveActiveFrameTextureKeys(machine), `${machine} active art`).toEqual([]);
      expect(resolveIdleTextureKey(machine), `${machine} idle art`).toBeUndefined();
    }

    expect(resolveIdleTextureKey("belt"), "an untouched machine still resolves through the mock").toBe(
      frameTextureKey("machine.belt.idle", 0),
    );
    expect(resolveIdleTextureKey("extractor")).not.toBe(resolveIdleTextureKey("belt"));
    expect(resolveActiveFrameTextureKeys("belt")).not.toEqual(
      resolveActiveFrameTextureKeys("extractor"),
    );
  });

  it("resolves every active frame for each unlockable machine", () => {
    expect(resolveActiveFrameTextureKeys("smelter")).toEqual([
      frameTextureKey("machine.smelter.active", 0),
      frameTextureKey("machine.smelter.active", 1),
    ]);
    expect(resolveActiveFrameTextureKeys("assembler")).toEqual([
      frameTextureKey("machine.assembler.active", 0),
      frameTextureKey("machine.assembler.active", 1),
    ]);
    expect(resolveActiveFrameTextureKeys("silo")).toEqual([
      frameTextureKey("machine.silo.active", 0),
      frameTextureKey("machine.silo.active", 1),
    ]);
  });

  it("resolves no icon frame when a resource names art the manifest does not register", () => {
    CONTENT_OVERRIDES.resources.motor = { ...RESOURCES.motor, iconKey: "resource.unregistered" };

    const override = CONTENT_OVERRIDES.resources.motor as { iconKey: string };
    expect(override.iconKey, "resource override must still carry a key").not.toBe("");
    expect(override.iconKey, "resource override must differ from the shipped key").not.toBe(
      RESOURCES.motor.iconKey,
    );
    expect(Object.hasOwn(ASSET_MANIFEST, override.iconKey)).toBe(false);

    expect(resolveResourceTextureKey("motor")).toBeUndefined();
  });

  it("resolves a registered resource icon frame per resource", () => {
    expect(resolveResourceTextureKey("copperOre")).toBe(frameTextureKey("resource.copperOre", 0));
    expect(resolveResourceTextureKey("ironOre")).toBe(frameTextureKey("resource.ironOre", 0));
    expect(resolveResourceTextureKey("motor")).toBe(frameTextureKey("resource.motor", 0));
  });

  it("parses locked palette colors into tint values", () => {
    expect(parseGlowColor("#c98245")).toBe(0xc98245);
    expect(parseGlowColor("#8fa6b8")).toBe(0x8fa6b8);
    expect(parseGlowColor("not-a-color")).toBeUndefined();
  });
});

interface RecordedView extends BeltItemView {
  destroyed: boolean;
  x: number;
  y: number;
}

function createFakeFactory(): {
  factory: BeltItemViewFactory;
  created: Array<{ descriptor: BeltItemViewDescriptor; x: number; y: number }>;
  views: Map<string, RecordedView>;
} {
  const created: Array<{ descriptor: BeltItemViewDescriptor; x: number; y: number }> = [];
  const views = new Map<string, RecordedView>();

  return {
    created,
    views,
    factory: {
      hasTexture: (textureKey) => textureKey.startsWith("factor-y:resource."),
      createView: (descriptor, worldX, worldY) => {
        created.push({ descriptor, x: worldX, y: worldY });
        const view: RecordedView = {
          destroyed: false,
          x: worldX,
          y: worldY,
          setPosition: (x, y) => {
            view.x = x;
            view.y = y;
          },
          destroy: () => {
            view.destroyed = true;
          },
        };
        views.set(descriptor.entityId, view);
        return view;
      },
    },
  };
}

describe("belt item renderer", () => {
  const positions = new Map<string, { x: number; y: number }>([
    ["belt-1", { x: 160, y: 32 }],
    ["belt-2", { x: 224, y: 32 }],
  ]);

  it("renders the resource icon with a resource colored glow at the belt cell", () => {
    const fake = createFakeFactory();
    const renderer = createBeltItemRenderer({
      factory: fake.factory,
      resolvePosition: (entityId) => positions.get(entityId),
    });

    renderer.apply({ type: "beltItemChanged", entityId: "belt-1", item: "copperOre" });

    expect(renderer.getRendered()).toEqual([
      {
        entityId: "belt-1",
        resource: "copperOre",
        textureKey: frameTextureKey("resource.copperOre", 0),
        glowColor: 0xc98245,
        x: 160,
        y: 32,
      },
    ]);
    expect(fake.created).toHaveLength(1);
  });

  it("moves the rendered item to the new belt cell without recreating the view", () => {
    const fake = createFakeFactory();
    const renderer = createBeltItemRenderer({
      factory: fake.factory,
      resolvePosition: (entityId) => positions.get(entityId),
    });

    renderer.apply({ type: "beltItemChanged", entityId: "belt-1", item: "ironOre" });
    renderer.apply({ type: "beltItemChanged", entityId: "belt-2", item: "ironOre" });
    renderer.apply({ type: "beltItemChanged", entityId: "belt-1", item: undefined });

    expect(renderer.getRendered()).toEqual([
      {
        entityId: "belt-2",
        resource: "ironOre",
        textureKey: frameTextureKey("resource.ironOre", 0),
        glowColor: 0x8fa6b8,
        x: 224,
        y: 32,
      },
    ]);
    expect(fake.created).toHaveLength(2);
    expect(fake.views.get("belt-1")?.destroyed).toBe(true);
  });

  it("removes the rendered item when the belt cell empties", () => {
    const fake = createFakeFactory();
    const renderer = createBeltItemRenderer({
      factory: fake.factory,
      resolvePosition: () => ({ x: 32, y: 32 }),
    });

    renderer.apply({ type: "beltItemChanged", entityId: "belt-1", item: "copperOre" });
    renderer.apply({ type: "beltItemChanged", entityId: "belt-1", item: undefined });
    renderer.apply({ type: "beltItemChanged", entityId: "belt-1", item: undefined });

    expect(renderer.getRendered()).toEqual([]);
    expect(renderer.getChangedEventCount()).toBe(3);
    expect(fake.created).toHaveLength(1);
  });

  it("rebuilds the view when the carried resource changes", () => {
    const fake = createFakeFactory();
    const renderer = createBeltItemRenderer({
      factory: fake.factory,
      resolvePosition: () => ({ x: 32, y: 32 }),
    });

    renderer.apply({ type: "beltItemChanged", entityId: "belt-1", item: "copperOre" });
    renderer.apply({ type: "beltItemChanged", entityId: "belt-1", item: "ironOre" });

    expect(renderer.getRendered().map((item) => item.resource)).toEqual(["ironOre"]);
    expect(fake.created).toHaveLength(2);
  });

  it("skips items with no registered icon, no position, or no texture", () => {
    const fake = createFakeFactory();
    const renderer = createBeltItemRenderer({
      factory: fake.factory,
      resolvePosition: (entityId) => positions.get(entityId),
    });

    CONTENT_OVERRIDES.resources.motor = { ...RESOURCES.motor, iconKey: "resource.unregistered" };
    renderer.apply({ type: "beltItemChanged", entityId: "belt-1", item: "motor" });
    renderer.apply({ type: "beltItemChanged", entityId: "belt-9", item: "copperOre" });

    const withoutTexture = createBeltItemRenderer({
      factory: {
        hasTexture: () => false,
        createView: (descriptor, worldX, worldY) => fake.factory.createView(descriptor, worldX, worldY),
      },
      resolvePosition: (entityId) => positions.get(entityId),
    });
    withoutTexture.apply({ type: "beltItemChanged", entityId: "belt-1", item: "copperOre" });

    expect(renderer.getRendered()).toEqual([]);
    expect(withoutTexture.getRendered()).toEqual([]);
    expect(renderer.getChangedEventCount()).toBe(2);
    expect(withoutTexture.getChangedEventCount()).toBe(1);
  });

  it("syncs carried items from simulation state without mutating it", () => {
    const fake = createFakeFactory();
    const state: Readonly<Record<string, ResourceId>> = Object.freeze({ "belt-2": "ironOre" });
    const renderer = createBeltItemRenderer({
      factory: fake.factory,
      resolvePosition: (entityId) => positions.get(entityId),
    });

    renderer.sync(state);

    expect(renderer.getRendered().map((item) => item.entityId)).toEqual(["belt-2"]);
    expect(state).toEqual({ "belt-2": "ironOre" });

    renderer.remove("belt-2");
    expect(renderer.getRendered()).toEqual([]);

    renderer.sync(state);
    expect(renderer.getRendered().map((item) => item.entityId)).toEqual(["belt-2"]);
  });

  it("destroys every rendered item and never mutates the render event", () => {
    const fake = createFakeFactory();
    const renderer = createBeltItemRenderer({
      factory: fake.factory,
      resolvePosition: () => ({ x: 32, y: 32 }),
    });
    const event: BeltItemChangedEvent = Object.freeze({
      type: "beltItemChanged",
      entityId: "belt-1",
      item: "copperOre",
    });

    renderer.apply(event);

    expect(Object.isFrozen(event)).toBe(true);
    expect(event).toEqual({
      type: "beltItemChanged",
      entityId: "belt-1",
      item: "copperOre",
    });

    renderer.destroy();

    expect(renderer.getRendered()).toEqual([]);
    expect(fake.views.get("belt-1")?.destroyed).toBe(true);
  });
});
