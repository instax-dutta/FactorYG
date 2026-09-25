import { FixedStepClock } from "./clock";
import { TICK_MS } from "./constants";
import {
  canUnlock,
  canUpgrade,
  unlockMachine,
  unlockRecipe,
  upgradeEntity,
  type UnlockTarget,
} from "./commands";
import { applyPlacement, validatePlacement } from "./placement";
import { createSnapshot } from "./snapshot";
import { advanceSimulation } from "./tick";
import type {
  CommandResult,
  Entity,
  RenderEvent,
  ResourceId,
  SaveGame,
  SimulationCommand,
  SimulationSnapshot,
  SimulationState,
} from "./types";

type SnapshotListener = (snapshot: SimulationSnapshot) => void;
type RenderEventListener = (event: RenderEvent) => void;

type CommandApplication = {
  state: SimulationState;
  changed: boolean;
  result: CommandResult;
  events?: RenderEvent[];
};

type SimulationTick = (
  state: SimulationState,
  tickCount: number,
  events?: RenderEvent[],
) => SimulationState;


function defaultNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export class SimulationStore {
  #state: SimulationState;
  #snapshot: SimulationSnapshot;
  #listeners = new Set<SnapshotListener>();
  #eventListeners = new Set<RenderEventListener>();
  #clock: FixedStepClock;
  #advanceSimulation: SimulationTick;
  #timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    initialState: SimulationState,
    now: () => number = defaultNow,
    tickFunction: SimulationTick = advanceSimulation,
  ) {
    this.#state = structuredClone(initialState);
    this.#snapshot = createSnapshot(this.#state);
    this.#clock = new FixedStepClock(TICK_MS, () => this.advanceTicks(1), now);
    this.#advanceSimulation = tickFunction;
  }

  public getSnapshot(): SimulationSnapshot {
    return this.#snapshot;
  }

  public getSaveGame(): SaveGame {
    return structuredClone(this.#state);
  }

  public getActiveMachineIds(): readonly string[] {
    const active: string[] = [];
    for (const entity of this.#state.grid.entities) {
      if (this.#state.grid.machines[entity.id]?.active === true) {
        active.push(entity.id);
      }
    }
    return Object.freeze(active);
  }

  public getEntities(): readonly Entity[] {
    const entities = this.#state.grid.entities.map((entity) => Object.freeze({ ...entity }));
    return Object.freeze(entities);
  }

  public getBeltItems(): Readonly<Record<string, ResourceId>> {
    const items: Record<string, ResourceId> = {};
    for (const entity of this.#state.grid.entities) {
      if (entity.type !== "belt") {
        continue;
      }

      const item = this.#state.grid.belts[entity.id]?.item;
      if (item !== undefined) {
        Object.defineProperty(items, entity.id, {
          configurable: true,
          enumerable: true,
          value: item,
          writable: false,
        });
      }
    }
    return Object.freeze(items);
  }

  public subscribe(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  public subscribeEvents(listener: RenderEventListener): () => void {
    this.#eventListeners.add(listener);

    return () => {
      this.#eventListeners.delete(listener);
    };
  }

  public validatePlacement(
    command: Extract<SimulationCommand, { type: "placeEntity" }>,
  ): CommandResult {
    return validatePlacement(this.#state, command);
  }

  public canUnlock(target: UnlockTarget): CommandResult {
    return canUnlock(this.#state, target);
  }

  public canUpgrade(entityId: string): CommandResult {
    return canUpgrade(this.#state, entityId);
  }

  public dispatch(command: SimulationCommand): CommandResult {
    const application = this.#applyCommand(command);
    if (!application.changed) {
      return application.result;
    }

    this.#state = application.state;
    this.#snapshot = createSnapshot(this.#state);
    this.#publish();
    this.#publishEvents(application.events ?? []);
    return application.result;
  }

  public start(): void {
    if (this.#timer !== undefined) {
      return;
    }

    this.#clock.reset();
    this.#timer = setInterval(() => this.#clock.advance(), TICK_MS);
  }

  public stop(): void {
    if (this.#timer === undefined) {
      return;
    }

    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  public advanceTicks(count: number): void {
    if (!Number.isInteger(count) || count <= 0) {
      return;
    }

    const events: RenderEvent[] = [];
    const nextState = this.#advanceSimulation(this.#state, count, events);
    if (nextState === this.#state) {
      return;
    }

    this.#state = nextState;
    this.#snapshot = createSnapshot(nextState);
    this.#publish();
    this.#publishEvents(events);
  }

  #applyCommand(command: SimulationCommand): CommandApplication {
    switch (command.type) {
      case "placeEntity": {
        const application = applyPlacement(this.#state, command);
        if (!application.changed || application.entity === undefined) {
          return application;
        }

        return {
          ...application,
          events: [{ type: "entityPlaced", entity: freezeEntity(application.entity) }],
        };
      }
      case "setPlacementMode": {
        if (this.#state.placementMode === command.machine) {
          return { state: this.#state, changed: false, result: { ok: true } };
        }

        return {
          state: { ...this.#state, placementMode: command.machine },
          changed: true,
          result: { ok: true },
        };
      }
      case "demolishEntity": {
        const entity = this.#state.grid.entities.find((candidate) => candidate.id === command.entityId);
        if (entity === undefined) {
          return { state: this.#state, changed: false, result: { ok: false, reason: "entityNotFound" } };
        }

        const machines = { ...this.#state.grid.machines };
        const belts = { ...this.#state.grid.belts };
        delete machines[entity.id];
        delete belts[entity.id];
        const selectedEntityId =
          this.#state.selectedEntityId === entity.id ? undefined : this.#state.selectedEntityId;

        return {
          state: {
            ...this.#state,
            selectedEntityId,
            grid: {
              ...this.#state.grid,
              entities: this.#state.grid.entities.filter((candidate) => candidate.id !== entity.id),
              machines,
              belts,
            },
          },
          changed: true,
          result: { ok: true },
          events: [{ type: "entityRemoved", entityId: entity.id }],
        };
      }
      case "rotatePlacement": {
        const rotation = this.#state.pendingRotation;
        const nextRotation = rotation === 270 ? 0 : ((rotation + 90) as 0 | 90 | 180 | 270);

        return {
          state: { ...this.#state, pendingRotation: nextRotation },
          changed: true,
          result: { ok: true },
        };
      }
      case "selectEntity": {
        if (this.#state.selectedEntityId === command.entityId) {
          return { state: this.#state, changed: false, result: { ok: true } };
        }

        return {
          state: { ...this.#state, selectedEntityId: command.entityId },
          changed: true,
          result: { ok: true },
        };
      }
      case "dismissOfflineSummary": {
        if (this.#state.offlineSummary === undefined) {
          return { state: this.#state, changed: false, result: { ok: true } };
        }

        return {
          state: { ...this.#state, offlineSummary: undefined },
          changed: true,
          result: { ok: true },
        };
      }
      case "dismissNotification": {
        const notifications = this.#state.notifications.filter(
          (notification) => notification.id !== command.id,
        );
        if (notifications.length === this.#state.notifications.length) {
          return { state: this.#state, changed: false, result: { ok: true } };
        }

        return {
          state: { ...this.#state, notifications },
          changed: true,
          result: { ok: true },
        };
      }
      case "unlockMachine": {
        return unlockMachine(this.#state, command);
      }
      case "unlockRecipe": {
        return unlockRecipe(this.#state, command);
      }
      case "upgradeEntity": {
        return upgradeEntity(this.#state, command.entityId);
      }
      default:
        return {
          state: this.#state,
          changed: false,
          result: { ok: false, reason: "notImplemented" },
        };
    }
  }

  #publish(): void {
    for (const listener of this.#listeners) {
      listener(this.#snapshot);
    }
  }

  #publishEvents(events: readonly RenderEvent[]): void {
    for (const event of events) {
      for (const listener of this.#eventListeners) {
        listener(event);
      }
    }
  }
}

function freezeEntity(entity: SimulationState["grid"]["entities"][number]): SimulationState["grid"]["entities"][number] {
  return Object.freeze({ ...entity });
}
