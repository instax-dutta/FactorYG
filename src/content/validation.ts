import { deepFreeze } from "./freeze";
import { MACHINES, isLevelAffected } from "./machines";
import { RECIPES } from "./recipes";
import { RESOURCES } from "./resources";
import { UNLOCKS } from "./unlocks";

type UnknownRecord = Record<string, unknown>;

interface InputPortValidation {
  id: string;
  accepts: ReadonlySet<string>;
}

interface MachineValidation {
  inputPorts: InputPortValidation[];
}

const EXPECTED_RESOURCE_IDS = [
  "copperOre",
  "ironOre",
  "coal",
  "stone",
  "copperIngot",
  "ironIngot",
  "refinedStone",
  "wire",
  "gear",
  "plate",
  "circuit",
  "frame",
  "motor",
] as const;
const EXPECTED_MACHINE_IDS = ["extractor", "belt", "smelter", "assembler", "silo", "depot"] as const;
const EXPECTED_RECIPE_IDS = [
  "copperIngot",
  "ironIngot",
  "refinedStone",
  "wire",
  "gear",
  "plate",
  "circuit",
  "frame",
  "motor",
] as const;
const EXPECTED_INITIAL_MACHINES = ["extractor", "belt", "depot"] as const;
const EXPECTED_INITIAL_RECIPES: readonly string[] = [];
const MACHINE_IDS: ReadonlySet<string> = new Set(EXPECTED_MACHINE_IDS);
const RECIPE_IDS: ReadonlySet<string> = new Set(EXPECTED_RECIPE_IDS);
const PORT_COUNTS: Readonly<Record<string, { inputs: number; outputs: number }>> = {
  extractor: { inputs: 0, outputs: 1 },
  belt: { inputs: 1, outputs: 1 },
  smelter: { inputs: 1, outputs: 1 },
  assembler: { inputs: 2, outputs: 1 },
  silo: { inputs: 1, outputs: 1 },
  depot: { inputs: 1, outputs: 0 },
};

const DEFAULT_CONTENT = deepFreeze({
  resources: RESOURCES,
  machines: MACHINES,
  recipes: RECIPES,
  unlocks: UNLOCKS,
});

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function acceptsEveryResource(
  inputPorts: readonly InputPortValidation[],
  resourceIds: ReadonlySet<string>,
): boolean {
  return inputPorts.some((port) => [...resourceIds].every((resource) => port.accepts.has(resource)));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? "no entries" : values.join(", ");
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return typeof value;
}

function validateExactIdSet(
  label: string,
  expected: readonly string[],
  actual: ReadonlySet<string>,
  errors: string[],
): void {
  const missing = expected.filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => !expected.includes(id)).sort();
  if (missing.length === 0 && unexpected.length === 0) {
    return;
  }

  const details: string[] = [];
  if (missing.length > 0) {
    details.push(`missing: ${formatList(missing)}`);
  }
  if (unexpected.length > 0) {
    details.push(`unexpected: ${formatList(unexpected)}`);
  }
  errors.push(`${label} IDs must exactly match the canonical set; ${details.join("; ")}.`);
}

function validateExactInitialSet(
  label: string,
  expected: readonly string[],
  actual: ReadonlySet<string>,
  errors: string[],
): void {
  const missing = expected.filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => !expected.includes(id)).sort();
  if (missing.length === 0 && unexpected.length === 0) {
    return;
  }

  const details: string[] = [];
  if (missing.length > 0) {
    details.push(`missing: ${formatList(missing)}`);
  }
  if (unexpected.length > 0) {
    details.push(`unexpected: ${formatList(unexpected)}`);
  }
  errors.push(`${label} must exactly match ${formatList(expected)}; ${details.join("; ")}.`);
}

function collectFreezeErrors(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  errors: string[],
): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (!Object.isFrozen(value)) {
    errors.push(`Content path "${path || "$"}" must be deeply frozen.`);
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  for (const [key, nested] of Object.entries(value)) {
    collectFreezeErrors(nested, path === "" ? key : `${path}.${key}`, seen, errors);
  }
}

