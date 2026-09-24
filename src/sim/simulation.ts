import { TICK_HZ } from '../config/constants';
import { applyExpansion, BASE_GRID, expansionCostFor, type Bounds } from './expansion';
import { MACHINES, acceptsFrom, rotationDelta, type MachineType, type Rotation } from './machines';
import { classifyConnection, classifyRun, neighborViews } from './connections';
import {
  canPlace,
  projectPlacement,
  type Cell,
  type PlaceCheck,
  type PlaceError,
  type PlacementPreview,
} from './placement';
import type { BeltRun } from './runs';
import { ProductionLedger, type ChainInfo } from './throughputLedger';
import type { OfflineReport } from './offline';
import {
  RECIPES,
  consumeInputs,
  inputCapacityFor,
  matchRecipe,
  sellValueFor,
  type CrafterMachine,
  type RecipeId,
} from './recipes';
import {
  applyUpgrade,
  isUpgradeable,
  speedMultiplierFor,
  type UpgradeRefusal,
} from './upgrades';
import { prestigeState, type PrestigeState } from './prestige';
import { resourceNodeAt, type RawResourceId, type ResourceId } from './worldgen';
import {
  ALL_UNLOCKED,
  isMachineUnlocked,
  isRecipeUnlocked,
  techNode,
  unlock as unlockNode,
  type TechNode,
  type UnlockRefusal,
  type UnlockState,
} from './techTree';

export type { PlaceCheck, PlaceError, PlacementPreview } from './placement';

export interface Entity {
  id: string;
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  /** Resource node under an extractor; null for everything else. */
  resourceNode: RawResourceId | null;
  /** The item this machine is holding ready to hand downstream. */
  item: ResourceId | null;
  /**
   * Held resources, by resource: a crafter's input buffer, or everything a
   * silo is storing (a silo keeps one item in `item` as the one it is releasing
   * and the rest here).
   */
  inputs: Partial<Record<ResourceId, number>>;
  /** Crafters: the recipe being worked on, or null when idle. */
  recipe: RecipeId | null;
  /** Ticks of extraction or crafting progress. */
  progress: number;
}

export type UpgradeError = UpgradeRefusal | 'empty' | 'not-upgradeable';

export type UpgradeOutcome =
  | { ok: true; level: number; cost: number }
  | { ok: false; reason: UpgradeError };

export type PlaceResult = { ok: true; entity: Entity } | { ok: false; reason: PlaceError };

export type MoveError = 'empty' | 'occupied' | 'out-of-bounds' | 'same-cell' | 'no-resource-node';
export type MoveResult = { ok: true } | { ok: false; reason: MoveError };

export interface SimSnapshot {
  currency: number;
  cps: number;
  entities: readonly Entity[];
  chains: readonly ChainInfo[];
  /** The placeable plot and how many expansion steps bought it. */
  plot: { width: number; height: number; expansionsBought: number };
}

export type PrestigeResult =
  | { ok: true; points: number; totalPrestiges: number }
  | { ok: false; reason: 'not-enough-motors' | 'no-fresh-point' };

/** Rolling window for the currency/sec readout. */
const CPS_WINDOW_TICKS = 5 * TICK_HZ;

const cellKey = (x: number, y: number): string => `${x},${y}`;

/** The four grid directions, for walks that must consider every side. */
const AXIS_DELTAS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
];

function isCrafter(type: MachineType): type is CrafterMachine {
  return type === 'smelter' || type === 'assembler';
}

/** Items a silo is storing, excluding the one it is releasing. */
function bufferedCount(entity: Entity): number {
  return Object.values(entity.inputs).reduce((total, count) => total + (count ?? 0), 0);
}

/**
 * Pops one unit off a buffer. Object key order is insertion order, so a silo
 * releases in the order resources were first stored in it.
 */
function takeFromBuffer(buffer: Partial<Record<ResourceId, number>>): ResourceId | null {
  for (const [item, count] of Object.entries(buffer)) {
    const key = item as ResourceId;
    if ((count ?? 0) <= 0) continue;
    if ((count ?? 0) > 1) buffer[key] = (count ?? 0) - 1;
    else delete buffer[key];
    return key;
  }
  return null;
}

