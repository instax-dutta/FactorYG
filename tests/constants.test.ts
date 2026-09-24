import { describe, it, expect } from 'vitest';
import {
  TICK_HZ,
  UI_HZ,
  GRID_W,
  GRID_H,
  CELL,
  OFFLINE_CAP_S,
  OFFLINE_MODAL_THRESHOLD_S,
} from '../src/config/constants';

describe('config constants', () => {
  it('exposes TICK_HZ=10 and UI_HZ=10', () => {
    expect(TICK_HZ).toBe(10);
    expect(UI_HZ).toBe(10);
  });

  it('grid is 64x64 with CELL=1', () => {
    expect(GRID_W).toBe(64);
    expect(GRID_H).toBe(64);
    expect(CELL).toBe(1);
  });

  it('offline cap is 8h and modal threshold is 60s', () => {
    expect(OFFLINE_CAP_S).toBe(8 * 3600);
    expect(OFFLINE_MODAL_THRESHOLD_S).toBe(60);
  });
});
