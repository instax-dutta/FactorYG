import Phaser from "phaser";
import { ASSET_MANIFEST, type AssetKey } from "../content/assetManifest";
import { cellToWorld } from "../sim/grid";
import type { Entity, MachineType, RenderEvent, SimulationSnapshot } from "../sim/types";
import { SimulationStore } from "../sim/store";
import { createCameraConfig } from "./cameraConfig";
import { createInputAdapter, type CameraInputAdapter } from "./inputAdapter";

const GRID_WIDTH = 64;
const GRID_HEIGHT = 64;
const TILE_SIZE_PX = 64;

export class FactoryScene extends Phaser.Scene {
  private readonly store: SimulationStore;
  private machineLayer!: Phaser.GameObjects.Layer;
  private beltLayer!: Phaser.GameObjects.Layer;
  private ghostLayer!: Phaser.GameObjects.Layer;
  private vfxLayer!: Phaser.GameObjects.Layer;
  private ghost!: Phaser.GameObjects.Rectangle;
  private inputAdapter: CameraInputAdapter | undefined;
  private snapshot!: SimulationSnapshot;
  private ghostCell: { x: number; y: number } | undefined;
  private readonly entitySprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly placedEntities = new Map<string, Entity>();
  private readonly activeExtractors = new Set<string>();
  private unsubscribeSnapshot: (() => void) | undefined;
  private unsubscribeEvents: (() => void) | undefined;

  public constructor(store: SimulationStore) {
    super({ key: "FactoryScene" });
    this.store = store;
  }

  public preload(): void {
    for (const [assetKey, entry] of Object.entries(ASSET_MANIFEST) as Array<
      [AssetKey, (typeof ASSET_MANIFEST)[AssetKey]]
    >) {
      for (let frameIndex = 0; frameIndex < entry.framePaths.length; frameIndex += 1) {
        this.load.svg(
          frameTextureKey(assetKey, frameIndex),
          `/${entry.framePaths[frameIndex]}`,
          { width: entry.width, height: entry.height },
        );
      }
    }
  }

