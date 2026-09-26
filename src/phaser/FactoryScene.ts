import Phaser from "phaser";
import { ASSET_MANIFEST, type AssetKey } from "../content/assetManifest";
import { getMachine } from "../content/machines";
import { cellToWorld } from "../sim/grid";
import type { Entity, MachineType, RenderEvent, SimulationSnapshot } from "../sim/types";
import { SimulationStore } from "../sim/store";
import { createCameraConfig } from "./cameraConfig";
import { createInputAdapter, type CameraInputAdapter } from "./inputAdapter";
import { createPrimaryCanvasCommand } from "./primaryInteraction";
import {
  createBeltItemRenderer,
  type BeltItemRenderer,
  type BeltItemView,
  type BeltItemViewFactory,
} from "./render/BeltItemRenderer";
import {
  createMachineBlinker,
  createMachineBlinkTweenSpec,
  type MachineBlinker,
  type MachineBlinkHost,
  type MachineBlinkPulse,
  type MachineBlinkPulseConfig,
  type MachineBlinkView,
} from "./render/machineBlink";
import {
  frameTextureKey,
  reportMissingMachineTexture,
  resolveActiveFrameTextureKeys,
  resolveIdleTextureKey,
} from "./render/textureKeys";
import {
  createRenderTelemetryCache,
  createSceneRenderTelemetry,
  createSceneTelemetry,
  type SceneRenderTelemetry,
  type SceneTelemetry,
} from "./telemetry";

const GRID_WIDTH = 64;
const GRID_HEIGHT = 64;
const TILE_SIZE_PX = 64;
const ACTIVE_FRAME_INTERVAL_MS = 160;
const BELT_GLOW_SCALE = 3.4;
const BELT_GLOW_ALPHA = 0.6;
const BELT_ITEM_SCALE = 1.5;

export class FactoryScene extends Phaser.Scene {
  private readonly store: SimulationStore;
  private readonly onReady: () => void;
  private readonly onTelemetry: (telemetry: SceneTelemetry) => void;
  private machineLayer!: Phaser.GameObjects.Layer;
  private beltLayer!: Phaser.GameObjects.Layer;
  private beltItemLayer!: Phaser.GameObjects.Layer;
  private ghostLayer!: Phaser.GameObjects.Layer;
  private vfxLayer!: Phaser.GameObjects.Layer;
  private ghost!: Phaser.GameObjects.Sprite;
  private beltItemRenderer!: BeltItemRenderer;
  private inputAdapter: CameraInputAdapter | undefined;
  private snapshot!: SimulationSnapshot;
  private ghostCell: { x: number; y: number } | undefined;
  private ghostValid = false;
  private ready = false;
  private readyNotified = false;
  private cleaned = false;
  private readonly entitySprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly placedEntities = new Map<string, Entity>();
  private readonly activeEntityIds = new Set<string>();
  private readonly renderTelemetry = createRenderTelemetryCache(
    createSceneRenderTelemetry({
      entityIds: [],
      activeEntityIds: [],
      activeFrameKeys: [],
      beltItemIds: [],
      beltGlowCount: 0,
      beltItemEventCount: 0,
      blockedEntityIds: [],
    }),
  );
  private machineBlinker!: MachineBlinker;
  private activeFrameBucket = -1;
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
    this.beltItemLayer = this.add.layer().setName("belt-item-layer").setDepth(12);
    this.ghostLayer = this.add.layer().setName("ghost-layer").setDepth(20);
    this.vfxLayer = this.add.layer().setName("vfx-layer").setDepth(30);
    this.ghost = this.add
      .sprite(0, 0, frameTextureKey("tile.floor", 0))
      .setAlpha(0.55)
      .setVisible(false);
    this.ghostLayer.add(this.ghost);
    this.beltItemRenderer = createBeltItemRenderer({
      factory: this.createBeltItemViewFactory(),
      resolvePosition: (entityId) => {
        const entity = this.placedEntities.get(entityId);
        if (entity === undefined) {
          return undefined;
        }
        const world = cellToWorld({ x: entity.x, y: entity.y }, TILE_SIZE_PX);
        return { x: world.x + TILE_SIZE_PX / 2, y: world.y + TILE_SIZE_PX / 2 };
      },
    });
    this.machineBlinker = createMachineBlinker(this.createMachineBlinkHost());

