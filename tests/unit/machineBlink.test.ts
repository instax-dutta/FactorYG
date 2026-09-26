import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import type { RenderEvent } from "../../src/sim/types";
import {
  BLOCKED_MACHINE_BLINK_HOLD,
  BLOCKED_MACHINE_TINT,
  BLOCKED_MACHINE_TWEEN_DURATION_MS,
  createMachineBlinker,
  createMachineBlinkTweenSpec,
  type MachineBlinkView,
} from "../../src/phaser/render/machineBlink";

class FakeView implements MachineBlinkView {
  readonly tints: number[] = [];
  alpha = 1;
  tint: number;

  public constructor(tint = 0xffffff) {
    this.tint = tint;
  }

  public setTint(color: number): void {
    this.tint = color;
    this.tints.push(color);
  }
}

interface FakeTween {
  readonly view: MachineBlinkView;
  readonly config: MachineBlinkTweenConfigShape;
  stopped: number;
}

interface MachineBlinkTweenConfigShape {
  readonly duration: number;
  readonly yoyo: boolean;
  readonly repeat: number;
  readonly hold: number;
}

function createFakeHost(): { host: Parameters<typeof createMachineBlinker>[0]; tweens: FakeTween[] } {
  const tweens: FakeTween[] = [];
  return {
    tweens,
    host: {
      createPulseTween: (view, config) => {
        const tween: FakeTween = { view, config, stopped: 0 };
        tweens.push(tween);
        return {
          stop: (): void => {
            tween.stopped += 1;
          },
        };
      },
    },
  };
}

describe("createMachineBlinker", () => {
  it("starts one repeating pulse tween per blocked machine and never two", () => {
    const { host, tweens } = createFakeHost();
    const blinker = createMachineBlinker(host);
    const view = new FakeView();

    blinker.start("entity-1", view, 0xffffff);
    blinker.start("entity-1", view, 0xffffff);

    expect(tweens).toHaveLength(1);
    expect(blinker.isBlinking("entity-1")).toBe(true);
    expect(tweens[0]?.view).toBe(view);
  });

  it("tints a blocked machine the alarm red and holds it there for the whole block", () => {
    const { host, tweens } = createFakeHost();
    const blinker = createMachineBlinker(host);
    const view = new FakeView();

    blinker.start("entity-1", view, 0xffffff);

    expect(view.tint).toBe(BLOCKED_MACHINE_TINT);
    expect(view.tints).toEqual([BLOCKED_MACHINE_TINT]);
    expect(tweens[0]?.config).toEqual({
      duration: BLOCKED_MACHINE_TWEEN_DURATION_MS,
      yoyo: true,
      repeat: -1,
      hold: BLOCKED_MACHINE_BLINK_HOLD,
    });
  });

  it("pulses at a rate a player can read rather than a strobe", () => {
    expect(BLOCKED_MACHINE_TWEEN_DURATION_MS).toBe(400);
    expect(BLOCKED_MACHINE_TWEEN_DURATION_MS * 2).toBe(800);
    expect(BLOCKED_MACHINE_BLINK_HOLD).toBeGreaterThan(0.3);
    expect(BLOCKED_MACHINE_BLINK_HOLD).toBeLessThan(0.5);
  });

  it("uses the same red the invalid placement ghost already teaches the player", () => {
    expect(BLOCKED_MACHINE_TINT).toBe(0xd85b3f);
  });

  it("restores the exact tint the machine carried before the block", () => {
    const { host, tweens } = createFakeHost();
    const blinker = createMachineBlinker(host);
    const view = new FakeView(0x36c5b5);

    blinker.start("entity-1", view, 0x36c5b5);
    blinker.stop("entity-1");

    expect(view.tints).toEqual([BLOCKED_MACHINE_TINT, 0x36c5b5]);
    expect(view.tint).toBe(0x36c5b5);
    expect(tweens[0]?.stopped).toBe(1);
  });

  it("ignores a stop for a machine that was never blinking", () => {
    const { host, tweens } = createFakeHost();
    const blinker = createMachineBlinker(host);
    const view = new FakeView();

    blinker.stop("entity-9");

    expect(view.tints).toEqual([]);
    expect(tweens).toEqual([]);
    expect(blinker.isBlinking("entity-9")).toBe(false);
  });

  it("blocks and unblocks the same machine repeatedly without leaking a tween", () => {
    const { host, tweens } = createFakeHost();
    const blinker = createMachineBlinker(host);
    const view = new FakeView();

    for (let cycle = 0; cycle < 5; cycle += 1) {
      blinker.start("entity-1", view, 0xffffff);
      blinker.stop("entity-1");
    }

    expect(tweens).toHaveLength(5);
    expect(tweens.every((tween) => tween.stopped === 1)).toBe(true);
    expect(blinker.getBlinkingEntityIds()).toEqual([]);
  });

  it("tracks several blocked machines independently and reports them in a stable order", () => {
    const { host, tweens } = createFakeHost();
    const blinker = createMachineBlinker(host);
    const second = new FakeView();
    const third = new FakeView();

    blinker.start("entity-3", third, 0xffffff);
    blinker.start("entity-1", new FakeView(), 0xffffff);
    blinker.start("entity-2", second, 0xffffff);
    blinker.stop("entity-2");

    expect(blinker.getBlinkingEntityIds()).toEqual(["entity-1", "entity-3"]);
    expect(blinker.isBlinking("entity-2")).toBe(false);
    expect(tweens).toHaveLength(3);
  });

  it("stops every live pulse on destroy so a shutdown leaves no tween behind", () => {
    const { host, tweens } = createFakeHost();
    const blinker = createMachineBlinker(host);

    blinker.start("entity-1", new FakeView(), 0xffffff);
    blinker.start("entity-2", new FakeView(), 0xffffff);
    blinker.destroy();
    blinker.destroy();

    expect(tweens.every((tween) => tween.stopped === 1)).toBe(true);
    expect(blinker.getBlinkingEntityIds()).toEqual([]);
  });

  it("is safe to start a machine that no longer has a sprite", () => {
    const { host, tweens } = createFakeHost();
    const blinker = createMachineBlinker(host);

    blinker.start("entity-1", undefined, 0xffffff);

    expect(tweens).toEqual([]);
    expect(blinker.getBlinkingEntityIds()).toEqual([]);
  });
});

