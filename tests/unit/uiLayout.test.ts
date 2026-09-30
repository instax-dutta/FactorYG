import { describe, expect, it } from "vitest";
import {
  LEFT_RAIL_GAP,
  LEFT_RAIL_INSPECTOR_MAX_HEIGHT,
  LEFT_RAIL_LEFT,
  LEFT_RAIL_TOP,
  LEFT_RAIL_TOGGLE_TOP,
  LEFT_RAIL_WIDTH,
} from "../../src/ui/layout";

describe("the left rail overlay geometry", () => {
  it("keeps a bounded inspector clear of the tech tree toggle below it", () => {
    const inspectorBottom = LEFT_RAIL_TOP + LEFT_RAIL_INSPECTOR_MAX_HEIGHT;

    expect(inspectorBottom).toBeLessThan(LEFT_RAIL_TOGGLE_TOP);
    expect(LEFT_RAIL_TOGGLE_TOP - inspectorBottom).toBe(LEFT_RAIL_GAP);
  });

  it("gives the inspector a bounded height rather than a content-driven one", () => {
    expect(LEFT_RAIL_INSPECTOR_MAX_HEIGHT).toBeGreaterThan(0);
    expect(Number.isFinite(LEFT_RAIL_INSPECTOR_MAX_HEIGHT)).toBe(true);
  });

  it("stacks the inspector and the toggle on one left edge at one width", () => {
    expect(LEFT_RAIL_TOP).toBeLessThan(LEFT_RAIL_TOGGLE_TOP);
    expect(LEFT_RAIL_GAP).toBeGreaterThan(0);
    expect(LEFT_RAIL_WIDTH).toBeGreaterThan(0);
    expect(LEFT_RAIL_LEFT).toBeGreaterThan(0);
  });
});