/**
 * Plain-TS game state, ticked at a fixed 10tps independently of rendering.
 * three.js and React never own this state; they read snapshots from it.
 */
export interface SimulationOptions {
  /**
   * Tech tree state. Defaults to everything unlocked so a bare `Simulation` is a
   * sandbox for tests and tooling; the app always passes the player's save state.
   */
  unlocked?: UnlockState;
}

export class Simulation {
  currency = 0;

  /**
   * Motors ever sold, across every prestige cycle. This is the only prestige
   * input that is stored: points and multipliers are derived from it, so a run
   * cannot be left holding a multiplier its production never earned.
   */
  lifetimeMotors = 0;

  /** Completed resets. Kept for the HUD and the save; points do not depend on it. */
  totalPrestiges = 0;

  claimedPrestigePoints = 0;

  /**
   * Machines the last tick actually visited (both passes). An idle factory
   * visits almost nothing however full the grid is, which is the dirty-set
   * contract: the tick skips machines with nothing to do rather than sweeping
   * every entity every tick.
   */
  lastTickWork = 0;

  private readonly cells = new Map<string, Entity>();
  /** Cell keys of machines that have something to do; see `advance()`. */
  private readonly active = new Set<string>();
  private nextId = 1;
  private incomeWindow: number[] = [];
  private tickIncome = 0;
  private tickCount = 0;
  private readonly throughput = new ProductionLedger();
  topologyVersion = 0;
  private routeHealth = new Map<string, boolean>();
  /**
   * The splitter's alternation memory, keyed by entity id: 0 hands the facing
   * exit next, 1 the right exit. In-memory only — a save/load restarting the
   * alternation is invisible next to the item the load itself restarts.
   */
  private splitterTurn = new Map<string, 0 | 1>();
  private unlocked: UnlockState;
  private plot: Bounds;
  private expansionsOwned = 0;
  /**
   * The tree this sim was built with, so a start-over hands back what it
   * started from: `startingUnlocks()` for the app, `ALL_UNLOCKED` for the
   * sandbox a test or tool constructs.
   */
  private readonly initialUnlocks: UnlockState;

  constructor(options: SimulationOptions = {}) {
    this.unlocked = this.initialUnlocks = options.unlocked ?? ALL_UNLOCKED;
    this.plot = { ...BASE_GRID };
  }

  unlocks(): UnlockState {
    return this.unlocked;
  }

  /** Replaces the unlock state wholesale, i.e. when a save is loaded. */
  setUnlocks(state: UnlockState): void {
    this.unlocked = state;
  }

  /** Restores the plot from a save; trusts the persisted dimensions. */
  restoreBounds(width: number, height: number, expansionsBought: number): void {
    this.plot = { width, height };
    this.expansionsOwned = expansionsBought;
    this.invalidateTopology();
  }

  /** Spends factory currency on a tech node. A refusal costs nothing. */
  unlock(id: string): { ok: true; node: TechNode } | { ok: false; reason: UnlockRefusal } {
    const result = unlockNode(this.unlocked, id, this.currency);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.unlocked = result.state;
    this.currency = result.currency;
    const node = techNode(id);
    if (node.kind === 'recipe') {
      for (const entity of this.cells.values()) {
        if (isCrafter(entity.type) && bufferedCount(entity) > 0) this.wakeAt(entity.x, entity.y);
      }
    }
    return { ok: true, node };
  }

  entities(): Entity[] {
    return [...this.cells.values()];
  }

  /**
   * Back to an empty grid: used by prestige and save loading. Deliberately
   * leaves the prestige fields alone — `lifetimeMotors` is what the player has
   * earned and a reset is the point of the loop, not a wipe. The plot reverts
   * to the base 64x64: expansion is a per-cycle purchase like the factory it
   * hosted.
   */
  reset(): void {
    this.cells.clear();
    this.active.clear();
    this.currency = 0;
    this.nextId = 1;
    this.incomeWindow = [];
    this.plot = { ...BASE_GRID };
    this.expansionsOwned = 0;
    this.tickIncome = 0;
    this.lastTickWork = 0;
    this.tickCount = 0;
    this.throughput.clear();
    this.invalidateTopology();
  }

