import { arePortsConnected, findConnectedEntity, getEntityAt, getWorldPortCells } from "./connections";
import { getOutputCapacity, getProcessorRecipe, getResourceAmount } from "./machines";
import type { Entity, MachineRuntime, ResourceId, SimulationState } from "./types";

export const CHUNK_SIZE = 8;

export const PRODUCING_MACHINE_TYPES: ReadonlySet<string> = new Set([
  "extractor",
  "smelter",
  "assembler",
]);

export interface WorldLookup {
  getEntityAt(x: number, y: number): Entity | undefined;
  getConnectedTarget(entity: Entity): Entity | undefined;
  getBeltEntities(): readonly Entity[];
}

export interface ActiveIndexTelemetry {
  readonly complete: boolean;
  readonly connectionChecks: number;
  readonly productionVisits: number;
  readonly productionSkips: number;
  readonly chunksVisited: number;
  readonly chunksSkipped: number;
}

export class ActiveEntityIndex implements WorldLookup {
  #source: readonly Entity[] = [];
  #entityById = new Map<string, Entity>();
  #entityAt = new Map<string, Entity>();
  #order = new Map<string, number>();
  #belts: Entity[] = [];
  #active = new Set<string>();
  #dirty = new Set<string>();
  #chunkEntities = new Map<string, string[]>();
  #activeChunks = new Set<string>();
  #duplicateCell = false;
  #forcedIncomplete = false;
  #connectionChecks = 0;
  #productionVisits = 0;
  #productionSkips = 0;
  #chunksVisited = 0;
  #chunksSkipped = 0;

  public rebuild(entities: readonly Entity[]): void {
    this.#source = entities;
    this.#entityById = new Map<string, Entity>();
    this.#entityAt = new Map<string, Entity>();
    this.#order = new Map<string, number>();
    this.#belts = [];
    this.#active = new Set<string>();
    this.#chunkEntities = new Map<string, string[]>();
    this.#activeChunks = new Set<string>();
    this.#duplicateCell = false;
    this.#forcedIncomplete = false;

    for (let position = 0; position < entities.length; position += 1) {
      const entity = entities[position];
      if (entity === undefined) {
        continue;
      }

      this.#entityById.set(entity.id, entity);
      this.#order.set(entity.id, position);
      this.#active.add(entity.id);
      const cell = getCellKey(entity.x, entity.y);
      if (this.#entityAt.has(cell)) {
        this.#duplicateCell = true;
      } else {
        this.#entityAt.set(cell, entity);
      }

      const chunk = getChunkKey(entity.x, entity.y);
      const bucket = this.#chunkEntities.get(chunk);
      if (bucket === undefined) {
        this.#chunkEntities.set(chunk, [entity.id]);
      } else {
        bucket.push(entity.id);
      }

      if (entity.type === "belt") {
        this.#belts.push(entity);
      }
    }

    for (const chunk of this.#chunkEntities.keys()) {
      this.#activeChunks.add(chunk);
    }
  }

  public markIncomplete(): void {
    this.#forcedIncomplete = true;
  }

  public canRebuild(): boolean {
    return !this.#forcedIncomplete && !this.#duplicateCell;
  }

  public isCompleteFor(entities: readonly Entity[]): boolean {
    if (!this.canRebuild() || entities.length !== this.#source.length) {
      return false;
    }

    for (let position = 0; position < entities.length; position += 1) {
      const candidate = entities[position];
      const indexed = this.#source[position];
      if (
        candidate === undefined ||
        indexed === undefined ||
        candidate.id !== indexed.id ||
        candidate.type !== indexed.type ||
        candidate.x !== indexed.x ||
        candidate.y !== indexed.y ||
        candidate.rotation !== indexed.rotation
      ) {
        return false;
      }
    }

    return true;
  }

  public getEntityById(entityId: string): Entity | undefined {
    return this.#entityById.get(entityId);
  }

  public getBeltEntities(): readonly Entity[] {
    return this.#belts;
  }

  public getEntityAt(x: number, y: number): Entity | undefined {
    return this.#entityAt.get(getCellKey(x, y));
  }

