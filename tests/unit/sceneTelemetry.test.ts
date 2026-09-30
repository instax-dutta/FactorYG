import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import {
  createRenderTelemetryCache,
  createSceneRenderTelemetry,
  createSceneSoundTelemetry,
  createSceneTelemetry,
  INITIAL_SCENE_TELEMETRY,
  type SceneRenderTelemetry,
} from "../../src/phaser/telemetry";

const SOUND_TELEMETRY = createSceneSoundTelemetry(
  {
    triggeredCounts: { machine: 0, belt: 0, unlock: 0, sale: 0, blocked: 0 },
    loopStartCount: 0,
    loopStopCount: 0,
    activeLoopCount: 0,
  },
  {
    unlocked: false,
    contextCreated: false,
    bufferCount: 5,
    readyBufferCount: 0,
    decodeFailureCount: 0,
    playedCounts: { machine: 0, belt: 0, unlock: 0, sale: 0, blocked: 0 },
    suppressedCount: 0,
    unavailableCount: 0,
    activeLoopCount: 0,
  },
);

function createRenderTelemetry(
  overrides: Partial<SceneRenderTelemetry> = {},
): SceneRenderTelemetry {
  return Object.freeze({
    entityIds: Object.freeze(["entity-1"]),
    activeEntityIds: Object.freeze(["entity-1"]),
    activeFrameKeys: Object.freeze(["factor-y:machine.extractor.active:0"]),
    beltItemIds: Object.freeze([]),
    beltGlowCount: 0,
    beltItemEventCount: 0,
    blockedEntityIds: Object.freeze([]),
    heatEntityIds: Object.freeze([]),
    saleBurstCount: 0,
    liveBurstCount: 0,
    ...overrides,
  });
}

describe("createSceneTelemetry", () => {
  it("reuses an already frozen render block so frame identity is observable", () => {
    const render = createRenderTelemetry();

    const first = createSceneTelemetry({
      ready: true,
      camera: { scrollX: 0, scrollY: 0, zoom: 1, boundsWidth: 4352, boundsHeight: 4352 },
      ghost: { visible: false, valid: false, rotation: 0 },
      render,
      sound: SOUND_TELEMETRY,
    });
    const second = createSceneTelemetry({
      ready: true,
      camera: { scrollX: 12, scrollY: 34, zoom: 2, boundsWidth: 6400, boundsHeight: 6400 },
      ghost: { visible: true, valid: true, rotation: 90 },
      render,
      sound: SOUND_TELEMETRY,
    });

    expect(first.render).toBe(render);
    expect(second.render).toBe(render);
    expect(first.sound).toBe(SOUND_TELEMETRY);
    expect(second.camera).not.toBe(first.camera);
  });

  it("carries the sound block so a browser test can read playback without hearing it", () => {
    const telemetry = createSceneTelemetry({
      ready: true,
      camera: { scrollX: 0, scrollY: 0, zoom: 1, boundsWidth: 4352, boundsHeight: 4352 },
      ghost: { visible: false, valid: false, rotation: 0 },
      render: createRenderTelemetry(),
      sound: SOUND_TELEMETRY,
    });

    expect(telemetry.sound.bufferCount).toBe(5);
    expect(telemetry.sound.unlocked).toBe(false);
    expect(telemetry.sound.triggeredCounts.sale).toBe(0);
    expect(Object.isFrozen(telemetry.sound)).toBe(true);
    expect(INITIAL_SCENE_TELEMETRY.sound.unlocked).toBe(false);
    expect(INITIAL_SCENE_TELEMETRY.sound.contextCreated).toBe(false);
  });

  it("carries the camera bounds so a browser test can observe a resized world", () => {
    const telemetry = createSceneTelemetry({
      ready: true,
      camera: { scrollX: 0, scrollY: 0, zoom: 1, boundsWidth: 6400, boundsHeight: 6016 },
      ghost: { visible: false, valid: false, rotation: 0 },
      render: createRenderTelemetry(),
      sound: SOUND_TELEMETRY,
    });

    expect(telemetry.camera).toEqual({
      scrollX: 0,
      scrollY: 0,
      zoom: 1,
      boundsWidth: 6400,
      boundsHeight: 6016,
    });
    expect(Object.isFrozen(telemetry.camera)).toBe(true);
    expect(
      Reflect.set(telemetry.camera as { boundsWidth: number }, "boundsWidth", 1),
    ).toBe(false);
    expect(telemetry.camera.boundsWidth).toBe(6400);
  });

  it("reports empty camera bounds before the scene has set any", () => {
    expect(INITIAL_SCENE_TELEMETRY.camera).toEqual({
      scrollX: 0,
      scrollY: 0,
      zoom: 1,
      boundsWidth: 0,
      boundsHeight: 0,
    });
  });

  it("defensively copies and freezes a mutable render block", () => {
    const mutable = {
      entityIds: ["entity-1"],
      activeEntityIds: ["entity-1"],
      activeFrameKeys: ["factor-y:machine.extractor.active:0"],
      beltItemIds: [] as string[],
      beltGlowCount: 0,
      beltItemEventCount: 0,
      blockedEntityIds: [] as string[],
      heatEntityIds: [] as string[],
      saleBurstCount: 0,
      liveBurstCount: 0,
    };

    const telemetry = createSceneTelemetry({
      ready: true,
      camera: { scrollX: 0, scrollY: 0, zoom: 1, boundsWidth: 4352, boundsHeight: 4352 },
      ghost: { visible: false, valid: false, rotation: 0 },
      render: mutable,
      sound: SOUND_TELEMETRY,
    });

    expect(telemetry.render).not.toBe(mutable);
    expect(Object.isFrozen(telemetry.render)).toBe(true);
    expect(Object.isFrozen(telemetry.render.entityIds)).toBe(true);
    expect(Reflect.set(telemetry.render.entityIds as string[], 0, "entity-9")).toBe(false);
    expect(Reflect.set(mutable.beltItemIds, 0, "belt-1")).toBe(true);
    expect(telemetry.render.beltItemIds).toEqual([]);
  });

  it("keeps the initial telemetry render block frozen and empty", () => {
    expect(Object.isFrozen(INITIAL_SCENE_TELEMETRY.render)).toBe(true);
    expect(INITIAL_SCENE_TELEMETRY.render).toEqual({
      entityIds: [],
      activeEntityIds: [],
      activeFrameKeys: [],
      beltItemIds: [],
      beltGlowCount: 0,
      beltItemEventCount: 0,
      blockedEntityIds: [],
      heatEntityIds: [],
      saleBurstCount: 0,
      liveBurstCount: 0,
    });
  });

  it("freezes the blocked machine ids so a browser test cannot mutate the reported blink set", () => {
    const render = createSceneRenderTelemetry({
      entityIds: ["entity-1"],
      activeEntityIds: [],
      activeFrameKeys: [],
      beltItemIds: [],
      beltGlowCount: 0,
      beltItemEventCount: 0,
      blockedEntityIds: ["entity-3", "entity-1"],
      heatEntityIds: [],
      saleBurstCount: 0,
      liveBurstCount: 0,
    });

    expect(Object.isFrozen(render.blockedEntityIds)).toBe(true);
    expect(Reflect.set(render.blockedEntityIds as string[], 0, "entity-9")).toBe(false);
    expect(render.blockedEntityIds).toEqual(["entity-3", "entity-1"]);
  });
});