  /**
   * Start over: a fresh factory **and** a fresh player.
   *
   * This is `reset()` plus everything a reset deliberately keeps — the prestige
   * counters and the tech tree — for the player whose factory is a mess and who
   * wants a clean save rather than a new cycle. It restores the tree this sim
   * was constructed with, so it cannot lock a sandbox out of its own machines.
   */
  restart(): void {
    this.reset();
    this.lifetimeMotors = 0;
    this.claimedPrestigePoints = 0;
    this.totalPrestiges = 0;
    this.unlocked = this.initialUnlocks;
  }

  /** The player's permanent bonuses, derived from lifetime production. */
  prestigeState(): PrestigeState {
    return prestigeState(this.lifetimeMotors, this.totalPrestiges, this.claimedPrestigePoints);
  }

  /**
   * Spends the factory for permanent multipliers: the grid, its items and the
   * currency go; the points, the multipliers and the tech tree stay.
   *
   * Refuses when the run has not earned a fresh point, so a reset can never
   * trade a working factory for nothing.
   */
  prestige(): PrestigeResult {
    const state = this.prestigeState();
    if (state.points === 0) return { ok: false, reason: 'not-enough-motors' };
    if (state.availablePoints <= 0) return { ok: false, reason: 'no-fresh-point' };

    const points = state.availablePoints;
    this.reset();
    this.claimedPrestigePoints = state.points;
    this.totalPrestiges += 1;
    return { ok: true, points, totalPrestiges: this.totalPrestiges };
  }

  restoreThroughput(chains: readonly ChainInfo[]): void {
    this.throughput.seed(chains, this.tickCount);
  }

  creditOffline(report: OfflineReport): void {
    this.currency += report.totalCurrency;
    for (const gain of report.gains) {
      if (gain.outputResource === 'motor') this.lifetimeMotors += gain.amount;
    }
  }

  /** Rebuild an entity verbatim from a save, keeping id allocation monotonic. */
  restoreEntity(
    saved: Omit<Entity, 'progress' | 'inputs' | 'recipe'> & {
      progress?: number;
      inputs?: Entity['inputs'];
      recipe?: Entity['recipe'];
    },
  ): Entity {
    const entity: Entity = {
      id: saved.id,
      type: saved.type,
      x: saved.x,
      y: saved.y,
      rotation: saved.rotation,
      level: saved.level,
      resourceNode: saved.resourceNode,
      item: saved.item,
      // In-flight crafts are deliberately not persisted: a save is a factory,
      // not a memory dump, and a half-finished craft is worth a fraction of an
      // item. Buffered inputs are cheap to lose and rebuild.
      inputs: saved.inputs ?? {},
      recipe: saved.recipe ?? null,
      progress: saved.progress ?? 0,
    };
    this.cells.set(cellKey(entity.x, entity.y), entity);
    this.invalidateTopology();
    this.wakeAt(entity.x, entity.y);
    const numericId = Number.parseInt(entity.id.replace(/^e/, ''), 10);
    if (Number.isFinite(numericId)) this.nextId = Math.max(this.nextId, numericId + 1);
    return entity;
  }

  entityAt(cell: Cell): Entity | null {
    return this.cells.get(cellKey(cell.x, cell.y)) ?? null;
  }

  /**
   * Buys one level for the machine on a cell. The cost curve and the level cap
   * live in `upgrades.ts`; this only owns the purse and the entity.
   */
  upgrade(cell: Cell): UpgradeOutcome {
    const entity = this.entityAt(cell);
    if (!entity) return { ok: false, reason: 'empty' };
    if (!isUpgradeable(entity.type)) return { ok: false, reason: 'not-upgradeable' };

    const result = applyUpgrade(entity.level, this.currency);
    if (!result.ok) return { ok: false, reason: result.reason };

    const cost = this.currency - result.currency;
    entity.level = result.level;
    this.currency = result.currency;
    return { ok: true, level: entity.level, cost };
  }

