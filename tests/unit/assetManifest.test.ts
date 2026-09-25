import { describe, expect, it } from "vitest";
import { ASSET_MANIFEST, getAssetPath } from "../../src/content/assetManifest";

describe("asset manifest", () => {
  it("registers unique 64 by 64 assets for the art spike", () => {
    const keys = Object.keys(ASSET_MANIFEST);

    expect(new Set(keys).size).toBe(keys.length);
    expect(ASSET_MANIFEST["machine.extractor.idle"].width).toBe(64);
    expect(ASSET_MANIFEST["machine.extractor.idle"].height).toBe(64);
    expect(ASSET_MANIFEST["machine.extractor.active"].frameCount).toBe(2);
    expect(ASSET_MANIFEST["resource.copperOre"].width).toBe(32);
    expect(getAssetPath("machine.belt.idle")).toMatch(/^assets\/machines\//);
  });

  it("records exact metadata for every first-spike asset", () => {
    expect(ASSET_MANIFEST).toEqual({
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
    });
  });

  it("deeply freezes every manifest entry", () => {
    expect(Object.isFrozen(ASSET_MANIFEST)).toBe(true);
    for (const entry of Object.values(ASSET_MANIFEST)) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it("returns a registered path and safely handles an unknown key", () => {
    expect(getAssetPath("resource.ironOre")).toBe("assets/resources/iron-ore.svg");
    expect(getAssetPath("missing.asset")).toBeUndefined();
  });
});
