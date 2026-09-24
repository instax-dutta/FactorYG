import * as THREE from 'three';
import { rotationDelta, type MachineType, type Rotation } from '../sim/machines';
import { cellToWorld, type Cell, type PlacementPreview } from '../sim/placement';
import type { ConnectionQuality } from '../sim/connections';
import { machineFootprint, outputMarkerOffset } from './machineShapes';
import { rotationToYaw } from './EntityMeshFactory';

const VALID_COLOR = 0x4ade80;
const AMBER_COLOR = 0xfbbf24;
const INVALID_COLOR = 0xf87171;
const CURSOR_COLOR = 0x60a5fa;

export type GhostStatus = boolean | ConnectionQuality | PlacementPreview | { ok: boolean };

export function ghostColor(status: GhostStatus): number {
  if (typeof status === 'boolean') return status ? VALID_COLOR : INVALID_COLOR;
  if (status === 'connected') return VALID_COLOR;
  if (status === 'partial' || status === 'disconnected') return AMBER_COLOR;
  if ('connection' in status) {
    if (!status.check.ok) return INVALID_COLOR;
    return status.connection === 'connected' ? VALID_COLOR : AMBER_COLOR;
  }
  return status.ok ? VALID_COLOR : INVALID_COLOR;
}

/**
 * Thin view over the placement validator: it owns no rules, only the tinted
 * preview. Validity decisions come from `canPlace()`.
 *
 * It previews the machine *as it will be placed* — same silhouette, same facing
 * — plus a marker on the output side. Without that, a player rotating a belt or
 * a smelter is placing blind, because the tint says only whether the cell is
 * legal, never which way the machine will point.
 */
/** How many cells of a dragged run are previewed at once. */
const RUN_PREVIEW_CAP = 128;

export class GhostPreview {
  readonly group: THREE.Group;
  readonly cursorGroup: THREE.Group;
  private readonly cursor: THREE.Mesh;
  private readonly cursorMaterial: THREE.MeshBasicMaterial;
  private readonly cursorGeometry: THREE.BoxGeometry;
  private readonly body: THREE.Mesh;
  private readonly marker: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly geometries = new Map<MachineType, THREE.BoxGeometry>();
  private shownType: MachineType | null = null;

  /**
   * A pool for dragged runs. One ghost per cell would mean allocating a mesh per
   * mouse move, so the pool is grown on demand and the surplus is hidden.
   * Each entry owns its material: a run can be blocked on the far end while its
   * near cells are fine, and the player needs to see *which* cell is the problem.
   */
  private readonly runPool: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }[] = [];

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      color: VALID_COLOR,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.marker = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), this.material);

    this.cursorGeometry = new THREE.BoxGeometry(0.92, 0.04, 0.92);
    this.cursorMaterial = new THREE.MeshBasicMaterial({
      color: CURSOR_COLOR,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
    });
    this.cursor = new THREE.Mesh(this.cursorGeometry, this.cursorMaterial);
    this.cursor.position.y = 0.04;
    this.cursor.renderOrder = 10;

    this.group = new THREE.Group();
    this.group.add(this.body, this.marker);
    this.group.visible = false;
    this.cursorGroup = new THREE.Group();
    this.cursorGroup.add(this.cursor);
    this.cursorGroup.visible = false;
  }

  /**
   * Previews a whole belt run, each cell tinted on its own merits. This is the
   * only feedback a drag has: without it the player is drawing invisible lines
   * across the map and finding out afterwards.
   */
  showRun(cells: Cell[], rotation: Rotation, status: (cell: Cell) => GhostStatus): void {
    this.group.visible = false;
    const { size, lift } = machineFootprint('belt');

    cells.slice(0, RUN_PREVIEW_CAP).forEach((cell, index) => {
      let entry = this.runPool[index];
      if (!entry) {
        const material = new THREE.MeshBasicMaterial({
          color: VALID_COLOR,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
        entry = { mesh, material };
        this.runPool[index] = entry;
        this.group.add(mesh);
      }

      entry.material.color.setHex(ghostColor(status(cell)));
      entry.mesh.position.y = lift;
      entry.mesh.rotation.y = rotationToYaw(rotation);
      const world = cellToWorld(cell);
      entry.mesh.position.x = world.x;
      entry.mesh.position.z = world.z;
      entry.mesh.visible = true;
    });

    for (let index = cells.length; index < this.runPool.length; index++) {
      this.runPool[index].mesh.visible = false;
    }
    if (cells.length === 0) return;
    this.group.visible = true;
  }

  /**
   * Previews `type` at `cell`, tinted by whether the placement is legal. The
   * group is world-aligned and only the body is turned, so the marker can be
   * positioned straight from the sim's output direction.
   */
  showAt(cell: Cell, result: GhostStatus, type: MachineType, rotation: Rotation): void {
    const { size, lift } = machineFootprint(type);

    this.body.geometry = this.geometryFor(type, size);
    this.body.position.y = lift;
    this.body.rotation.y = rotationToYaw(rotation);

    // Sit the marker on the output edge, halfway across the body on that axis.
    const delta = rotationDelta(rotation);
    const half = (delta.x !== 0 ? size.x : size.z) / 2;
    const offset = outputMarkerOffset(rotation, half);
    this.marker.position.set(offset.x, lift, offset.z);

    this.material.color.setHex(ghostColor(result));

    const world = cellToWorld(cell);
    this.group.position.set(world.x, 0, world.z);
    this.group.visible = true;
  }

  showCursor(cell: Cell): void {
    const world = cellToWorld(cell);
    this.cursorGroup.position.set(world.x, 0, world.z);
    this.cursorGroup.visible = true;
  }

  hideCursor(): void {
    this.cursorGroup.visible = false;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    this.body.geometry.dispose();
    this.marker.geometry.dispose();
    this.material.dispose();
    this.cursorGeometry.dispose();
    this.cursorMaterial.dispose();
    for (const entry of this.runPool) {
      entry.mesh.geometry.dispose();
      entry.material.dispose();
    }
    this.runPool.length = 0;
  }

  private geometryFor(type: MachineType, size: { x: number; y: number; z: number }): THREE.BoxGeometry {
    if (this.shownType === type) {
      const existing = this.geometries.get(type);
      if (existing) return existing;
    }
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    this.geometries.set(type, geometry);
    this.shownType = type;
    return geometry;
  }
}