describe("createRenderTelemetryCache", () => {
  it("returns the same instance until a change is marked", () => {
    let builds = 0;
    const build = (): SceneRenderTelemetry => {
      builds += 1;
      return createRenderTelemetry({ beltItemEventCount: builds });
    };
    const cache = createRenderTelemetryCache(build());

    const first = cache.read(build);
    const second = cache.read(build);
    const third = cache.read(build);

    expect(builds).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("rebuilds once after a mark and then memoizes again", () => {
    let builds = 0;
    const build = (): SceneRenderTelemetry => {
      builds += 1;
      return createRenderTelemetry({ beltItemEventCount: builds });
    };
    const cache = createRenderTelemetryCache(build());
    const initial = cache.read(build);

    cache.markDirty();
    const rebuilt = cache.read(build);

    expect(builds).toBe(2);
    expect(rebuilt).not.toBe(initial);
    expect(rebuilt.beltItemEventCount).toBe(2);
    expect(cache.read(build)).toBe(rebuilt);
    expect(builds).toBe(2);
  });

  it("coalesces repeated marks into a single rebuild", () => {
    let builds = 0;
    const build = (): SceneRenderTelemetry => {
      builds += 1;
      return createRenderTelemetry();
    };
    const cache = createRenderTelemetryCache(build());
    const initial = cache.read(build);

    cache.markDirty();
    cache.markDirty();
    cache.markDirty();

    expect(cache.read(build)).not.toBe(initial);
    expect(builds).toBe(2);
  });
});

describe("SimulationStore read-only views", () => {
  it("exposes active machine ids without cloning runtime state", () => {
    const store = new SimulationStore(createInitialState(1337));

    expect(store.getActiveMachineIds()).toEqual([]);
    expect(store.getEntities()).toEqual([]);

    for (const result of [
      store.dispatch({
        type: "placeEntity",
        machine: "extractor",
        x: 40,
        y: 37,
        rotation: 0,
        resourceNode: "copperOre",
      }),
      store.dispatch({ type: "placeEntity", machine: "belt", x: 21, y: 21, rotation: 0 }),
      store.dispatch({ type: "placeEntity", machine: "depot", x: 22, y: 21, rotation: 0 }),
    ]) {
      expect(result.ok).toBe(true);
    }

    expect(store.getActiveMachineIds()).toEqual([]);
    expect(store.getEntities()).toHaveLength(3);

    store.advanceTicks(1);

    const active = store.getActiveMachineIds();
    expect(active).toEqual(["entity-1"]);
    expect(Object.isFrozen(active)).toBe(true);
    expect(Reflect.set(active as string[], 0, "entity-3")).toBe(false);
    expect(store.getActiveMachineIds()).toEqual(["entity-1"]);

    store.dispatch({ type: "demolishEntity", entityId: "entity-1" });

    expect(store.getActiveMachineIds()).toEqual([]);
  });

  it("never reports a belt as an active machine", () => {
    const store = new SimulationStore(createInitialState(1337));
    for (let index = 0; index < 3; index += 1) {
      store.dispatch({
        type: "placeEntity",
        machine: "belt",
        x: 30 + index,
        y: 30,
        rotation: 0,
      });
    }
    store.advanceTicks(1);

    expect(store.getBeltItems()).toEqual({});
    expect(store.getActiveMachineIds()).toEqual([]);
  });

  it("keeps the store free of react, phaser, dom, and persistence imports", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src", "sim", "store.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);

    expect(imports).not.toContain("../persistence/save");
    expect(imports).not.toContain("../persistence/migrate");
    expect(imports.some((specifier) => specifier.includes("persistence"))).toBe(false);
    expect(imports.some((specifier) => specifier.includes("react"))).toBe(false);
    expect(imports.some((specifier) => specifier.includes("phaser"))).toBe(false);
    expect(source).not.toMatch(/\b(localStorage|sessionStorage|document|window)\b/);
    expect(imports.every((specifier) => specifier.startsWith("."))).toBe(true);
  });
});
