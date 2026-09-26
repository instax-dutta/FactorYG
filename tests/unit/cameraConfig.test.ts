import { describe, expect, it } from "vitest";
import {
  CAMERA_INITIAL_ZOOM,
  CAMERA_MARGIN_PX,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  createCameraConfig,
} from "../../src/phaser/cameraConfig";

describe("camera configuration", () => {
  it("uses a bounded camera with the locked zoom range", () => {
    const config = createCameraConfig(64, 64);

    expect(config.boundsWidth).toBe(64 * 64 + CAMERA_MARGIN_PX);
    expect(config.boundsHeight).toBe(64 * 64 + CAMERA_MARGIN_PX);
    expect(config.minZoom).toBe(CAMERA_MIN_ZOOM);
    expect(config.maxZoom).toBe(CAMERA_MAX_ZOOM);
    expect(config.initialZoom).toBe(CAMERA_INITIAL_ZOOM);
  });

  it("exports the zoom range and the margin the config is built from", () => {
    expect(CAMERA_MIN_ZOOM).toBe(0.5);
    expect(CAMERA_MAX_ZOOM).toBe(2);
    expect(CAMERA_INITIAL_ZOOM).toBe(1);
    expect(CAMERA_MARGIN_PX).toBe(256);
  });

  it("grows the bounds with the plot so a bigger world pans further", () => {
    const expanded = createCameraConfig(96, 96);

    expect(expanded.boundsWidth).toBeGreaterThan(createCameraConfig(64, 64).boundsWidth);
    expect(expanded.boundsHeight).toBeGreaterThan(createCameraConfig(64, 64).boundsHeight);
  });
});
