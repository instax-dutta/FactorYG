import { getMachine } from "../content/machines";
import { getResource } from "../content/resources";
import { arePortsConnected, getProducedResource, getWorldPortCells } from "./connections";
import {
  CURRENCY_RATE_WINDOW_SECONDS,
  getWindowedSaleCurrency,
  hasFullRateWindow,
} from "./economy";
import { getProcessorRecipe } from "./machines";
import type {
  Entity,
  ProductionChainSummary,
  RecipeDefinition,
  ResourceId,
  SimulationState,
} from "./types";

const CHAIN_ID_PREFIX = "chain-";

interface TracedChain {
  id: string;
  outputResource?: ResourceId;
  saleTerminalIds: string[];
}

export function analyzeProductionChains(
  state: SimulationState,
): Record<string, ProductionChainSummary> {
  const chains = traceProductionChains(state);
  const claimedTerminals = claimSaleTerminals(chains);
  const summaries: Record<string, ProductionChainSummary> = {};
  for (const chain of chains) {
    if (chain.outputResource === undefined) {
      continue;
    }

    const saleTerminalIds = (claimedTerminals.get(chain.id) ?? []).filter((terminalId) =>
      chain.saleTerminalIds.includes(terminalId),
    );
    summaries[chain.id] = {
      id: chain.id,
      outputResource: chain.outputResource,
      steadyStateThroughput: measureChainThroughput(state, chain, saleTerminalIds),
      sellValue: getResource(chain.outputResource)?.sellValue ?? 0,
    };
  }
  return summaries;
}

export function getSteadyStateThroughput(state: SimulationState): number {
  const summaries = analyzeProductionChains(state);
  const total = Object.keys(summaries).reduce(
    (sum, chainId) => sum + (summaries[chainId]?.steadyStateThroughput ?? 0),
    0,
  );
  return Number.isFinite(total) ? total : 0;
}

