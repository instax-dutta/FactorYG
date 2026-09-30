import { describe, expect, it } from "vitest";
import { RESOURCES } from "../../src/content/resources";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import type { Entity, RenderEvent, ResourceId, SimulationState } from "../../src/sim/types";
import { parseGlowColor } from "../../src/phaser/render/textureKeys";
import {
  createVfxRenderer,
  MAX_LIVE_SALE_BURSTS,
  SALE_BURST_LIFETIME_MS,
  SALE_BURST_RISE_PX,
  SMELTER_HEAT_ALPHA_HOLD,
  SMELTER_HEAT_TINT,
  SMELTER_HEAT_TWEEN_DURATION_MS,
  createSaleBurstSpec,
  createSmelterHeatPulseSpec,
  type VfxOneShotSpec,
  type VfxPulseSpec,
  type VfxView,
  type VfxViewDescriptor,
  type VfxViewFactory,
} from "../../src/phaser/render/VfxRenderer";

interface RecordedView extends VfxView {
  readonly descriptor: VfxViewDescriptor;
  readonly tweens: VfxPulseSpec[];
  readonly tints: number[];
  readonly visibility: boolean[];
  destroyed: boolean;
}

interface FakeHost {
  readonly views: VfxViewFactory;
  readonly created: RecordedView[];
  readonly tweens: Array<{ spec: VfxPulseSpec; stops: number }>;
  readonly oneShots: Array<{ spec: VfxOneShotSpec; view: RecordedView }>;
}

function createFakeHost(overrides: Partial<VfxViewFactory> = {}): FakeHost {
  const created: RecordedView[] = [];
  const tweens: Array<{ spec: VfxPulseSpec; stops: number }> = [];
  const oneShots: FakeHost["oneShots"] = [];

  return {
    created,
    tweens,
    oneShots,
    views: {
      hasTexture: (textureKey) => textureKey.startsWith("factor-y:vfx."),
      createView: (descriptor) => {
        const view: RecordedView = {
          descriptor,
          tweens: [],
          tints: [],
          visibility: [],
          destroyed: false,
          x: descriptor.worldX,
          y: descriptor.worldY,
          scale: descriptor.scale,
          alpha: descriptor.alpha,
          setTint: (color) => {
            view.tints.push(color);
          },
          setVisible: (visible) => {
            view.visibility.push(visible);
          },
          destroy: () => {
            view.destroyed = true;
          },
        };
        view.setTint(descriptor.tint);
        created.push(view);
        return view;
      },
      ...overrides,
    },
  };
}

function createEntity(overrides: Partial<Entity> & Pick<Entity, "id" | "type">): Entity {
  return Object.freeze({ x: 0, y: 0, rotation: 0 as const, level: 1, ...overrides });
}

function saleEvent(entityId: string, resource: ResourceId): RenderEvent {
  return {
    type: "saleCompleted",
    entityId,
    resource,
    currency: 1,
    worldX: 32,
    worldY: 64,
  };
}

function machineStateEvent(entityId: string, active: boolean): RenderEvent {
  return { type: "machineStateChanged", entityId, active };
}

function createRenderer(
  entities: readonly Entity[],
  host: FakeHost = createFakeHost(),
): { renderer: ReturnType<typeof createVfxRenderer>; host: FakeHost } {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  return {
    host,
    renderer: createVfxRenderer({
      factory: host.views,
      tweens: {
        createPulseTween: (spec) => {
          const entry = { spec, stops: 0 };
          host.tweens.push(entry);
          (spec.targets as RecordedView).tweens.push(spec);
          return {
            stop: (): void => {
              entry.stops += 1;
            },
          };
        },
        createOneShotTween: (spec) => {
          host.oneShots.push({ spec, view: spec.targets as RecordedView });
          return { stop: (): void => undefined };
        },
      },
      resolveEntity: (entityId) => byId.get(entityId),
    }),
  };
}

