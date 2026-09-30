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
    path: "assets/machines/belt-idle.svg",
    framePaths: ["assets/machines/belt-idle.svg"],
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "machine.belt.active": {
    path: "assets/machines/belt-active.svg",
    framePaths: [
      "assets/machines/belt-active.svg",
      "assets/machines/belt-active-1.svg",
    ],
    width: 64,
    height: 64,
    frameCount: 2,
  },
  "machine.depot.idle": {
    path: "assets/machines/depot-idle.svg",
    framePaths: ["assets/machines/depot-idle.svg"],
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "machine.depot.active": {
    path: "assets/machines/depot-active.svg",
    framePaths: [
      "assets/machines/depot-active.svg",
      "assets/machines/depot-active-1.svg",
    ],
    width: 64,
    height: 64,
    frameCount: 2,
  },
  "machine.smelter.idle": {
    path: "assets/machines/smelter-idle.svg",
    framePaths: ["assets/machines/smelter-idle.svg"],
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "machine.smelter.active": {
    path: "assets/machines/smelter-active.svg",
    framePaths: [
      "assets/machines/smelter-active.svg",
      "assets/machines/smelter-active-1.svg",
    ],
    width: 64,
    height: 64,
    frameCount: 2,
  },
  "machine.assembler.idle": {
    path: "assets/machines/assembler-idle.svg",
    framePaths: ["assets/machines/assembler-idle.svg"],
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "machine.assembler.active": {
    path: "assets/machines/assembler-active.svg",
    framePaths: [
      "assets/machines/assembler-active.svg",
      "assets/machines/assembler-active-1.svg",
    ],
    width: 64,
    height: 64,
    frameCount: 2,
  },
  "machine.silo.idle": {
    path: "assets/machines/silo-idle.svg",
    framePaths: ["assets/machines/silo-idle.svg"],
    width: 64,
    height: 64,
    frameCount: 1,
  },
  "machine.silo.active": {
    path: "assets/machines/silo-active.svg",
    framePaths: [
      "assets/machines/silo-active.svg",
      "assets/machines/silo-active-1.svg",
    ],
    width: 64,
    height: 64,
    frameCount: 2,
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
  "resource.coal": {
    path: "assets/resources/coal.svg",
    framePaths: ["assets/resources/coal.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.stone": {
    path: "assets/resources/stone.svg",
    framePaths: ["assets/resources/stone.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.copperIngot": {
    path: "assets/resources/copper-ingot.svg",
    framePaths: ["assets/resources/copper-ingot.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.ironIngot": {
    path: "assets/resources/iron-ingot.svg",
    framePaths: ["assets/resources/iron-ingot.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.refinedStone": {
    path: "assets/resources/refined-stone.svg",
    framePaths: ["assets/resources/refined-stone.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.wire": {
    path: "assets/resources/wire.svg",
    framePaths: ["assets/resources/wire.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.gear": {
    path: "assets/resources/gear.svg",
    framePaths: ["assets/resources/gear.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.plate": {
    path: "assets/resources/plate.svg",
    framePaths: ["assets/resources/plate.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.circuit": {
    path: "assets/resources/circuit.svg",
    framePaths: ["assets/resources/circuit.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.frame": {
    path: "assets/resources/frame.svg",
    framePaths: ["assets/resources/frame.svg"],
    width: 32,
    height: 32,
    frameCount: 1,
  },
  "resource.motor": {
    path: "assets/resources/motor.svg",
    framePaths: ["assets/resources/motor.svg"],
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
  "vfx.heat": {
    path: "assets/vfx/heat.svg",
    framePaths: ["assets/vfx/heat.svg"],
    width: 16,
    height: 16,
    frameCount: 1,
  },
  "vfx.coin": {
    path: "assets/vfx/coin.svg",
    framePaths: ["assets/vfx/coin.svg"],
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