export function traceChainNodes(
  startId: string,
  successors: ReadonlyMap<string, readonly string[]>,
): string[] {
  if (!successors.has(startId)) {
    return [];
  }

  const nodes: string[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = startId;
  while (currentId !== undefined && !visited.has(currentId)) {
    visited.add(currentId);
    nodes.push(currentId);
    currentId = successors.get(currentId)?.[0];
  }
  return nodes;
}

export function getDrainableEntityIds(state: SimulationState): ReadonlySet<string> {
  const entities = state.grid.entities;
  const producersByTarget = new Map<string, string[]>();
  for (const [sourceId, targetIds] of buildSuccessors(state)) {
    for (const targetId of targetIds) {
      const producers = producersByTarget.get(targetId);
      if (producers === undefined) {
        producersByTarget.set(targetId, [sourceId]);
      } else {
        producers.push(sourceId);
      }
    }
  }

  const producible = collectProducibleResources(state);
  const consumesWhatItHolds = new Map<string, boolean>();
  for (const entity of entities) {
    consumesWhatItHolds.set(entity.id, canConsumeWhatItHolds(entity, state, producible));
  }

  const drainable = new Set<string>();
  const frontier: string[] = [];
  for (const entity of entities) {
    if (isSaleTerminal(entity)) {
      drainable.add(entity.id);
      frontier.push(entity.id);
    }
  }
  frontier.sort(compareIds);

  for (let head = 0; head < frontier.length; head += 1) {
    for (const producerId of producersByTarget.get(frontier[head]) ?? []) {
      if (consumesWhatItHolds.get(producerId) !== true || drainable.has(producerId)) {
        continue;
      }

      drainable.add(producerId);
      frontier.push(producerId);
    }
  }

  return drainable;
}

function canConsumeWhatItHolds(
  entity: Entity,
  state: SimulationState,
  producible: ReadonlySet<ResourceId>,
): boolean {
  if (entity.type !== "smelter" && entity.type !== "assembler") {
    return true;
  }

  const recipe = getProcessorRecipe(entity, state);
  if (recipe === undefined) {
    return false;
  }

  return Object.keys(recipe.inputs).every((input) => producible.has(input as ResourceId));
}

function collectProducibleResources(state: SimulationState): ReadonlySet<ResourceId> {
  const producible = new Set<ResourceId>();
  const seen = new Set<string>();
  const recipes: RecipeDefinition[] = [];
  for (const entity of state.grid.entities) {
    if (entity.type === "extractor" && entity.resourceNode !== undefined) {
      producible.add(entity.resourceNode);
      continue;
    }
    if (entity.type !== "smelter" && entity.type !== "assembler") {
      continue;
    }

    const recipe = getProcessorRecipe(entity, state);
    if (recipe !== undefined && !seen.has(recipe.id)) {
      seen.add(recipe.id);
      recipes.push(recipe);
    }
  }

  let settled = false;
  while (!settled) {
    settled = true;
    for (const recipe of recipes) {
      if (producible.has(recipe.output.resource)) {
        continue;
      }
      if (!Object.keys(recipe.inputs).every((input) => producible.has(input as ResourceId))) {
        continue;
      }

      producible.add(recipe.output.resource);
      settled = false;
    }
  }

  return producible;
}

function traceProductionChains(state: SimulationState): TracedChain[] {
  const entities = state.grid.entities;
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const successors = buildSuccessors(state);
  const connected = collectConnectedEntityIds(successors);
  const traced = new Set<string>();
  const chains: TracedChain[] = [];

  for (const entity of sortEntitiesById(entities)) {
    if (connected.has(entity.id)) {
      continue;
    }

    const nodes = traceChainNodes(entity.id, successors);
    markTraced(traced, nodes);
    chains.push(createTracedChain(nodes, entityById, entity.id));
  }

  for (const entity of sortEntitiesById(entities)) {
    if (traced.has(entity.id)) {
      continue;
    }

    chains.push(createTracedChain(traceChainNodes(entity.id, successors), entityById, entity.id));
  }

  return chains.sort((left, right) => compareIds(left.id, right.id));
}

function buildSuccessors(state: SimulationState): Map<string, string[]> {
  const sorted = sortEntitiesById(state.grid.entities);
  const entityAtCell = new Map<string, Entity>();
  for (const entity of sorted) {
    const key = getCellKey(entity.x, entity.y);
    if (!entityAtCell.has(key)) {
      entityAtCell.set(key, entity);
    }
  }

  const successors = new Map<string, string[]>();
  for (const entity of sorted) {
    const targets: string[] = [];
    for (const cell of getWorldPortCells(entity)) {
      if (cell.port.kind !== "output") {
        continue;
      }

      const target = entityAtCell.get(getCellKey(cell.x, cell.y));
      if (target === undefined || target.id === entity.id) {
        continue;
      }
      if (arePortsConnected(entity, target, getCarriedResource(state, entity))) {
        targets.push(target.id);
      }
    }
    successors.set(entity.id, sortIds(targets));
  }
  return successors;
}

function getCarriedResource(state: SimulationState, entity: Entity): ResourceId | undefined {
  return state.grid.belts[entity.id]?.item;
}

function createTracedChain(
  nodes: string[],
  entityById: ReadonlyMap<string, Entity>,
  keyEntityId: string,
): TracedChain {
  const chainEntities = nodes
    .map((nodeId) => entityById.get(nodeId))
    .filter((entity): entity is Entity => entity !== undefined);
  const saleTerminalIds = chainEntities
    .filter((entity) => isSaleTerminal(entity))
    .map((entity) => entity.id);

  return {
    id: `${CHAIN_ID_PREFIX}${keyEntityId}`,
    outputResource: findLastProducedResource(chainEntities),
    saleTerminalIds,
  };
}

function isSaleTerminal(entity: Entity): boolean {
  return getMachine(entity.type)?.saleTerminal === true;
}

function claimSaleTerminals(chains: readonly TracedChain[]): Map<string, string[]> {
  const claims = new Map<string, string[]>();
  for (const chain of chains) {
    claims.set(chain.id, []);
  }

  const owners = new Map<string, string>();
  for (const chain of chains) {
    for (const terminalId of chain.saleTerminalIds) {
      if (!owners.has(terminalId)) {
        owners.set(terminalId, chain.id);
      }
    }
  }

  for (const [terminalId, ownerId] of owners) {
    claims.get(ownerId)?.push(terminalId);
  }

  return claims;
}

function findLastProducedResource(entities: readonly Entity[]): ResourceId | undefined {
  for (let index = entities.length - 1; index >= 0; index -= 1) {
    const entity = entities[index];
    if (entity === undefined) {
      continue;
    }

    const resource = getProducedResources(entity)[0];
    if (resource !== undefined) {
      return resource;
    }
  }
  return undefined;
}

function getProducedResources(entity: Entity): ResourceId[] {
  const produced: ResourceId[] = [];
  for (const cell of getWorldPortCells(entity)) {
    if (cell.port.kind !== "output") {
      continue;
    }

    const resource = getProducedResource(entity, cell.port);
    if (resource !== undefined && !produced.includes(resource)) {
      produced.push(resource);
    }
  }
  return produced;
}

function measureChainThroughput(
  state: SimulationState,
  chain: TracedChain,
  claimedTerminalIds: readonly string[],
): number {
  if (chain.outputResource === undefined || claimedTerminalIds.length === 0) {
    return 0;
  }
  if (!hasFullRateWindow(state)) {
    return 0;
  }

  const sellMultiplier = state.prestige.permanentMultipliers.sellValue;
  const unitSellValue = getResource(chain.outputResource)?.sellValue ?? 0;
  if (!Number.isFinite(sellMultiplier) || sellMultiplier <= 0) {
    return 0;
  }
  if (!Number.isFinite(unitSellValue) || unitSellValue <= 0) {
    return 0;
  }

  let windowCurrency = 0;
  for (const terminalId of claimedTerminalIds) {
    windowCurrency += getWindowedSaleCurrency(state, {
      entityId: terminalId,
      resource: chain.outputResource,
    });
  }

  const throughput =
    windowCurrency / (unitSellValue * sellMultiplier * CURRENCY_RATE_WINDOW_SECONDS);
  return Number.isFinite(throughput) && throughput > 0 ? throughput : 0;
}

function collectConnectedEntityIds(successors: ReadonlyMap<string, readonly string[]>): Set<string> {
  const connected = new Set<string>();
  for (const targets of successors.values()) {
    for (const target of targets) {
      connected.add(target);
    }
  }
  return connected;
}

function getCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function markTraced(traced: Set<string>, nodes: readonly string[]): void {
  for (const nodeId of nodes) {
    traced.add(nodeId);
  }
}

function sortEntitiesById(entities: readonly Entity[]): Entity[] {
  return [...entities].sort((left, right) => compareIds(left.id, right.id));
}

function sortIds(ids: readonly string[]): string[] {
  return [...ids].sort(compareIds);
}

function compareIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
