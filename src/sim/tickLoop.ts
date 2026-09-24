import { TICK_HZ } from '../config/constants';

/** Sim seconds per step: 10tps means one step every 100ms. */
export const FIXED_DT = 1 / TICK_HZ;
/**
 * The most sim time a single frame may claim. A stalled tab (GC pause, hidden
 * window, slow load) must not fast-forward the factory by minutes.
 */
export const MAX_CATCH_UP_S = 0.5;
/** Hard bound on steps per frame, so one bad frame cannot block the thread. */
export const MAX_STEPS_PER_FRAME = 10;
/** Slack for float accumulation: 20 x 50ms must add up to exactly 10 steps. */
const EPSILON = 1e-9;

export interface FixedStepClockOptions {
  /** Steps per second. Defaults to the sim rate. */
  hz?: number;
  maxCatchUpSec?: number;
  maxStepsPerFrame?: number;
}

export interface FixedStepClock {
  /**
   * Wall-clock seconds since the last call; returns how many fixed steps to
   * run. Time that is not yet a whole step is carried into the next call, and
   * time past the catch-up cap is dropped rather than saved up.
   */
  advance(deltaSec: number): number;
  /** Forgets any partial step, e.g. after a pause. */
  reset(): void;
}

/**
 * Fixed-timestep accumulator for the sim loop. Render frames may arrive at any
 * rate; this is the only thing that decides how much factory time passes, which
 * is what keeps the sim independent of requestAnimationFrame.
 */
export function createFixedStepClock(options: FixedStepClockOptions = {}): FixedStepClock {
  const dt = 1 / (options.hz ?? TICK_HZ);
  const maxCatchUpSec = options.maxCatchUpSec ?? MAX_CATCH_UP_S;
  const maxStepsPerFrame = options.maxStepsPerFrame ?? MAX_STEPS_PER_FRAME;
  let accumulator = 0;

  return {
    advance(deltaSec: number): number {
      // Clock skew, a backwards timer, or a paused debugger: nothing to run.
      if (!Number.isFinite(deltaSec) || deltaSec <= 0) return 0;

      accumulator += Math.min(deltaSec, maxCatchUpSec);

      let steps = 0;
      while (steps < maxStepsPerFrame && accumulator + EPSILON >= dt) {
        accumulator -= dt;
        steps++;
      }

      // Whatever backlog we refused to run is abandoned, never repaid: catching
      // up on a 60s stall would only stall the next frame too.
      if (steps >= maxStepsPerFrame) accumulator = 0;

      return steps;
    },
    reset(): void {
      accumulator = 0;
    },
  };
}
