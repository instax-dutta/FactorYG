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

const NO_PORTS: readonly PortDefinition[] = [];

interface PortKinds {
  readonly inputs: readonly PortDefinition[];
  readonly outputs: readonly PortDefinition[];
}

const ROTATION_COUNT = 4;
const ROTATED_PORTS = new WeakMap<MachineDefinition, PortDefinition[][]>();
const PORT_KINDS = new WeakMap<MachineDefinition, PortKinds[]>();

function getCachedRotatedPorts(
  definition: MachineDefinition,
  rotation: Rotation,
): readonly PortDefinition[] {
  let byRotation = ROTATED_PORTS.get(definition);
  if (byRotation === undefined) {
    byRotation = [];
    for (let step = 0; step < ROTATION_COUNT; step += 1) {
      byRotation.push(
        definition.ports.map((port) => ({
          ...port,
          offset: rotateGridPoint(port.offset, (step * 90) as Rotation),
        })),
      );
    }
    ROTATED_PORTS.set(definition, byRotation);
  }

  return byRotation[rotation / 90] ?? NO_PORTS;
}

function getCachedPortKinds(
  definition: MachineDefinition,
  rotation: Rotation,
): PortKinds {
  let byRotation = PORT_KINDS.get(definition);
  if (byRotation === undefined) {
    byRotation = [];
    PORT_KINDS.set(definition, byRotation);
  }

  const slot = rotation / 90;
  const cached = byRotation[slot];
  if (cached !== undefined) {
    return cached;
  }

  const ports = getCachedRotatedPorts(definition, rotation);
  const inputs: PortDefinition[] = [];
  const outputs: PortDefinition[] = [];
  for (const port of ports) {
    if (port.kind === "output") {
      outputs.push(port);
    } else {
      inputs.push(port);
    }
  }

  const kinds: PortKinds = { inputs, outputs };
  byRotation[slot] = kinds;
  return kinds;
}

function resolvePortSource(type: string): MachineDefinition | undefined {
  return getMachine(type);
}

export function getWorldPortCells(entity: Entity): WorldPortCell[] {
  const definition = resolvePortSource(entity.type);
  if (definition === undefined) {
    return [];
  }

  const ports = getCachedRotatedPorts(definition, entity.rotation);
  if (ports.length === 0) {
    return [];
  }

  const cells: WorldPortCell[] = [];
  for (const port of ports) {
    cells.push({
      port,
      x: entity.x + port.offset.x,
      y: entity.y + port.offset.y,
    });
  }
  return cells;
}

export function arePortsConnected(
  outputEntity: Entity,
  inputEntity: Entity,
  carriedResource?: ResourceId,
): boolean {
  const outputDefinition = resolvePortSource(outputEntity.type);
  const inputDefinition = resolvePortSource(inputEntity.type);
  if (outputDefinition === undefined || inputDefinition === undefined) {
    return false;
  }

  const outputKinds = getCachedPortKinds(outputDefinition, outputEntity.rotation);
  const inputKinds = getCachedPortKinds(inputDefinition, inputEntity.rotation);
  if (outputKinds.outputs.length === 0 || inputKinds.inputs.length === 0) {
    return false;
  }

  const deltaX = inputEntity.x - outputEntity.x;
  const deltaY = inputEntity.y - outputEntity.y;

  return outputKinds.outputs.some((outputPort) =>
    inputKinds.inputs.some((inputPort) => {
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