function validateResources(resources: UnknownRecord, errors: string[]): Set<string> {
  const resourceIds = new Set(Object.keys(resources));
  const iconKeys = new Set<string>();
  const colors = new Set<string>();

  validateExactIdSet("Resource", EXPECTED_RESOURCE_IDS, resourceIds, errors);

  for (const [key, value] of Object.entries(resources)) {
    if (!isRecord(value)) {
      errors.push(`Resource "${key}" must be an object.`);
      continue;
    }
    if (value.id !== key) {
      errors.push(`Resource key "${key}" must match id "${String(value.id)}".`);
    }
    if (![0, 1, 2, 3].includes(value.tier as number)) {
      errors.push(`Resource "${key}" must have a tier from 0 through 3.`);
    }
    if (!isNonEmptyString(value.label)) {
      errors.push(`Resource "${key}" must have a label.`);
    }
    if (!isFiniteNumber(value.sellValue) || value.sellValue <= 0) {
      errors.push(`Resource "${key}" must have a positive finite sell value.`);
    }
    if (!isNonEmptyString(value.iconKey)) {
      errors.push(`Resource "${key}" must have an icon key.`);
    } else if (iconKeys.has(value.iconKey)) {
      errors.push(`Resource "${key}" duplicates icon key "${value.iconKey}".`);
    } else {
      iconKeys.add(value.iconKey);
    }
    if (!isHexColor(value.color)) {
      errors.push(`Resource "${key}" must have a six-digit hexadecimal color.`);
    } else if (colors.has(value.color)) {
      errors.push(`Resource "${key}" duplicates color "${value.color}".`);
    } else {
      colors.add(value.color);
    }
  }

  return resourceIds;
}

function validatePort(
  machineKey: string,
  portValue: unknown,
  portIndex: number,
  resourceIds: ReadonlySet<string>,
  portIds: Set<string>,
  offsetKeys: Set<string>,
  errors: string[],
): InputPortValidation | undefined {
  if (!isRecord(portValue)) {
    errors.push(`Machine "${machineKey}" port at index ${portIndex} must be an object.`);
    return undefined;
  }

  if (!isNonEmptyString(portValue.id)) {
    errors.push(`Machine "${machineKey}" must have non-empty port identifiers.`);
  } else if (portIds.has(portValue.id)) {
    errors.push(`Machine "${machineKey}" port "${portValue.id}" must have a unique identifier.`);
  } else {
    portIds.add(portValue.id);
  }

  if (portValue.kind !== "input" && portValue.kind !== "output") {
    errors.push(`Machine "${machineKey}" port "${String(portValue.id)}" must be an input or output.`);
    return undefined;
  }

  if (!isRecord(portValue.offset)) {
    errors.push(`Machine "${machineKey}" port "${String(portValue.id)}" must have an offset object.`);
  } else {
    const { x, y } = portValue.offset;
    const isAdjacent = isFiniteNumber(x) && isFiniteNumber(y) && Math.abs(x) + Math.abs(y) === 1;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !Number.isInteger(x) || !Number.isInteger(y) || !isAdjacent) {
      errors.push(`Machine "${machineKey}" port "${String(portValue.id)}" must use an adjacent integer offset.`);
    } else {
      const offsetKey = `${x},${y}`;
      if (offsetKeys.has(offsetKey)) {
        errors.push(`Machine "${machineKey}" must use unique adjacent port offsets.`);
      } else {
        offsetKeys.add(offsetKey);
      }
    }
  }

  if (portValue.kind === "output") {
    if (Object.hasOwn(portValue, "accepts")) {
      errors.push(`Machine "${machineKey}" output port "${String(portValue.id)}" must not define accepts.`);
    }
    if (portValue.produces !== undefined && !resourceIds.has(formatUnknown(portValue.produces))) {
      errors.push(`Machine "${machineKey}" port "${String(portValue.id)}" references unknown produced resource "${formatUnknown(portValue.produces)}".`);
    }
    return undefined;
  }

  if (!Array.isArray(portValue.accepts)) {
    errors.push(`Machine "${machineKey}" input port "${String(portValue.id)}" must declare accepted resources.`);
    return undefined;
  }

  const accepts = new Set<string>();
  for (const accepted of portValue.accepts) {
    if (!resourceIds.has(String(accepted))) {
      errors.push(`Machine "${machineKey}" port "${String(portValue.id)}" references unknown resource "${String(accepted)}".`);
      continue;
    }
    if (accepts.has(String(accepted))) {
      errors.push(`Machine "${machineKey}" port "${String(portValue.id)}" duplicates resource "${String(accepted)}".`);
    }
    accepts.add(String(accepted));
  }
  if (accepts.size === 0) {
    errors.push(`Machine "${machineKey}" input port "${String(portValue.id)}" must accept at least one resource.`);
  }

  return isNonEmptyString(portValue.id) ? { id: portValue.id, accepts } : undefined;
}