  /** The placeable plot: base 64x64 grown by EXPANSION_STEP per purchase. */
  bounds(): Bounds {
    return this.plot;
  }

  expansionsBought(): number {
    return this.expansionsOwned;
  }

  /** Spends factory currency on one expansion step. A refusal costs nothing. */
  buyExpansion(): { ok: true; cost: number } | { ok: false; reason: 'maxed' | 'insufficient-currency' } {
    const result = applyExpansion(this.plot, this.expansionsOwned);
    if (!result.ok) return { ok: false, reason: 'maxed' };
    const cost = expansionCostFor(this.expansionsOwned);
    if (this.currency < cost) return { ok: false, reason: 'insufficient-currency' };
    this.plot = result.bounds;
    this.expansionsOwned += 1;
    this.currency -= cost;
    this.invalidateTopology();
    return { ok: true, cost };
  }

  /** Placement rules without mutating anything: used by the ghost preview. */
  canPlaceAt(type: MachineType, x: number, y: number): PlaceCheck {
    const result = canPlace(
      { x, y },
      {
        width: this.plot.width,
        height: this.plot.height,
        isOccupied: (cell) => this.cells.has(cellKey(cell.x, cell.y)),
      },
    );
    if (!result.ok) return result;
    if (!isMachineUnlocked(this.unlocked, type)) {
      return { ok: false, reason: 'locked' };
    }
    if (MACHINES[type].requiresNode && !resourceNodeAt(x, y)) {
      return { ok: false, reason: 'no-resource-node' };
    }
    return { ok: true };
  }

  previewAt(type: MachineType, x: number, y: number, rotation: Rotation): PlacementPreview {
    const cell = { x, y };
    const check = this.canPlaceAt(type, x, y);
    const connection = classifyConnection(
      { type, rotation },
      neighborViews(cell, this.cells),
    );
    return projectPlacement(type, check, connection);
  }

  previewRun(run: BeltRun): PlacementPreview[] {
    const connections = classifyRun(
      { cells: run.cells, rotation: run.rotation, type: 'belt' },
      this.cells,
    );
    return run.cells.map((cell, index) =>
      projectPlacement('belt', this.canPlaceAt('belt', cell.x, cell.y), connections[index] ?? 'disconnected'),
    );
  }

  place(type: MachineType, x: number, y: number, rotation: Rotation): PlaceResult {
    const check = this.canPlaceAt(type, x, y);
    if (!check.ok) return check;

    const definition = MACHINES[type];
    const resourceNode = resourceNodeAt(x, y);

    const entity: Entity = {
      id: `e${this.nextId++}`,
      type,
      x,
      y,
      rotation,
      level: 1,
      resourceNode: definition.requiresNode ? resourceNode : null,
      item: null,
      inputs: {},
      recipe: null,
      progress: 0,
    };
    this.cells.set(cellKey(x, y), entity);
    this.invalidateTopology();
    this.wakeAt(x, y);
    return { ok: true, entity };
  }

  /**
   * Whether a whole belt run can be placed, without placing anything.
   *
   * All-or-nothing on purpose: a run with a hole in it is worse than no run,
   * because the missing cell is invisible in a row of identical belts. Looking
   * without touching is also what lets the drag preview tint the run before the
   * player commits to it.
   */
  canPlaceRun(run: BeltRun): boolean {
    return run.cells.every((cell) => this.canPlaceAt('belt', cell.x, cell.y).ok);
  }

  /**
   * Places a belt on every cell of a run. Returns the cells placed, or nothing
   * at all when the run is refused, so a caller can record exactly one undo.
   */
  placeRun(run: BeltRun): Cell[] {
    if (!this.canPlaceRun(run)) return [];
    for (const cell of run.cells) {
      this.place('belt', cell.x, cell.y, run.rotation);
    }
    if (run.cells.length > 0) this.invalidateTopology();
    return run.cells.map((cell) => ({ x: cell.x, y: cell.y }));
  }

