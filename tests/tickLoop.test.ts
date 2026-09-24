import { describe, it, expect } from 'vitest';
import { createFixedStepClock } from '../src/sim/tickLoop';
import { TICK_HZ } from '../src/config/constants';

/**
 * Plan architecture rule 2 / spec §2: the sim runs on a fixed timestep
 * decoupled from requestAnimationFrame. Renders may stall or run at any rate;
 * the factory must still advance in exact 1/TICK_HZ steps, and a stalled tab
 * must never be able to spiral.
 */
describe('fixed timestep clock', () => {
  it('runs one step per fixed interval', () => {
    const clock = createFixedStepClock({ hz: TICK_HZ });

    expect(clock.advance(1 / TICK_HZ)).toBe(1);
    expect(clock.advance(1 / TICK_HZ)).toBe(1);
  });

  it('runs nothing until a whole interval has elapsed', () => {
    const clock = createFixedStepClock({ hz: TICK_HZ });

    // A 120Hz render frame is smaller than a 10tps tick.
    expect(clock.advance(1 / 120)).toBe(0);
  });

  it('carries the remainder, so a steady frame rate never loses or gains time', () => {
    const clock = createFixedStepClock({ hz: TICK_HZ });

    // 20 frames of 50ms is exactly one second of sim: 10 ticks, no rounding drift.
    let steps = 0;
    for (let frame = 0; frame < 20; frame++) steps += clock.advance(0.05);

    expect(steps).toBe(TICK_HZ);
  });

  it('caps how much sim time one frame may claim', () => {
    const clock = createFixedStepClock({ hz: TICK_HZ, maxCatchUpSec: 0.5 });

    // A 5s stall (GC pause, hidden tab) must not fast-forward half a minute.
    expect(clock.advance(5)).toBeLessThanOrEqual(TICK_HZ * 0.5);
  });

  it('does not spiral after a long stall', () => {
    const clock = createFixedStepClock({ hz: TICK_HZ, maxCatchUpSec: 0.5 });

    clock.advance(60);

    // Back to normal frames: the dropped backlog must not be repaid forever.
    expect(clock.advance(1 / TICK_HZ)).toBe(1);
    expect(clock.advance(1 / TICK_HZ)).toBe(1);
  });

  it('ignores zero, negative, and non-finite deltas', () => {
    const clock = createFixedStepClock({ hz: TICK_HZ });

    expect(clock.advance(0)).toBe(0);
    expect(clock.advance(-1)).toBe(0);
    expect(clock.advance(Number.NaN)).toBe(0);
    expect(clock.advance(Number.POSITIVE_INFINITY)).toBe(0);

    // A backwards clock must not corrupt the accumulator either.
    expect(clock.advance(1 / TICK_HZ)).toBe(1);
  });

  it('honours a custom rate', () => {
    const clock = createFixedStepClock({ hz: 20 });

    expect(clock.advance(1 / 20)).toBe(1);
    expect(clock.advance(0.1)).toBe(2);
  });

  it('drops the backlog it refuses to run rather than saving it up', () => {
    const clock = createFixedStepClock({ hz: TICK_HZ, maxCatchUpSec: 10, maxStepsPerFrame: 3 });

    expect(clock.advance(10)).toBe(3);
    // The unrun backlog is gone: the next frame is a normal frame again.
    expect(clock.advance(1 / TICK_HZ)).toBe(1);
  });
});