function validateMachines(
  machines: UnknownRecord,
  resourceIds: ReadonlySet<string>,
  errors: string[],
): Map<string, MachineValidation> {
  const machineIds = new Set(Object.keys(machines));
  const validations = new Map<string, MachineValidation>();
  const spriteKeys = new Set<string>();

  validateExactIdSet("Machine", EXPECTED_MACHINE_IDS, machineIds, errors);

  for (const [key, value] of Object.entries(machines)) {
    if (!isRecord(value)) {
      errors.push(`Machine "${key}" must be an object.`);
      continue;
    }

    if (value.type !== key) {
      errors.push(`Machine key "${key}" must match type "${String(value.type)}".`);
    } else if (!MACHINE_IDS.has(key)) {
      errors.push(`Machine "${key}" must have a canonical type.`);
    }

    if (!isRecord(value.footprint) || value.footprint.width !== 1 || value.footprint.height !== 1) {
      errors.push(`Machine "${key}" must have a 1 by 1 footprint.`);
    }
    if (!isFiniteNumber(value.cost) || value.cost < 0) {
      errors.push(`Machine "${key}" must have a non-negative finite cost.`);
    }
    if (isLevelAffected(key) && !isPositiveInteger(value.cost)) {
      errors.push(
        `Machine "${key}" must have a positive integer cost because a level upgrade is priced from it.`,
      );
    }
    if (!isNonNegativeInteger(value.unlockCost)) {
      errors.push(`Machine "${key}" must have a non-negative integer unlock cost.`);
    }
    if (!isNonNegativeInteger(value.inputBuffer)) {
      errors.push(`Machine "${key}" must have a non-negative integer input buffer.`);
    }
    if (!isNonNegativeInteger(value.outputBuffer)) {
      errors.push(`Machine "${key}" must have a non-negative integer output buffer.`);
    }
    if (!isPositiveInteger(value.defaultProcessTicks)) {
      errors.push(`Machine "${key}" must have a positive integer defaultProcessTicks.`);
    }
    if (Object.hasOwn(value, "processTicks")) {
      errors.push(`Machine "${key}" must use defaultProcessTicks instead of processTicks.`);
    }

    if (key === "silo") {
      if (value.bufferMode !== "shared") {
        errors.push(`Machine "silo" must use shared buffer mode.`);
      }
      if (value.storageCapacity !== 100) {
        errors.push('Machine "silo" storage capacity must be exactly 100.');
      }
      if (value.inputBuffer !== 100 || value.outputBuffer !== 100) {
        errors.push('Machine "silo" input and output buffers must reference the shared capacity of 100.');
      }
    } else {
      if (value.bufferMode !== "separate") {
        errors.push(`Machine "${key}" must use separate buffer mode.`);
      }
      if (Object.hasOwn(value, "storageCapacity")) {
        errors.push(`Machine "${key}" must not define storageCapacity.`);
      }
    }

    if (Object.hasOwn(value, "saleTerminal") && typeof value.saleTerminal !== "boolean") {
      errors.push(`Machine "${key}" saleTerminal must be a boolean.`);
    }

    if (!isNonEmptyString(value.spriteKey)) {
      errors.push(`Machine "${key}" must have a sprite key.`);
    } else if (spriteKeys.has(value.spriteKey)) {
      errors.push(`Machine "${key}" duplicates sprite key "${value.spriteKey}".`);
    } else {
      spriteKeys.add(value.spriteKey);
    }
    if (!isNonEmptyString(value.activeSpriteKey)) {
      errors.push(`Machine "${key}" must have an active sprite key.`);
    } else if (spriteKeys.has(value.activeSpriteKey)) {
      errors.push(`Machine "${key}" duplicates active sprite key "${value.activeSpriteKey}".`);
    } else {
      spriteKeys.add(value.activeSpriteKey);
    }

    const inputPorts: InputPortValidation[] = [];
    if (!Array.isArray(value.ports)) {
      errors.push(`Machine "${key}" ports must be an array.`);
    } else {
      const portIds = new Set<string>();
      const offsetKeys = new Set<string>();
      let inputCount = 0;
      let outputCount = 0;

      for (const [index, port] of value.ports.entries()) {
        if (isRecord(port) && port.kind === "input") {
          inputCount += 1;
        } else if (isRecord(port) && port.kind === "output") {
          outputCount += 1;
        }
        const inputPort = validatePort(key, port, index, resourceIds, portIds, offsetKeys, errors);
        if (inputPort !== undefined) {
          inputPorts.push(inputPort);
        }
      }

      const expectedCounts = PORT_COUNTS[key];
      if (expectedCounts === undefined) {
        errors.push(`Machine "${key}" has an unsupported port contract.`);
      } else {
        if (inputCount !== expectedCounts.inputs) {
          errors.push(`Machine "${key}" must define ${expectedCounts.inputs} input port(s).`);
        }
        if (outputCount !== expectedCounts.outputs) {
          errors.push(`Machine "${key}" must define ${expectedCounts.outputs} output port(s).`);
        }
      }
    }

    if (value.saleTerminal === true && !acceptsEveryResource(inputPorts, resourceIds)) {
      errors.push(
        `Machine "${key}" must accept every resource on an input port because a sale terminal sells everything it receives.`,
      );
    }

    validations.set(key, { inputPorts });
  }

  return validations;
}

