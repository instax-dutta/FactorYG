import { getAssetPaths } from "../../content/assetManifest";
import { getMachine } from "../../content/machines";
import type { MachineDefinition } from "../../content/types";
import { TILE_SIZE_PX } from "../../sim/constants";
import { cellToWorld } from "../../sim/grid";
import type { Entity, MachineType, RenderEvent } from "../../sim/types";
import { frameTextureKey, resolveIdleTextureKey } from "./textureKeys";

export const ACTIVE_FRAME_INTERVAL_MS = 160;

export type EntityLayerName = "machine" | "belt";

export interface EntityView {
  readonly entityId: string;
  readonly textureKey: string | undefined;
  readonly baseTint: number;
  alpha: number;
  setTexture(textureKey: string): void;
  setAngle(degrees: number): void;
  setTint(color: number): void;
  destroy(): void;
}

export interface EntityViewDescriptor {
  readonly entityId: string;
  readonly machineType: MachineType;
  readonly layer: EntityLayerName;
  readonly textureKey: string;
  readonly rotation: number;
  readonly worldX: number;
  readonly worldY: number;
}

export interface EntityViewFactory {
  hasTexture(textureKey: string): boolean;
  createView(descriptor: EntityViewDescriptor): EntityView;
}

export interface EntityWorldPosition {
  readonly x: number;
  readonly y: number;
}

export interface EntityRenderWork {
  readonly frameWrites: number;
  readonly frameKeyResolutions: number;
}

export interface EntityRenderer {
  apply(event: RenderEvent): boolean;
  place(entity: Entity): boolean;
  remove(entityId: string): EntityView | undefined;
  setActive(entityId: string): boolean;
  setIdle(entityId: string): boolean;
  syncActive(entityIds: readonly string[]): void;
  advanceFrames(nowMs: number): boolean;
  isActive(entityId: string): boolean;
  getView(entityId: string): EntityView | undefined;
  getEntity(entityId: string): Entity | undefined;
  getEntityIds(): readonly string[];
  getActiveEntityIds(): readonly string[];
  getActiveFrameKeys(): readonly string[];
  resolveWorldPosition(entityId: string): EntityWorldPosition | undefined;
  getWork(): EntityRenderWork;
  clearActive(): void;
}

export interface EntityRendererOptions {
  readonly factory: EntityViewFactory;
}

const NO_ACTIVE_FRAMES: readonly string[] = Object.freeze([]);
const BUCKET_INVALID = -1;

function frameKeysForDefinition(definition: MachineDefinition): readonly string[] {
  const assetKey = definition.activeSpriteKey;
  if (assetKey === undefined) {
    return NO_ACTIVE_FRAMES;
  }

  const framePaths = getAssetPaths(assetKey);
  if (framePaths === undefined || framePaths.length === 0) {
    return NO_ACTIVE_FRAMES;
  }

  return Object.freeze(framePaths.map((_path, frameIndex) => frameTextureKey(assetKey, frameIndex)));
}

