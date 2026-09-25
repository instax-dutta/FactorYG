import { describe, expect, it } from "vitest";
import { nextRotation, rotateGridPoint, rotatePoint } from "../../src/sim/rotation";

describe("rotation", () => {
  it("rotates local grid points clockwise in 90 degree increments", () => {
    expect(rotateGridPoint({ x: 0, y: -1 }, 90)).toEqual({ x: 1, y: 0 });
    expect(rotateGridPoint({ x: 1, y: 0 }, 270)).toEqual({ x: 0, y: -1 });
  });

  it("rotates points through all four orientations", () => {
    const point = { x: 2, y: -3 };

    expect(rotatePoint(point, 0)).toEqual(point);
    expect(rotatePoint(point, 90)).toEqual({ x: 3, y: 2 });
    expect(rotatePoint(point, 180)).toEqual({ x: -2, y: 3 });
    expect(rotatePoint(point, 270)).toEqual({ x: -3, y: -2 });
  });

  it("cycles through all four rotations", () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(90)).toBe(180);
    expect(nextRotation(180)).toBe(270);
    expect(nextRotation(270)).toBe(0);
  });
});
