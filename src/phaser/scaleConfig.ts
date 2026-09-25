import type Phaser from "phaser";

export const DEFAULT_SURFACE_WIDTH = 1280;
export const DEFAULT_SURFACE_HEIGHT = 720;
export const PHASER_SCALE_FIT = 3 as Phaser.Scale.ScaleModeType;
export const PHASER_SCALE_CENTER_BOTH = 1 as Phaser.Scale.CenterType;

export interface ScaleConfig {
  width: number;
  height: number;
  mode: Phaser.Scale.ScaleModeType;
  autoCenter: Phaser.Scale.CenterType;
}

function normalizeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createScaleConfig(width: number, height: number): ScaleConfig {
  return {
    width: normalizeDimension(width, DEFAULT_SURFACE_WIDTH),
    height: normalizeDimension(height, DEFAULT_SURFACE_HEIGHT),
    mode: PHASER_SCALE_FIT,
    autoCenter: PHASER_SCALE_CENTER_BOTH,
  };
}
