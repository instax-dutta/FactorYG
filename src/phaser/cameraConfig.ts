import { TILE_SIZE_PX } from "../sim/constants";

export const CAMERA_MARGIN_PX = 256;
export const CAMERA_MIN_ZOOM = 0.5;
export const CAMERA_MAX_ZOOM = 2;
export const CAMERA_INITIAL_ZOOM = 1;

export interface CameraConfig {
  boundsWidth: number;
  boundsHeight: number;
  minZoom: number;
  maxZoom: number;
  initialZoom: number;
}

export function createCameraConfig(width: number, height: number): CameraConfig {
  return {
    boundsWidth: width * TILE_SIZE_PX + CAMERA_MARGIN_PX,
    boundsHeight: height * TILE_SIZE_PX + CAMERA_MARGIN_PX,
    minZoom: CAMERA_MIN_ZOOM,
    maxZoom: CAMERA_MAX_ZOOM,
    initialZoom: CAMERA_INITIAL_ZOOM,
  };
}