  /**
   * Relocates a placed machine. This is what makes a long belt run fixable: a
   * mis-placed belt used to mean demolishing and rebuilding everything behind it.
   *     * A move is a relocation, not a rebuild — the same entity keeps its id, level,
     * buffer, held item and in-flight progress, so moving a silo does not quietly
     * empty it and nothing downstream needs rewiring. Only an extractor's resource
     * is re-read, because that comes from the tile it is standing on.
     *
     * The rules live in `canMove`, so the drag preview and this cannot disagree.
   */
  /** Move rules without mutating anything: used by the drag preview. */
  canMove(from: Cell, to: Cell): MoveResult {
    const entity = this.entityAt(from);
    if (!entity) return { ok: false, reason: 'empty' };
    if (from.x === to.x && from.y === to.y) return { ok: false, reason: 'same-cell' };
    if (to.x < 0 || to.y < 0 || to.x >= this.plot.width || to.y >= this.plot.height) {
      return { ok: false, reason: 'out-of-bounds' };
    }
    if (this.cells.has(cellKey(to.x, to.y))) return { ok: false, reason: 'occupied' };
    // The same rule as placement: an extractor with no node under it would be a
    // machine that can never produce, so it is refused rather than allowed.
    if (MACHINES[entity.type].requiresNode && !resourceNodeAt(to.x, to.y)) {
      return { ok: false, reason: 'no-resource-node' };
    }
    return { ok: true };
  }

  move(from: Cell, to: Cell): MoveResult {
    const entity = this.entityAt(from);
    if (!entity) return { ok: false, reason: 'empty' };
    const check = this.canMove(from, to);
    if (!check.ok) return check;

    const definition = MACHINES[entity.type];
    const node = resourceNodeAt(to.x, to.y);

    this.cells.delete(cellKey(from.x, from.y));
    this.active.delete(cellKey(from.x, from.y));
    entity.x = to.x;
    entity.y = to.y;
    if (definition.requiresNode) entity.resourceNode = node;
    this.cells.set(cellKey(to.x, to.y), entity);
    this.invalidateTopology();
    this.wakeAt(to.x, to.y);
    return { ok: true };
  }

  removeAt(cell: Cell): boolean {
    const removedEntity = this.entityAt(cell);
    if (removedEntity) this.splitterTurn.delete(removedEntity.id);
    const removed = this.cells.delete(cellKey(cell.x, cell.y));
    // A machine that is gone cannot have work. Anything stalled behind it is
    // holding an item, so it stays active and retries on its own.
    this.active.delete(cellKey(cell.x, cell.y));
    if (removed) this.invalidateTopology();
    return removed;
  }

  /** Adds a machine to the active set, if that cell holds one. */
  private invalidateTopology(): void {
    this.topologyVersion += 1;
    this.routeHealth.clear();
  }

  private wakeAt(x: number, y: number): void {
    const key = cellKey(x, y);
    if (this.cells.has(key)) this.active.add(key);
  }

