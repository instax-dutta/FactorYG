import { describe, it, expect } from 'vitest';
import {
  worldToCell,
  cellToWorld,
  canPlace,
  type PlacementContext,
} from '../src/sim/placement';

const ctx: PlacementContext = { width: 64, height: 64, isOccupied: () => false };

describe('placement validity', () => {
  it('snaps world coords to grid cell', () => {
    // Cell n spans [n - 0.5, n + 0.5), so cells are centred on integer coords.
    expect(worldToCell(0.2, 0.9)).toEqual({ x: 0, y: 1 });
    expect(worldToCell(2.4, 3.4)).toEqual({ x: 2, y: 3 });
    expect(worldToCell(-0.6, -1.6)).toEqual({ x: -1, y: -2 });

    const cell = worldToCell(12.4, 5.6);
    const world = cellToWorld(cell);
    expect(worldToCell(world.x, world.z)).toEqual(cell);
  });

  it('rejects out-of-bounds cell', () => {
    expect(canPlace({ x: -1, y: 0 }, ctx)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(canPlace({ x: 64, y: 0 }, ctx)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(canPlace({ x: 0, y: 64 }, ctx)).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('rejects occupied cell', () => {
    const occupied: PlacementContext = {
      ...ctx,
      isOccupied: (cell) => cell.x === 10 && cell.y === 12,
    };
    expect(canPlace({ x: 10, y: 12 }, occupied)).toEqual({ ok: false, reason: 'occupied' });
    expect(canPlace({ x: 11, y: 12 }, occupied).ok).toBe(true);
  });

  it('accepts a valid empty in-bounds cell', () => {
    expect(canPlace({ x: 63, y: 63 }, ctx)).toEqual({ ok: true });
    expect(canPlace({ x: 0, y: 0 }, ctx)).toEqual({ ok: true });
  });
});
