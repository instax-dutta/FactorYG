import { deepFreeze } from "./freeze";

export interface AssetManifestEntry {
  readonly path: string;
  readonly framePaths: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
}

const ASSET_ENTRIES = {
  "tile.floor": {
    path: "assets/tiles/floor.svg",
    framePaths: ["assets/tiles/floor.svg"],
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "machine.extractor.idle": {
    path: "assets/machines/extractor-idle.svg",
    framePaths: ["assets/machines/extractor-idle.svg"],
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "machine.extractor.active": {
    path: "assets/machines/extractor-active.svg",
    framePaths: [
      "assets/machines/extractor-active.svg",
      "assets/machines/extractor-active-1.svg",
    ],
    width: 64,
    height: 64,
    frameCount: 2,
  },
  "machine.belt.idle": {
    path: "assets/machines/belt.svg",
    framePaths: ["assets/machines/belt.svg"],
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "resource.copperOre": {
    path: "assets/resources/copper-ore.svg",
    framePaths: ["assets/resources/copper-ore.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.ironOre": {
    path: "assets/resources/iron-ore.svg",
    framePaths: ["assets/resources/iron-ore.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "vfx.spark": {
    path: "assets/vfx/spark.svg",
    framePaths: ["assets/vfx/spark.svg"],
    width: 16,
    height: 16,
    frameCount: 1,
  },
} as const satisfies Record<string, AssetManifestEntry>;

export type AssetKey = keyof typeof ASSET_ENTRIES;

export const ASSET_MANIFEST = deepFreeze(ASSET_ENTRIES);

function getAssetEntry(key: string): AssetManifestEntry | undefined {
  return Object.hasOwn(ASSET_MANIFEST, key) ? ASSET_MANIFEST[key as AssetKey] : undefined;
}

export function getAssetPath(key: AssetKey): string;
export function getAssetPath(key: string): string | undefined;
export function getAssetPath(key: string): string | undefined {
  return getAssetEntry(key)?.framePaths[0];
}

export function getAssetPaths(key: AssetKey): readonly string[];
export function getAssetPaths(key: string): readonly string[] | undefined;
export function getAssetPaths(key: string): readonly string[] | undefined {
  return getAssetEntry(key)?.framePaths;
}
