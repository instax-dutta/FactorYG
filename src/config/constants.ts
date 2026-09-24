/** Fixed simulation rate. Sim ticks independently of requestAnimationFrame. */
export const TICK_HZ = 10;
export const THROUGHPUT_WINDOW_TICKS = 5 * TICK_HZ;
/** Rate at which sim state is pushed into the React/zustand UI layer. */
export const UI_HZ = 10;

/** Discrete cell grid. 1 world unit = 1 cell. */
export const GRID_W = 64;
export const GRID_H = 64;
export const CELL = 1;

/** Offline progress is credited for at most 8 hours of absence. */
export const OFFLINE_CAP_S = 8 * 3600;
/** Below this, the offline summary modal is not shown at all. */
export const OFFLINE_MODAL_THRESHOLD_S = 60;

/** Lifetime motors required per prestige point. TUNE_AFTER_PLAYABLE. */
export const MOTOR_THRESHOLD = 25;

export const SAVE_KEY = 'factoryg.save.v1';
export const SAVE_VERSION = 2;
/** Sim seconds between autosaves: cadence follows the factory, not the wall clock. */
export const AUTOSAVE_INTERVAL_S = 5;
