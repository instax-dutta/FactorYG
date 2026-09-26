import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import {
  createRenderTelemetryCache,
  createSceneRenderTelemetry,
  createSceneTelemetry,
  INITIAL_SCENE_TELEMETRY,
  type SceneRenderTelemetry,
} from "../../src/phaser/telemetry";

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
    ...overrides,
  });
}

describe("createSceneTelemetry", () => {
  it("reuses an already frozen render block so frame identity is observable", () => {
    const render = createRenderTelemetry();

    const first = createSceneTelemetry({
      ready: true,
      camera: { scrollX: 0, scrollY: 0, zoom: 1 },
      ghost: { visible: false, valid: false, rotation: 0 },
      render,
    });
    const second = createSceneTelemetry({
      ready: true,
      camera: { scrollX: 12, scrollY: 34, zoom: 2 },
      ghost: { visible: true, valid: true, rotation: 90 },
      render,
    });

    expect(first.render).toBe(render);
    expect(second.render).toBe(render);
    expect(second.camera).not.toBe(first.camera);
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
    };

    const telemetry = createSceneTelemetry({
      ready: true,
      camera: { scrollX: 0, scrollY: 0, zoom: 1 },
      ghost: { visible: false, valid: false, rotation: 0 },
      render: mutable,
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