  public getConnectedTarget(entity: Entity): Entity | undefined {
    const candidates: Entity[] = [];
    for (const cell of getWorldPortCells(entity)) {
      if (cell.port.kind !== "output") {
        continue;
      }

      const occupant = this.#entityAt.get(getCellKey(cell.x, cell.y));
      if (occupant === undefined || occupant.id === entity.id) {
        continue;
      }
      if (!candidates.includes(occupant)) {
        candidates.push(occupant);
      }
    }

    if (candidates.length > 1) {
      candidates.sort(
        (left, right) => (this.#order.get(left.id) ?? 0) - (this.#order.get(right.id) ?? 0),
      );
    }

    for (const candidate of candidates) {
      this.#connectionChecks += 1;
      if (arePortsConnected(entity, candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  public registerEntity(entity: Entity): void {
    this.#active.add(entity.id);
    this.#activeChunks.add(getChunkKey(entity.x, entity.y));
  }

  public retireEntity(entityId: string): void {
    this.#active.delete(entityId);
  }

  public isActive(entityId: string): boolean {
    return this.#active.has(entityId);
  }

  public observeProduction(entity: Entity, quiescent: boolean): void {
    if (quiescent) {
      this.#productionSkips += 1;
      this.retireEntity(entity.id);
      return;
    }

    this.#productionVisits += 1;
    this.#active.add(entity.id);
  }

  public markDirty(entityId: string): void {
    this.#dirty.add(entityId);
    const entity = this.#entityById.get(entityId);
    if (entity !== undefined) {
      this.#active.add(entityId);
      this.#activeChunks.add(getChunkKey(entity.x, entity.y));
    }
  }

  public isDirty(entityId: string): boolean {
    return this.#dirty.has(entityId);
  }

  public drainDirtyEntityIds(): string[] {
    const drained: string[] = [];
    for (const entity of this.#source) {
      if (this.#dirty.delete(entity.id)) {
        drained.push(entity.id);
      }
    }
    return drained;
  }

  public getChunkKey(x: number, y: number): string {
    return getChunkKey(x, y);
  }

  public getChunkEntityIds(chunkKey: string): readonly string[] {
    return this.#chunkEntities.get(chunkKey) ?? [];
  }

  public isChunkActive(chunkKey: string): boolean {
    return this.#activeChunks.has(chunkKey);
  }

  public noteChunkVisited(): void {
    this.#chunksVisited += 1;
  }

  public noteChunkSkipped(): void {
    this.#chunksSkipped += 1;
  }

  public refreshActivity(state: SimulationState): void {
    this.#activeChunks = new Set();
    for (const entity of this.#source) {
      if (!this.#active.has(entity.id) && !holdsGoods(state, entity)) {
        continue;
      }

      this.#activeChunks.add(getChunkKey(entity.x, entity.y));
      for (const cell of getWorldPortCells(entity)) {
        this.#activeChunks.add(getChunkKey(cell.x, cell.y));
      }
    }
  }

  public getTelemetry(): ActiveIndexTelemetry {
    return Object.freeze({
      complete: !this.#forcedIncomplete && !this.#duplicateCell,
      connectionChecks: this.#connectionChecks,
      productionVisits: this.#productionVisits,
      productionSkips: this.#productionSkips,
      chunksVisited: this.#chunksVisited,
      chunksSkipped: this.#chunksSkipped,
    });
  }

  public resetTelemetry(): void {
    this.#connectionChecks = 0;
    this.#productionVisits = 0;
    this.#productionSkips = 0;
    this.#chunksVisited = 0;
    this.#chunksSkipped = 0;
  }
}

export function createFullLookup(entities: readonly Entity[]): WorldLookup {
  let belts: Entity[] | undefined;
  return {
    getEntityAt: (x, y) => getEntityAt(entities, x, y),
    getConnectedTarget: (entity) => findConnectedEntity(entity, entities),
    getBeltEntities: () => {
      if (belts === undefined) {
        belts = entities.filter((entity) => entity.type === "belt");
      }
      return belts;
    },
  };
}

export function isQuiescentProducer(
  entity: Entity,
  runtime: MachineRuntime,
  state: SimulationState,
): boolean {
  if (entity.type === "extractor") {
    const resource = entity.resourceNode;
    if (resource === undefined) {
      return true;
    }

    return !runtime.active && getResourceAmount(runtime.output, resource) >= getOutputCapacity(entity);
  }

  if (runtime.active || runtime.progressTicks > 0) {
    return false;
  }

  const recipe = getProcessorRecipe(entity, state);
  if (recipe === undefined) {
    return true;
  }

  const needsInput = Object.values(recipe.inputs).some((amount) => amount > 0);
  return needsInput && !hasAmount(runtime.input);
}

export function isQuiescentTransfer(entity: Entity, runtime: MachineRuntime): boolean {
  if (runtime.alreadyNotifiedBlocked || runtime.blockedRefusalTicks !== undefined) {
    return false;
  }

  return !hasAmount(entity.type === "silo" ? runtime.input : runtime.output);
}

export function holdsGoods(state: SimulationState, entity: Entity): boolean {
  if (entity.type === "belt") {
    return state.grid.belts[entity.id]?.item !== undefined;
  }

  const runtime = state.grid.machines[entity.id];
  return runtime !== undefined && (hasAmount(runtime.input) || hasAmount(runtime.output));
}

function hasAmount(values: Partial<Record<ResourceId, number>>): boolean {
  for (const resource of Object.keys(values) as ResourceId[]) {
    if ((values[resource] ?? 0) > 0) {
      return true;
    }
  }
  return false;
}

function getCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function getChunkKey(x: number, y: number): string {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)}`;
}