export function createEntityRenderer(options: EntityRendererOptions): EntityRenderer {
  const entityFrameKeys = new WeakMap<MachineDefinition, readonly string[]>();
  const views = new Map<string, EntityView>();
  const entities = new Map<string, Entity>();
  const activeIds = new Set<string>();
  let frameBucket = BUCKET_INVALID;
  let frameWrites = 0;
  let frameKeyResolutions = 0;

  const activeFramesFor = (machine: MachineType): readonly string[] => {
    const definition = getMachine(machine);
    if (definition === undefined) {
      return NO_ACTIVE_FRAMES;
    }

    const cached = entityFrameKeys.get(definition);
    if (cached !== undefined) {
      return cached;
    }

    frameKeyResolutions += 1;
    const frames = frameKeysForDefinition(definition);
    entityFrameKeys.set(definition, frames);
    return frames;
  };

  const idleFrameFor = (machine: MachineType): string | undefined => resolveIdleTextureKey(machine);

  const renderer: EntityRenderer = {
    apply: (event): boolean => {
      switch (event.type) {
        case "entityPlaced":
          return renderer.place(event.entity);
        case "entityRemoved":
          return renderer.remove(event.entityId) !== undefined;
        case "machineStateChanged":
          return event.active
            ? renderer.setActive(event.entityId)
            : renderer.setIdle(event.entityId);
        case "beltItemChanged":
          return event.item === undefined
            ? renderer.setIdle(event.entityId)
            : renderer.setActive(event.entityId);
        default:
          return false;
      }
    },
    place: (entity): boolean => {
      const textureKey = idleFrameFor(entity.type);
      if (textureKey === undefined || !options.factory.hasTexture(textureKey)) {
        return false;
      }

      renderer.remove(entity.id);

      const world = cellToWorld({ x: entity.x, y: entity.y }, TILE_SIZE_PX);
      const view = options.factory.createView({
        entityId: entity.id,
        machineType: entity.type,
        layer: entity.type === "belt" ? "belt" : "machine",
        textureKey,
        rotation: entity.rotation,
        worldX: world.x + TILE_SIZE_PX / 2,
        worldY: world.y + TILE_SIZE_PX / 2,
      });
      view.setAngle(entity.rotation);
      views.set(entity.id, view);
      entities.set(entity.id, { ...entity });
      return true;
    },
    remove: (entityId): EntityView | undefined => {
      const view = views.get(entityId);
      if (view === undefined) {
        return undefined;
      }

      views.delete(entityId);
      entities.delete(entityId);
      activeIds.delete(entityId);
      frameBucket = BUCKET_INVALID;
      view.destroy();
      return view;
    },
    setActive: (entityId): boolean => {
      if (activeIds.has(entityId)) {
        return false;
      }

      const entity = entities.get(entityId);
      if (entity === undefined) {
        return false;
      }

      const frames = activeFramesFor(entity.type);
      if (!frames.some((textureKey) => options.factory.hasTexture(textureKey))) {
        return false;
      }

      activeIds.add(entityId);
      frameBucket = BUCKET_INVALID;
      return true;
    },
    setIdle: (entityId): boolean => {
      if (!activeIds.delete(entityId)) {
        return false;
      }

      frameBucket = BUCKET_INVALID;
      const entity = entities.get(entityId);
      const idleFrame = entity === undefined ? undefined : idleFrameFor(entity.type);
      if (idleFrame !== undefined) {
        views.get(entityId)?.setTexture(idleFrame);
      }
      return true;
    },
    syncActive: (entityIds): void => {
      const wanted = new Set(entityIds);
      for (const entityId of [...activeIds]) {
        if (!wanted.has(entityId)) {
          renderer.setIdle(entityId);
        }
      }
      for (const entityId of wanted) {
        renderer.setActive(entityId);
      }
    },
    advanceFrames: (nowMs): boolean => {
      const bucket = Math.floor(nowMs / ACTIVE_FRAME_INTERVAL_MS);
      if (bucket === frameBucket) {
        return false;
      }
      frameBucket = bucket;

      for (const entityId of activeIds) {
        const entity = entities.get(entityId);
        if (entity === undefined) {
          continue;
        }

        const frames = activeFramesFor(entity.type);
        if (frames.length === 0) {
          renderer.setIdle(entityId);
          continue;
        }

        const frameKey = frames[bucket % frames.length];
        if (frameKey === undefined || !options.factory.hasTexture(frameKey)) {
          continue;
        }

        views.get(entityId)?.setTexture(frameKey);
        frameWrites += 1;
      }
      return true;
    },
    isActive: (entityId): boolean => activeIds.has(entityId),
    getView: (entityId): EntityView | undefined => views.get(entityId),
    getEntity: (entityId): Entity | undefined => entities.get(entityId),
    getEntityIds: (): string[] => [...entities.keys()],
    getActiveEntityIds: (): string[] => [...activeIds].sort(compareEntityIds),
    getActiveFrameKeys: (): string[] =>
      [...activeIds]
        .sort(compareEntityIds)
        .map((entityId) => views.get(entityId)?.textureKey)
        .filter((textureKey): textureKey is string => typeof textureKey === "string"),
    resolveWorldPosition: (entityId): EntityWorldPosition | undefined => {
      const entity = entities.get(entityId);
      if (entity === undefined) {
        return undefined;
      }

      const world = cellToWorld({ x: entity.x, y: entity.y }, TILE_SIZE_PX);
      return { x: world.x + TILE_SIZE_PX / 2, y: world.y + TILE_SIZE_PX / 2 };
    },
    getWork: (): EntityRenderWork => ({
      frameWrites,
      frameKeyResolutions,
    }),
    clearActive: (): void => {
      activeIds.clear();
      frameBucket = BUCKET_INVALID;
    },
  };

  return renderer;
}

function compareEntityIds(first: string, second: string): number {
  return first < second ? -1 : 1;
}