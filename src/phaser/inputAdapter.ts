import Phaser from "phaser";
import { worldToCell } from "../sim/grid";
import type { GridPoint } from "../sim/types";

export interface CameraInputOptions {
  minZoom: number;
  maxZoom: number;
  onPrimaryClick: (cell: GridPoint) => void;
  onSecondaryClick: (cell: GridPoint) => void;
  onPointerMove: (cell: GridPoint) => void;
  onRotate: () => void;
}

interface PointerPosition {
  x: number;
  y: number;
}

export function pointerToCell(
  pointer: Phaser.Input.Pointer,
  camera: Phaser.Cameras.Scene2D.Camera,
  tileSizePx = 64,
  canvas?: HTMLCanvasElement,
): GridPoint {
  const canvasPoint = getCanvasPoint(pointer, canvas);
  const worldPoint = camera.getWorldPoint(canvasPoint?.x ?? pointer.x, canvasPoint?.y ?? pointer.y);
  return worldToCell({ x: worldPoint.x, y: worldPoint.y }, tileSizePx);
}

function getCanvasPoint(
  pointer: Phaser.Input.Pointer,
  canvas: HTMLCanvasElement | undefined,
): { x: number; y: number } | undefined {
  const event = pointer.event;
  if (canvas === undefined || event === undefined || !("clientX" in event) || !("clientY" in event)) {
    return undefined;
  }

  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return undefined;
  }

  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

export class CameraInputAdapter {
  private readonly scene: Phaser.Scene;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly options: CameraInputOptions;
  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, PointerPosition>();
  private primaryPointerId: number | undefined;
  private primaryStart: PointerPosition = { x: 0, y: 0 };
  private primaryMoved = false;
  private suppressPrimaryClick = false;
  private pinchDistance: number | undefined;
  private disposed = false;

  public constructor(
    scene: Phaser.Scene,
    camera: Phaser.Cameras.Scene2D.Camera,
    options: CameraInputOptions,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.options = options;
    this.scene.input.on("pointerdown", this.handlePointerDown);
    this.scene.input.on("pointermove", this.handlePointerMove);
    this.scene.input.on("pointerup", this.handlePointerUp);
    this.scene.input.on("pointerupoutside", this.handlePointerUp);
    this.scene.input.on("wheel", this.handleWheel);
    this.scene.input.keyboard?.on("keydown", this.handleKeyDown);
    this.scene.input.keyboard?.on("keyup", this.handleKeyUp);
    this.scene.input.mouse?.disableContextMenu();
  }

  public update(delta: number): void {
    if (this.disposed) {
      return;
    }
    const speed = (600 * Math.max(0, delta)) / 1000 / Math.max(this.camera.zoom, 0.1);
    if (this.keys.has("arrowleft") || this.keys.has("a")) {
      this.camera.scrollX -= speed;
    }
    if (this.keys.has("arrowright") || this.keys.has("d")) {
      this.camera.scrollX += speed;
    }
    if (this.keys.has("arrowup") || this.keys.has("w")) {
      this.camera.scrollY -= speed;
    }
    if (this.keys.has("arrowdown") || this.keys.has("s")) {
      this.camera.scrollY += speed;
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.scene.input.off("pointerdown", this.handlePointerDown);
    this.scene.input.off("pointermove", this.handlePointerMove);
    this.scene.input.off("pointerup", this.handlePointerUp);
    this.scene.input.off("pointerupoutside", this.handlePointerUp);
    this.scene.input.off("wheel", this.handleWheel);
    this.scene.input.keyboard?.off("keydown", this.handleKeyDown);
    this.scene.input.keyboard?.off("keyup", this.handleKeyUp);
    this.keys.clear();
    this.pointers.clear();
  }

  private pointerPosition(pointer: Phaser.Input.Pointer): PointerPosition {
    return getCanvasPoint(pointer, this.scene.scale.canvas) ?? { x: pointer.x, y: pointer.y };
  }

  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    const position = this.pointerPosition(pointer);
    this.pointers.set(pointer.id, position);
    this.updatePinchDistance();
    if (this.pointers.size >= 2) {
      this.suppressPrimaryClick = true;
    }

    if (pointer.button === 2) {
      this.options.onSecondaryClick(pointerToCell(pointer, this.camera, 64, this.scene.scale.canvas));
      return;
    }

    if (pointer.button === 0) {
      this.primaryPointerId = pointer.id;
      this.primaryStart = position;
      this.primaryMoved = false;
    }
  };

  private readonly handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    const position = this.pointerPosition(pointer);
    const previous = this.pointers.get(pointer.id) ?? position;
    this.pointers.set(pointer.id, position);
    this.options.onPointerMove(pointerToCell(pointer, this.camera, 64, this.scene.scale.canvas));

    if (this.pointers.size >= 2) {
      this.suppressPrimaryClick = true;
      const previousDistance = this.pinchDistance;
      const nextDistance = this.getPinchDistance();
      if (previousDistance !== undefined && nextDistance !== undefined && nextDistance > 0) {
        this.setZoom(this.camera.zoom * (nextDistance / previousDistance));
      }
      this.pinchDistance = nextDistance;
      return;
    }

    if (this.primaryPointerId !== pointer.id) {
      return;
    }

    const deltaX = position.x - previous.x;
    const deltaY = position.y - previous.y;
    if (Math.hypot(position.x - this.primaryStart.x, position.y - this.primaryStart.y) > 6) {
      this.primaryMoved = true;
    }
    if (this.primaryMoved) {
      this.camera.scrollX -= deltaX / Math.max(this.camera.zoom, 0.1);
      this.camera.scrollY -= deltaY / Math.max(this.camera.zoom, 0.1);
    }
  };

  private readonly handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (this.primaryPointerId === pointer.id) {
      if (!this.primaryMoved && !this.suppressPrimaryClick && pointer.button === 0) {
        this.options.onPrimaryClick(pointerToCell(pointer, this.camera, 64, this.scene.scale.canvas));
      }
      this.primaryPointerId = undefined;
      this.primaryStart = { x: 0, y: 0 };
      this.primaryMoved = false;
    }
    this.pointers.delete(pointer.id);
    this.pinchDistance = this.getPinchDistance();
    if (this.pointers.size === 0) {
      this.suppressPrimaryClick = false;
    }
  };

  private readonly handleWheel = (
    _pointer: Phaser.Input.Pointer,
    _objects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ): void => {
    this.setZoom(this.camera.zoom * (deltaY > 0 ? 0.9 : 1.1));
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    this.keys.add(key);
    if (key === "r" && !event.repeat) {
      this.options.onRotate();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private setZoom(value: number): void {
    this.camera.setZoom(
      Phaser.Math.Clamp(value, this.options.minZoom, this.options.maxZoom),
    );
  }

  private updatePinchDistance(): void {
    this.pinchDistance = this.getPinchDistance();
  }

  private getPinchDistance(): number | undefined {
    if (this.pointers.size < 2) {
      return undefined;
    }
    const points = [...this.pointers.values()];
    const first = points[0];
    const second = points[1];
    return Math.hypot(first.x - second.x, first.y - second.y);
  }
}

export function createInputAdapter(
  scene: Phaser.Scene,
  camera: Phaser.Cameras.Scene2D.Camera,
  options: CameraInputOptions,
): CameraInputAdapter {
  return new CameraInputAdapter(scene, camera, options);
}
