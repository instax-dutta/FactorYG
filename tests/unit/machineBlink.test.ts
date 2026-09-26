import { describe, expect, it } from "vitest";
import {
  BLOCKED_MACHINE_BLINK_HOLD,
  BLOCKED_MACHINE_TINT,
  BLOCKED_MACHINE_TWEEN_DURATION_MS,
  createMachineBlinker,
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
