import Phaser from "phaser";
import { createSceneSoundPlayer } from "../audio/browserPlayer";
import {
  createSoundDirector,
  type SoundDirector,
  type SoundPlayer,
} from "../audio/sound";
import { ASSET_MANIFEST, type AssetKey } from "../content/assetManifest";
import { getMachine } from "../content/machines";
import { TILE_SIZE_PX } from "../sim/constants";
import { cellToWorld } from "../sim/grid";
import type {
  Entity,
  GridDimensions,
  RenderEvent,
  SimulationSnapshot,
} from "../sim/types";
import { SimulationStore } from "../sim/store";
import {
  CAMERA_INITIAL_ZOOM,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  createCameraConfig,
} from "./cameraConfig";
import { createInputAdapter, type CameraInputAdapter } from "./inputAdapter";
import { createPrimaryCanvasCommand } from "./primaryInteraction";
import {
  createBeltItemRenderer,
  type BeltItemRenderer,
  type BeltItemView,
  type BeltItemViewFactory,
} from "./render/BeltItemRenderer";
import {
  createEntityRenderer,
  type EntityRenderer,
  type EntityView,
  type EntityViewDescriptor,
  type EntityViewFactory,
} from "./render/EntityRenderer";
import { createFloorTileData } from "./render/floorGrid";
import {
  createNodeRenderer,
  NODE_VIEW_ALPHA,
  type NodeRenderer,
  type NodeSprite,
  type NodeViewFactory,
} from "./render/NodeRenderer";
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
  resolveIdleTextureKey,
} from "./render/textureKeys";
import {
  createVfxRenderer,
  type VfxRenderer,
  type VfxTweenHost,
  type VfxView,
  type VfxViewDescriptor,
  type VfxViewFactory,
} from "./render/VfxRenderer";
import {
  createRenderTelemetryCache,
  createSceneRenderTelemetry,
  createSceneSoundTelemetry,
  createSceneTelemetry,
  type SceneRenderTelemetry,
  type SceneTelemetry,
} from "./telemetry";

const BELT_GLOW_SCALE = 3.4;
const BELT_GLOW_ALPHA = 0.6;
const BELT_ITEM_SCALE = 1.5;

export class FactoryScene extends Phaser.Scene {
  private readonly store: SimulationStore;
  private readonly onReady: () => void;
  private readonly onTelemetry: (telemetry: SceneTelemetry) => void;
  private floorMap: Phaser.Tilemaps.Tilemap | undefined;
  private floorLayer: Phaser.Tilemaps.TilemapLayer | undefined;
  private gridDimensions: GridDimensions | undefined;
  private nodeLayer!: Phaser.GameObjects.Layer;
  private machineLayer!: Phaser.GameObjects.Layer;
  private beltLayer!: Phaser.GameObjects.Layer;
  private beltItemLayer!: Phaser.GameObjects.Layer;
  private ghostLayer!: Phaser.GameObjects.Layer;
  private vfxLayer!: Phaser.GameObjects.Layer;
  private ghost!: Phaser.GameObjects.Sprite;
  private beltItemRenderer!: BeltItemRenderer;
  private entityRenderer!: EntityRenderer;
  private nodeRenderer!: NodeRenderer;
  private vfxRenderer!: VfxRenderer;
  private inputAdapter: CameraInputAdapter | undefined;
  private snapshot!: SimulationSnapshot;
  private ghostCell: { x: number; y: number } | undefined;
  private ghostValid = false;
  private ready = false;
  private readyNotified = false;
  private cleaned = false;
  private readonly renderTelemetry = createRenderTelemetryCache(
    createSceneRenderTelemetry({
      entityIds: [],
      activeEntityIds: [],
      activeFrameKeys: [],
      beltItemIds: [],
      beltGlowCount: 0,
      beltItemEventCount: 0,
      blockedEntityIds: [],
      heatEntityIds: [],
      saleBurstCount: 0,
      liveBurstCount: 0,
      nodeSpriteCount: 0,
      nodeSpriteCells: [],
    }),
  );
  private machineBlinker!: MachineBlinker;
  private soundPlayer!: SoundPlayer;
  private soundDirector!: SoundDirector;
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

    const dimensions = this.store.getGridDimensions();
    const camera = this.cameras.main;
    camera.setZoom(CAMERA_INITIAL_ZOOM);
    camera.centerOn((dimensions.width * TILE_SIZE_PX) / 2, (dimensions.height * TILE_SIZE_PX) / 2);

