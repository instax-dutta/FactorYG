import { deepFreeze } from "./freeze";

export interface AssetManifestEntry {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
}

const ASSET_ENTRIES = {
  "tile.floor": {
    path: "assets/tiles/floor.svg",
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "machine.extractor.idle": {
    path: "assets/machines/extractor-idle.svg",
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "machine.extractor.active": {
    path: "assets/machines/extractor-active.svg",
    width: 64,
    height: 64,
    frameCount: 2,
  },
  "machine.belt.idle": {
    path: "assets/machines/belt.svg",
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "resource.copperOre": {
    path: "assets/resources/copper-ore.svg",
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.ironOre": {
    path: "assets/resources/iron-ore.svg",
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "vfx.spark": {
    path: "assets/vfx/spark.svg",
    width: 16,
    height: 16,
    frameCount: 1,
  },
} as const satisfies Record<string, AssetManifestEntry>;

export type AssetKey = keyof typeof ASSET_ENTRIES;

export const ASSET_MANIFEST = deepFreeze(ASSET_ENTRIES);

export function getAssetPath(key: AssetKey): string;
export function getAssetPath(key: string): string | undefined;
export function getAssetPath(key: string): string | undefined {
  return Object.hasOwn(ASSET_MANIFEST, key) ? ASSET_MANIFEST[key as AssetKey].path : undefined;
}
