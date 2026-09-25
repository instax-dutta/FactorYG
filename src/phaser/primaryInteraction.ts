import type {
  Entity,
  GridPoint,
  MachineType,
  Rotation,
  SimulationCommand,
} from "../sim/types";

export function createPrimaryCanvasCommand(
  placementMode: MachineType | undefined,
  pendingRotation: Rotation,
  cell: GridPoint,
  placedEntity: Entity | undefined,
): SimulationCommand {
  if (placementMode === undefined) {
    return { type: "selectEntity", entityId: placedEntity?.id };
  }

  return {
    type: "placeEntity",
    machine: placementMode,
    x: cell.x,
    y: cell.y,
    rotation: pendingRotation,
  };
}
