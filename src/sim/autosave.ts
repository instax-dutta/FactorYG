import { AUTOSAVE_INTERVAL_S } from '../config/constants';

/** Slack for float accumulation, so a steady 0.1s cadence lands exactly. */
const EPSILON = 1e-9;

export interface SaveScheduleOptions {
  /** Sim seconds between saves. Defaults to the configured interval. */
  intervalSec?: number;
}

export interface SaveSchedule {
  /**
   * Sim seconds that passed since the last call; returns true when a save is
   * due. At most one save is ever due per call.
   */
  advance(deltaSec: number): boolean;
  /** Records that a save just happened (autosave or forced), restarting the cadence. */
  markSaved(): void;
}

/**
 * Autosave cadence, measured in sim seconds so it rides the same fixed timestep
 * as the factory. Wall-clock pacing would keep firing while a throttled tab is
 * not advancing the factory at all; this way the save rate follows progress.
 */
export function runForcedSave(save: () => boolean, schedule: Pick<SaveSchedule, 'markSaved'>): boolean {
  const saved = save();
  if (saved) schedule.markSaved();
  return saved;
}

export function createSaveSchedule(options: SaveScheduleOptions = {}): SaveSchedule {
  const intervalSec = options.intervalSec ?? AUTOSAVE_INTERVAL_S;
  let secondsSinceSave = 0;

  return {
    advance(deltaSec: number): boolean {
      // A paused or skewed clock has not aged the factory.
      if (!Number.isFinite(deltaSec) || deltaSec <= 0) return false;

      secondsSinceSave += deltaSec;
      if (secondsSinceSave + EPSILON < intervalSec) return false;

      // The overdue time is not repaid tick by tick: one save, then the clock
      // starts again, so a stall can never queue a burst.
      secondsSinceSave = 0;
      return true;
    },
    markSaved(): void {
      secondsSinceSave = 0;
    },
  };
}
