import { type Rotation } from './machines';
import type { Cell } from './placement';

export interface BeltRun {
  /** Every cell of the run, in the order the drag passed them. */
  cells: Cell[];
  /** Facing for the belts: the direction the drag went. */
  rotation: Rotation;
}

/**
 * A straight run between two cells, snapped to whichever axis the drag covered
 * more of.
 *
 * Dragging is how a factory actually gets long: the act 3 build is ~140 cells and
 * nearly all of them are belt, and a click per cell is the difference between
 * playing the game and doing data entry. Snapping to the dominant axis is what
 * makes it usable — a mouse drag is never axis-perfect, so pixel-hunting for a
 * perfectly straight line would be worse than the clicking it replaces.
 *
 * Ties go to the horizontal leg, deliberately: a run that flickers between two
 * shapes as the mouse jitters by one pixel is worse than a run that is slightly
 * in the wrong direction, which the player can see and re-drag.
 */
export function straightRun(from: Cell, to: Cell): BeltRun {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const step: Cell = horizontal
    ? { x: Math.sign(dx), y: 0 }
    : { x: 0, y: Math.sign(dy) };

  const length = horizontal ? Math.abs(dx) : Math.abs(dy);
  const cells: Cell[] = [];
  for (let i = 0; i <= length; i++) {
    cells.push({ x: from.x + step.x * i, y: from.y + step.y * i });
  }

  // A zero-length drag still has a facing, so it can be placed as a belt; the
  // rotation is whatever the player's tool is set to, so fall back to east.
  const rotation: Rotation = step.x > 0 ? 90 : step.x < 0 ? 270 : step.y > 0 ? 180 : 0;

  return { cells, rotation: length === 0 ? 90 : rotation };
}
