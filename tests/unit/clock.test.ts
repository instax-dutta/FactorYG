import { describe, expect, it, vi } from "vitest";
import { FixedStepClock } from "../../src/sim/clock";

describe("FixedStepClock", () => {
  it("runs no logical tick before the fixed step is complete", () => {
    const tick = vi.fn();
    const now = vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(99);
    const clock = new FixedStepClock(100, tick, now);

    clock.advance();

    expect(tick).not.toHaveBeenCalled();
  });

  it("runs one tick at 100 ms and carries the remainder", () => {
    const tick = vi.fn();
    const now = vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(250);
    const clock = new FixedStepClock(100, tick, now);

    clock.advance();

    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("caps catch-up at 120 logical ticks per call", () => {
    const tick = vi.fn();
    const now = vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(12_000);
    const clock = new FixedStepClock(100, tick, now);

    clock.advance();

    expect(tick).toHaveBeenCalledTimes(120);
  });
});
