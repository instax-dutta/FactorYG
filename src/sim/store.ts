import { FixedStepClock } from "./clock";
import { TICK_MS } from "./constants";
import { createSnapshot } from "./snapshot";
import { advanceSimulation } from "./tick";
import type {
  CommandResult,
  SimulationCommand,
  SimulationSnapshot,
  SimulationState,
} from "./types";

type SnapshotListener = (snapshot: SimulationSnapshot) => void;

type CommandApplication = {
  state: SimulationState;
  changed: boolean;
  result: CommandResult;
};

function defaultNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export class SimulationStore {
  #state: SimulationState;
  #snapshot: SimulationSnapshot;
  #listeners = new Set<SnapshotListener>();
  #clock: FixedStepClock;
  #timer: ReturnType<typeof setInterval> | undefined;

  public constructor(initialState: SimulationState, now: () => number = defaultNow) {
    this.#state = structuredClone(initialState);
    this.#snapshot = createSnapshot(this.#state);
    this.#clock = new FixedStepClock(TICK_MS, () => this.advanceTicks(1), now);
  }

  public getSnapshot(): SimulationSnapshot {
    return this.#snapshot;
  }

  public subscribe(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  public dispatch(command: SimulationCommand): CommandResult {
    const application = this.#applyCommand(command);
    if (!application.changed) {
      return application.result;
    }

    this.#state = application.state;
    this.#snapshot = createSnapshot(this.#state);
    this.#publish();
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

    const nextState = advanceSimulation(this.#state, count);
    if (nextState === this.#state) {
      return;
    }

    this.#state = nextState;
    this.#snapshot = createSnapshot(this.#state);
    this.#publish();
  }

  #applyCommand(command: SimulationCommand): CommandApplication {
    switch (command.type) {
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
}
