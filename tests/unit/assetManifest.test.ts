import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSET_MANIFEST, getAssetPath, getAssetPaths } from "../../src/content/assetManifest";

const LOCKED_PALETTE = new Set([
  "#101820",
  "#263746",
  "#4d6875",
  "#c98245",
  "#e0a458",
  "#36c5b5",
  "#f2c14e",
]);

const EXPECTED_FRAME_PATHS = {
  "tile.floor": ["assets/tiles/floor.svg"],
  "machine.extractor.idle": ["assets/machines/extractor-idle.svg"],
  "machine.extractor.active": [
    "assets/machines/extractor-active.svg",
    "assets/machines/extractor-active-1.svg",
  ],
  "machine.belt.idle": ["assets/machines/belt.svg"],
  "resource.copperOre": ["assets/resources/copper-ore.svg"],
  "resource.ironOre": ["assets/resources/iron-ore.svg"],
  "vfx.spark": ["assets/vfx/spark.svg"],
} as const;

function readAsset(path: string): string {
  const file = resolve(process.cwd(), "public", path);
  expect(existsSync(file)).toBe(true);
  return readFileSync(file, "utf8");
}

function expectValidSvg(path: string, width: number, height: number): void {
  const svg = readAsset(path);

  expect(svg).toContain(`width="${width}"`);
  expect(svg).toContain(`height="${height}"`);
  expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
  expect(svg).not.toContain("<!--");
  expect(svg).not.toContain("-->");
  expect(svg).not.toMatch(/drop-shadow|feGaussianBlur|feOffset|<filter/i);
  expect(svg).not.toMatch(/<animate\b/i);

  for (const color of svg.match(/#[0-9a-f]{6}/gi) ?? []) {
    expect(LOCKED_PALETTE.has(color.toLowerCase())).toBe(true);
  }
}

describe("asset manifest", () => {
  it("registers real, dimensioned asset files and separate active frames", () => {
    const keys = Object.keys(ASSET_MANIFEST);

    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.fromEntries(Object.entries(ASSET_MANIFEST).map(([key, entry]) => [key, entry.framePaths]))).toEqual(
      EXPECTED_FRAME_PATHS,
    );

    for (const [key, entry] of Object.entries(ASSET_MANIFEST)) {
      expect(entry.path).toBe(entry.framePaths[0]);
      expect(entry.frameCount).toBe(entry.framePaths.length);
      expect(new Set(entry.framePaths).size).toBe(entry.framePaths.length);
      expect(getAssetPaths(key)).toEqual(entry.framePaths);

      for (const path of entry.framePaths) {
        expectValidSvg(path, entry.width, entry.height);
      }
    }

    expect(ASSET_MANIFEST["machine.extractor.active"].frameCount).toBe(2);
    expect(getAssetPaths("machine.extractor.active")).toEqual([
      "assets/machines/extractor-active.svg",
      "assets/machines/extractor-active-1.svg",
    ]);
    expect(getAssetPath("machine.belt.idle")).toBe("assets/machines/belt.svg");
  });

  it("deeply freezes the manifest and every frame path list", () => {
    expect(Object.isFrozen(ASSET_MANIFEST)).toBe(true);

    for (const entry of Object.values(ASSET_MANIFEST)) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.framePaths)).toBe(true);
      expect(Reflect.set(entry.framePaths, 0, "assets/missing.svg")).toBe(false);
    }
  });

  it("returns the first frame through the compatibility accessor and handles unknown keys", () => {
    expect(getAssetPath("machine.extractor.active")).toBe("assets/machines/extractor-active.svg");
    expect(getAssetPaths("machine.extractor.active")).toEqual([
      "assets/machines/extractor-active.svg",
      "assets/machines/extractor-active-1.svg",
    ]);
    expect(getAssetPath("missing.asset")).toBeUndefined();
    expect(getAssetPaths("missing.asset")).toBeUndefined();
  });
});
