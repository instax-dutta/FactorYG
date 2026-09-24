import { CELL } from '../config/constants';
import type { MachineType } from './machines';
import type { ConnectionQuality } from './connections';

export type { ConnectionQuality } from './connections';

export interface Cell {
  x: number;
  y: number;
}

export type PlacementError = 'occupied' | 'out-of-bounds';

export type PlacementResult = { ok: true } | { ok: false; reason: PlacementError };

export type PlaceError = 'occupied' | 'out-of-bounds' | 'no-resource-node' | 'locked';
export type PlaceCheck = { ok: true } | { ok: false; reason: PlaceError };
export type PlacementPreview = {
  check: PlaceCheck;
  connection: ConnectionQuality;
  message: string | null;
};

const MACHINE_LABELS: Record<MachineType, string> = {
  extractor: 'Extractor',
  belt: 'Belt',
  crossing: 'Crossing',
  splitter: 'Splitter',
  depot: 'Depot',
  smelter: 'Smelter',
  assembler: 'Assembler',
  silo: 'Storage Silo',
};

function placementMessage(
  type: MachineType,
  check: PlaceCheck,
  connection: ConnectionQuality,
): string | null {
  if (!check.ok) {
    switch (check.reason) {
      case 'occupied':
        return 'Cell occupied';
      case 'locked':
        return `Unlock ${MACHINE_LABELS[type]} in Tech`;
      case 'no-resource-node':
        return 'Extractor needs a resource node';
      case 'out-of-bounds':
        return 'Outside the plot';
    }
  }
  if (connection === 'connected') return null;
  return 'Disconnected - this machine will idle';
}

export function projectPlacement(
  type: MachineType,
  check: PlaceCheck,
  connection: ConnectionQuality,
): PlacementPreview;
export function projectPlacement(
  check: PlaceCheck,
  connection: ConnectionQuality,
  type: MachineType,
): PlacementPreview;
export function projectPlacement(
  first: MachineType | PlaceCheck,
  second: PlaceCheck | ConnectionQuality,
  third: ConnectionQuality | MachineType,
): PlacementPreview {
  if (typeof first === 'string') {
    const type = first;
    const check = second as PlaceCheck;
    const connection = third as ConnectionQuality;
    return { check, connection, message: placementMessage(type, check, connection) };
  }
  const type = third as MachineType;
  const connection = second as ConnectionQuality;
  return { check: first, connection, message: placementMessage(type, first, connection) };
}

export const placementPreview = projectPlacement;

export interface PlacementContext {
  width: number;
  height: number;
  isOccupied: (cell: Cell) => boolean;
}

/**
 * World coordinates are cell-centred, so a cell spans [n - 0.5, n + 0.5).
 */
export function worldToCell(worldX: number, worldZ: number): Cell {
  return {
    x: Math.floor(worldX / CELL + 0.5),
    y: Math.floor(worldZ / CELL + 0.5),
  };
}

export function cellToWorld(cell: Cell): { x: number; z: number } {
  return { x: cell.x * CELL, z: cell.y * CELL };
}

export function isInBounds(cell: Cell, ctx: PlacementContext): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < ctx.width && cell.y < ctx.height;
}

export function canPlace(cell: Cell, ctx: PlacementContext): PlacementResult {
  if (!isInBounds(cell, ctx)) return { ok: false, reason: 'out-of-bounds' };
  if (ctx.isOccupied(cell)) return { ok: false, reason: 'occupied' };
  return { ok: true };
}
