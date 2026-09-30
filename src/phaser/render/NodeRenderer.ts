import { TILE_SIZE_PX } from "../../sim/constants";
import { cellToWorld } from "../../sim/grid";
import type { ResourceId } from "../../sim/types";
import { resolveResourceTextureKey } from "./textureKeys";

export const NODE_VIEW_ALPHA = 1;

export interface ResourceNode {
  readonly x: number;
  readonly y: number;
  readonly resource: ResourceId;
}

export interface NodeSprite {
  destroy(): void;
}

export interface NodeViewFactory {
  hasTexture(textureKey: string): boolean;
  createView(
    worldX: number,
    worldY: number,
    textureKey: string,
  ): NodeSprite;
}

export interface NodeRenderer {
  sync(nodes: readonly ResourceNode[]): boolean;
  add(node: ResourceNode): boolean;
  remove(x: number, y: number): boolean;
  clear(): void;
  getSpriteCount(): number;
  getSpriteCells(): readonly string[];
  hasTextureFor(resource: ResourceId): boolean;
  destroy(): void;
}

export interface NodeRendererOptions {
  readonly factory: NodeViewFactory;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function createNodeRenderer(options: NodeRendererOptions): NodeRenderer {
  const sprites = new Map<string, NodeSprite>();

  function add(node: ResourceNode): boolean {
    const key = cellKey(node.x, node.y);
    if (sprites.has(key)) {
      return false;
    }

    const textureKey = resolveResourceTextureKey(node.resource);
    if (textureKey === undefined || !options.factory.hasTexture(textureKey)) {
      return false;
    }

    const world = cellToWorld({ x: node.x, y: node.y }, TILE_SIZE_PX);
    sprites.set(
      key,
      options.factory.createView(
        world.x + TILE_SIZE_PX / 2,
        world.y + TILE_SIZE_PX / 2,
        textureKey,
      ),
    );
    return true;
  }

  return {
    sync(nodes) {
      let changed = false;
      const wanted = new Set<string>();
      for (const node of nodes) {
        wanted.add(cellKey(node.x, node.y));
        if (add(node)) {
          changed = true;
        }
      }
      for (const key of [...sprites.keys()]) {
        if (wanted.has(key)) {
          continue;
        }
        sprites.get(key)?.destroy();
        sprites.delete(key);
        changed = true;
      }
      return changed;
    },
    add,
    remove(x, y) {
      const key = cellKey(x, y);
      const sprite = sprites.get(key);
      if (sprite === undefined) {
        return false;
      }
      sprite.destroy();
      sprites.delete(key);
      return true;
    },
    clear() {
      for (const sprite of sprites.values()) {
        sprite.destroy();
      }
      sprites.clear();
    },
    getSpriteCount() {
      return sprites.size;
    },
    getSpriteCells() {
      return [...sprites.keys()].sort();
    },
    hasTextureFor(resource) {
      const textureKey = resolveResourceTextureKey(resource);
      return textureKey !== undefined && options.factory.hasTexture(textureKey);
    },
    destroy() {
      for (const sprite of sprites.values()) {
        sprite.destroy();
      }
      sprites.clear();
    },
  };
}
