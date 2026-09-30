import { getMachine } from "../../content/machines";
import { getResource } from "../../content/resources";
import { TILE_SIZE_PX } from "../../sim/constants";
import { cellToWorld } from "../../sim/grid";
import type { Entity, RenderEvent, ResourceId } from "../../sim/types";
import { frameTextureKey, parseGlowColor } from "./textureKeys";

export const SMELTER_HEAT_TWEEN_DURATION_MS = 420;
export const SMELTER_HEAT_ALPHA_HOLD = 0.5;
export const SMELTER_HEAT_SCALE = 2.2;
export const SMELTER_HEAT_TINT = 0xe0a458;
export const SALE_BURST_LIFETIME_MS = 320;
export const SALE_BURST_RISE_PX = 26;
export const SALE_BURST_START_SCALE = 0.6;
export const SALE_BURST_END_SCALE = 1.25;
export const MAX_LIVE_SALE_BURSTS = 12;

export const SMELTER_HEAT_ASSET_KEY = "vfx.heat";
export const SALE_BURST_ASSET_KEY = "vfx.coin";
export const HEATED_MACHINE_TYPES: ReadonlySet<string> = new Set(["smelter"]);

export interface VfxView {
  x: number;
  y: number;
  scale: number;
  alpha: number;
  setTint(color: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export interface VfxViewDescriptor {
  readonly assetKey: string;
  readonly worldX: number;
  readonly worldY: number;
  readonly tint: number;
  readonly scale: number;
  readonly alpha: number;
  readonly additive: boolean;
}

export interface VfxViewFactory {
  hasTexture(textureKey: string): boolean;
  createView(descriptor: VfxViewDescriptor): VfxView;
}

export interface VfxPulseSpec {
  targets: VfxView;
  alpha: number;
  duration: number;
  yoyo: boolean;
  repeat: number;
}

export interface VfxOneShotConfig {
  readonly worldX: number;
  readonly worldY: number;
  readonly onComplete: () => void;
}

export interface VfxOneShotSpec {
  targets: VfxView;
  y: number;
  scale: number;
  alpha: number;
  duration: number;
  onComplete: () => void;
}

export interface VfxTweenHandle {
  stop(): void;
}

export interface VfxTweenHost {
  createPulseTween(spec: VfxPulseSpec): VfxTweenHandle;
  createOneShotTween(spec: VfxOneShotSpec): VfxTweenHandle;
}

export interface VfxRenderer {
  apply(event: RenderEvent): boolean;
  remove(entityId: string): boolean;
  getHeatEntityIds(): readonly string[];
  getSaleBurstCount(): number;
  getLiveBurstCount(): number;
  getPoolSize(): number;
  destroy(): void;
}

export interface VfxRendererOptions {
  readonly factory: VfxViewFactory;
  readonly tweens: VfxTweenHost;
  readonly resolveEntity: (entityId: string) => Entity | undefined;
}

export function createSmelterHeatPulseSpec(view: VfxView): VfxPulseSpec {
  return {
    targets: view,
    alpha: SMELTER_HEAT_ALPHA_HOLD,
    duration: SMELTER_HEAT_TWEEN_DURATION_MS,
    yoyo: true,
    repeat: -1,
  };
}

export function createSaleBurstSpec(view: VfxView, config: VfxOneShotConfig): VfxOneShotSpec {
  return {
    targets: view,
    y: config.worldY - SALE_BURST_RISE_PX,
    scale: SALE_BURST_END_SCALE,
    alpha: 0,
    duration: SALE_BURST_LIFETIME_MS,
    onComplete: config.onComplete,
  };
}

interface ActiveHeat {
  readonly view: VfxView;
  readonly pulse: VfxTweenHandle;
}

interface LiveBurst {
  readonly view: VfxView;
  handle: VfxTweenHandle;
}

export function createVfxRenderer(options: VfxRendererOptions): VfxRenderer {
  const heats = new Map<string, ActiveHeat>();
  const freeViews = new Map<string, VfxView[]>();
  const liveBursts: LiveBurst[] = [];
  let saleBurstCount = 0;

  const acquireView = (descriptor: VfxViewDescriptor): VfxView | undefined => {
    if (!options.factory.hasTexture(frameTextureKey(descriptor.assetKey, 0))) {
      return undefined;
    }

    const pooled = freeViews.get(descriptor.assetKey)?.pop();
    if (pooled !== undefined) {
      pooled.x = descriptor.worldX;
      pooled.y = descriptor.worldY;
      pooled.scale = descriptor.scale;
      pooled.alpha = descriptor.alpha;
      pooled.setTint(descriptor.tint);
      pooled.setVisible(true);
      return pooled;
    }

    return options.factory.createView(descriptor);
  };

  const releaseView = (assetKey: string, view: VfxView): void => {
    const pool = freeViews.get(assetKey);
    if (pool === undefined) {
      freeViews.set(assetKey, [view]);
      return;
    }
    pool.push(view);
  };

  const stopHeat = (entityId: string): boolean => {
    const active = heats.get(entityId);
    if (active === undefined) {
      return false;
    }

    heats.delete(entityId);
    active.pulse.stop();
    active.view.setVisible(false);
    releaseView(SMELTER_HEAT_ASSET_KEY, active.view);
    return true;
  };

  const startHeat = (entity: Entity): boolean => {
    if (heats.has(entity.id)) {
      return false;
    }
    if (!HEATED_MACHINE_TYPES.has(getMachine(entity.type)?.type ?? entity.type)) {
      return false;
    }

    const world = cellToWorld({ x: entity.x, y: entity.y }, TILE_SIZE_PX);
    const view = acquireView({
      assetKey: SMELTER_HEAT_ASSET_KEY,
      worldX: world.x + TILE_SIZE_PX / 2,
      worldY: world.y + TILE_SIZE_PX / 2,
      tint: SMELTER_HEAT_TINT,
      scale: SMELTER_HEAT_SCALE,
      alpha: 1,
      additive: true,
    });
    if (view === undefined) {
      return false;
    }

    const pulse = options.tweens.createPulseTween(createSmelterHeatPulseSpec(view));
    heats.set(entity.id, { view, pulse });
    return true;
  };

  const retireBurst = (burst: LiveBurst): void => {
    const index = liveBursts.indexOf(burst);
    if (index < 0) {
      return;
    }
    liveBursts.splice(index, 1);
    burst.handle.stop();
    burst.view.setVisible(false);
    releaseView(SALE_BURST_ASSET_KEY, burst.view);
  };

  const burstSale = (
    worldX: number,
    worldY: number,
    resource: ResourceId,
  ): boolean => {
    const definition = getResource(resource);
    const tint = definition === undefined ? undefined : parseGlowColor(definition.color);
    if (tint === undefined) {
      return false;
    }

    while (liveBursts.length >= MAX_LIVE_SALE_BURSTS) {
      const oldest = liveBursts[0];
      if (oldest === undefined) {
        break;
      }
      retireBurst(oldest);
    }

    const view = acquireView({
      assetKey: SALE_BURST_ASSET_KEY,
      worldX,
      worldY,
      tint,
      scale: SALE_BURST_START_SCALE,
      alpha: 1,
      additive: true,
    });
    if (view === undefined) {
      return false;
    }

    const burst: LiveBurst = { view, handle: { stop: (): void => undefined } };
    const settle = (): void => {
      const index = liveBursts.indexOf(burst);
      if (index < 0) {
        return;
      }
      liveBursts.splice(index, 1);
      releaseView(SALE_BURST_ASSET_KEY, view);
      view.setVisible(false);
    };
    liveBursts.push(burst);
    saleBurstCount += 1;
    const spec = createSaleBurstSpec(view, { worldX, worldY, onComplete: settle });
    burst.handle = options.tweens.createOneShotTween(spec);
    return true;
  };

  return {
    apply: (event): boolean => {
      switch (event.type) {
        case "saleCompleted":
          return burstSale(event.worldX, event.worldY, event.resource);
        case "machineStateChanged": {
          if (!event.active) {
            return stopHeat(event.entityId);
          }
          const entity = options.resolveEntity(event.entityId);
          return entity === undefined ? false : startHeat(entity);
        }
        case "entityRemoved":
          return stopHeat(event.entityId);
        default:
          return false;
      }
    },
    remove: stopHeat,
    getHeatEntityIds: (): string[] => [...heats.keys()].sort(compareEntityIds),
    getSaleBurstCount: (): number => saleBurstCount,
    getLiveBurstCount: (): number => liveBursts.length,
    getPoolSize: (): number => {
      let total = 0;
      for (const pool of freeViews.values()) {
        total += pool.length;
      }
      return total;
    },
    destroy: (): void => {
      for (const entityId of [...heats.keys()]) {
        stopHeat(entityId);
      }
      for (const burst of [...liveBursts]) {
        retireBurst(burst);
      }
      for (const pool of freeViews.values()) {
        for (const view of pool) {
          view.destroy();
        }
        pool.length = 0;
      }
    },
  };
}

function compareEntityIds(first: string, second: string): number {
  return first < second ? -1 : 1;
}