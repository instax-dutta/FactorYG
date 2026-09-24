import { CELL } from '../config/constants';
import { rotationDelta, type MachineType, type Rotation } from '../sim/machines';

export interface MachineFootprint {
  /** Body dimensions in world units, before rotation. */
  size: { x: number; y: number; z: number };
  /** Height of the body's centre, i.e. half its height: it stands on the ground. */
  lift: number;
}

/**
 * One silhouette per machine type. This is the single source of truth for a
 * machine's shape: the placed mesh, the placement ghost and the scene's mesh
 * positioning all read it, so a preview can never disagree with what lands.
 *
 * Shapes differ on purpose. The ghost is tinted by *validity*, not by type, so
 * with six machines in the build panel its outline is the only thing telling a
 * player what they are about to place.
 */
const SIZES: Record<MachineType, { x: number; y: number; z: number }> = {
  // Flat: a belt lies on the ground so its direction reads from an isometric view.
  belt: { x: 0.95, y: 0.28, z: 0.7 },
  // A thin plate: visibly *not* a belt, since flow through it is axis-driven
  // (both directions pass), not the facing a silhouette would suggest.
  crossing: { x: 0.95, y: 0.18, z: 0.95 },
  // A junction plate: full-width like the crossing but raised off the ground,
  // so the two road tiles do not read as the same thing from an iso view.
  splitter: { x: 0.95, y: 0.4, z: 0.95 },
  extractor: { x: 0.85, y: 0.6, z: 0.85 },
  smelter: { x: 0.9, y: 0.7, z: 0.9 },
  assembler: { x: 0.95, y: 0.5, z: 0.8 },
  // A tower, so storage never has to be guessed at.
  silo: { x: 0.7, y: 1.1, z: 0.7 },
  depot: { x: 0.95, y: 0.9, z: 0.95 },
};

export function machineFootprint(type: MachineType): MachineFootprint {
  const raw = SIZES[type];
  const size = { x: raw.x * CELL, y: raw.y * CELL, z: raw.z * CELL };
  return { size, lift: size.y / 2 };
}

/**
 * How far a machine's output side sits from its cell centre, in world units.
 * World axes line up with the grid's (`cellToWorld`), so this is the grid
 * direction the sim will push items along, scaled to the body.
 */
export function outputMarkerOffset(rotation: Rotation, distance: number): { x: number; z: number } {
  const delta = rotationDelta(rotation);
  return { x: delta.x * distance, z: delta.y * distance };
}
