import { describe, expect, it } from "vitest";
import { createCameraConfig } from "../../src/phaser/cameraConfig";

describe("camera configuration", () => {
  it("uses a bounded camera with the locked zoom range", () => {
    const config = createCameraConfig(64, 64);

    expect(config.boundsWidth).toBe(64 * 64 + 256);
    expect(config.boundsHeight).toBe(64 * 64 + 256);
    expect(config.minZoom).toBe(0.5);
    expect(config.maxZoom).toBe(2);
    expect(config.initialZoom).toBe(1);
  });
});
