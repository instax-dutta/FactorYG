import { getResource } from "../../content/resources";
import type { RenderEvent, ResourceId } from "../../sim/types";
import { parseGlowColor, resolveResourceTextureKey } from "./textureKeys";

export type BeltItemChangedEvent = Extract<RenderEvent, { type: "beltItemChanged" }>;

export interface BeltItemViewDescriptor {
  readonly entityId: string;
  readonly resource: ResourceId;
  readonly textureKey: string;
  readonly glowColor: number;
}

export interface BeltItemView {
  setPosition(x: number, y: number): void;
  destroy(): void;
}

export interface BeltItemViewFactory {
  hasTexture(textureKey: string): boolean;
  createView(
    descriptor: BeltItemViewDescriptor,
    worldX: number,
    worldY: number,
  ): BeltItemView;
}

export interface BeltItemPosition {
  readonly x: number;
  readonly y: number;
}

export interface RenderedBeltItem {
  readonly entityId: string;
  readonly resource: ResourceId;
  readonly textureKey: string;
  readonly glowColor: number;
  readonly x: number;
  readonly y: number;
}

export interface BeltItemRenderer {
  sync(items: Readonly<Record<string, ResourceId>>): void;
  apply(event: BeltItemChangedEvent): void;
  remove(entityId: string): void;
  getRendered(): readonly RenderedBeltItem[];
  getRenderedEntityIds(): readonly string[];
  getChangedEventCount(): number;
  destroy(): void;
}

export interface BeltItemRendererOptions {
  readonly factory: BeltItemViewFactory;
  readonly resolvePosition: (entityId: string) => BeltItemPosition | undefined;
}

interface ActiveView {
  readonly view: BeltItemView;
  readonly descriptor: BeltItemViewDescriptor;
  readonly x: number;
  readonly y: number;
}

export function createBeltItemRenderer(
  options: BeltItemRendererOptions,
): BeltItemRenderer {
  const views = new Map<string, ActiveView>();
  let changedEventCount = 0;

  const remove = (entityId: string): void => {
    const active = views.get(entityId);
    if (active === undefined) {
      return;
    }
    views.delete(entityId);
    active.view.destroy();
  };

  const render = (entityId: string, resource: ResourceId): void => {
    const position = options.resolvePosition(entityId);
    const descriptor = resolveDescriptor(entityId, resource);
    if (position === undefined || descriptor === undefined) {
      remove(entityId);
      return;
    }

    if (!options.factory.hasTexture(descriptor.textureKey)) {
      remove(entityId);
      return;
    }

    const existing = views.get(entityId);
    if (existing !== undefined) {
      if (existing.descriptor.textureKey === descriptor.textureKey) {
        existing.view.setPosition(position.x, position.y);
        views.set(entityId, {
          view: existing.view,
          descriptor,
          x: position.x,
          y: position.y,
        });
        return;
      }
      remove(entityId);
    }

    views.set(entityId, {
      view: options.factory.createView(descriptor, position.x, position.y),
      descriptor,
      x: position.x,
      y: position.y,
    });
  };

  return {
    sync: (items) => {
      for (const entityId of [...views.keys()]) {
        if (!Object.hasOwn(items, entityId)) {
          remove(entityId);
        }
      }
      for (const entityId of Object.keys(items).sort()) {
        const resource = items[entityId];
        if (resource !== undefined) {
          render(entityId, resource);
        }
      }
    },
    apply: (event) => {
      changedEventCount += 1;
      if (event.item === undefined) {
        remove(event.entityId);
        return;
      }
      render(event.entityId, event.item);
    },
    remove,
    getRendered: () =>
      [...views.entries()]
        .sort(([first], [second]) => (first < second ? -1 : 1))
        .map(([entityId, active]) => ({
          entityId,
          resource: active.descriptor.resource,
          textureKey: active.descriptor.textureKey,
          glowColor: active.descriptor.glowColor,
          x: active.x,
          y: active.y,
        })),
    getRenderedEntityIds: () => [...views.keys()],
    getChangedEventCount: () => changedEventCount,
    destroy: () => {
      for (const entityId of [...views.keys()]) {
        remove(entityId);
      }
    },
  };
}

function resolveDescriptor(
  entityId: string,
  resource: ResourceId,
): BeltItemViewDescriptor | undefined {
  const definition = getResource(resource);
  const textureKey = resolveResourceTextureKey(resource);
  if (definition === undefined || textureKey === undefined) {
    return undefined;
  }

  const glowColor = parseGlowColor(definition.color);
  if (glowColor === undefined) {
    return undefined;
  }

  return Object.freeze({ entityId, resource, textureKey, glowColor });
}
