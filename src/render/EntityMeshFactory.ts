import * as THREE from 'three';
import { CELL } from '../config/constants';
import { rotationDelta, type MachineType, type Rotation } from '../sim/machines';
import type { ResourceId } from '../sim/worldgen';
import { machineFootprint } from './machineShapes';

export const MACHINE_COLORS: Record<MachineType, number> = {
  extractor: 0x60a5fa,
  belt: 0xfbbf24,
  // A darker belt tone with a drilled plate look: infrastructure, not a machine.
  crossing: 0x9a7b2f,
  // Deep copper-brown: road like the crossing, but warm where the crossing is
  // olive, and clearly not the bright amber of the belt it branches.
  splitter: 0xb45309,
  depot: 0xa78bfa,
  smelter: 0xf97316,
  assembler: 0x38bdf8,
  silo: 0x86efac,
};

/** One colour per item so a belt's cargo is readable at a glance. */
export const ITEM_COLORS: Record<ResourceId, number> = {
  // Tier 0 raws
  copperOre: 0xf08a4b,
  ironOre: 0xc7d2de,
  coal: 0x4b5563,
  stone: 0x9ca3af,
  // Tier 1
  copperIngot: 0xe08c3c,
  ironIngot: 0xdbe4ec,
  refinedStone: 0xb8b2a7,
  // Tier 2
  wire: 0xf59e0b,
  gear: 0x94a3b8,
  plate: 0xcbd5e1,
  // Tier 3
  circuit: 0x34d399,
  frame: 0xa16207,
  motor: 0xf43f5e,
};

/** Yaw that points a mesh's local +x along the machine's output direction. */
export function rotationToYaw(rotation: Rotation): number {
  const delta = rotationDelta(rotation);
  return Math.atan2(-delta.y, delta.x);
}

/**
 * One mesh per entity. Phase 4 replaces this with instancing + pooling; until
 * then it keeps the scene honest about what the sim actually contains.
 */
export function createEntityMesh(type: MachineType, rotation: Rotation): THREE.Mesh {
  const { size, lift } = machineFootprint(type);
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);

  const material = new THREE.MeshStandardMaterial({
    color: MACHINE_COLORS[type],
    roughness: 0.45,
    metalness: 0.15,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = lift;
  mesh.rotation.y = rotationToYaw(rotation);

  // Small cube riding on top so flowing items are visible at a glance.
  const itemMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.32 * CELL, 0.32 * CELL, 0.32 * CELL),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222 }),
  );
  itemMesh.visible = false;
  itemMesh.position.y = size.y / 2 + 0.12;
  mesh.add(itemMesh);
  mesh.userData.itemMesh = itemMesh;

  return mesh;
}

export function setItemMarker(mesh: THREE.Mesh, item: ResourceId | null): void {
  const marker = mesh.userData.itemMesh as THREE.Mesh | undefined;
  if (!marker) return;
  marker.visible = item !== null;
  if (item) (marker.material as THREE.MeshStandardMaterial).color.setHex(ITEM_COLORS[item]);
}

export function setSelectedHighlight(mesh: THREE.Mesh, selected: boolean): void {
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.emissive.setHex(selected ? 0x2b3f55 : 0x000000);
}

export function disposeEntityMesh(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.GridHelper) {
      child.geometry.dispose();
      const material = child.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }
  });
}
