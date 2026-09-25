import { describe, expect, it } from "vitest";
import {
  createScaleConfig,
  DEFAULT_SURFACE_HEIGHT,
  DEFAULT_SURFACE_WIDTH,
  MIN_SURFACE_HEIGHT,
  MIN_SURFACE_WIDTH,
} from "../../src/phaser/scaleConfig";

describe("scale configuration", () => {
  it.each([0, Number.NaN, -1])("uses desktop defaults for invalid dimensions %s", (invalid) => {
    const config = createScaleConfig(invalid, invalid);

    expect(config.width).toBe(DEFAULT_SURFACE_WIDTH);
    expect(config.height).toBe(DEFAULT_SURFACE_HEIGHT);
    expect(config.width).toBeGreaterThan(0);
    expect(config.height).toBeGreaterThan(0);
  });

  it("raises positive dimensions below the minimum surface floor", () => {
    const config = createScaleConfig(1, 1);

    expect(MIN_SURFACE_WIDTH).toBe(640);
    expect(MIN_SURFACE_HEIGHT).toBe(360);
    expect(config.width).toBe(MIN_SURFACE_WIDTH);
    expect(config.height).toBe(MIN_SURFACE_HEIGHT);
  });

  it("preserves normal finite dimensions", () => {
    const config = createScaleConfig(1440, 900);

    expect(config.width).toBe(1440);
    expect(config.height).toBe(900);
  });

  it("uses the literal Phaser 3.90 centered FIT values", () => {
    const config = createScaleConfig(1280, 720);

    expect(config.mode).toBe(3);
    expect(config.autoCenter).toBe(1);
  });
});
