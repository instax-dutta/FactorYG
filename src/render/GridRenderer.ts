import * as THREE from 'three';
import { GRID_H, GRID_W } from '../config/constants';

export const GROUND_NAME = 'ground';

/**
 * Grid lines plus a raycast plane. Cell (0,0) is centred on world (0,0), so the
 * grid spans -0.5 .. width - 0.5. Sized to the plot, which grows with
 * expansions (always in equal steps on both axes, so width === height).
 */
export function createGrid(width: number = GRID_W, height: number = GRID_H): THREE.Group {
  const group = new THREE.Group();
  const centerX = (width - 1) / 2;
  const centerZ = (height - 1) / 2;

  const lines = new THREE.GridHelper(width, width, 0x3b4d61, 0x223040);
  lines.position.set(centerX, 0, centerZ);
  group.add(lines);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ color: 0x121a22, side: THREE.DoubleSide }),
  );
  ground.name = GROUND_NAME;
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(centerX, -0.002, centerZ);
  group.add(ground);

  return group;
}