function validateRecipes(
  recipes: UnknownRecord,
  resources: UnknownRecord,
  machines: ReadonlyMap<string, MachineValidation>,
  errors: string[],
): void {
  const recipeIds = new Set(Object.keys(recipes));
  validateExactIdSet("Recipe", EXPECTED_RECIPE_IDS, recipeIds, errors);

  for (const [key, value] of Object.entries(recipes)) {
    if (!isRecord(value)) {
      errors.push(`Recipe "${key}" must be an object.`);
      continue;
    }
    if (value.id !== key) {
      errors.push(`Recipe key "${key}" must match id "${String(value.id)}".`);
    }
    if (value.machine !== "smelter" && value.machine !== "assembler") {
      errors.push(`Recipe "${key}" must run on a smelter or assembler.`);
    } else if (!machines.has(value.machine)) {
      errors.push(`Recipe "${key}" references unknown machine "${value.machine}".`);
    }

    const inputIds: string[] = [];
    if (!isRecord(value.inputs)) {
      errors.push(`Recipe "${key}" inputs must be an object of resource amounts.`);
    } else {
      const inputs = Object.entries(value.inputs);
      if (inputs.length === 0) {
        errors.push(`Recipe "${key}" must define at least one input.`);
      }
      for (const [resource, amount] of inputs) {
        inputIds.push(resource);
        if (!Object.hasOwn(resources, resource)) {
          errors.push(`Recipe "${key}" references unknown resource "${resource}".`);
        }
        if (!isFiniteNumber(amount) || amount <= 0) {
          errors.push(`Recipe "${key}" input "${resource}" must have a positive finite amount.`);
        }
      }
    }

    if (!isRecord(value.output)) {
      errors.push(`Recipe "${key}" must define an output.`);
    } else {
      const outputResource = value.output.resource;
      if (!Object.hasOwn(resources, String(outputResource))) {
        errors.push(`Recipe "${key}" references unknown output resource "${String(outputResource)}".`);
      }
      if (!isPositiveInteger(value.output.amount)) {
        errors.push(`Recipe "${key}" must produce a positive integer amount.`);
      }
      const resource = isRecord(resources[String(outputResource)]) ? resources[String(outputResource)] : undefined;
      if (isRecord(resource) && isFiniteNumber(resource.sellValue) && isPositiveInteger(value.output.amount)) {
        const expectedSellValue = resource.sellValue * value.output.amount;
        if (value.sellValue !== expectedSellValue) {
          errors.push(`Recipe "${key}" sell value must equal ${expectedSellValue}.`);
        }
      }
    }

    if (!isPositiveInteger(value.durationTicks)) {
      errors.push(`Recipe "${key}" must have a positive integer durationTicks.`);
    }
    if (!isNonNegativeInteger(value.unlockCost)) {
      errors.push(`Recipe "${key}" must have a non-negative integer unlock cost.`);
    }
    if (!isFiniteNumber(value.sellValue) || value.sellValue <= 0) {
      errors.push(`Recipe "${key}" must have a positive finite sell value.`);
    }

    if ((value.machine === "smelter" || value.machine === "assembler") && machines.has(value.machine)) {
      const machine = machines.get(value.machine);
      for (const resource of inputIds) {
        const acceptingPort = machine?.inputPorts.find((port) => port.accepts.has(resource));
        if (acceptingPort === undefined) {
          const portId = machine?.inputPorts[0]?.id ?? "unknown";
          errors.push(`Recipe "${key}" input "${resource}" is not accepted by ${value.machine} input port "${portId}".`);
        }
      }
    }
  }
}