describe("smelter heat", () => {
  it("schedules one heat effect when a smelter becomes active and never a second for the same heat", () => {
    const smelter = createEntity({ id: "s1", type: "smelter", x: 4, y: 5 });
    const { renderer, host } = createRenderer([smelter]);

    expect(renderer.apply(machineStateEvent("s1", true))).toBe(true);
    expect(renderer.apply(machineStateEvent("s1", true))).toBe(false);

    expect(renderer.getHeatEntityIds()).toEqual(["s1"]);
    expect(host.tweens).toHaveLength(1);
    expect(host.created).toHaveLength(1);
    expect(host.created[0]?.descriptor.assetKey).toBe("vfx.heat");
    expect(host.created[0]?.tints).toEqual([SMELTER_HEAT_TINT]);
  });

  it("positions the heat on the smelter's own cell", () => {
    const smelter = createEntity({ id: "s1", type: "smelter", x: 4, y: 5 });
    const { renderer, host } = createRenderer([smelter]);

    renderer.apply(machineStateEvent("s1", true));

    expect(host.created[0]?.x).toBe(4 * 64 + 32);
    expect(host.created[0]?.y).toBe(5 * 64 + 32);
  });

  it("stops the heat when the smelter goes idle", () => {
    const smelter = createEntity({ id: "s1", type: "smelter" });
    const { renderer, host } = createRenderer([smelter]);
    renderer.apply(machineStateEvent("s1", true));

    expect(renderer.apply(machineStateEvent("s1", false))).toBe(true);

    expect(renderer.getHeatEntityIds()).toEqual([]);
    expect(host.tweens[0]?.stops).toBe(1);
    expect(host.created[0]?.visibility).toEqual([false]);
    expect(host.created[0]?.destroyed).toBe(false);
  });

  it("reports no stop for a smelter that was never hot", () => {
    const smelter = createEntity({ id: "s1", type: "smelter" });
    const { renderer, host } = createRenderer([smelter]);

    expect(renderer.apply(machineStateEvent("s1", false))).toBe(false);
    expect(host.created).toHaveLength(0);
  });

  it("schedules heat for a smelter and nothing at all for any other machine", () => {
    const others = ["extractor", "belt", "depot", "assembler", "silo"] as const;
    const entities = others.map((type, index) =>
      createEntity({ id: `m${index}`, type, x: index }),
    );
    const { renderer, host } = createRenderer(entities);

    for (const entity of entities) {
      expect(renderer.apply(machineStateEvent(entity.id, true)), entity.type).toBe(false);
    }

    expect(renderer.getHeatEntityIds()).toEqual([]);
    expect(host.created).toHaveLength(0);
  });

  it("never heats a blocked producer, because a blocked producer is idle", () => {
    const smelter = createEntity({ id: "s1", type: "smelter" });
    const { renderer, host } = createRenderer([smelter]);

    renderer.apply(machineStateEvent("s1", true));
    const onBlock = renderer.apply({ type: "blockedFull", entityId: "s1" });
    const onIdle = renderer.apply(machineStateEvent("s1", false));

    expect(onBlock).toBe(false);
    expect(onIdle).toBe(true);
    expect(renderer.getHeatEntityIds()).toEqual([]);
    expect(host.created).toHaveLength(1);
  });

  it("schedules no heat for an entity it cannot resolve", () => {
    const { renderer, host } = createRenderer([]);

    expect(renderer.apply(machineStateEvent("missing", true))).toBe(false);
    expect(host.created).toHaveLength(0);
  });

  it("schedules no heat when the heat art is not loadable", () => {
    const smelter = createEntity({ id: "s1", type: "smelter" });
    const host = createFakeHost({ hasTexture: () => false });
    const { renderer } = createRenderer([smelter], host);

    expect(renderer.apply(machineStateEvent("s1", true))).toBe(false);
    expect(renderer.getHeatEntityIds()).toEqual([]);
  });

  it("pulses the heat at a rate a player can read and a hold that never hides the machine", () => {
    const view = { alpha: 1 } as VfxView;
    const spec = createSmelterHeatPulseSpec(view);

    expect(spec).toEqual({
      targets: view,
      alpha: SMELTER_HEAT_ALPHA_HOLD,
      duration: SMELTER_HEAT_TWEEN_DURATION_MS,
      yoyo: true,
      repeat: -1,
    });
    expect(SMELTER_HEAT_TWEEN_DURATION_MS).toBeGreaterThanOrEqual(300);
    expect(SMELTER_HEAT_TWEEN_DURATION_MS).toBeLessThanOrEqual(600);
    expect(SMELTER_HEAT_ALPHA_HOLD).toBeGreaterThan(0.2);
    expect(SMELTER_HEAT_ALPHA_HOLD).toBeLessThan(0.8);
  });

  it("uses an amber heat the locked palette already teaches the player", () => {
    expect(SMELTER_HEAT_TINT).toBe(parseGlowColor("#e0a458"));
  });
});

