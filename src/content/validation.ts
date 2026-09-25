import { MACHINES, type MachineDefinition, type MachineType } from "./machines";
import { RECIPES, type RecipeDefinition } from "./recipes";
import { RESOURCES, type ResourceDefinition } from "./resources";
import { UNLOCKS, type UnlockTable } from "./unlocks";

export interface ContentTables {
  resources: Readonly<Record<string, ResourceDefinition>>;
  machines: Readonly<Record<string, MachineDefinition>>;
  recipes: Readonly<Record<string, RecipeDefinition>>;
  unlocks: UnlockTable;
}

const DEFAULT_CONTENT: ContentTables = {
  resources: RESOURCES,
  machines: MACHINES,
  recipes: RECIPES,
  unlocks: UNLOCKS,
};

const PORT_COUNTS: Record<MachineType, { inputs: number; outputs: number }> = {
  extractor: { inputs: 0, outputs: 1 },
  belt: { inputs: 1, outputs: 1 },
  smelter: { inputs: 1, outputs: 1 },
  assembler: { inputs: 2, outputs: 1 },
  silo: { inputs: 1, outputs: 1 },
  depot: { inputs: 1, outputs: 0 },
};

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function isAdjacentPortOffset(machine: MachineDefinition, port: MachineDefinition["ports"][number]): boolean {
  const { x, y } = port.offset;
  const isInteger = Number.isInteger(x) && Number.isInteger(y);
  const isAdjacent = Math.abs(x) + Math.abs(y) === 1;

  return isInteger && isAdjacent && machine.footprint.width === 1 && machine.footprint.height === 1;
}

function validateResources(resources: ContentTables["resources"]): string[] {
  const errors: string[] = [];
  const entries = Object.entries(resources);
  const iconKeys = new Set<string>();
  const colors = new Set<string>();

  if (entries.length !== 13) {
    errors.push(`Expected 13 resources, found ${entries.length}.`);
  }

  for (const [id, resource] of entries) {
    if (resource.id !== id) {
      errors.push(`Resource key "${id}" does not match id "${resource.id}".`);
    }
    if (![0, 1, 2, 3].includes(resource.tier)) {
      errors.push(`Resource "${id}" has invalid tier ${resource.tier}.`);
    }
    if (!isNonEmptyString(resource.label)) {
      errors.push(`Resource "${id}" must have a label.`);
    }
    if (!isFiniteNumber(resource.sellValue) || resource.sellValue <= 0) {
      errors.push(`Resource "${id}" must have a positive finite sell value.`);
    }
    if (!isNonEmptyString(resource.iconKey)) {
      errors.push(`Resource "${id}" must have an icon key.`);
    } else if (iconKeys.has(resource.iconKey)) {
      errors.push(`Resource "${id}" duplicates icon key "${resource.iconKey}".`);
    } else {
      iconKeys.add(resource.iconKey);
    }
    if (!isHexColor(resource.color)) {
      errors.push(`Resource "${id}" must have a six-digit hexadecimal color.`);
    } else if (colors.has(resource.color)) {
      errors.push(`Resource "${id}" duplicates color "${resource.color}".`);
    } else {
      colors.add(resource.color);
    }
  }

  return errors;
}

function validateMachines(
  machines: ContentTables["machines"],
  resourceIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  const entries = Object.entries(machines);
  const spriteKeys = new Set<string>();

  if (entries.length !== 6) {
    errors.push(`Expected 6 machines, found ${entries.length}.`);
  }

  for (const [type, machine] of entries) {
    if (machine.type !== type) {
      errors.push(`Machine key "${type}" does not match type "${machine.type}".`);
    }
    if (machine.footprint.width !== 1 || machine.footprint.height !== 1) {
      errors.push(`Machine "${type}" must have a 1 by 1 footprint.`);
    }
    if (!isFiniteNumber(machine.cost) || machine.cost < 0) {
      errors.push(`Machine "${type}" must have a non-negative finite cost.`);
    }
    if (!isNonNegativeInteger(machine.unlockCost)) {
      errors.push(`Machine "${type}" must have a non-negative integer unlock cost.`);
    }
    if (!isNonNegativeInteger(machine.inputBuffer)) {
      errors.push(`Machine "${type}" must have a non-negative integer input buffer.`);
    }
    if (!isNonNegativeInteger(machine.outputBuffer)) {
      errors.push(`Machine "${type}" must have a non-negative integer output buffer.`);
    }
    if (!isPositiveInteger(machine.processTicks)) {
      errors.push(`Machine "${type}" must have a positive integer process tick count.`);
    }
    if (!isNonEmptyString(machine.spriteKey) || spriteKeys.has(machine.spriteKey)) {
      errors.push(`Machine "${type}" must have a unique sprite key.`);
    } else {
      spriteKeys.add(machine.spriteKey);
    }
    if (machine.activeSpriteKey === undefined || !isNonEmptyString(machine.activeSpriteKey)) {
      errors.push(`Machine "${type}" must have an active sprite key.`);
    } else if (spriteKeys.has(machine.activeSpriteKey)) {
      errors.push(`Machine "${type}" duplicates active sprite key "${machine.activeSpriteKey}".`);
    } else {
      spriteKeys.add(machine.activeSpriteKey);
    }

    const expectedPortCounts = PORT_COUNTS[machine.type];
    const inputPorts = machine.ports.filter((port) => port.kind === "input");
    const outputPorts = machine.ports.filter((port) => port.kind === "output");
    const portIds = new Set<string>();

    if (expectedPortCounts === undefined) {
      errors.push(`Machine "${type}" has an unsupported port contract.`);
    } else {
      if (inputPorts.length !== expectedPortCounts.inputs) {
        errors.push(`Machine "${type}" must define ${expectedPortCounts.inputs} input port(s).`);
      }
      if (outputPorts.length !== expectedPortCounts.outputs) {
        errors.push(`Machine "${type}" must define ${expectedPortCounts.outputs} output port(s).`);
      }
    }

    for (const port of machine.ports) {
      if (!isNonEmptyString(port.id) || portIds.has(port.id)) {
        errors.push(`Machine "${type}" must have unique port identifiers.`);
      } else {
        portIds.add(port.id);
      }
      if (port.kind !== "input" && port.kind !== "output") {
        errors.push(`Machine "${type}" port "${port.id}" has an invalid kind.`);
      }
      if (!isAdjacentPortOffset(machine, port)) {
        errors.push(`Machine "${type}" port "${port.id}" must use an adjacent integer offset.`);
      }
      if (port.kind === "input") {
        if (port.accepts === undefined || port.accepts.length === 0) {
          errors.push(`Machine "${type}" input port "${port.id}" must declare accepted resources.`);
        } else {
          for (const resource of port.accepts) {
            if (!resourceIds.has(resource)) {
              errors.push(`Machine "${type}" port "${port.id}" references unknown resource "${resource}".`);
            }
          }
        }
      }
      if (port.produces !== undefined && !resourceIds.has(port.produces)) {
        errors.push(`Machine "${type}" port "${port.id}" references unknown produced resource "${port.produces}".`);
      }
    }
  }

  return errors;
}

