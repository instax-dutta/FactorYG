import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE_PX } from "./constants";
import type { GridPoint } from "./types";

function assertFinitePoint(point: GridPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError("Grid coordinates must be finite");
  }
}

export function isInsideGrid(point: GridPoint, width = GRID_WIDTH, height = GRID_HEIGHT): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x < width &&
    point.y >= 0 &&
    point.y < height
  );
}

export function cellToWorld(point: GridPoint, tileSizePx = TILE_SIZE_PX): GridPoint {
  assertFinitePoint(point);

  return {
    x: point.x * tileSizePx,
    y: point.y * tileSizePx,
  };
}

export function worldToCell(worldPoint: GridPoint, tileSizePx = TILE_SIZE_PX): GridPoint {
  assertFinitePoint(worldPoint);

  return {
    x: Math.floor(worldPoint.x / tileSizePx),
    y: Math.floor(worldPoint.y / tileSizePx),
  };
}