describe("depot sale bursts", () => {
  it("emits exactly one burst per completed sale", () => {
    const depot = createEntity({ id: "d1", type: "depot" });
    const { renderer, host } = createRenderer([depot]);

    expect(renderer.apply(saleEvent("d1", "copperOre"))).toBe(true);

    expect(renderer.getSaleBurstCount()).toBe(1);
    expect(renderer.getLiveBurstCount()).toBe(1);
    expect(host.created).toHaveLength(1);
    expect(host.created[0]?.descriptor.assetKey).toBe("vfx.coin");
  });

  it("emits one burst for each of several sales rather than folding them together", () => {
    const depot = createEntity({ id: "d1", type: "depot" });
    const { renderer, host } = createRenderer([depot]);

    for (let sale = 0; sale < 5; sale += 1) {
      renderer.apply(saleEvent("d1", "copperOre"));
    }

    expect(renderer.getSaleBurstCount()).toBe(5);
    expect(renderer.getLiveBurstCount()).toBe(5);
    expect(host.created).toHaveLength(5);
    expect(new Set(host.oneShots.map((oneShot) => oneShot.view)).size).toBe(5);
  });

  it("tints a burst from the sold resource's own content colour", () => {
    const depot = createEntity({ id: "d1", type: "depot" });
    for (const resource of Object.keys(RESOURCES) as ResourceId[]) {
      const { renderer, host } = createRenderer([depot]);

      renderer.apply(saleEvent("d1", resource));

      expect(host.created[0]?.tints, resource).toEqual([parseGlowColor(RESOURCES[resource].color)]);
    }
  });

  it("maps every resource colour to the locked content palette", () => {
    for (const resource of Object.keys(RESOURCES) as ResourceId[]) {
      expect(parseGlowColor(RESOURCES[resource].color), resource).toBeTypeOf("number");
    }
  });

  it("bursts on the sale's own world position", () => {
    const depot = createEntity({ id: "d1", type: "depot" });
    const { renderer, host } = createRenderer([depot]);

    renderer.apply(saleEvent("d1", "copperOre"));

    expect(host.created[0]?.x).toBe(32);
    expect(host.created[0]?.y).toBe(64);
  });

  it("emits no burst for an event that is not a sale", () => {
    const silo = createEntity({ id: "s1", type: "silo" });
    const smelter = createEntity({ id: "s2", type: "smelter" });
    const { renderer, host } = createRenderer([silo, smelter]);

    for (const event of [
      { type: "storageFull", entityId: "s1", resource: "copperOre", worldX: 0, worldY: 0 },
      { type: "blockedFull", entityId: "s2" },
      { type: "entityPlaced", entity: createEntity({ id: "e9", type: "depot" }) },
      { type: "entityRemoved", entityId: "s1" },
    ] satisfies RenderEvent[]) {
      expect(renderer.apply(event), event.type).toBe(false);
    }

    expect(renderer.getSaleBurstCount()).toBe(0);
    expect(host.created).toHaveLength(0);
  });

  it("emits no burst when the coin art is not loadable", () => {
    const depot = createEntity({ id: "d1", type: "depot" });
    const host = createFakeHost({
      hasTexture: (textureKey) => textureKey === "factor-y:vfx.heat:0",
    });
    const { renderer } = createRenderer([depot], host);

    expect(renderer.apply(saleEvent("d1", "copperOre"))).toBe(false);
    expect(renderer.getSaleBurstCount()).toBe(0);
    expect(renderer.getLiveBurstCount()).toBe(0);
  });

  it("rises and fades a burst over one short lifetime and then retires it", () => {
    const view: VfxView = { alpha: 1, scale: 1, y: 0, x: 0 } as unknown as VfxView;
    let completed = 0;
    const spec = createSaleBurstSpec(view, {
      worldX: 0,
      worldY: 64,
      onComplete: () => {
        completed += 1;
      },
    });

    expect(spec.duration).toBe(SALE_BURST_LIFETIME_MS);
    expect(spec.y).toBe(64 - SALE_BURST_RISE_PX);
    expect(spec.alpha).toBe(0);
    expect(spec.scale).toBeGreaterThan(1);

    spec.onComplete();
    expect(completed).toBe(1);
  });
});