function validateRecipes(
  recipes: ContentTables["recipes"],
  resources: ContentTables["resources"],
  machines: ContentTables["machines"],
): string[] {
  const errors: string[] = [];
  const entries = Object.entries(recipes);

  if (entries.length !== 9) {
    errors.push(`Expected 9 recipes, found ${entries.length}.`);
  }

  for (const [id, recipe] of entries) {
    if (recipe.id !== id) {
      errors.push(`Recipe key "${id}" does not match id "${recipe.id}".`);
    }
    if (recipe.machine !== "smelter" && recipe.machine !== "assembler") {
      errors.push(`Recipe "${id}" must run on a smelter or assembler.`);
    } else if (!Object.hasOwn(machines, recipe.machine)) {
      errors.push(`Recipe "${id}" references unknown machine "${recipe.machine}".`);
    }

    const inputs = Object.entries(recipe.inputs);
    if (inputs.length === 0) {
      errors.push(`Recipe "${id}" must define at least one input.`);
    }
    for (const [resource, amount] of inputs) {
      if (!Object.hasOwn(resources, resource)) {
        errors.push(`Recipe "${id}" references unknown resource "${resource}".`);
      }
      if (!isFiniteNumber(amount) || amount <= 0) {
        errors.push(`Recipe "${id}" input "${resource}" must have a positive finite amount.`);
      }
    }

    if (!Object.hasOwn(resources, recipe.output.resource)) {
      errors.push(`Recipe "${id}" references unknown output resource "${recipe.output.resource}".`);
    } else if (!isPositiveInteger(recipe.output.amount)) {
      errors.push(`Recipe "${id}" must produce a positive integer amount.`);
    } else {
      const resource = resources[recipe.output.resource];
      const expectedSellValue = resource.sellValue * recipe.output.amount;
      if (recipe.sellValue !== expectedSellValue) {
        errors.push(`Recipe "${id}" sell value must equal ${expectedSellValue}.`);
      }
    }

    if (!isPositiveInteger(recipe.durationTicks)) {
      errors.push(`Recipe "${id}" must have a positive integer duration.`);
    }
    if (!isNonNegativeInteger(recipe.unlockCost)) {
      errors.push(`Recipe "${id}" must have a non-negative integer unlock cost.`);
    }
    if (!isFiniteNumber(recipe.sellValue) || recipe.sellValue <= 0) {
      errors.push(`Recipe "${id}" must have a positive finite sell value.`);
    }
  }

  return errors;
}

function validateUnlocks(
  unlocks: UnlockTable,
  machines: ContentTables["machines"],
  recipes: ContentTables["recipes"],
): string[] {
  const errors: string[] = [];
  const initialMachines = new Set(unlocks.machines);

  if (initialMachines.size !== unlocks.machines.length) {
    errors.push("Initial machine unlocks must be unique.");
  }
  for (const type of unlocks.machines) {
    if (!Object.hasOwn(machines, type)) {
      errors.push(`Initial unlock references unknown machine "${type}".`);
    } else if (machines[type].unlockCost !== 0) {
      errors.push(`Initially unlocked machine "${type}" must have a zero unlock cost.`);
    }
  }
  for (const [type, machine] of Object.entries(machines)) {
    if (!initialMachines.has(type as MachineType) && machine.unlockCost === 0) {
      errors.push(`Locked machine "${type}" must have a positive unlock cost.`);
    }
  }

  if (new Set(unlocks.recipes).size !== unlocks.recipes.length) {
    errors.push("Initial recipe unlocks must be unique.");
  }
  for (const id of unlocks.recipes) {
    if (!Object.hasOwn(recipes, id)) {
      errors.push(`Initial unlock references unknown recipe "${id}".`);
    } else if (recipes[id].unlockCost !== 0) {
      errors.push(`Initially unlocked recipe "${id}" must have a zero unlock cost.`);
    }
  }

  return errors;
}

export function validateContent(content: ContentTables = DEFAULT_CONTENT): string[] {
  return [
    ...validateResources(content.resources),
    ...validateMachines(content.machines, new Set(Object.keys(content.resources))),
    ...validateRecipes(content.recipes, content.resources, content.machines),
    ...validateUnlocks(content.unlocks, content.machines, content.recipes),
  ];
}
