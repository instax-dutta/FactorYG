import { getMachine } from "../content/machines";
import { getRecipe } from "../content/recipes";
import { isInsideGrid } from "./grid";
import { createMachineRuntime } from "./machines";
import type { CommandResult, Entity, SimulationCommand, SimulationState } from "./types";

export type PlaceEntityCommand = Extract<SimulationCommand, { type: "placeEntity" }>;

export interface PlacementApplication {
  state: SimulationState;
  changed: boolean;
  result: CommandResult;
  entity?: Entity;
}

const VALID_ROTATIONS = new Set([0, 90, 180, 270]);

function isProcessorMachine(machine: PlaceEntityCommand["machine"]): boolean {
  return machine === "smelter" || machine === "assembler";
}

export function validatePlacement(state: SimulationState, command: PlaceEntityCommand): CommandResult {
  const definition = getMachine(command.machine);
  if (definition === undefined || !state.unlocked.machines.includes(command.machine)) {
    return { ok: false, reason: "lockedMachine" };
  }

  if (
    !Number.isInteger(command.x) ||
    !Number.isInteger(command.y) ||
    !isInsideGrid({ x: command.x, y: command.y }, state.grid.width, state.grid.height)
  ) {
    return { ok: false, reason: "outOfBounds" };
  }

  if (state.grid.entities.some((entity) => entity.x === command.x && entity.y === command.y)) {
    return { ok: false, reason: "occupied" };
  }

  if (state.currency < definition.cost) {
    return { ok: false, reason: "insufficientCurrency" };
  }

  if (!VALID_ROTATIONS.has(command.rotation)) {
    return { ok: false, reason: "invalidRotation" };
  }

  if (command.recipeId !== undefined && !isProcessorMachine(command.machine)) {
    return { ok: false, reason: "unexpectedRecipe" };
  }

  if (command.machine === "extractor") {
    const node = state.grid.nodes.find((candidate) => candidate.x === command.x && candidate.y === command.y);
    if (node === undefined) {
      return { ok: false, reason: "missingResourceNode" };
    }

    if (command.resourceNode !== undefined && command.resourceNode !== node.resource) {
      return { ok: false, reason: "missingResourceNode" };
    }
  }

  if (isProcessorMachine(command.machine)) {
    const recipe = command.recipeId === undefined ? undefined : getRecipe(command.recipeId);
    if (
      recipe === undefined ||
      recipe.machine !== command.machine ||
      !state.unlocked.recipes.includes(recipe.id)
    ) {
      return { ok: false, reason: "missingRecipe" };
    }
  }

  return { ok: true };
}

export function applyPlacement(
  state: SimulationState,
  command: PlaceEntityCommand,
): PlacementApplication {
  const result = validatePlacement(state, command);
  if (!result.ok) {
    return { state, changed: false, result };
  }

  const definition = getMachine(command.machine);
  if (definition === undefined) {
    return { state, changed: false, result: { ok: false, reason: "lockedMachine" } };
  }

  const node = state.grid.nodes.find((candidate) => candidate.x === command.x && candidate.y === command.y);
  const entity: Entity = {
    id: `entity-${state.nextEntitySequence}`,
    type: command.machine,
    x: command.x,
    y: command.y,
    rotation: command.rotation,
    level: 1,
    ...(command.machine === "extractor" && node !== undefined ? { resourceNode: node.resource } : {}),
    ...(isProcessorMachine(command.machine) && command.recipeId !== undefined
      ? { recipeId: command.recipeId }
      : {}),
  };

  const machines = { ...state.grid.machines };
  const belts = { ...state.grid.belts };
  if (command.machine === "belt") {
    belts[entity.id] = { entityId: entity.id, progress: 0 };
  } else {
    machines[entity.id] = createMachineRuntime(entity);
  }

  const nextState: SimulationState = {
    ...state,
    currency: state.currency - definition.cost,
    nextEntitySequence: state.nextEntitySequence + 1,
    grid: {
      ...state.grid,
      entities: [...state.grid.entities, entity],
      machines,
      belts,
    },
  };

  return { state: nextState, changed: true, result: { ok: true }, entity };
}