    this.refreshGridBounds();
    this.nodeLayer = this.add.layer().setName("node-layer").setDepth(5);
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
    this.entityRenderer = createEntityRenderer({ factory: this.createEntityViewFactory() });
    this.nodeRenderer = createNodeRenderer({ factory: this.createNodeViewFactory() });
    this.vfxRenderer = createVfxRenderer({
      factory: this.createVfxViewFactory(),
      tweens: this.createVfxTweenHost(),
      resolveEntity: (entityId) => this.entityRenderer.getEntity(entityId),
    });
    this.beltItemRenderer = createBeltItemRenderer({
      factory: this.createBeltItemViewFactory(),
      resolvePosition: (entityId) => this.entityRenderer.resolveWorldPosition(entityId),
    });
    this.machineBlinker = createMachineBlinker(this.createMachineBlinkHost());
    this.soundPlayer = createSceneSoundPlayer();
    this.soundDirector = createSoundDirector({ player: this.soundPlayer });
    this.soundDirector.handleSnapshot(this.store.getSnapshot());

    this.snapshot = this.store.getSnapshot();
    this.unsubscribeSnapshot = this.store.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.refreshGridBounds();
      this.refreshGhost();
      this.refreshBlockedMachines();
      this.soundDirector.handleSnapshot(snapshot);
      this.publishTelemetry();
    });
    this.unsubscribeEvents = this.store.subscribeEvents((event) => this.handleRenderEvent(event));
    this.inputAdapter = createInputAdapter(this, camera, {
      minZoom: CAMERA_MIN_ZOOM,
      maxZoom: CAMERA_MAX_ZOOM,
      onPrimaryClick: (cell) => this.handlePrimaryClick(cell),
      onSecondaryClick: (cell) => this.demolishAt(cell),
      onPointerMove: (cell) => this.updateGhost(cell),
      onRotate: () => this.store.dispatch({ type: "rotatePlacement" }),
    });
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.unlockSound);
    this.input.keyboard?.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.unlockSound);
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

  private refreshGridBounds(): void {
    const dimensions = this.store.getGridDimensions();
    const current = this.gridDimensions;
    if (
      current !== undefined &&
      current.width === dimensions.width &&
      current.height === dimensions.height
    ) {
      return;
    }

    const cameraConfig = createCameraConfig(dimensions.width, dimensions.height);
    this.cameras.main.setBounds(0, 0, cameraConfig.boundsWidth, cameraConfig.boundsHeight);
    this.rebuildFloor(dimensions);
  }

  private rebuildFloor(dimensions: GridDimensions): void {
    this.gridDimensions = { ...dimensions };
    this.floorLayer?.destroy();
    this.floorLayer = undefined;
    this.floorMap?.destroy();
    this.floorMap = undefined;

    const map = this.make.tilemap({
      data: createFloorTileData(dimensions.width, dimensions.height),
      tileWidth: TILE_SIZE_PX,
      tileHeight: TILE_SIZE_PX,
      width: dimensions.width,
      height: dimensions.height,
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
      map.destroy();
      return;
    }

    const floorLayer = map.createLayer(0, tileset, 0, 0);
    if (floorLayer === null) {
      map.destroy();
      return;
    }

    floorLayer.setDepth(0);
    this.floorLayer = floorLayer;
    this.floorMap = map;
  }

  private syncExistingWorld(): void {
    this.nodeRenderer.sync(this.store.getNodes());

    for (const entity of this.store.getEntities()) {
      this.entityRenderer.place(entity);
    }

    this.entityRenderer.syncActive(this.store.getActiveMachineIds());

    for (const entityId of this.store.getBlockedMachineIds()) {
      this.setEntityBlocked(entityId);
    }

    const carriedItems = this.store.getBeltItems();
    this.beltItemRenderer.sync(carriedItems);
    for (const entityId of Object.keys(carriedItems)) {
      this.entityRenderer.setActive(entityId);
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
    for (const entityId of this.entityRenderer.getEntityIds()) {
      const entity = this.entityRenderer.getEntity(entityId);
      if (entity?.x === cell.x && entity?.y === cell.y) {
        return entity;
      }
    }
    return undefined;
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
    this.soundDirector.handleEvent(event);
    switch (event.type) {
      case "entityPlaced":
        if (this.entityRenderer.place(event.entity)) {
          this.renderTelemetry.markDirty();
        }
        break;
      case "entityRemoved": {
        this.machineBlinker.stop(event.entityId);
        this.entityRenderer.remove(event.entityId);
        this.beltItemRenderer.remove(event.entityId);
        this.vfxRenderer.remove(event.entityId);
        this.renderTelemetry.markDirty();
        break;
      }
      case "machineStateChanged":
        if (event.active) {
          this.entityRenderer.setActive(event.entityId);
        } else {
          this.entityRenderer.setIdle(event.entityId);
        }
        if (this.vfxRenderer.apply(event)) {
          this.renderTelemetry.markDirty();
        }
        break;
      case "beltItemChanged":
        this.beltItemRenderer.apply(event);
        this.renderTelemetry.markDirty();
        if (event.item === undefined) {
          this.entityRenderer.setIdle(event.entityId);
        } else {
          this.entityRenderer.setActive(event.entityId);
        }
        break;
      case "blockedFull":
        this.setEntityBlocked(event.entityId);
        break;
      case "storageFull":
        this.renderNotice(event.worldX, event.worldY);
        break;
      case "saleCompleted":
        if (this.vfxRenderer.apply(event)) {
          this.renderTelemetry.markDirty();
        }
        break;
      default:
        return this.assertUnreachableRenderEvent(event);
    }
  }

  private assertUnreachableRenderEvent(event: never): never {
    throw new Error(`Unhandled render event: ${JSON.stringify(event)}`);
  }

  private setEntityBlocked(entityId: string): void {
    const view = this.entityRenderer.getView(entityId);
    if (view === undefined || this.machineBlinker.isBlinking(entityId)) {
      return;
    }

    this.machineBlinker.start(entityId, view, view.baseTint);
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

  private createEntityViewFactory(): EntityViewFactory {
    return {
      hasTexture: (textureKey) => this.textures.exists(textureKey),
      createView: (descriptor) => this.createEntityView(descriptor),
    };
  }

  private createNodeViewFactory(): NodeViewFactory {
    return {
      hasTexture: (textureKey) => this.textures.exists(textureKey),
      createView: (worldX, worldY, textureKey) => this.createNodeView(worldX, worldY, textureKey),
    };
  }

  private createNodeView(worldX: number, worldY: number, textureKey: string): NodeSprite {
    const sprite = this.add
      .sprite(worldX, worldY, textureKey)
      .setData("resourceNode", true)
      .setAlpha(NODE_VIEW_ALPHA);
    this.nodeLayer.add(sprite);
    return { destroy: () => sprite.destroy() };
  }

  private createEntityView(descriptor: EntityViewDescriptor): EntityView {
    const sprite = this.add
      .sprite(descriptor.worldX, descriptor.worldY, descriptor.textureKey)
      .setData("entityId", descriptor.entityId)
      .setData("machineType", descriptor.machineType);
    if (descriptor.layer === "belt") {
      this.beltLayer.add(sprite);
    } else {
      this.machineLayer.add(sprite);
    }

    return {
      entityId: descriptor.entityId,
      get textureKey(): string | undefined {
        return sprite.texture.key;
      },
      get baseTint(): number {
        return sprite.tintTopLeft;
      },
      get alpha(): number {
        return sprite.alpha;
      },
      set alpha(value: number) {
        sprite.alpha = value;
      },
      setTexture: (textureKey) => {
        sprite.setTexture(textureKey);
      },
      setAngle: (degrees) => {
        sprite.setAngle(degrees);
      },
      setTint: (color) => {
        sprite.setTint(color);
      },
      destroy: () => {
        sprite.destroy();
      },
    };
  }

  private createVfxViewFactory(): VfxViewFactory {
    return {
      hasTexture: (textureKey) => this.textures.exists(textureKey),
      createView: (descriptor) => this.createVfxView(descriptor),
    };
  }

  private createVfxView(descriptor: VfxViewDescriptor): VfxView {
    const sprite = this.add.sprite(
      descriptor.worldX,
      descriptor.worldY,
      frameTextureKey(descriptor.assetKey, 0),
    );
    if (descriptor.additive) {
      sprite.setBlendMode(Phaser.BlendModes.ADD);
    }
    sprite.setTint(descriptor.tint);
    sprite.setScale(descriptor.scale);
    sprite.setAlpha(descriptor.alpha);
    this.vfxLayer.add(sprite);

    return {
      get x(): number {
        return sprite.x;
      },
      set x(value: number) {
        sprite.x = value;
      },
      get y(): number {
        return sprite.y;
      },
      set y(value: number) {
        sprite.y = value;
      },
      get scale(): number {
        return sprite.scaleX;
      },
      set scale(value: number) {
        sprite.setScale(value);
      },
      get alpha(): number {
        return sprite.alpha;
      },
      set alpha(value: number) {
        sprite.alpha = value;
      },
      setTint: (color) => {
        sprite.setTint(color);
      },
      setVisible: (visible) => {
        sprite.setVisible(visible);
      },
      destroy: () => {
        sprite.destroy();
      },
    };
  }

  private createVfxTweenHost(): VfxTweenHost {
    return {
      createPulseTween: (spec) => {
        const tween = this.tweens.add({
          targets: spec.targets,
          alpha: spec.alpha,
          duration: spec.duration,
          yoyo: spec.yoyo,
          repeat: spec.repeat,
        });
        return {
          stop: (): void => {
            tween.stop();
          },
        };
      },
      createOneShotTween: (spec) => {
        const tween = this.tweens.add({
          targets: spec.targets,
          y: spec.y,
          scale: spec.scale,
          alpha: spec.alpha,
          duration: spec.duration,
          onComplete: () => spec.onComplete(),
        });
        return {
          stop: (): void => {
            tween.stop();
          },
        };
      },
    };
  }

  private updateActiveFrames(): void {
    if (this.cleaned) {
      return;
    }

    if (this.entityRenderer.advanceFrames(this.time.now)) {
      this.renderTelemetry.markDirty();
    }
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

  private readonly unlockSound = (): void => {
    this.soundPlayer.unlock();
  };

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
          entityIds: this.entityRenderer.getEntityIds(),
          activeEntityIds: this.entityRenderer.getActiveEntityIds(),
          activeFrameKeys: this.entityRenderer.getActiveFrameKeys(),
          beltItemIds: [...this.beltItemRenderer.getRenderedEntityIds()].sort(),
          beltGlowCount: this.beltItemRenderer.getRendered().length,
          beltItemEventCount: this.beltItemRenderer.getChangedEventCount(),
          blockedEntityIds: [...this.machineBlinker.getBlinkingEntityIds()].sort(
            compareEntityIds,
          ),
          heatEntityIds: this.vfxRenderer.getHeatEntityIds(),
          saleBurstCount: this.vfxRenderer.getSaleBurstCount(),
          liveBurstCount: this.vfxRenderer.getLiveBurstCount(),
          nodeSpriteCount: this.nodeRenderer.getSpriteCount(),
          nodeSpriteCells: this.nodeRenderer.getSpriteCells(),
        }),
    );
  }

  private publishTelemetry(): void {
    if (this.cleaned || this.snapshot === undefined || this.soundPlayer === undefined) {
      return;
    }
    const camera = this.cameras.main;
    const bounds = camera.getBounds();
    this.onTelemetry(
      createSceneTelemetry({
        ready: this.ready,
        camera: {
          scrollX: camera.scrollX,
          scrollY: camera.scrollY,
          zoom: camera.zoom,
          boundsWidth: bounds.width,
          boundsHeight: bounds.height,
        },
        ghost: {
          visible: this.ghost?.visible ?? false,
          valid: this.ghostValid,
          rotation: this.snapshot.pendingRotation,
        },
        render: this.readRenderTelemetry(),
        sound: createSceneSoundTelemetry(
          this.soundDirector.getTriggerCounts(),
          this.soundPlayer.getState(),
        ),
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
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.unlockSound);
    this.input.keyboard?.off(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.unlockSound);
    this.soundDirector?.dispose();
    this.floorLayer?.destroy();
    this.floorLayer = undefined;
    this.floorMap?.destroy();
    this.floorMap = undefined;
    this.gridDimensions = undefined;
    this.beltItemRenderer?.destroy();
    this.nodeRenderer?.destroy();
    this.vfxRenderer?.destroy();
    this.machineBlinker?.destroy();
    this.entityRenderer?.clearActive();
  };
}

function compareEntityIds(first: string, second: string): number {
  return first < second ? -1 : 1;
}