describe("createMachineBlinkTweenSpec", () => {
  const config = {
    duration: BLOCKED_MACHINE_TWEEN_DURATION_MS,
    yoyo: true,
    repeat: -1,
    hold: BLOCKED_MACHINE_BLINK_HOLD,
  };

  it("builds the tween the scene hands to Phaser, so the motion is pinned here", () => {
    const view = new FakeView();

    expect(createMachineBlinkTweenSpec(view, config)).toEqual({
      targets: view,
      alpha: BLOCKED_MACHINE_BLINK_HOLD,
      duration: BLOCKED_MACHINE_TWEEN_DURATION_MS,
      yoyo: true,
      repeat: -1,
    });
  });

  it("animates alpha rather than tint, so the blocked red never pulses off", () => {
    const spec = createMachineBlinkTweenSpec(new FakeView(), config);

    expect(Object.keys(spec).sort()).toEqual(["alpha", "duration", "repeat", "targets", "yoyo"]);
    expect(spec).not.toHaveProperty("tint");
    expect(spec).not.toHaveProperty("tintFill");
    expect(spec).not.toHaveProperty("tintTopLeft");
  });

  it("keeps the pulse on the machine sprite itself so nothing else in the scene moves", () => {
    const view = new FakeView();

    expect(createMachineBlinkTweenSpec(view, config).targets).toBe(view);
  });

  it("repeats forever and yoyos, which is the difference between a blink and a fade", () => {
    const spec = createMachineBlinkTweenSpec(new FakeView(), config);

    expect(spec.repeat).toBe(-1);
    expect(spec.yoyo).toBe(true);
  });

  it("fades to a hold that is visible but never hides the machine", () => {
    const spec = createMachineBlinkTweenSpec(new FakeView(), config);

    expect(spec.alpha).toBe(BLOCKED_MACHINE_BLINK_HOLD);
    expect(spec.alpha).toBeGreaterThan(0);
    expect(spec.alpha).toBeLessThan(1);
  });
});

interface BlinkHarness {
  readonly blinker: ReturnType<typeof createMachineBlinker>;
  readonly tweens: FakeTween[];
  readonly views: Map<string, FakeView>;
}

function createBlinkHarness(): BlinkHarness {
  const { host, tweens } = createFakeHost();
  return { blinker: createMachineBlinker(host), tweens, views: new Map() };
}

