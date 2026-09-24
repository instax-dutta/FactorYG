import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GhostPreview, ghostColor } from '../src/render/GhostPreview';
import { projectPlacement } from '../src/sim/placement';

const VALID = 0x4ade80;
const AMBER = 0xfbbf24;
const INVALID = 0xf87171;

function materialColor(ghost: GhostPreview): number {
  return (ghost as unknown as { material: THREE.MeshBasicMaterial }).material.color.getHex();
}

function runColors(ghost: GhostPreview, count: number): number[] {
  const pool = (ghost as unknown as { runPool: { material: THREE.MeshBasicMaterial }[] }).runPool;
  return pool.slice(0, count).map((entry) => entry.material.color.getHex());
}

describe('GhostPreview presentation', () => {
  it('uses green, amber, and red for connected, disconnected, and invalid states', () => {
    const connected = projectPlacement('belt', { ok: true }, 'connected');
    const partial = projectPlacement('belt', { ok: true }, 'partial');
    const disconnected = projectPlacement('belt', { ok: true }, 'disconnected');
    const invalid = projectPlacement('belt', { ok: false, reason: 'occupied' }, 'connected');

    expect(ghostColor(connected)).toBe(VALID);
    expect(ghostColor(partial)).toBe(AMBER);
    expect(ghostColor(disconnected)).toBe(AMBER);
    expect(ghostColor(invalid)).toBe(INVALID);

    const ghost = new GhostPreview();
    try {
      ghost.showAt({ x: 0, y: 0 }, connected, 'belt', 90);
      expect(materialColor(ghost)).toBe(VALID);
      ghost.showAt({ x: 0, y: 0 }, { ok: true }, 'belt', 90);
      expect(materialColor(ghost)).toBe(VALID);
      ghost.showAt({ x: 0, y: 0 }, partial, 'belt', 90);
      expect(materialColor(ghost)).toBe(AMBER);
      ghost.showAt({ x: 0, y: 0 }, invalid, 'belt', 90);
      expect(materialColor(ghost)).toBe(INVALID);
    } finally {
      ghost.dispose();
    }
  });

  it('applies a distinct state to every cell in a whole run', () => {
    const cells = [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 12, y: 10 },
    ];
    const previews = [
      projectPlacement('belt', { ok: true }, 'connected'),
      projectPlacement('belt', { ok: true }, 'partial'),
      projectPlacement('belt', { ok: false, reason: 'occupied' }, 'disconnected'),
    ];
    const ghost = new GhostPreview();

    try {
      ghost.showRun(cells, 90, (cell) => previews[cells.indexOf(cell)]!);
      expect(runColors(ghost, cells.length)).toEqual([VALID, AMBER, INVALID]);
    } finally {
      ghost.dispose();
    }
  });
});