  /**
   * One fixed simulation step (1/TICK_HZ seconds).
   *
   * Only the active set is visited: a machine is in it while it holds an item
   * (always work to do) or can produce/craft right now. A machine that is idle
   * is dropped until something wakes it, which in practice is only ever a
   * delivery — so nothing that is waiting to move can ever fall asleep with an
   * item in hand.
   */
  tick(): void {
    this.tickIncome = 0;
    this.lastTickWork = 0;
    const moved = new Set<string>();

    // Pass 1: anything holding an item hands it downstream. The `moved` guard
    // stops an item being carried more than one cell in a single tick, whatever
    // order the active set happens to be in.
    for (const key of [...this.active]) {
      this.lastTickWork += 1;
      const entity = this.cells.get(key);
      if (!entity) {
        this.active.delete(key);
        continue;
      }
      // A crossing is a pass-through, not a holder: it forwards each stream in
      // the tick it arrives. See `forwardThroughCrossing`.
      if (entity.type === 'crossing') {
        this.forwardThroughCrossing(entity, moved);
        continue;
      }
      // A splitter is a belt that fans out: it holds like a belt (pass 1 moves
      // its item) but hands to either of two exits. See `advanceSplitter`.
      if (entity.type === 'splitter') {
        this.advanceSplitter(entity, moved);
        continue;
      }
      if (entity.item === null || entity.type === 'depot') continue;
      if (moved.has(entity.id)) continue;

      const target = this.downstreamOf(entity);
      // A stalled machine keeps its item and stays active, so it retries every
      // tick: nothing is dropped and nothing is duplicated while blocked.
      if (!target || !this.accepts(target, entity)) continue;

      const carried = entity.item;
      entity.item = null;
      if (entity.type === 'extractor') entity.progress = 0;
      // Crafters and silos buffer deliveries; a belt carries one item in hand.
      this.deliver(carried, target, moved);
    }

    // Pass 2: sources produce, buffers release, crafters work. A machine whose
    // output slot is occupied is pass 1's business, so it stays active; one
    // with nothing to do is dropped from the active set until a delivery wakes
    // it or the recipe it is running completes.
    for (const key of [...this.active]) {
      this.lastTickWork += 1;
      const entity = this.cells.get(key);
      if (!entity) {
        this.active.delete(key);
        continue;
      }
      // A crossing never produces; its work all happened in pass 1. A splitter
      // holds like a belt, so pass 1 is its whole story too.
      if (entity.type === 'crossing' || entity.type === 'splitter') continue;
      if (entity.item !== null) continue;
      if (!this.advance(entity)) this.active.delete(key);
    }

    this.incomeWindow.push(this.tickIncome);
    if (this.incomeWindow.length > CPS_WINDOW_TICKS) this.incomeWindow.shift();
    this.tickCount += 1;
  }

  /**
   * One tick of production for a machine whose output slot is free. Returns
   * false when the machine has nothing to do, which lets the tick drop it from
   * the active set instead of visiting it forever.
   */
  private advance(entity: Entity): boolean {
    // A level multiplies progress, so a faster machine finishes the same job in
    // fewer ticks whatever the job is (extraction or a recipe). Prestige is a
    // permanent multiplier on top of it.
    const speed =
      speedMultiplierFor(entity.level) * this.prestigeState().permanentMultipliers.productionSpeed;

    if (entity.type === 'extractor') {
      if (!entity.resourceNode) return false;
      entity.progress += speed;
      const ticks = MACHINES.extractor.ticksPerItem ?? 1;
      if (entity.progress >= ticks) {
        entity.item = entity.resourceNode;
        entity.progress = 0;
      }
      return true;
    }

    if (entity.type === 'silo') {
      // One buffered item per tick into the single output slot.
      const released = takeFromBuffer(entity.inputs);
      if (released === null) return false;
      entity.item = released;
      return true;
    }

    // Belts only carry what they already hold.
    if (!isCrafter(entity.type)) return false;

    if (entity.recipe === null) {
      // Inputs are held even for a locked recipe, so the machine starts working
      // the moment the player unlocks it rather than needing a rebuild.
      const recipe = matchRecipe(entity.type, entity.inputs, (id) =>
        isRecipeUnlocked(this.unlocked, id),
      );
      if (!recipe) return false;
      // Inputs are spent when the craft starts, so the buffer frees up for
      // the next delivery while this one runs.
      consumeInputs(entity.inputs, recipe.inputs);
      entity.recipe = recipe.id;
      entity.progress = 0;
      return true;
    }

    entity.progress += speed;
    const recipe = RECIPES[entity.recipe];
    if (entity.progress >= recipe.ticks) {
      entity.item = recipe.output;
      entity.recipe = null;
      entity.progress = 0;
    }
    return true;
  }

  chains(): ChainInfo[] {
    return this.throughput.snapshot(this.tickCount);
  }

  entityReachesDepot(cell: Cell): boolean {
    const key = `${this.topologyVersion}:${cell.x},${cell.y}`;
    const cached = this.routeHealth.get(key);
    if (cached !== undefined) return cached;
    const source = this.entityAt(cell);
    const connected = source ? this.reachesDepot(source) : false;
    this.routeHealth.set(key, connected);
    return connected;
  }