function applyRenderEvent(
  harness: BlinkHarness,
  event: Extract<RenderEvent, { type: "blockedFull" | "entityRemoved" }>,
): void {
  if (event.type === "entityRemoved") {
    const view = harness.views.get(event.entityId);
    harness.blinker.stop(event.entityId);
    harness.views.delete(event.entityId);
    void view;
    return;
  }

  const view = new FakeView();
  harness.views.set(event.entityId, view);
  harness.blinker.start(event.entityId, view, 0xffffff);
}

function createJammedStore(): SimulationStore {
  const store = new SimulationStore(createInitialState(1337));
  store.dispatch({
    type: "placeEntity",
    machine: "extractor",
    x: 40,
    y: 37,
    rotation: 0,
    resourceNode: "copperOre",
  });
  for (let index = 0; index < 3; index += 1) {
    store.dispatch({
      type: "placeEntity",
      machine: "belt",
      x: 41 + index,
      y: 37,
      rotation: 0,
    });
  }
  return store;
}

describe("a blocked machine that is demolished", () => {
  it("stops the live repeating tween instead of leaving it on a destroyed sprite", () => {
    const store = createJammedStore();
    const harness = createBlinkHarness();
    const seen: RenderEvent[] = [];
    store.subscribeEvents((event) => {
      if (event.type === "blockedFull" || event.type === "entityRemoved") {
        seen.push(event);
        applyRenderEvent(harness, event);
      }
    });

    store.advanceTicks(200);

    expect(seen.filter((event) => event.type === "blockedFull")).toEqual([
      { type: "blockedFull", entityId: "entity-1" },
    ]);
    expect(harness.blinker.isBlinking("entity-1")).toBe(true);
    expect(harness.blinker.getBlinkingEntityIds()).toEqual(["entity-1"]);
    expect(harness.views.get("entity-1")?.tint).toBe(BLOCKED_MACHINE_TINT);
    expect(harness.tweens).toHaveLength(1);
    expect(harness.tweens[0]?.stopped).toBe(0);

    store.dispatch({ type: "demolishEntity", entityId: "entity-1" });

    expect(harness.tweens[0]?.stopped).toBe(1);
    expect(harness.blinker.isBlinking("entity-1")).toBe(false);
    expect(harness.blinker.getBlinkingEntityIds()).toEqual([]);
    expect(harness.views.size).toBe(0);

    store.advanceTicks(100);

    expect(harness.tweens).toHaveLength(1);
    expect(harness.tweens[0]?.stopped).toBe(1);
  });

  it("leaves the sprite tint restored so a rebuilt machine never inherits a stale red", () => {
    const store = createJammedStore();
    const harness = createBlinkHarness();
    const removed: FakeView[] = [];
    store.subscribeEvents((event) => {
      if (event.type === "blockedFull") {
        const view = new FakeView();
        harness.views.set(event.entityId, view);
        harness.blinker.start(event.entityId, view, 0x36c5b5);
      }
      if (event.type === "entityRemoved") {
        removed.push(harness.views.get(event.entityId) as FakeView);
        harness.blinker.stop(event.entityId);
        harness.views.delete(event.entityId);
      }
    });

    store.advanceTicks(200);
    store.dispatch({ type: "demolishEntity", entityId: "entity-1" });

    expect(removed).toHaveLength(1);
    expect(removed[0]?.tints).toEqual([BLOCKED_MACHINE_TINT, 0x36c5b5]);
    expect(removed[0]?.tint).toBe(0x36c5b5);
    expect(removed[0]?.alpha).toBe(1);
  });

  it("stops a blink that is already running when the machine is removed, not only a fresh one", () => {
    const store = createJammedStore();
    const harness = createBlinkHarness();
    store.subscribeEvents((event) => {
      if (event.type === "blockedFull") {
        harness.blinker.start(event.entityId, new FakeView(), 0xffffff);
      }
    });

    store.advanceTicks(200);
    store.advanceTicks(200);

    expect(harness.tweens).toHaveLength(1);
    expect(harness.tweens[0]?.stopped).toBe(0);

    store.subscribeEvents((event) => {
      if (event.type === "entityRemoved") {
        harness.blinker.stop(event.entityId);
      }
    });
    store.dispatch({ type: "demolishEntity", entityId: "entity-1" });

    expect(harness.tweens[0]?.stopped).toBe(1);
  });
});