  public create(): void {
    const cameraConfig = createCameraConfig(GRID_WIDTH, GRID_HEIGHT);
    const camera = this.cameras.main;
    camera.setBounds(0, 0, cameraConfig.boundsWidth, cameraConfig.boundsHeight);
    camera.setZoom(cameraConfig.initialZoom);
    camera.centerOn((GRID_WIDTH * TILE_SIZE_PX) / 2, (GRID_HEIGHT * TILE_SIZE_PX) / 2);

    this.createFloor();
    this.machineLayer = this.add.layer().setName("machine-layer").setDepth(10);
    this.beltLayer = this.add.layer().setName("belt-layer").setDepth(11);
    this.ghostLayer = this.add.layer().setName("ghost-layer").setDepth(20);
    this.vfxLayer = this.add.layer().setName("vfx-layer").setDepth(30);
    this.ghost = this.add
      .rectangle(0, 0, TILE_SIZE_PX, TILE_SIZE_PX, 0x36c5b5, 0.35)
      .setStrokeStyle(2, 0x36c5b5);
    this.ghostLayer.add(this.ghost);

    this.snapshot = this.store.getSnapshot();
    this.inputAdapter = createInputAdapter(this, camera, {
      minZoom: cameraConfig.minZoom,
      maxZoom: cameraConfig.maxZoom,
      onPrimaryClick: (cell) => this.placeAt(cell),
      onSecondaryClick: (cell) => this.demolishAt(cell),
      onPointerMove: (cell) => this.updateGhost(cell),
      onRotate: () => this.store.dispatch({ type: "rotatePlacement" }),
    });

    this.unsubscribeSnapshot = this.store.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.updateGhostTexture();
    });
    this.unsubscribeEvents = this.store.subscribeEvents((event) => this.handleRenderEvent(event));
    this.events.once("shutdown", this.cleanup);
    this.updateGhostTexture();
  }

  public update(_time: number, delta: number): void {
    this.inputAdapter?.update(delta);
    this.updateActiveExtractorFrames();
  }

  private createFloor(): void {
    const floorData = Array.from({ length: GRID_HEIGHT }, () =>
      Array.from({ length: GRID_WIDTH }, () => 1),
    );
    const map = this.make.tilemap({
      data: floorData,
      tileWidth: TILE_SIZE_PX,
      tileHeight: TILE_SIZE_PX,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
    });
    const tileset = map.addTilesetImage(
      "floor",
      frameTextureKey("tile.floor", 0),
      TILE_SIZE_PX,
      TILE_SIZE_PX,
      0,
      0,
      1,
    );
    if (tileset === null) {
      return;
    }
    const floorLayer = map.createLayer(0, tileset, 0, 0);
    floorLayer?.setDepth(0);
  }

  private placeAt(cell: { x: number; y: number }): void {
    const machine = this.snapshot.placementMode ?? "extractor";
    this.store.dispatch({
      type: "placeEntity",
      machine,
      x: cell.x,
      y: cell.y,
      rotation: this.snapshot.pendingRotation,
    });
  }

  private demolishAt(cell: { x: number; y: number }): void {
    const placedEntity = this.findPlacedEntity(cell);
    if (placedEntity !== undefined) {
      this.store.dispatch({ type: "demolishEntity", entityId: placedEntity.id });
    }
  }

  private findPlacedEntity(cell: { x: number; y: number }): Entity | undefined {
    return [...this.placedEntities.values()].find(
      (entity) => entity.x === cell.x && entity.y === cell.y,
    );
  }

  private updateGhost(cell: { x: number; y: number }): void {
    this.ghostCell = cell;
    const world = cellToWorld(cell, TILE_SIZE_PX);
    this.ghost.setPosition(world.x + TILE_SIZE_PX / 2, world.y + TILE_SIZE_PX / 2);
    this.ghost.setAngle(this.snapshot.pendingRotation);
    const result = this.store.validatePlacement({
      type: "placeEntity",
      machine: this.snapshot.placementMode ?? "extractor",
      x: cell.x,
      y: cell.y,
      rotation: this.snapshot.pendingRotation,
    });
    const color = result.ok ? 0x36c5b5 : 0xd85b3f;
    this.ghost.setFillStyle(color, 0.35);
    this.ghost.setStrokeStyle(2, color);
  }

  private updateGhostTexture(): void {
    if (this.ghostCell !== undefined) {
      this.updateGhost(this.ghostCell);
      return;
    }
    this.ghost.setVisible(this.snapshot !== undefined);
  }

  private handleRenderEvent(event: RenderEvent): void {
    switch (event.type) {
      case "entityPlaced":
        this.renderEntity(event.entity);
        break;
      case "entityRemoved": {
        const sprite = this.entitySprites.get(event.entityId);
        sprite?.destroy();
        this.entitySprites.delete(event.entityId);
        this.placedEntities.delete(event.entityId);
        this.activeExtractors.delete(event.entityId);
        break;
      }
      case "machineStateChanged":
        if (event.active) {
          this.activeExtractors.add(event.entityId);
        } else {
          this.activeExtractors.delete(event.entityId);
          this.setEntityFrame(event.entityId, 0);
        }
        break;
      case "saleCompleted":
        this.renderSale(event.worldX, event.worldY);
        break;
    }
  }

  private renderEntity(entity: Entity): void {
    const textureKey = idleTextureKey(entity.type);
    if (!this.textures.exists(textureKey)) {
      return;
    }

    const world = cellToWorld({ x: entity.x, y: entity.y }, TILE_SIZE_PX);
    const sprite = this.add
      .sprite(world.x + TILE_SIZE_PX / 2, world.y + TILE_SIZE_PX / 2, textureKey)
      .setAngle(entity.rotation)
      .setData("entityId", entity.id)
      .setData("machineType", entity.type);
    if (entity.type === "belt") {
      this.beltLayer.add(sprite);
    } else {
      this.machineLayer.add(sprite);
    }
    this.entitySprites.set(entity.id, sprite);
    this.placedEntities.set(entity.id, { ...entity });
  }

  private updateActiveExtractorFrames(): void {
    const activeFrames = ASSET_MANIFEST["machine.extractor.active"].framePaths;
    const frameIndex = Math.floor(this.time.now / 160) % activeFrames.length;
    for (const entityId of this.activeExtractors) {
      this.setEntityFrame(entityId, frameIndex);
    }
  }

  private setEntityFrame(entityId: string, frameIndex: number): void {
    const sprite = this.entitySprites.get(entityId);
    if (sprite === undefined) {
      return;
    }
    const entityType = sprite.getData("machineType") as MachineType | undefined;
    if (entityType !== "extractor") {
      return;
    }
    const frameKey = frameTextureKey("machine.extractor.active", frameIndex);
    if (this.textures.exists(frameKey)) {
      sprite.setTexture(frameKey);
    }
  }

  private renderSale(worldX: number, worldY: number): void {
    const sparkKey = frameTextureKey("vfx.spark", 0);
    if (!this.textures.exists(sparkKey)) {
      return;
    }
    const spark = this.add.sprite(worldX, worldY, sparkKey).setDepth(30);
    this.vfxLayer.add(spark);
    this.tweens.add({
      targets: spark,
      y: worldY - 28,
      alpha: 0,
      duration: 320,
      onComplete: () => spark.destroy(),
    });
  }

  private readonly cleanup = (): void => {
    this.unsubscribeSnapshot?.();
    this.unsubscribeEvents?.();
    this.inputAdapter?.dispose();
    this.inputAdapter = undefined;
  };
}

function frameTextureKey(assetKey: AssetKey, frameIndex: number): string {
  return `factor-y:${assetKey}:${frameIndex}`;
}

function idleTextureKey(machine: MachineType): string {
  const key = `machine.${machine}.idle` as AssetKey;
  const manifestEntry = ASSET_MANIFEST[key];
  if (manifestEntry !== undefined) {
    return frameTextureKey(key, 0);
  }
  return frameTextureKey("machine.extractor.idle", 0);
}