  isConnectedToDepot(cell: Cell): boolean {
    return this.entityReachesDepot(cell);
  }

  private reachesDepot(source: Entity): boolean {
    return this.reachesDepotFrom(source, new Set<string>(), this.cells.size + 1);
  }

  private reachesDepotFrom(source: Entity, visited: Set<string>, remaining: number): boolean {
    let current: Entity | null = source;
    for (let step = 0; step < remaining; step += 1) {
      if (!current) return false;
      if (current.type === 'depot') return true;
      if (MACHINES[current.type].outputs === 0) return false;
      if (visited.has(current.id)) return false;
      visited.add(current.id);
      if (current.type === 'crossing' || current.type === 'splitter') {
        const deltas: readonly (readonly [number, number])[] =
          current.type === 'crossing'
            ? AXIS_DELTAS
            : (() => {
                const facing = rotationDelta(current.rotation);
                return [
                  [facing.x, facing.y],
                  [-facing.y, facing.x],
                ] as const;
              })();
        for (const [dx, dy] of deltas) {
          const next = this.entityAt({ x: current.x + dx, y: current.y + dy });
          if (
            next &&
            this.topologyAccepts(current, next) &&
            this.reachesDepotFrom(next, visited, remaining - step - 1)
          ) {
            return true;
          }
        }
        return false;
      }
      const next = this.downstreamOf(current);
      if (!next || !this.topologyAccepts(current, next)) return false;
      current = next;
    }
    return false;
  }

  private topologyAccepts(source: Entity, target: Entity): boolean {
    return acceptsFrom(target.type, target.rotation, {
      x: source.x - target.x,
      y: source.y - target.y,
    });
  }

  cps(): number {
    const total = this.incomeWindow.reduce((sum, value) => sum + value, 0);
    return total / (CPS_WINDOW_TICKS / TICK_HZ);
  }

  snapshot(): SimSnapshot {
    return {
      currency: this.currency,
      cps: this.cps(),
      entities: this.entities(),
      chains: this.chains(),
      plot: { ...this.plot, expansionsBought: this.expansionsOwned },
    };
  }

  private sell(item: ResourceId): void {
    this.throughput.recordSale(item, this.tickCount);
    // Credited at the multiplier the factory had when the item left, so the
    // motor that earns the point is not retroactively worth more.
    const value = sellValueFor(item) * this.prestigeState().permanentMultipliers.sellValue;
    if (item === 'motor') this.lifetimeMotors += 1;
    this.currency += value;
    this.tickIncome += value;
  }

  /**
   * A crossing's whole tick: forward each axis's incoming stream straight
   * through, in the tick it arrives. The tile never holds an item — the cargo
   * stays parked on its feeder until the far end accepts — which is what keeps
   * two perpendicular streams independent and keeps the Entity item slot and
   * the save schema out of this feature.
   *
   * The exit delta comes from the STREAM's axis, not the tile's rotation, so
   * facing is cosmetic: a player can drop a crossing without thinking about the
   * R key. Consecutive crossings resolve as one virtual straight wire, so an
   * overpass only needs one tile per crossed line.
   */
  private forwardThroughCrossing(crossing: Entity, moved: Set<string>): void {
    for (const [dx, dy] of AXIS_DELTAS) {
      const source = this.entityAt({ x: crossing.x - dx, y: crossing.y - dy });
      if (!source || source.item === null || moved.has(source.id)) continue;

      // Walk the stream's axis through any further crossings; the last one is
      // the emitter that hands off to real machinery.
      let emitter = crossing;
      let target = this.entityAt({ x: emitter.x + dx, y: emitter.y + dy });
      while (target && target.type === 'crossing') {
        emitter = target;
        target = this.entityAt({ x: emitter.x + dx, y: emitter.y + dy });
      }
      if (!target || !this.accepts(target, emitter, source.item)) continue;

      const carried = source.item;
      source.item = null;
      if (source.type === 'extractor') source.progress = 0;
      moved.add(source.id);
      this.deliver(carried, target, moved);
    }
  }

