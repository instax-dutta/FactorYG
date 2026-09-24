import { describe, it, expect } from 'vitest';
import * as iso from '../src/render/IsoCamera';
import {
  ISO_ELEVATION_DEG,
  ISO_ROTATION_DEG,
  PAN_MARGIN,
  ZOOM_MIN,
  ZOOM_MAX,
  isoViewDirection,
  createCameraState,
  cameraPositionFrom,
  orthoFrustum,
  pan,
  panMarginFor,
  screenToGroundDelta,
  zoomAbout,
  zoomBy,
} from '../src/render/IsoCamera';

const BOUNDS = { minX: 0, minZ: 0, maxX: 63, maxZ: 63 };

describe('isometric camera', () => {
  it('uses orthographic projection at 35.264° elevation / 45° rotation', () => {
    expect(ISO_ELEVATION_DEG).toBeCloseTo(Math.atan(1 / Math.SQRT2) * (180 / Math.PI), 3);
    expect(ISO_ELEVATION_DEG).toBeCloseTo(35.264, 3);
    expect(ISO_ROTATION_DEG).toBe(45);

    // True isometric: view direction is normalized (1, 1, 1).
    const dir = isoViewDirection();
    expect(dir.x).toBeCloseTo(1 / Math.sqrt(3), 6);
    expect(dir.y).toBeCloseTo(1 / Math.sqrt(3), 6);
    expect(dir.z).toBeCloseTo(1 / Math.sqrt(3), 6);
  });

  it('caps the pan margin to a fraction of the frustum so the plot stays visible', () => {
    // The visible half-height is zoom/2, so a fixed 8-unit margin would let the
    // player pan until the whole plot is off screen once zoomed out.
    expect(panMarginFor(16)).toBeCloseTo(4, 6);
    expect(panMarginFor(ZOOM_MIN)).toBeCloseTo(1, 6);
    expect(panMarginFor(ZOOM_MAX)).toBeCloseTo(PAN_MARGIN, 6);
    for (const zoom of [ZOOM_MIN, 8, 16, 24, ZOOM_MAX]) {
      expect(panMarginFor(zoom)).toBeLessThan(zoom / 2);
    }
  });

  it('pan clamps to factory bounds + margin (does not pan to infinity)', () => {
    const start = createCameraState(BOUNDS);
    expect(start.x).toBeGreaterThanOrEqual(0);
    expect(start.x).toBeLessThanOrEqual(63);

    const moved = pan(start, 10, -10, BOUNDS);
    expect(moved.x).toBeCloseTo(start.x + 10, 6);
    expect(moved.z).toBeCloseTo(start.z - 10, 6);

    const margin = panMarginFor(start.zoom);
    const farRight = pan(start, 10_000, 0, BOUNDS);
    expect(farRight.x).toBe(63 + margin);

    const farLeft = pan(start, -10_000, -10_000, BOUNDS);
    expect(farLeft.x).toBe(0 - margin);
    expect(farLeft.z).toBe(0 - margin);
  });

  it('zoom clamps to min/max', () => {
    const start = createCameraState(BOUNDS);

    const inRange = zoomBy(start, 1);
    expect(inRange.zoom).toBeGreaterThan(ZOOM_MIN);
    expect(inRange.zoom).toBeLessThan(ZOOM_MAX);

    expect(zoomBy(start, 1_000_000).zoom).toBe(ZOOM_MAX);
    expect(zoomBy(start, -1_000_000).zoom).toBe(ZOOM_MIN);
  });

  it('zooming keeps the anchor point fixed on screen (cursor-anchored zoom)', () => {
    const wide = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
    const start = { x: 0, z: 0, zoom: 20 };
    const anchor = { x: 10, z: 0 };

    // Halving the frustum must halve the anchor's distance from the target,
    // so the world point under the cursor does not slide away.
    const zoomedIn = zoomAbout(start, 10, anchor, wide);
    expect(zoomedIn.zoom).toBe(10);
    expect(zoomedIn.x).toBeCloseTo(5, 6);
    expect(zoomedIn.z).toBeCloseTo(0, 6);

    const zoomedOut = zoomAbout(start, 40, anchor, wide);
    expect(zoomedOut.zoom).toBe(40);
    expect(zoomedOut.x).toBeCloseTo(-10, 6);
  });

  it('anchored zoom still clamps zoom and pan bounds', () => {
    const start = { x: 0, z: 0, zoom: 20 };
    const anchor = { x: 10, z: 0 };
    const wide = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };

    expect(zoomAbout(start, 0.001, anchor, wide).zoom).toBe(ZOOM_MIN);
    expect(zoomAbout(start, 10_000, anchor, wide).zoom).toBe(ZOOM_MAX);

    // Clamping the pan must still be applied around the anchor: anchoring at
    // x=0 while doubling the frustum pushes the target to x=20, past max+margin.
    const tight = { minX: 0, minZ: 0, maxX: 10, maxZ: 10 };
    const clamped = zoomAbout({ x: 10, z: 10, zoom: 20 }, 40, { x: 0, z: 10 }, tight);
    expect(clamped.x).toBe(10 + panMarginFor(40));
    expect(clamped.zoom).toBe(40);
  });

  it('converts a screen drag into the ground-plane pan that keeps content under the cursor', () => {
    const worldPerPx = 16 / 720;

    // 90px right is two world units along the camera's screen-right axis.
    const horizontal = screenToGroundDelta(90, 0, worldPerPx);
    expect(horizontal.x).toBeCloseTo(Math.SQRT2, 6);
    expect(horizontal.z).toBeCloseTo(-Math.SQRT2, 6);

    // Vertically the ground is foreshortened by sin(35.264deg) = 1/sqrt(3), so a
    // 120px drag needs 120 / (45 * 0.5774) = 4.62 world units to track 1:1.
    const vertical = screenToGroundDelta(0, 120, worldPerPx);
    expect(vertical.x).toBeCloseTo(3.266, 3);
    expect(vertical.z).toBeCloseTo(3.266, 3);

    expect(screenToGroundDelta(0, 0, worldPerPx)).toEqual({ x: 0, z: 0 });
  });

  it('places the camera along the iso view direction at distance from target', () => {
    const pos = cameraPositionFrom({ x: 10, z: 20 }, Math.sqrt(3));
    expect(pos.x).toBeCloseTo(11, 6);
    expect(pos.y).toBeCloseTo(1, 6);
    expect(pos.z).toBeCloseTo(21, 6);
  });

  it('computes orthographic frustum half-extents from zoom + aspect', () => {
    const f = orthoFrustum(10, 2);
    expect(f.top - f.bottom).toBeCloseTo(10, 6);
    expect(f.right - f.left).toBeCloseTo(20, 6);
    expect(f.left).toBeCloseTo(-f.right, 6);
    expect(f.bottom).toBeCloseTo(-f.top, 6);
  });

  it('exposes no orbit API (fixed angle is a deliberate readability choice)', () => {
    expect('orbit' in iso).toBe(false);
    expect('rotate' in iso).toBe(false);
  });
});