describe("vfx lifetime", () => {
  it("bounds the live burst pool so a long run cannot leave thousands of sprites behind", () => {
    const depot = createEntity({ id: "d1", type: "depot" });
    const { renderer, host } = createRenderer([depot]);

    for (let sale = 0; sale < MAX_LIVE_SALE_BURSTS * 3; sale += 1) {
      renderer.apply(saleEvent("d1", "copperOre"));
    }

    expect(renderer.getSaleBurstCount()).toBe(MAX_LIVE_SALE_BURSTS * 3);
    expect(renderer.getLiveBurstCount()).toBeLessThanOrEqual(MAX_LIVE_SALE_BURSTS);
    expect(host.created.length).toBeLessThanOrEqual(MAX_LIVE_SALE_BURSTS);
  });

  it("returns a retired burst to the pool instead of allocating a new sprite", () => {
    const depot = createEntity({ id: "d1", type: "depot" });
    const { renderer, host } = createRenderer([depot]);

    renderer.apply(saleEvent("d1", "copperOre"));
    const first = host.created[0];
    host.oneShots[0].spec.onComplete();

    expect(renderer.getLiveBurstCount()).toBe(0);
    expect(renderer.getPoolSize()).toBe(1);

    renderer.apply(saleEvent("d1", "copperOre"));

    expect(host.created).toHaveLength(1);
    expect(host.created[0]).toBe(first);
    expect(first.tints).toEqual([parseGlowColor("#c98245"), parseGlowColor("#c98245")]);
    expect(renderer.getLiveBurstCount()).toBe(1);
  });

  it("stops and disposes only the removed entity's heat", () => {
    const first = createEntity({ id: "s1", type: "smelter", x: 1 });
    const second = createEntity({ id: "s2", type: "smelter", x: 2 });
    const { renderer, host } = createRenderer([first, second]);
    renderer.apply(machineStateEvent("s1", true));
    renderer.apply(machineStateEvent("s2", true));

    expect(renderer.remove("s1")).toBe(true);

    expect(renderer.getHeatEntityIds()).toEqual(["s2"]);
    expect(host.created[0]?.visibility).toEqual([false]);
    expect(host.created[1]?.visibility).toEqual([]);
  });

  it("reports no removal for an entity that carried no heat", () => {
    const { renderer } = createRenderer([]);
    expect(renderer.remove("missing")).toBe(false);
  });

  it("disposes everything once and tolerates a second destroy", () => {
    const smelter = createEntity({ id: "s1", type: "smelter" });
    const depot = createEntity({ id: "d1", type: "depot" });
    const { renderer, host } = createRenderer([smelter, depot]);
    renderer.apply(machineStateEvent("s1", true));
    renderer.apply(saleEvent("d1", "copperOre"));

    renderer.destroy();
    renderer.destroy();

    expect(renderer.getHeatEntityIds()).toEqual([]);
    expect(renderer.getLiveBurstCount()).toBe(0);
    expect(host.created.every((view) => view.destroyed)).toBe(true);
  });
});

describe("vfx render event consumption against a real store", () => {
  function createWorld(): { store: SimulationStore; events: RenderEvent[]; node: { x: number; y: number } } {
    const state: SimulationState = createInitialState(1337);
    const node = state.grid.nodes.find((candidate) => candidate.resource === ("copperOre" satisfies ResourceId));
    if (node === undefined) {
      throw new Error("No copperOre node in the initial world");
    }
    const store = new SimulationStore(state);
    const events: RenderEvent[] = [];
    store.subscribeEvents((event) => events.push(event));
    return { store, events, node };
  }

  it("emits exactly one burst for every sale a real depot run completes", () => {
    const { store, events, node } = createWorld();
    const host = createFakeHost();
    const renderer = createVfxRenderer({
      factory: host.views,
      tweens: {
        createPulseTween: () => ({ stop: () => undefined }),
        createOneShotTween: () => ({ stop: () => undefined }),
      },
      resolveEntity: (entityId) => store.getEntities().find((entity) => entity.id === entityId),
    });
    store.subscribeEvents((event) => renderer.apply(event));

    for (const command of [
      { type: "placeEntity", machine: "extractor", x: node.x, y: node.y, rotation: 0, resourceNode: "copperOre" },
      { type: "placeEntity", machine: "depot", x: node.x + 1, y: node.y, rotation: 0 },
    ] as const) {
      expect(store.dispatch({ ...command }).ok, command.machine).toBe(true);
    }

    store.advanceTicks(120);

    const sales = events.filter((event) => event.type === "saleCompleted");
    expect(sales.length).toBeGreaterThan(0);
    expect(renderer.getSaleBurstCount()).toBe(sales.length);
    for (const sale of sales) {
      expect(sale.type).toBe("saleCompleted");
    }
  });

  it("schedules no heat for a real run whose only machines are an extractor and a depot", () => {
    const { store, events, node } = createWorld();
    const host = createFakeHost();
    const renderer = createVfxRenderer({
      factory: host.views,
      tweens: {
        createPulseTween: () => ({ stop: () => undefined }),
        createOneShotTween: () => ({ stop: () => undefined }),
      },
      resolveEntity: (entityId) => store.getEntities().find((entity) => entity.id === entityId),
    });
    store.subscribeEvents((event) => renderer.apply(event));

    for (const command of [
      { type: "placeEntity", machine: "extractor", x: node.x, y: node.y, rotation: 0, resourceNode: "copperOre" },
      { type: "placeEntity", machine: "depot", x: node.x + 1, y: node.y, rotation: 0 },
    ] as const) {
      expect(store.dispatch({ ...command }).ok, command.machine).toBe(true);
    }

    store.advanceTicks(120);

    const stateChanges = events.filter((event) => event.type === "machineStateChanged");
    expect(stateChanges.length).toBeGreaterThan(0);
    expect(renderer.getHeatEntityIds()).toEqual([]);
    expect(renderer.getSaleBurstCount()).toBe(
      events.filter((event) => event.type === "saleCompleted").length,
    );
    expect(host.created.every((view) => view.descriptor.assetKey === "vfx.coin")).toBe(true);
  });
});