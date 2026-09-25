import type { GridPoint, Rotation } from "./types";

export function rotatePoint(point: GridPoint, rotation: Rotation): GridPoint {
  let { x, y } = point;
  const steps = rotation / 90;

  for (let step = 0; step < steps; step += 1) {
    const previousX = x;
    x = -y;
    y = previousX;
  }

  return { x, y };
}

export function rotateGridPoint(point: GridPoint, rotation: Rotation): GridPoint {
  return rotatePoint(point, rotation);
}

export function nextRotation(rotation: Rotation): Rotation {
  return rotation === 270 ? 0 : ((rotation + 90) as Rotation);
}
