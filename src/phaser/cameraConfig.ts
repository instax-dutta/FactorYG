import { TILE_SIZE_PX } from "../sim/constants";

export interface CameraConfig {
  boundsWidth: number;
  boundsHeight: number;
  minZoom: number;
  maxZoom: number;
  initialZoom: number;
}

const CAMERA_MARGIN_PX = 256;

export function createCameraConfig(width: number, height: number): CameraConfig {
  return {
    boundsWidth: width * TILE_SIZE_PX + CAMERA_MARGIN_PX,
    boundsHeight: height * TILE_SIZE_PX + CAMERA_MARGIN_PX,
    minZoom: 0.5,
    maxZoom: 2,
    initialZoom: 1,
  };
}
