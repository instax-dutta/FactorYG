import { describe, expect, it } from "vitest";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE_PX } from "../../src/sim/constants";
import { cellToWorld, isInsideGrid, worldToCell } from "../../src/sim/grid";

describe("grid coordinates", () => {
  it("converts between cells and world pixels at 64 pixels per tile", () => {
    expect(cellToWorld({ x: 3, y: 4 }, 64)).toEqual({ x: 192, y: 256 });
    expect(worldToCell({ x: 255, y: 319 }, 64)).toEqual({ x: 3, y: 4 });
  });

  it("uses the fixed 64-pixel grid contract by default", () => {
    expect(GRID_WIDTH).toBe(64);
    expect(GRID_HEIGHT).toBe(64);
    expect(TILE_SIZE_PX).toBe(64);
    expect(cellToWorld({ x: 1, y: 2 })).toEqual({ x: 64, y: 128 });
    expect(worldToCell({ x: 64, y: 128 })).toEqual({ x: 1, y: 2 });
    expect(isInsideGrid({ x: 0, y: 0 })).toBe(true);
  });

  it("rejects coordinates on the outer boundary", () => {
    expect(isInsideGrid({ x: 64, y: 0 }, 64, 64)).toBe(false);
    expect(isInsideGrid({ x: 63, y: 63 }, 64, 64)).toBe(true);
  });

  it("floors world coordinates into cells", () => {
    expect(worldToCell({ x: -1, y: -1 }, 64)).toEqual({ x: -1, y: -1 });
    expect(worldToCell({ x: 191.9, y: 255.9 }, 64)).toEqual({ x: 2, y: 3 });
  });

  it("rejects non-finite grid coordinates", () => {
    expect(isInsideGrid({ x: Number.NaN, y: 0 }, 64, 64)).toBe(false);
    expect(isInsideGrid({ x: 0, y: Number.POSITIVE_INFINITY }, 64, 64)).toBe(false);
  });

  it("throws a TypeError when converting non-finite coordinates", () => {
    expect(() => cellToWorld({ x: Number.NaN, y: 0 }, 64)).toThrow(TypeError);
    expect(() => cellToWorld({ x: 0, y: Number.NEGATIVE_INFINITY }, 64)).toThrow(TypeError);
    expect(() => worldToCell({ x: Number.POSITIVE_INFINITY, y: 0 }, 64)).toThrow(TypeError);
    expect(() => worldToCell({ x: 0, y: Number.NaN }, 64)).toThrow(TypeError);
  });
});
