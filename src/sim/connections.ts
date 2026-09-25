import { getMachine } from "../content/machines";
import { getRecipe } from "../content/recipes";
import { rotateGridPoint } from "./rotation";
import type { Entity, MachineDefinition, PortDefinition, ResourceId, Rotation } from "./types";

export interface WorldPortCell {
  port: PortDefinition;
  x: number;
  y: number;
}

function isProcessorEntity(entity: Entity): boolean {
  return entity.type === "smelter" || entity.type === "assembler";
}

export function rotatePorts(ports: readonly PortDefinition[], rotation: Rotation): PortDefinition[] {
  return ports.map((port) => ({
    ...port,
    offset: rotateGridPoint(port.offset, rotation),
  }));
}

export function getWorldPortCells(entity: Entity): WorldPortCell[] {
  const definition = getMachine(entity.type);
  if (definition === undefined) {
    return [];
  }

  return rotatePorts(definition.ports, entity.rotation).map((port) => ({
    port,
    x: entity.x + port.offset.x,
    y: entity.y + port.offset.y,
  }));
}

export function arePortsConnected(
  outputEntity: Entity,
  inputEntity: Entity,
  carriedResource?: ResourceId,
): boolean {
  const outputDefinition = getMachine(outputEntity.type);
  const inputDefinition = getMachine(inputEntity.type);
  if (outputDefinition === undefined || inputDefinition === undefined) {
    return false;
  }

  const outputPorts = rotatePorts(outputDefinition.ports, outputEntity.rotation).filter(
    (port) => port.kind === "output",
  );
  const inputPorts = rotatePorts(inputDefinition.ports, inputEntity.rotation).filter(
    (port) => port.kind === "input",
  );
  const deltaX = inputEntity.x - outputEntity.x;
  const deltaY = inputEntity.y - outputEntity.y;

  return outputPorts.some((outputPort) =>
    inputPorts.some((inputPort) => {
      const facesTarget =
        outputPort.offset.x === deltaX &&
        outputPort.offset.y === deltaY &&
        inputPort.offset.x === -deltaX &&
        inputPort.offset.y === -deltaY;
      const producedResource =
        carriedResource === undefined
          ? getProducedResource(outputEntity, outputPort)
          : carriedResource;
      const hasValidOutput =
        !isProcessorEntity(outputEntity) ||
        outputPort.produces !== undefined ||
        producedResource !== undefined;
      return facesTarget && hasValidOutput && portAcceptsResource(outputPort, inputPort, producedResource);
    }),
  );
}

export function getEntityAt(entities: readonly Entity[], x: number, y: number): Entity | undefined {
  return entities.find((entity) => entity.x === x && entity.y === y);
}

export function findConnectedEntity(entity: Entity, entities: readonly Entity[]): Entity | undefined {
  return entities.find(
    (candidate) => candidate.id !== entity.id && arePortsConnected(entity, candidate),
  );
}

export function portAcceptsResource(
  outputPort: PortDefinition,
  inputPort: PortDefinition,
  producedResource = outputPort.produces,
): boolean {
  if (producedResource === undefined || inputPort.accepts === undefined) {
    return true;
  }

  return inputPort.accepts.includes(producedResource);
}

export function getProducedResource(
  entity: Entity,
  port: PortDefinition,
): ResourceId | undefined {
  if (port.produces !== undefined) {
    return port.produces;
  }
  if (entity.type === "extractor") {
    return entity.resourceNode;
  }
  if (!isProcessorEntity(entity) || entity.recipeId === undefined) {
    return undefined;
  }
  const recipe = getRecipe(entity.recipeId);
  return recipe?.machine === entity.type ? recipe.output.resource : undefined;
}

export function getDefinition(type: string): MachineDefinition | undefined {
  return getMachine(type);
}