  /**
   * A splitter's pass-1: the same hand-off a belt makes, except the exit is
   * whichever of the two accepts — alternating when both do, falling back to
   * the open one when the other is stalled. The turn flips when the item LEAVES
   * (like the extractor's progress reset), so backpressure cannot shift the
   * split: a blocked exit skips its turn without spending it.
   */
  private advanceSplitter(entity: Entity, moved: Set<string>): void {
    if (entity.item === null || moved.has(entity.id)) return;

    const facing = rotationDelta(entity.rotation);
    const right = { x: -facing.y, y: facing.x };
    const exits = [
      this.entityAt({ x: entity.x + facing.x, y: entity.y + facing.y }),
      this.entityAt({ x: entity.x + right.x, y: entity.y + right.y }),
    ];
    const open = exits.map((exit) => !!exit && this.accepts(exit, entity));
    if (!open[0] && !open[1]) return; // stalled: keep the item, stay active

    const turn = this.splitterTurn.get(entity.id) ?? 0;
    const chosen = open[turn] ? turn : open[0] ? 0 : 1;
    const target = exits[chosen]!;

    const carried = entity.item;
    entity.item = null;
    moved.add(entity.id);
    this.splitterTurn.set(entity.id, (1 - chosen) as 0 | 1);
    this.deliver(carried, target, moved);
  }

  /**
   * One accepted delivery, shared by pass 1 and the crossing forward pass so
   * the two can never disagree about where an item lands.
   */
  private deliver(item: ResourceId, target: Entity, moved: Set<string>): void {
    if (target.type === 'depot') {
      this.sell(item);
      return;
    }
    if (isCrafter(target.type) || target.type === 'silo') {
      target.inputs[item] = (target.inputs[item] ?? 0) + 1;
      this.wakeAt(target.x, target.y);
      return;
    }
    target.item = item;
    moved.add(target.id);
    this.wakeAt(target.x, target.y);
  }

  /** The entity an item leaves this machine into, if any. */
  private downstreamOf(entity: Entity): Entity | null {
    const delta = rotationDelta(entity.rotation);
    return this.entityAt({ x: entity.x + delta.x, y: entity.y + delta.y });
  }

  /** True when `target` accepts the item `source` is holding on the shared side. */
  /** True when `target` accepts `offered` from `source` on the shared side. */
  private accepts(
    target: Entity,
    source: Entity,
    /** The crossing forward pass offers a stream its feeder holds, not its own. */
    offered: ResourceId | null = source.item,
  ): boolean {
    if (MACHINES[target.type].inputs === 0) return false;

    // Which sides take input is data (spec §5), so a belt only takes from
    // behind while a crafter takes from anywhere but its output side.
    if (!acceptsFrom(target.type, target.rotation, { x: source.x - target.x, y: source.y - target.y })) {
      return false;
    }

    // Only a crossing's own forward pass may hand a stream into a crossing:
    // pass 1 has already resolved its flows, and a normal hand-off would push a
    // third stream into a tile that keeps exactly two.
    if (target.type === 'crossing' && source.type !== 'crossing') return false;

    // A splitter is not a merge: its single input is the side opposite its two
    // exits, so a belt pushing into the facing (or side) face is refused and
    // its item stays parked. `acceptsFrom('behind')` already enforces this.
    if (target.type === 'splitter') return target.item === null;

    if (target.type === 'belt') return target.item === null;
    if (target.type === 'depot') return true;

    if (offered === null) return false;

    // A silo takes anything until it is full, which is what makes it absorb an
    // overflow instead of stalling the line behind it.
    if (target.type === 'silo') {
      return bufferedCount(target) < MACHINES.silo.bufferSize;
    }

    if (!isCrafter(target.type)) return true;

    // A crafter only takes what one of its recipes consumes, and only as much
    // as that recipe needs at once.
    const capacity = inputCapacityFor(target.type, offered);
    return capacity > 0 && (target.inputs[offered] ?? 0) < capacity;
  }

}
