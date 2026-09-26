export const FLOOR_TILE_INDEX = 1;

export function createFloorTileData(width: number, height: number): number[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => FLOOR_TILE_INDEX),
  );
}
