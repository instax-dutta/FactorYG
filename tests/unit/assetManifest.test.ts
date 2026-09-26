import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSET_MANIFEST, getAssetPath, getAssetPaths } from "../../src/content/assetManifest";
import { getMachine, MACHINES } from "../../src/content/machines";
import { RESOURCES } from "../../src/content/resources";

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
  "machine.belt.idle": ["assets/machines/belt-idle.svg"],
  "machine.belt.active": [
    "assets/machines/belt-active.svg",
    "assets/machines/belt-active-1.svg",
  ],
  "machine.depot.idle": ["assets/machines/depot-idle.svg"],
  "machine.depot.active": [
    "assets/machines/depot-active.svg",
    "assets/machines/depot-active-1.svg",
  ],
  "machine.smelter.idle": ["assets/machines/smelter-idle.svg"],
  "machine.smelter.active": [
    "assets/machines/smelter-active.svg",
    "assets/machines/smelter-active-1.svg",
  ],
  "machine.assembler.idle": ["assets/machines/assembler-idle.svg"],
  "machine.assembler.active": [
    "assets/machines/assembler-active.svg",
    "assets/machines/assembler-active-1.svg",
  ],
  "machine.silo.idle": ["assets/machines/silo-idle.svg"],
  "machine.silo.active": [
    "assets/machines/silo-active.svg",
    "assets/machines/silo-active-1.svg",
  ],
  "resource.copperOre": ["assets/resources/copper-ore.svg"],
  "resource.ironOre": ["assets/resources/iron-ore.svg"],
  "resource.coal": ["assets/resources/coal.svg"],
  "resource.stone": ["assets/resources/stone.svg"],
  "resource.copperIngot": ["assets/resources/copper-ingot.svg"],
  "resource.ironIngot": ["assets/resources/iron-ingot.svg"],
  "resource.refinedStone": ["assets/resources/refined-stone.svg"],
  "resource.wire": ["assets/resources/wire.svg"],
  "resource.gear": ["assets/resources/gear.svg"],
  "resource.plate": ["assets/resources/plate.svg"],
  "resource.circuit": ["assets/resources/circuit.svg"],
  "resource.frame": ["assets/resources/frame.svg"],
  "resource.motor": ["assets/resources/motor.svg"],
  "vfx.spark": ["assets/vfx/spark.svg"],
} as const;

const MACHINE_TILE_SIZE = 64;
const RESOURCE_ICON_SIZE = 32;

const ANIMATED_MACHINES = [
  "extractor",
  "belt",
  "smelter",
  "assembler",
  "silo",
  "depot",
] as const;

const EXPECTED_MACHINE_FRAMES = {
  extractor: { idle: 1, active: 2 },
  belt: { idle: 1, active: 2 },
  smelter: { idle: 1, active: 2 },
  assembler: { idle: 1, active: 2 },
  silo: { idle: 1, active: 2 },
  depot: { idle: 1, active: 2 },
} as const;

function readAsset(path: string): string {
  const file = resolve(process.cwd(), "public", path);
  expect(existsSync(file)).toBe(true);
  return readFileSync(file, "utf8");
}

const PORT_MARKER_MIN_RADIUS = 2;
const PORT_MARKER_MAX_RADIUS = 3.5;

function readPortMarkerFills(path: string): Map<string, string> {
  const svg = readAsset(path);
  const markers = new Map<string, string>();

  for (const tag of svg.match(/<circle\b[^>]*>/g) ?? []) {
    const cx = /\bcx="([\d.]+)"/.exec(tag)?.[1];
    const cy = /\bcy="([\d.]+)"/.exec(tag)?.[1];
    const r = /\br="([\d.]+)"/.exec(tag)?.[1];
    const fill = /\bfill="(#[0-9a-fA-F]{6})"/.exec(tag)?.[1];
    if (cx === undefined || cy === undefined || r === undefined || fill === undefined) {
      continue;
    }

    const radius = Number(r);
    if (radius < PORT_MARKER_MIN_RADIUS || radius > PORT_MARKER_MAX_RADIUS) {
      continue;
    }

    markers.set(`${cx},${cy},${r}`, fill.toLowerCase());
  }

  return markers;
}