function parseUnlockList(
  value: unknown,
  canonicalIds: ReadonlySet<string>,
  label: string,
  errors: string[],
): Set<string> {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array.`);
    return new Set();
  }

  const ids = new Set<string>();
  for (const id of value) {
    if (!isNonEmptyString(id) || !canonicalIds.has(id)) {
      errors.push(`${label} references unknown ID "${String(id)}".`);
      continue;
    }
    if (ids.has(id)) {
      errors.push(`${label} must not contain duplicate ID "${id}".`);
    }
    ids.add(id);
  }
  return ids;
}

interface PrerequisiteContract {
  field: string;
  known: ReadonlySet<string>;
  costOf: (key: string) => number | undefined;
}

function indexInputProducers(recipes: UnknownRecord): Map<string, string[]> {
  const producers = new Map<string, string[]>();
  for (const [key, value] of Object.entries(recipes)) {
    if (!isRecord(value) || !isRecord(value.output) || !isNonEmptyString(value.output.resource)) {
      continue;
    }

    const resource = value.output.resource;
    const existing = producers.get(resource);
    if (existing === undefined) {
      producers.set(resource, [key]);
    } else {
      existing.push(key);
    }
  }
  return producers;
}

function missingInputProducers(
  recipeKey: string,
  recipe: UnknownRecord,
  producers: ReadonlyMap<string, readonly string[]>,
  requirement: UnknownRecord,
): { producer: string; input: string }[] {
  if (!isRecord(recipe.inputs) || !Array.isArray(requirement.requiresRecipes)) {
    return [];
  }

  const declared = new Set(requirement.requiresRecipes.map((entry) => String(entry)));
  const missing = new Map<string, string>();

  for (const input of Object.keys(recipe.inputs)) {
    for (const producer of producers.get(input) ?? []) {
      if (producer === recipeKey || declared.has(producer)) {
        continue;
      }
      if (!missing.has(producer)) {
        missing.set(producer, input);
      }
    }
  }

  return [...missing.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([producer, input]) => ({ producer, input }));
}

function unlockCostOf(table: UnknownRecord, key: string): number | undefined {
  const entry = table[key];
  return isRecord(entry) && isFiniteNumber(entry.unlockCost) ? entry.unlockCost : undefined;
}

function machinePrerequisiteContract(
  machines: UnknownRecord,
  recipes: UnknownRecord,
): readonly PrerequisiteContract[] {
  return [
    {
      field: "requiresMachines",
      known: MACHINE_IDS,
      costOf: (prerequisite) => unlockCostOf(machines, prerequisite),
    },
    {
      field: "requiresRecipes",
      known: RECIPE_IDS,
      costOf: (prerequisite) => unlockCostOf(recipes, prerequisite),
    },
  ];
}

function validateRequirement(
  label: string,
  id: string,
  value: unknown,
  prerequisites: readonly PrerequisiteContract[],
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${label} "${id}" must be an object.`);
    return;
  }

  if (!isPositiveInteger(value.cost)) {
    errors.push(`${label} "${id}" must have a positive integer cost.`);
  }

  for (const prerequisite of prerequisites) {
    const list = value[prerequisite.field];
    if (!Array.isArray(list)) {
      errors.push(`${label} "${id}" ${prerequisite.field} must be an array.`);
      continue;
    }

    const seen = new Set<string>();
    for (const entry of list) {
      const key = String(entry);
      if (!prerequisite.known.has(key)) {
        errors.push(`${label} "${id}" ${prerequisite.field} references unknown ID "${key}".`);
        continue;
      }
      if (key === id) {
        errors.push(`${label} "${id}" must not require itself.`);
        continue;
      }
      if (seen.has(key)) {
        errors.push(`${label} "${id}" duplicates ${prerequisite.field} prerequisite "${key}".`);
        continue;
      }
      seen.add(key);

      const prerequisiteCost = prerequisite.costOf(key);
      if (prerequisiteCost !== undefined && isPositiveInteger(value.cost) && prerequisiteCost >= value.cost) {
        errors.push(`${label} "${id}" cost must exceed prerequisite cost ${prerequisiteCost} of "${key}".`);
      }
    }
  }
}

