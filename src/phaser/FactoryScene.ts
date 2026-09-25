import Phaser from "phaser";
import { ASSET_MANIFEST, type AssetKey } from "../content/assetManifest";
import { getMachine } from "../content/machines";
import { cellToWorld } from "../sim/grid";
import type { Entity, MachineType, RenderEvent, SimulationSnapshot } from "../sim/types";
import { SimulationStore } from "../sim/store";
import { createCameraConfig } from "./cameraConfig";
import { createInputAdapter, type CameraInputAdapter } from "./inputAdapter";
import { createSceneTelemetry, type SceneTelemetry } from "./telemetry";

const GRID_WIDTH = 64;
const GRID_HEIGHT = 64;
const TILE_SIZE_PX = 64;

export class FactoryScene extends Phaser.Scene {
  private readonly store: SimulationStore;
  private readonly onReady: () => void;
  private readonly onTelemetry: (telemetry: SceneTelemetry) => void;
  private machineLayer!: Phaser.GameObjects.Layer;
  private beltLayer!: Phaser.GameObjects.Layer;
  private ghostLayer!: Phaser.GameObjects.Layer;
  private vfxLayer!: Phaser.GameObjects.Layer;
  private ghost!: Phaser.GameObjects.Sprite;
  private inputAdapter: CameraInputAdapter | undefined;
  private snapshot!: SimulationSnapshot;
  private ghostCell: { x: number; y: number } | undefined;
  private ghostValid = false;
  private ready = false;
  private readyNotified = false;
  private cleaned = false;
  private readonly entitySprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly placedEntities = new Map<string, Entity>();
  private readonly activeExtractors = new Set<string>();
  private unsubscribeSnapshot: (() => void) | undefined;
  private unsubscribeEvents: (() => void) | undefined;

  public constructor(
    store: SimulationStore,
    onReady: () => void = () => undefined,
    onTelemetry: (telemetry: SceneTelemetry) => void = () => undefined,
  ) {
    super({ key: "FactoryScene" });
    this.store = store;
    this.onReady = onReady;
    this.onTelemetry = onTelemetry;
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
    if (this.cleaned) {
      return;
    }

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
      .sprite(0, 0, frameTextureKey("tile.floor", 0))
      .setAlpha(0.55)
      .setVisible(false);
    this.ghostLayer.add(this.ghost);

    this.snapshot = this.store.getSnapshot();
    this.unsubscribeSnapshot = this.store.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.refreshGhost();
      this.publishTelemetry();
    });
    this.unsubscribeEvents = this.store.subscribeEvents((event) => this.handleRenderEvent(event));
    this.inputAdapter = createInputAdapter(this, camera, {
      minZoom: cameraConfig.minZoom,
      maxZoom: cameraConfig.maxZoom,
      onPrimaryClick: (cell) => this.placeAt(cell),
      onSecondaryClick: (cell) => this.demolishAt(cell),
      onPointerMove: (cell) => this.updateGhost(cell),
      onRotate: () => this.store.dispatch({ type: "rotatePlacement" }),
    });
    this.events.once("shutdown", this.cleanup);
    this.events.once("destroy", this.cleanup);

    this.ready = true;
    this.publishTelemetry();
    this.notifyReady();
  }

  public update(_time: number, delta: number): void {
    if (this.cleaned) {
      return;
    }
    this.inputAdapter?.update(delta);
    this.updateActiveExtractorFrames();
    this.publishTelemetry();
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
    const machine = this.snapshot.placementMode;
    if (machine === undefined) {
      return;
    }
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
    const machine = this.snapshot.placementMode;
    if (machine === undefined) {
      this.hideGhost();
      return;
    }

    const textureKey = idleTextureKey(machine);
    if (textureKey === undefined) {
      this.hideGhost();
      return;
    }

    const world = cellToWorld(cell, TILE_SIZE_PX);
    this.ghost
      .setTexture(textureKey)
      .setPosition(world.x + TILE_SIZE_PX / 2, world.y + TILE_SIZE_PX / 2)
      .setAngle(this.snapshot.pendingRotation)
      .setVisible(true);
    const result = this.store.validatePlacement({
      type: "placeEntity",
      machine,
      x: cell.x,
      y: cell.y,
      rotation: this.snapshot.pendingRotation,
    });
    this.ghostValid = result.ok;
    this.ghost.setTint(result.ok ? 0xffffff : 0xd85b3f);
    this.publishTelemetry();
  }

  private refreshGhost(): void {
    if (this.ghostCell === undefined) {
      this.hideGhost();
      return;
    }
    this.updateGhost(this.ghostCell);
  }

  private hideGhost(): void {
    this.ghostValid = false;
    if (this.ghost !== undefined) {
      this.ghost.setVisible(false);
    }
    this.publishTelemetry();
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
          this.setEntityIdle(event.entityId);
        }
        break;
      case "saleCompleted":
        this.renderSale(event.worldX, event.worldY);
        break;
    }
  }

  private renderEntity(entity: Entity): void {
    const textureKey = idleTextureKey(entity.type);
    if (textureKey === undefined) {
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

  private setEntityIdle(entityId: string): void {
    const sprite = this.entitySprites.get(entityId);
    if (sprite === undefined) {
      return;
    }
    const entityType = sprite.getData("machineType") as MachineType | undefined;
    if (entityType === undefined) {
      return;
    }
    const textureKey = idleTextureKey(entityType);
    if (textureKey !== undefined) {
      sprite.setTexture(textureKey);
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

  private notifyReady(): void {
    if (this.readyNotified || !this.ready || this.cleaned) {
      return;
    }
    this.readyNotified = true;
    this.onReady();
  }

  private publishTelemetry(): void {
    if (this.cleaned || this.snapshot === undefined) {
      return;
    }
    const camera = this.cameras.main;
    this.onTelemetry(
      createSceneTelemetry({
        ready: this.ready,
        camera: {
          scrollX: camera.scrollX,
          scrollY: camera.scrollY,
          zoom: camera.zoom,
        },
        ghost: {
          visible: this.ghost?.visible ?? false,
          valid: this.ghostValid,
          rotation: this.snapshot.pendingRotation,
        },
      }),
    );
  }

  private readonly cleanup = (): void => {
    if (this.cleaned) {
      return;
    }
    this.cleaned = true;
    this.ready = false;
    this.events.off("shutdown", this.cleanup);
    this.events.off("destroy", this.cleanup);
    this.unsubscribeSnapshot?.();
    this.unsubscribeEvents?.();
    this.unsubscribeSnapshot = undefined;
    this.unsubscribeEvents = undefined;
    this.inputAdapter?.dispose();
    this.inputAdapter = undefined;
  };
}

function frameTextureKey(assetKey: AssetKey, frameIndex: number): string {
  return `factor-y:${assetKey}:${frameIndex}`;
}

function idleTextureKey(machine: MachineType): string | undefined {
  const definition = getMachine(machine);
  if (definition === undefined) {
    reportMissingTexture(machine, machine);
    return undefined;
  }
  const assetKey = definition.spriteKey;
  if (!Object.hasOwn(ASSET_MANIFEST, assetKey)) {
    reportMissingTexture(machine, assetKey);
    return undefined;
  }
  return frameTextureKey(assetKey as AssetKey, 0);
}

function reportMissingTexture(machine: MachineType, assetKey: string): void {
  if (import.meta.env.DEV) {
    console.error(`Missing machine texture for ${machine}: ${assetKey}`);
  }
}
