import { SOUND_KEYS, type SoundKey } from "./assets";
import type { RenderEvent, SimulationSnapshot } from "../sim/types";

export interface SoundPlaybackState {
  readonly unlocked: boolean;
  readonly contextCreated: boolean;
  readonly bufferCount: number;
  readonly readyBufferCount: number;
  readonly decodeFailureCount: number;
  readonly playedCounts: Readonly<Record<SoundKey, number>>;
  readonly suppressedCount: number;
  readonly unavailableCount: number;
  readonly activeLoopCount: number;
}

export interface SoundTriggerCounts {
  readonly triggeredCounts: Readonly<Record<SoundKey, number>>;
  readonly loopStartCount: number;
  readonly loopStopCount: number;
  readonly activeLoopCount: number;
}

export interface SoundPlayer {
  unlock(): void;
  playOneShot(key: SoundKey): void;
  startLoop(key: SoundKey, ownerId: string): void;
  stopLoop(key: SoundKey, ownerId: string): void;
  getState(): SoundPlaybackState;
  dispose(): void;
}

export interface SoundDirector {
  handleEvent(event: RenderEvent): void;
  handleSnapshot(snapshot: SimulationSnapshot): void;
  getTriggerCounts(): SoundTriggerCounts;
  dispose(): void;
}

export interface SoundDirectorOptions {
  readonly player: SoundPlayer;
}

const LOOP_KEY: SoundKey = "machine";

export function createSoundDirector(options: SoundDirectorOptions): SoundDirector {
  const loopingOwners = new Set<string>();
  const unlockedMachines = new Set<string>();
  const unlockedRecipes = new Set<string>();
  const triggeredCounts = createCountRecord();
  let loopStartCount = 0;
  let loopStopCount = 0;
  let seeded = false;
  let disposed = false;

  const trigger = (key: SoundKey): void => {
    triggeredCounts[key] += 1;
    options.player.playOneShot(key);
  };

  const startLoop = (entityId: string): void => {
    if (loopingOwners.has(entityId)) {
      return;
    }
    loopingOwners.add(entityId);
    triggeredCounts[LOOP_KEY] += 1;
    loopStartCount += 1;
    options.player.startLoop(LOOP_KEY, entityId);
  };

  const stopLoop = (entityId: string): void => {
    if (!loopingOwners.delete(entityId)) {
      return;
    }
    loopStopCount += 1;
    options.player.stopLoop(LOOP_KEY, entityId);
  };

  const adopt = (snapshot: SimulationSnapshot): void => {
    unlockedMachines.clear();
    for (const machine of snapshot.unlockedMachines) {
      unlockedMachines.add(machine);
    }
    unlockedRecipes.clear();
    for (const recipe of snapshot.unlockedRecipes) {
      unlockedRecipes.add(recipe);
    }
  };

  return {
    handleEvent: (event: RenderEvent): void => {
      switch (event.type) {
        case "entityPlaced":
          return;
        case "entityRemoved":
          stopLoop(event.entityId);
          return;
        case "machineStateChanged":
          if (event.active) {
            startLoop(event.entityId);
          } else {
            stopLoop(event.entityId);
          }
          return;
        case "beltItemChanged":
          if (event.item !== undefined) {
            trigger("belt");
          }
          return;
        case "storageFull":
          return;
        case "blockedFull":
          trigger("blocked");
          return;
        case "saleCompleted":
          trigger("sale");
          return;
        default:
          throw new Error(`Unhandled render event for sound: ${JSON.stringify(event)}`);
      }
    },
    handleSnapshot: (snapshot: SimulationSnapshot): void => {
      if (!seeded) {
        seeded = true;
        adopt(snapshot);
        return;
      }

      const purchased =
        countNewIds(snapshot.unlockedMachines, unlockedMachines) +
        countNewIds(snapshot.unlockedRecipes, unlockedRecipes);
      adopt(snapshot);
      for (let purchase = 0; purchase < purchased; purchase += 1) {
        trigger("unlock");
      }
    },
    getTriggerCounts: (): SoundTriggerCounts => ({
      triggeredCounts: { ...triggeredCounts },
      loopStartCount,
      loopStopCount,
      activeLoopCount: loopingOwners.size,
    }),
    dispose: (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const entityId of [...loopingOwners]) {
        stopLoop(entityId);
      }
      options.player.dispose();
    },
  };
}

export function createNoOpSoundPlayer(): SoundPlayer {
  return {
    unlock: (): void => undefined,
    playOneShot: (): void => undefined,
    startLoop: (): void => undefined,
    stopLoop: (): void => undefined,
    getState: (): SoundPlaybackState => ({
      unlocked: true,
      contextCreated: false,
      bufferCount: SOUND_KEYS.length,
      readyBufferCount: SOUND_KEYS.length,
      decodeFailureCount: 0,
      playedCounts: createCountRecord(),
      suppressedCount: 0,
      unavailableCount: 0,
      activeLoopCount: 0,
    }),
    dispose: (): void => undefined,
  };
}

function createCountRecord(): Record<SoundKey, number> {
  const counts = {} as Record<SoundKey, number>;
  for (const key of SOUND_KEYS) {
    counts[key] = 0;
  }
  return counts;
}

function countNewIds(ids: readonly string[], known: ReadonlySet<string>): number {
  let added = 0;
  for (const id of ids) {
    if (!known.has(id)) {
      added += 1;
    }
  }
  return added;
}
