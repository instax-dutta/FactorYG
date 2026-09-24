import { CELL } from '../config/constants';

/** atan(1/sqrt(2)) — the true isometric elevation. No orbit API by design. */
export const ISO_ELEVATION_DEG = Math.atan(1 / Math.SQRT2) * (180 / Math.PI);
export const ISO_ROTATION_DEG = 45;

/** Pan is clamped to the factory bounds plus this margin, never to infinity. */
export const PAN_MARGIN = 8;

export const ZOOM_MIN = 4;
export const ZOOM_MAX = 40;
export const ZOOM_DEFAULT = 16;

export interface GridBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface CameraState {
  /** Look-at target on the ground plane, in world units. */
  x: number;
  z: number;
  /** Half-height of the orthographic frustum, in world units. */
  zoom: number;
}

export function boundsFromGrid(width: number, height: number): GridBounds {
  return { minX: 0, minZ: 0, maxX: (width - 1) * CELL, maxZ: (height - 1) * CELL };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * How far past the plot edge the camera may pan. Capped to a quarter of the
 * frustum height: the visible half-height is `zoom / 2`, so a fixed margin
 * would let the player pan until the factory is entirely off screen.
 */
export function panMarginFor(zoom: number): number {
  return Math.min(PAN_MARGIN, zoom / 4);
}

export function createCameraState(bounds: GridBounds, zoom = ZOOM_DEFAULT): CameraState {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
    zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX),
  };
}

export function pan(state: CameraState, dx: number, dz: number, bounds: GridBounds): CameraState {
  const margin = panMarginFor(state.zoom);
  return {
    ...state,
    x: clamp(state.x + dx, bounds.minX - margin, bounds.maxX + margin),
    z: clamp(state.z + dz, bounds.minZ - margin, bounds.maxZ + margin),
  };
}

export function zoomBy(state: CameraState, delta: number): CameraState {
  return { ...state, zoom: clamp(state.zoom + delta, ZOOM_MIN, ZOOM_MAX) };
}

/**
 * Zoom while keeping the ground point under the cursor pinned to the cursor:
 * the target's distance to the anchor scales with the frustum, so the anchor's
 * screen offset is unchanged.
 */
export function zoomAbout(
  state: CameraState,
  nextZoom: number,
  anchor: { x: number; z: number },
  bounds: GridBounds,
): CameraState {
  const zoom = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
  const scale = zoom / state.zoom;
  const margin = panMarginFor(zoom);
  return {
    x: clamp(anchor.x - (anchor.x - state.x) * scale, bounds.minX - margin, bounds.maxX + margin),
    z: clamp(anchor.z - (anchor.z - state.z) * scale, bounds.minZ - margin, bounds.maxZ + margin),
    zoom,
  };
}

/** Unit vector from the camera target toward the camera (normalized 1,1,1). */
export function isoViewDirection(): { x: number; y: number; z: number } {
  const elevation = (ISO_ELEVATION_DEG * Math.PI) / 180;
  const rotation = (ISO_ROTATION_DEG * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  return {
    x: horizontal * Math.cos(rotation),
    y: Math.sin(elevation),
    z: horizontal * Math.sin(rotation),
  };
}

/** Unit ground vector pointing to screen-right. */
export function isoRightVector(): { x: number; z: number } {
  const rotation = (ISO_ROTATION_DEG * Math.PI) / 180;
  return { x: Math.cos(rotation), z: -Math.sin(rotation) };
}

/** Unit ground vector pointing to screen-up (and into the scene). */
export function isoUpGroundVector(): { x: number; z: number } {
  const rotation = (ISO_ROTATION_DEG * Math.PI) / 180;
  return { x: -Math.cos(rotation), z: -Math.sin(rotation) };
}

/**
 * Inverse projection for a screen-space drag: the ground-plane delta needed to
 * move the map 1:1 with the cursor. The vertical axis is foreshortened by
 * sin(elevation), so a naive `zoom / height` scale would lag the cursor.
 */
export function screenToGroundDelta(
  dx: number,
  dy: number,
  worldPerPx: number,
): { x: number; z: number } {
  const alongRight = dx * worldPerPx;
  const alongUp = (dy * worldPerPx) / Math.sin((ISO_ELEVATION_DEG * Math.PI) / 180);
  const right = isoRightVector();
  const up = isoUpGroundVector();
  return {
    x: right.x * alongRight - up.x * alongUp,
    z: right.z * alongRight - up.z * alongUp,
  };
}

export function cameraPositionFrom(
  target: { x: number; z: number },
  distance: number,
): { x: number; y: number; z: number } {
  const dir = isoViewDirection();
  return {
    x: target.x + dir.x * distance,
    y: dir.y * distance,
    z: target.z + dir.z * distance,
  };
}

/** Orthographic frustum half-extents. `zoom` is the frustum height in world units. */
export function orthoFrustum(
  zoom: number,
  aspect: number,
): { left: number; right: number; top: number; bottom: number } {
  const halfHeight = zoom / 2;
  const halfWidth = halfHeight * aspect;
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight };
}