    this.snapshot = this.store.getSnapshot();
    this.unsubscribeSnapshot = this.store.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.refreshGhost();
      this.refreshBlockedMachines();
      this.publishTelemetry();
    });
    this.unsubscribeEvents = this.store.subscribeEvents((event) => this.handleRenderEvent(event));
    this.inputAdapter = createInputAdapter(this, camera, {
      minZoom: cameraConfig.minZoom,
      maxZoom: cameraConfig.maxZoom,
      onPrimaryClick: (cell) => this.handlePrimaryClick(cell),
      onSecondaryClick: (cell) => this.demolishAt(cell),
      onPointerMove: (cell) => this.updateGhost(cell),
      onRotate: () => this.store.dispatch({ type: "rotatePlacement" }),
    });
    this.events.once("shutdown", this.cleanup);
    this.events.once("destroy", this.cleanup);

    this.renderTelemetry.markDirty();
    this.syncExistingWorld();
    this.updateActiveFrames();
    this.ready = true;
    this.publishTelemetry();
    this.notifyReady();
  }

  public update(_time: number, delta: number): void {
    if (this.cleaned) {
      return;
    }
    this.inputAdapter?.update(delta);
    this.updateActiveFrames();
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

  private syncExistingWorld(): void {
    for (const entity of this.store.getEntities()) {
      this.renderEntity(entity);
    }

    for (const entityId of this.store.getActiveMachineIds()) {
      this.setEntityActive(entityId);
    }

    for (const entityId of this.store.getBlockedMachineIds()) {
      this.setEntityBlocked(entityId);
    }

    const carriedItems = this.store.getBeltItems();
    this.beltItemRenderer.sync(carriedItems);
    for (const entityId of Object.keys(carriedItems)) {
      this.setEntityActive(entityId);
    }
  }

  private refreshBlockedMachines(): void {
    const blocked = this.store.getBlockedMachineIds();
    for (const entityId of this.machineBlinker.getBlinkingEntityIds()) {
      if (!blocked.includes(entityId)) {
        this.machineBlinker.stop(entityId);
        this.renderTelemetry.markDirty();
      }
    }

    for (const entityId of blocked) {
      this.setEntityBlocked(entityId);
    }
  }

  private handlePrimaryClick(cell: { x: number; y: number }): void {
    this.store.dispatch(
      createPrimaryCanvasCommand(
        this.snapshot.placementMode,
        this.snapshot.pendingRotation,
        cell,
        this.findPlacedEntity(cell),
      ),
    );
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

    const textureKey = resolveIdleTextureKey(machine);
    if (textureKey === undefined) {
      reportMissingMachineTexture(machine, getMachine(machine)?.spriteKey);
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
        this.machineBlinker.stop(event.entityId);
        sprite?.destroy();
        this.entitySprites.delete(event.entityId);
        this.placedEntities.delete(event.entityId);
        this.activeEntityIds.delete(event.entityId);
        this.beltItemRenderer.remove(event.entityId);
        this.renderTelemetry.markDirty();
        break;
      }
      case "machineStateChanged":
        if (event.active) {
          this.setEntityActive(event.entityId);
        } else {
          this.setEntityIdle(event.entityId);
        }
        break;
      case "beltItemChanged":
        this.beltItemRenderer.apply(event);
        this.renderTelemetry.markDirty();
        if (event.item === undefined) {
          this.setEntityIdle(event.entityId);
        } else {
          this.setEntityActive(event.entityId);
        }
        break;
      case "blockedFull":
        this.setEntityBlocked(event.entityId);
        break;
      case "storageFull":
        this.renderNotice(event.worldX, event.worldY);
        break;
      case "saleCompleted":
        this.renderNotice(event.worldX, event.worldY);
        break;
      default:
        return this.assertUnreachableRenderEvent(event);
    }
  }

  private assertUnreachableRenderEvent(event: never): never {
    throw new Error(`Unhandled render event: ${JSON.stringify(event)}`);
  }

  private setEntityBlocked(entityId: string): void {
    const sprite = this.entitySprites.get(entityId);
    if (sprite === undefined || this.machineBlinker.isBlinking(entityId)) {
      return;
    }

    this.machineBlinker.start(entityId, sprite, sprite.tintTopLeft);
    this.renderTelemetry.markDirty();
  }

  private createMachineBlinkHost(): MachineBlinkHost {
    return {
      createPulseTween: (view, config) => this.createMachineBlinkPulse(view, config),
    };
  }

  private createMachineBlinkPulse(
    view: MachineBlinkView,
    config: MachineBlinkPulseConfig,
  ): MachineBlinkPulse {
    const tween = this.tweens.add(createMachineBlinkTweenSpec(view, config));
    return {
      stop: (): void => {
        tween.stop();
        view.alpha = 1;
      },
    };
  }

  private renderEntity(entity: Entity): void {
    const textureKey = resolveIdleTextureKey(entity.type);
    if (textureKey === undefined) {
      reportMissingMachineTexture(entity.type, getMachine(entity.type)?.spriteKey);
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
    this.renderTelemetry.markDirty();
  }

  private setEntityActive(entityId: string): void {
    const sprite = this.entitySprites.get(entityId);
    if (sprite === undefined) {
      return;
    }

    const machine = this.getEntityMachine(entityId);
    if (machine === undefined) {
      return;
    }

    if (!this.activeEntityIds.has(entityId)) {
      this.activeEntityIds.add(entityId);
      this.activeFrameBucket = -1;
      this.renderTelemetry.markDirty();
    }

    if (resolveActiveFrameTextureKeys(machine).length === 0) {
      const idleTextureKey = resolveIdleTextureKey(machine);
      if (idleTextureKey !== undefined) {
        sprite.setTexture(idleTextureKey);
      }
    }
  }

  private updateActiveFrames(): void {
    if (this.cleaned) {
      return;
    }

    for (const entityId of this.activeEntityIds) {
      const machine = this.getEntityMachine(entityId);
      if (machine === undefined) {
        continue;
      }

      const frameKeys = resolveActiveFrameTextureKeys(machine);
      if (frameKeys.length === 0) {
        this.setEntityIdle(entityId);
        continue;
      }

      const bucket = Math.floor(this.time.now / ACTIVE_FRAME_INTERVAL_MS);
      if (bucket !== this.activeFrameBucket) {
        this.activeFrameBucket = bucket;
        this.renderTelemetry.markDirty();
      }

      const frameKey = frameKeys[bucket % frameKeys.length];
      if (frameKey !== undefined && this.textures.exists(frameKey)) {
        this.entitySprites.get(entityId)?.setTexture(frameKey);
      }
    }
  }

  private setEntityIdle(entityId: string): void {
    if (this.activeEntityIds.delete(entityId)) {
      this.activeFrameBucket = -1;
      this.renderTelemetry.markDirty();
    }

    const sprite = this.entitySprites.get(entityId);
    if (sprite === undefined) {
      return;
    }

    const machine = this.getEntityMachine(entityId);
    if (machine === undefined) {
      return;
    }

    const textureKey = resolveIdleTextureKey(machine);
    if (textureKey !== undefined) {
      sprite.setTexture(textureKey);
    }
  }

  private getEntityMachine(entityId: string): MachineType | undefined {
    const placedType = this.placedEntities.get(entityId)?.type;
    if (placedType !== undefined) {
      return placedType;
    }
    return this.entitySprites.get(entityId)?.getData("machineType") as MachineType | undefined;
  }

  private createBeltItemViewFactory(): BeltItemViewFactory {
    return {
      hasTexture: (textureKey) => this.textures.exists(textureKey),
      createView: (descriptor, worldX, worldY) => {
        const glow = this.add
          .sprite(worldX, worldY, frameTextureKey("vfx.spark", 0))
          .setBlendMode(Phaser.BlendModes.ADD)
          .setScale(BELT_GLOW_SCALE)
          .setAlpha(BELT_GLOW_ALPHA)
          .setTint(descriptor.glowColor);
        const icon = this.add
          .sprite(worldX, worldY, descriptor.textureKey)
          .setScale(BELT_ITEM_SCALE);
        this.beltItemLayer.add(glow);
        this.beltItemLayer.add(icon);
        return this.createBeltItemView(glow, icon);
      },
    };
  }

  private createBeltItemView(
    glow: Phaser.GameObjects.Sprite,
    icon: Phaser.GameObjects.Sprite,
  ): BeltItemView {
    return {
      setPosition: (x, y) => {
        glow.setPosition(x, y);
        icon.setPosition(x, y);
      },
      destroy: () => {
        glow.destroy();
        icon.destroy();
      },
    };
  }

  private renderNotice(worldX: number, worldY: number): void {
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

  private readRenderTelemetry(): SceneRenderTelemetry {
    return this.renderTelemetry.read(
      () =>
        createSceneRenderTelemetry({
          entityIds: [...this.placedEntities.keys()],
          activeEntityIds: [...this.activeEntityIds].sort(compareEntityIds),
          activeFrameKeys: [...this.activeEntityIds]
            .sort(compareEntityIds)
            .map((entityId) => this.entitySprites.get(entityId)?.texture.key)
            .filter((key): key is string => typeof key === "string"),
          beltItemIds: [...this.beltItemRenderer.getRenderedEntityIds()].sort(),
          beltGlowCount: this.beltItemRenderer.getRendered().length,
          beltItemEventCount: this.beltItemRenderer.getChangedEventCount(),
          blockedEntityIds: [...this.machineBlinker.getBlinkingEntityIds()].sort(
            compareEntityIds,
          ),
        }),
    );
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
        render: this.readRenderTelemetry(),
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
    this.beltItemRenderer?.destroy();
    this.machineBlinker?.destroy();
    this.activeEntityIds.clear();
    this.activeFrameBucket = -1;
  };
}

function compareEntityIds(first: string, second: string): number {
  return first < second ? -1 : 1;
}