function parseUnlockRequirements(
  value: unknown,
  canonicalIds: ReadonlySet<string>,
  label: string,
  errors: string[],
): Map<string, UnknownRecord> {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object.`);
    return new Map();
  }

  const requirements = new Map<string, UnknownRecord>();
  for (const [key, entry] of Object.entries(value)) {
    if (!canonicalIds.has(key)) {
      errors.push(`${label} references unknown ID "${key}".`);
      continue;
    }
    if (!isRecord(entry)) {
      errors.push(`${label} "${key}" must be an object.`);
      continue;
    }
    requirements.set(key, entry);
  }
  return requirements;
}

function validateUnlocks(
  unlocks: UnknownRecord,
  machines: UnknownRecord,
  recipes: UnknownRecord,
  errors: string[],
): void {
  const initialMachines = parseUnlockList(
    unlocks.machines,
    MACHINE_IDS,
    "Initial machine unlocks",
    errors,
  );
  const initialRecipes = parseUnlockList(
    unlocks.recipes,
    RECIPE_IDS,
    "Initial recipe unlocks",
    errors,
  );

  validateExactInitialSet(
    "Initial machine unlocks",
    EXPECTED_INITIAL_MACHINES,
    initialMachines,
    errors,
  );
  validateExactInitialSet("Initial recipe unlocks", EXPECTED_INITIAL_RECIPES, initialRecipes, errors);

  for (const [key, value] of Object.entries(machines)) {
    if (!isRecord(value)) {
      continue;
    }
    if (value.unlockCost === 0 && !initialMachines.has(key)) {
      errors.push(`Machine "${key}" has zero unlock cost but is not initially unlocked.`);
    }
  }
  for (const key of initialMachines) {
    const machine = machines[key];
    if (isRecord(machine) && machine.unlockCost !== 0) {
      errors.push(`Initially unlocked machine "${key}" must have a zero unlock cost.`);
    }
  }

  for (const [key, value] of Object.entries(recipes)) {
    if (!isRecord(value)) {
      continue;
    }
    if (value.unlockCost === 0 && !initialRecipes.has(key)) {
      errors.push(`Recipe "${key}" has zero unlock cost but is not initially unlocked.`);
    }
  }
  for (const key of initialRecipes) {
    const recipe = recipes[key];
    if (isRecord(recipe) && recipe.unlockCost !== 0) {
      errors.push(`Initially unlocked recipe "${key}" must have a zero unlock cost.`);
    }
  }

  const machineRequirements = parseUnlockRequirements(
    unlocks.machineUnlocks,
    MACHINE_IDS,
    "Machine unlock requirements",
    errors,
  );
  const recipeRequirements = parseUnlockRequirements(
    unlocks.recipeUnlocks,
    RECIPE_IDS,
    "Recipe unlock requirements",
    errors,
  );
  const inputProducers = indexInputProducers(recipes);

  for (const [key, value] of Object.entries(machines)) {
    if (!isRecord(value)) {
      continue;
    }
    const requirement = machineRequirements.get(key);
    if (isFiniteNumber(value.unlockCost) && value.unlockCost > 0 && requirement === undefined) {
      errors.push(`Machine "${key}" has a paid unlock and must declare unlock requirements.`);
    }
    if (requirement === undefined) {
      continue;
    }
    if (requirement.cost !== value.unlockCost) {
      errors.push(`Machine unlock cost for "${key}" must match its machine unlockCost ${String(value.unlockCost)}.`);
    }
  }

  for (const [key, value] of Object.entries(recipes)) {
    if (!isRecord(value)) {
      continue;
    }
    const requirement = recipeRequirements.get(key);
    if (isFiniteNumber(value.unlockCost) && value.unlockCost > 0 && requirement === undefined) {
      errors.push(`Recipe "${key}" has a paid unlock and must declare unlock requirements.`);
    }
    if (requirement === undefined) {
      continue;
    }
    if (requirement.cost !== value.unlockCost) {
      errors.push(`Recipe unlock cost for "${key}" must match its recipe unlockCost ${String(value.unlockCost)}.`);
    }
    if (typeof value.machine === "string" && Array.isArray(requirement.requiresMachines)) {
      if (!requirement.requiresMachines.some((prerequisite) => String(prerequisite) === value.machine)) {
        errors.push(`Recipe unlock requirements for "${key}" must require its machine "${value.machine}".`);
      }
    }
    for (const gap of missingInputProducers(key, value, inputProducers, requirement)) {
      errors.push(
        `Recipe unlock requirements for "${key}" must require "${gap.producer}" to produce input "${gap.input}".`,
      );
    }
  }

  for (const [key, requirement] of machineRequirements) {
    validateRequirement(
      "Machine unlock requirements",
      key,
      requirement,
      machinePrerequisiteContract(machines, recipes),
      errors,
    );
  }

  for (const [key, requirement] of recipeRequirements) {
    validateRequirement(
      "Recipe unlock requirements",
      key,
      requirement,
      machinePrerequisiteContract(machines, recipes),
      errors,
    );
  }
}

function validateContentUnsafe(input: unknown): string[] {
  const errors: string[] = [];
  collectFreezeErrors(input, "", new WeakSet<object>(), errors);

  if (!isRecord(input)) {
    errors.push("Content must be an object containing resources, machines, recipes, and unlocks.");
    return errors;
  }

  const resources = isRecord(input.resources) ? input.resources : undefined;
  const machines = isRecord(input.machines) ? input.machines : undefined;
  const recipes = isRecord(input.recipes) ? input.recipes : undefined;
  const unlocks = isRecord(input.unlocks) ? input.unlocks : undefined;

  for (const field of ["resources", "machines", "recipes", "unlocks"] as const) {
    if (input[field] === undefined) {
      errors.push(`Content is missing required field "${field}".`);
    } else if (!isRecord(input[field])) {
      errors.push(`Content field "${field}" must be an object.`);
    }
  }

  const resourceIds = resources === undefined ? new Set<string>() : validateResources(resources, errors);
  const machineValidations =
    machines === undefined
      ? new Map<string, MachineValidation>()
      : validateMachines(machines, resourceIds, errors);
  if (recipes !== undefined) {
    validateRecipes(recipes, resources ?? {}, machineValidations, errors);
  }
  if (unlocks !== undefined) {
    validateUnlocks(unlocks, machines ?? {}, recipes ?? {}, errors);
  }

  return errors;
}

export function validateContent(input: unknown = DEFAULT_CONTENT): string[] {
  try {
    return [...new Set(validateContentUnsafe(input))];
  } catch {
    return ["Content validation could not inspect the supplied input."];
  }
}
