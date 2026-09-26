import { GRID_EXPANSION_COST } from "../content/balance";
import {
  GRID_EXPANSION_STEP,
  GRID_HEIGHT,
  GRID_MAX_SIZE,
  GRID_MIN_SIZE,
  GRID_WIDTH,
  TILE_SIZE_PX,
} from "./constants";
import type { GridDimensions, GridPoint, SimulationState } from "./types";

function assertFinitePoint(point: GridPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError("Grid coordinates must be finite");
  }
}

export function isValidGridDimension(dimension: unknown): dimension is number {
  return (
    typeof dimension === "number" &&
    Number.isInteger(dimension) &&
    dimension >= GRID_MIN_SIZE &&
    dimension <= GRID_MAX_SIZE
  );
}

export function isAlignedGridDimension(dimension: number): boolean {
  return dimension % GRID_EXPANSION_STEP === 0;
}

export function hasGridExpansionRights(state: SimulationState): boolean {
  return state.prestige.totalPrestiges > 0;
}

export function canAffordGridExpansion(state: SimulationState): boolean {
  return Number.isFinite(state.currency) && state.currency >= GRID_EXPANSION_COST;
}

export function isGridExpansionUnlocked(state: SimulationState): boolean {
  return hasGridExpansionRights(state) && canAffordGridExpansion(state);
}

export function isGridGrowth(previous: GridDimensions, next: GridDimensions): boolean {
  return (
    next.width >= previous.width &&
    next.height >= previous.height &&
    (next.width > previous.width || next.height > previous.height)
  );
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