function machineFrames(spriteKey: string, activeSpriteKey: string | undefined): string[] {
  const idle = ASSET_MANIFEST[spriteKey as keyof typeof ASSET_MANIFEST];
  const active = ASSET_MANIFEST[(activeSpriteKey ?? "") as keyof typeof ASSET_MANIFEST];
  return [...idle.framePaths, ...active.framePaths];
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
    expect(getAssetPath("machine.belt.idle")).toBe("assets/machines/belt-idle.svg");
    expect(getAssetPath("machine.depot.idle")).toBe("assets/machines/depot-idle.svg");
  });

  it("registers an idle frame and an animated active frame set for every machine", () => {
    for (const machine of ANIMATED_MACHINES) {
      const definition = getMachine(machine);
      if (definition === undefined) {
        throw new Error(`Missing machine definition for ${machine}`);
      }

      const idle = ASSET_MANIFEST[definition.spriteKey as keyof typeof ASSET_MANIFEST];
      const active = ASSET_MANIFEST[(definition.activeSpriteKey ?? "") as keyof typeof ASSET_MANIFEST];
      const expected = EXPECTED_MACHINE_FRAMES[machine];

      expect(idle, `${machine} idle art`).toBeDefined();
      expect(active, `${machine} active art`).toBeDefined();
      expect(idle.frameCount).toBe(expected.idle);
      expect(active.frameCount).toBe(expected.active);
      expect(active.path).not.toBe(idle.path);
      expect(active.framePaths[0]).not.toBe(idle.path);
      expect(new Set([...idle.framePaths, ...active.framePaths]).size).toBe(
        idle.frameCount + active.frameCount,
      );
    }
  });

  it("registers a 64 by 64 tile for every machine art key in the machine table", () => {
    const missing: string[] = [];
    const offConvention: string[] = [];

    for (const machine of Object.values(MACHINES)) {
      for (const key of [machine.spriteKey, machine.activeSpriteKey ?? ""]) {
        const entry = ASSET_MANIFEST[key as keyof typeof ASSET_MANIFEST];
        if (entry === undefined) {
          missing.push(`${machine.type} -> ${key}`);
          continue;
        }
        if (entry.width !== MACHINE_TILE_SIZE || entry.height !== MACHINE_TILE_SIZE) {
          offConvention.push(`${key} is ${entry.width} by ${entry.height}`);
        }
      }
    }

    expect(missing, `machine art keys with no manifest entry: ${missing.join(", ")}`).toEqual([]);
    expect(
      offConvention,
      `machine art keys off the ${MACHINE_TILE_SIZE} by ${MACHINE_TILE_SIZE} tile convention: ${offConvention.join(", ")}`,
    ).toEqual([]);
  });

  it("registers one distinct 32 by 32 icon for every resource in the resource table", () => {
    const missing: string[] = [];
    const offConvention: string[] = [];
    const paths: string[] = [];

    for (const resource of Object.values(RESOURCES)) {
      const entry = ASSET_MANIFEST[resource.iconKey as keyof typeof ASSET_MANIFEST];
      if (entry === undefined) {
        missing.push(`${resource.id} -> ${resource.iconKey}`);
        continue;
      }
      if (entry.width !== RESOURCE_ICON_SIZE || entry.height !== RESOURCE_ICON_SIZE) {
        offConvention.push(`${resource.iconKey} is ${entry.width} by ${entry.height}`);
      }
      if (entry.frameCount !== 1) {
        offConvention.push(`${resource.iconKey} has ${entry.frameCount} frames`);
      }
      paths.push(...entry.framePaths);
    }

    expect(
      new Set(paths).size,
      `resource icons must resolve to distinct files: ${paths.join(", ")}`,
    ).toBe(paths.length);
    expect(missing, `resource icon keys with no manifest entry: ${missing.join(", ")}`).toEqual([]);
    expect(
      offConvention,
      `resource icons off the ${RESOURCE_ICON_SIZE} by ${RESOURCE_ICON_SIZE} single-frame convention: ${offConvention.join(", ")}`,
    ).toEqual([]);
  });

  it("resolves every file the manifest names to a real file on disk", () => {
    const named = Object.values(ASSET_MANIFEST).flatMap((entry) => entry.framePaths);
    const missing = named.filter((path) => !existsSync(resolve(process.cwd(), "public", path)));

    expect(missing, `manifest names files that do not exist: ${missing.join(", ")}`).toEqual([]);
  });

  it("holds every port marker colour steady across all frames of a machine with ports on both sides", () => {
    const recoloured: string[] = [];
    const moved: string[] = [];
    const unmarked: string[] = [];

    for (const machine of Object.values(MACHINES)) {
      const bidirectional =
        machine.ports.some((port) => port.kind === "input") &&
        machine.ports.some((port) => port.kind === "output");
      if (!bidirectional) {
        continue;
      }

      const frames = machineFrames(machine.spriteKey, machine.activeSpriteKey);
      const reference = readPortMarkerFills(frames[0]);
      const referencePath = frames[0];

      if (reference.size === 0) {
        unmarked.push(`${machine.type} has no port markers in ${referencePath}`);
        continue;
      }

      for (const frame of frames.slice(1)) {
        const markers = readPortMarkerFills(frame);

        for (const [position, fill] of reference) {
          const seen = markers.get(position);
          if (seen === undefined) {
            moved.push(`${machine.type} marker at ${position} is absent from ${frame}`);
          } else if (seen !== fill) {
            recoloured.push(
              `${machine.type} marker at ${position} is ${fill} in ${referencePath} and ${seen} in ${frame}`,
            );
          }
        }

        for (const position of markers.keys()) {
          if (!reference.has(position)) {
            moved.push(`${machine.type} marker at ${position} appears only in ${frame}`);
          }
        }
      }
    }

    expect(unmarked, `machines with no port markers to hold steady: ${unmarked.join(", ")}`).toEqual([]);
    expect(moved, `port markers that move between frames: ${moved.join(", ")}`).toEqual([]);
    expect(
      recoloured,
      `port markers that change colour between frames, which would swap a machine's facing: ${recoloured.join(", ")}`,
    ).toEqual([]);
  });

  it("registers one distinct icon per raw resource", () => {
    expect(ASSET_MANIFEST["resource.copperOre"].frameCount).toBe(1);
    expect(ASSET_MANIFEST["resource.ironOre"].frameCount).toBe(1);
    expect(ASSET_MANIFEST["resource.copperOre"].path).not.toBe(
      ASSET_MANIFEST["resource.ironOre"].path,
    );
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
    expect(getAssetPath("machine.belt.active")).toBe("assets/machines/belt-active.svg");
    expect(getAssetPath("machine.depot.active")).toBe("assets/machines/depot-active.svg");
    expect(getAssetPath("missing.asset")).toBeUndefined();
    expect(getAssetPaths("missing.asset")).toBeUndefined();
  });
});
