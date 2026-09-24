import { describe, it, expect } from 'vitest';
import { createSaveSchedule, runForcedSave } from '../src/sim/autosave';
import { FIXED_DT } from '../src/sim/tickLoop';
import { TICK_HZ } from '../src/config/constants';

/**
 * Autosave is paced by sim seconds, the same clock the factory runs on, rather
 * than by its own wall-clock timer. A tab that is throttled (or a frame that
 * stalls) has not advanced the factory, so it has nothing new to lose.
 */
describe('autosave schedule (tick-clock paced)', () => {
  it('does not save before the interval has elapsed', () => {
    const schedule = createSaveSchedule({ intervalSec: 5 });

    expect(schedule.advance(1)).toBe(false);
    expect(schedule.advance(3.5)).toBe(false);
  });

  it('saves once reached sim time crosses the interval', () => {
    const schedule = createSaveSchedule({ intervalSec: 5 });

    expect(schedule.advance(4.9)).toBe(false);
    expect(schedule.advance(0.1)).toBe(true);
  });

  it('carries the remainder, so the cadence does not drift', () => {
    const schedule = createSaveSchedule({ intervalSec: 5 });

    // 60s of sim fed a tick at a time: exactly 12 saves, not 11 or 13.
    let saves = 0;
    for (let step = 0; step < 60 * TICK_HZ; step++) {
      if (schedule.advance(FIXED_DT)) saves++;
    }

    expect(saves).toBe(12);
  });

  it('saves at most once per call, however long the stall', () => {
    const schedule = createSaveSchedule({ intervalSec: 5 });

    // A 10 minute stall must not queue up a burst of saves.
    expect(schedule.advance(600)).toBe(true);
    expect(schedule.advance(0.05)).toBe(false);
  });

  it('restarts the cadence after a forced save', () => {
    const schedule = createSaveSchedule({ intervalSec: 5 });

    expect(schedule.advance(5)).toBe(true);
    schedule.markSaved();

    // The tab-hide save counts: no immediate autosave right after it.
    expect(schedule.advance(4.9)).toBe(false);
    expect(schedule.advance(0.1)).toBe(true);
  });

  it('marks cadence only after a successful forced save', () => {
    expect(typeof runForcedSave).toBe('function');
    const successful = createSaveSchedule({ intervalSec: 5 });
    successful.advance(4);

    expect(runForcedSave(() => true, successful)).toBe(true);
    expect(successful.advance(4.9)).toBe(false);
    expect(successful.advance(0.1)).toBe(true);
  });

  it('preserves elapsed autosave time after a failed forced save', () => {
    expect(typeof runForcedSave).toBe('function');
    const failed = createSaveSchedule({ intervalSec: 5 });
    failed.advance(4);

    expect(runForcedSave(() => false, failed)).toBe(false);
    expect(failed.advance(1)).toBe(true);
  });

  it('does not count paused time toward the next save', () => {
    const schedule = createSaveSchedule({ intervalSec: 5 });

    for (let frame = 0; frame < 100; frame++) schedule.advance(0);
    expect(schedule.advance(Number.NaN)).toBe(false);
    expect(schedule.advance(-1)).toBe(false);

    expect(schedule.advance(4)).toBe(false);
    expect(schedule.advance(1)).toBe(true);
  });

  it('defaults the interval when none is given', () => {
    const schedule = createSaveSchedule();

    expect(schedule.advance(1)).toBe(false);
    expect(schedule.advance(60)).toBe(true);
  });
});
