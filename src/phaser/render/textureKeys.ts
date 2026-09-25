import { ASSET_MANIFEST, getAssetPaths } from "../../content/assetManifest";
import { getMachine } from "../../content/machines";
import { getResource } from "../../content/resources";
import type { MachineType, ResourceId } from "../../sim/types";

export function frameTextureKey(assetKey: string, frameIndex: number): string {
  return `factor-y:${assetKey}:${frameIndex}`;
}

export function resolveIdleTextureKey(machine: MachineType): string | undefined {
  const assetKey = getMachine(machine)?.spriteKey;
  if (assetKey === undefined || !isRegistered(assetKey)) {
    return undefined;
  }
  return frameTextureKey(assetKey, 0);
}

export function resolveActiveFrameTextureKeys(machine: MachineType): readonly string[] {
  const assetKey = getMachine(machine)?.activeSpriteKey;
  if (assetKey === undefined || !isRegistered(assetKey)) {
    return [];
  }

  return getAssetPaths(assetKey)?.map((_path, frameIndex) => frameTextureKey(assetKey, frameIndex)) ?? [];
}

export function resolveResourceTextureKey(resource: ResourceId): string | undefined {
  const assetKey = getResource(resource)?.iconKey;
  if (assetKey === undefined || !isRegistered(assetKey)) {
    return undefined;
  }
  return frameTextureKey(assetKey, 0);
}

export function parseGlowColor(color: string): number | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (match === null) {
    return undefined;
  }
  return Number.parseInt(match[1], 16);
}

export function reportMissingMachineTexture(
  machine: MachineType,
  assetKey: string | undefined,
): void {
  if (import.meta.env.DEV) {
    console.error(`Missing machine texture for ${machine}: ${assetKey ?? "unregistered"}`);
  }
}

function isRegistered(assetKey: string): boolean {
  return Object.hasOwn(ASSET_MANIFEST, assetKey);
}
