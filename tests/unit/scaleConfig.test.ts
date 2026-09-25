import { describe, expect, it } from "vitest";
import {
  createScaleConfig,
  DEFAULT_SURFACE_HEIGHT,
  DEFAULT_SURFACE_WIDTH,
  PHASER_SCALE_CENTER_BOTH,
  PHASER_SCALE_FIT,
} from "../../src/phaser/scaleConfig";

describe("scale configuration", () => {
  it.each([0, Number.NaN, -1])("uses desktop defaults for invalid dimensions %s", (invalid) => {
    const config = createScaleConfig(invalid, invalid);

    expect(config.width).toBe(DEFAULT_SURFACE_WIDTH);
    expect(config.height).toBe(DEFAULT_SURFACE_HEIGHT);
    expect(config.width).toBeGreaterThan(0);
    expect(config.height).toBeGreaterThan(0);
  });

  it("preserves normal finite dimensions", () => {
    const config = createScaleConfig(1440, 900);

    expect(config.width).toBe(1440);
    expect(config.height).toBe(900);
  });

  it("uses centered FIT scaling", () => {
    const config = createScaleConfig(1280, 720);

    expect(config.mode).toBe(PHASER_SCALE_FIT);
    expect(config.autoCenter).toBe(PHASER_SCALE_CENTER_BOTH);
  });
});
