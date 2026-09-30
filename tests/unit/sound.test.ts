import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { createMachineRuntime } from "../../src/sim/machines";
import { SimulationStore } from "../../src/sim/store";
import { advanceSimulation } from "../../src/sim/tick";
import type {
  Entity,
  MachineType,
  RenderEvent,
  ResourceId,
  SimulationSnapshot,
  SimulationState,
} from "../../src/sim/types";
import { SOUND_KEYS, type SoundKey } from "../../src/audio/assets";
import {
  createNoOpSoundPlayer,
  createSoundDirector,
  type SoundPlayer,
} from "../../src/audio/sound";
import {
  createBrowserSoundPlayer,
  type AudioGraphPort,
  type AudioGraphSource,
  type AudioGraphGain,
} from "../../src/audio/browserPlayer";

const COPPER_NODE: ResourceId = "copperOre";
const DEAD_END_EXTRACTOR_LEVEL = 20;
const DEAD_END_BELT_COUNT = 3;
const BLOCKED_RUN_TICKS = 400;
const BLOCKED_REFUSAL_LIMIT = 2;

interface RecordedCalls {
  oneShots: SoundKey[];
  loopStarts: Array<{ key: SoundKey; ownerId: string }>;
  loopStops: Array<{ key: SoundKey; ownerId: string }>;
  unlocks: number;
  disposals: number;
}

interface RecordingPlayer extends SoundPlayer {
  readonly calls: RecordedCalls;
}

function emptyCounts(): Record<SoundKey, number> {
  const counts = {} as Record<SoundKey, number>;
  for (const key of SOUND_KEYS) {
    counts[key] = 0;
  }
  return counts;
}

function createRecordingPlayer(): RecordingPlayer {
  const calls: RecordedCalls = {
    oneShots: [],
    loopStarts: [],
    loopStops: [],
    unlocks: 0,
    disposals: 0,
  };

  return {
    calls,
    unlock: () => {
      calls.unlocks += 1;
    },
    playOneShot: (key) => {
      calls.oneShots.push(key);
    },
    startLoop: (key, ownerId) => {
      calls.loopStarts.push({ key, ownerId });
    },
    stopLoop: (key, ownerId) => {
      calls.loopStops.push({ key, ownerId });
    },
    getState: () => ({
      unlocked: true,
      contextCreated: false,
      bufferCount: SOUND_KEYS.length,
      readyBufferCount: SOUND_KEYS.length,
      decodeFailureCount: 0,
      playedCounts: emptyCounts(),
      suppressedCount: 0,
      unavailableCount: 0,
      activeLoopCount: 0,
    }),
    dispose: () => {
      calls.disposals += 1;
    },
  };
}

function countKey(calls: readonly SoundKey[], key: SoundKey): number {
  return calls.filter((entry) => entry === key).length;
}

function saleEvent(entityId = "depot-1"): RenderEvent {
  return {
    type: "saleCompleted",
    entityId,
    resource: "copperIngot",
    currency: 1,
    worldX: 32,
    worldY: 32,
  };
}

describe("sound director", () => {
  it("turns one sale event into exactly one sale call", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    director.handleEvent(saleEvent());

    expect(player.calls.oneShots).toEqual(["sale"]);
    expect(director.getTriggerCounts().triggeredCounts.sale).toBe(1);
  });

  it("starts one machine loop for a machine that reports active on every tick", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    for (let tick = 0; tick < 200; tick += 1) {
      director.handleEvent({ type: "machineStateChanged", entityId: "extractor-1", active: true });
    }

    expect(player.calls.loopStarts).toEqual([{ key: "machine", ownerId: "extractor-1" }]);
    expect(director.getTriggerCounts().loopStartCount).toBe(1);
    expect(director.getTriggerCounts().triggeredCounts.machine).toBe(1);
    expect(director.getTriggerCounts().activeLoopCount).toBe(1);
  });

  it("stops the loop once on the transition to idle and restarts it on the next activation", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-1", active: true });
    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-1", active: false });
    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-1", active: false });
    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-1", active: true });

    expect(player.calls.loopStops).toEqual([{ key: "machine", ownerId: "extractor-1" }]);
    expect(director.getTriggerCounts().loopStartCount).toBe(2);
    expect(director.getTriggerCounts().triggeredCounts.machine).toBe(2);
    expect(director.getTriggerCounts().loopStopCount).toBe(1);
    expect(director.getTriggerCounts().activeLoopCount).toBe(1);
  });

  it("tracks a loop per machine rather than one loop for the whole factory", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-1", active: true });
    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-2", active: true });
    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-1", active: false });

    expect(director.getTriggerCounts().activeLoopCount).toBe(1);
    expect(player.calls.loopStarts).toHaveLength(2);
    expect(player.calls.loopStops).toEqual([{ key: "machine", ownerId: "extractor-1" }]);
  });

  it("stops a removed machine's loop and ignores a machine that was never running", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-1", active: true });
    director.handleEvent({ type: "entityRemoved", entityId: "extractor-1" });
    director.handleEvent({ type: "entityRemoved", entityId: "extractor-2" });

    expect(player.calls.loopStops).toEqual([{ key: "machine", ownerId: "extractor-1" }]);
    expect(director.getTriggerCounts().activeLoopCount).toBe(0);
  });

  it("stops every running loop when the director is disposed", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-1", active: true });
    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-2", active: true });
    director.dispose();

    expect(player.calls.loopStops).toEqual([
      { key: "machine", ownerId: "extractor-1" },
      { key: "machine", ownerId: "extractor-2" },
    ]);
    expect(player.calls.disposals).toBe(1);
    expect(director.getTriggerCounts().activeLoopCount).toBe(0);
  });

  it("clicks once for a belt cell that gained an item and stays silent for one that emptied", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    director.handleEvent({ type: "beltItemChanged", entityId: "belt-1", item: "copperIngot" });
    director.handleEvent({ type: "beltItemChanged", entityId: "belt-1", item: undefined });

    expect(player.calls.oneShots).toEqual(["belt"]);
    expect(director.getTriggerCounts().triggeredCounts.belt).toBe(1);
  });

  it("makes no sound for a placement or a full storage notice", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    director.handleEvent({ type: "entityPlaced", entity: extractorAt(1, 1) });
    director.handleEvent({
      type: "storageFull",
      entityId: "silo-1",
      resource: "copperIngot",
      worldX: 32,
      worldY: 32,
    });

    expect(player.calls.oneShots).toEqual([]);
    expect(director.getTriggerCounts().triggeredCounts).toEqual(emptyCounts());
  });

  it("stays silent for the first snapshot it sees, so a loaded run does not chime for its own unlocks", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    director.handleSnapshot(snapshotWith({ machines: ["extractor", "belt", "depot", "silo"] }));

    expect(player.calls.oneShots).toEqual([]);
    expect(director.getTriggerCounts().triggeredCounts.unlock).toBe(0);
  });

  it("sounds one unlock per purchase and never repeats it when the snapshot is republished", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    director.handleSnapshot(snapshotWith({ machines: ["extractor", "belt", "depot"] }));
    expect(player.calls.oneShots).toEqual([]);

    director.handleSnapshot(snapshotWith({ machines: ["extractor", "belt", "depot", "silo"] }));
    for (let tick = 0; tick < 50; tick += 1) {
      director.handleSnapshot(snapshotWith({ machines: ["extractor", "belt", "depot", "silo"] }));
    }

    expect(countKey(player.calls.oneShots, "unlock")).toBe(1);
  });

  it("sounds one unlock per newly owned id when a snapshot publishes several at once", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });

    director.handleSnapshot(snapshotWith({ machines: ["extractor"] }));
    director.handleSnapshot(
      snapshotWith({ machines: ["extractor", "silo", "depot"], recipes: ["copperIngot"] }),
    );

    expect(countKey(player.calls.oneShots, "unlock")).toBe(3);
  });

  it("sounds nothing for a rejected unlock and one for an accepted one, on a real store", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });
    const store = new SimulationStore(createInitialState(4410));
    director.handleSnapshot(store.getSnapshot());
    const unsubscribe = store.subscribe((snapshot) => director.handleSnapshot(snapshot));

    const refused = store.dispatch({ type: "unlockRecipe", recipeId: "motor" });
    expect(refused.ok).toBe(false);
    expect(player.calls.oneShots).toEqual([]);

    const accepted = store.dispatch({ type: "unlockMachine", machine: "silo" });
    expect(accepted.ok).toBe(true);

    unsubscribe();
    expect(player.calls.oneShots).toEqual(["unlock"]);
  });

  it("makes one sound for a whole long blocked run and none for the ticks that follow", () => {
    const player = createRecordingPlayer();
    const director = createSoundDirector({ player });
    const world = createDeadEndLine();
    const events: RenderEvent[] = [];

    const next = advanceSimulation(world.state, BLOCKED_RUN_TICKS, events);
    expect(next.grid.machines[world.extractor.id]?.alreadyNotifiedBlocked).toBe(true);
    expect(next.grid.machines[world.extractor.id]?.blockedRefusalTicks).toBe(
      BLOCKED_REFUSAL_LIMIT,
    );
    for (const event of events) {
      director.handleEvent(event);
    }

    expect(events.filter((event) => event.type === "blockedFull")).toHaveLength(1);
    expect(countKey(player.calls.oneShots, "blocked")).toBe(1);
    expect(director.getTriggerCounts().triggeredCounts.blocked).toBe(1);
  });

  it("absorbs every event through the no-op player without making an audio call", () => {
    const player = createNoOpSoundPlayer();
    const director = createSoundDirector({ player });
    const events: RenderEvent[] = [];

    advanceSimulation(createDeadEndLine().state, 60, events);
    director.handleSnapshot(snapshotWith({ machines: ["extractor", "silo"] }));
    for (const event of events) {
      director.handleEvent(event);
    }
    director.handleEvent({ type: "machineStateChanged", entityId: "extractor-1", active: true });
    director.handleEvent(saleEvent());

    const state = player.getState();
    expect(state.playedCounts).toEqual(emptyCounts());
    expect(state.suppressedCount).toBe(0);
    expect(state.unavailableCount).toBe(0);
    expect(state.contextCreated).toBe(false);
    expect(director.getTriggerCounts().triggeredCounts.sale).toBe(1);
  });
});

interface FakeSource extends AudioGraphSource {
  readonly connected: object[];
  started: number;
  stopped: number;
}

interface FakeGain extends AudioGraphGain {
  readonly connected: object[];
}

class FakeAudioContext implements AudioGraphPort {
  public state = "suspended";
  public resumeCalls = 0;
  public resumeRejection: Error | undefined;
  public decodeRejection: Error | undefined;
  public readonly sources: FakeSource[] = [];
  public readonly gains: FakeGain[] = [];
  public readonly destination = { name: "destination" };

  public resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.resumeRejection !== undefined) {
      return Promise.reject(this.resumeRejection);
    }
    this.state = "running";
    return Promise.resolve();
  }

  public createBufferSource(): FakeSource {
    const connected: object[] = [];
    const source: FakeSource = {
      buffer: null,
      loop: false,
      connected,
      started: 0,
      stopped: 0,
      connect: (target: object): void => {
        connected.push(target);
      },
      start: (): void => {
        source.started += 1;
      },
      stop: (): void => {
        source.stopped += 1;
      },
    };
    this.sources.push(source);
    return source;
  }

  public createGain(): FakeGain {
    const connected: object[] = [];
    const gain: FakeGain = {
      gain: { value: 1 },
      connected,
      connect: (target: object): void => {
        connected.push(target);
      },
    };
    this.gains.push(gain);
    return gain;
  }

  public decodeAudioData(): Promise<object> {
    if (this.decodeRejection !== undefined) {
      return Promise.reject(this.decodeRejection);
    }
    return Promise.resolve({ sampleRate: 22050, length: 1 });
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolveWork) => {
    setTimeout(resolveWork, 0);
  });
}

function createBrowserPlayerUnderTest(
  context: FakeAudioContext,
  loadBytes: () => Promise<ArrayBuffer> = () => Promise.resolve(new ArrayBuffer(64)),
): SoundPlayer {
  return createBrowserSoundPlayer({ createContext: () => context, loadBytes });
}

describe("browser sound player", () => {
  it("creates no context and makes no call before a gesture unlocks it", () => {
    const context = new FakeAudioContext();
    const requestedUrls: string[] = [];
    const player = createBrowserSoundPlayer({
      createContext: () => context,
      loadBytes: (url) => {
        requestedUrls.push(url);
        return Promise.resolve(new ArrayBuffer(64));
      },
    });

    player.playOneShot("sale");
    player.startLoop("machine", "extractor-1");

    const state = player.getState();
    expect(state.unlocked).toBe(false);
    expect(state.contextCreated).toBe(false);
    expect(state.playedCounts).toEqual(emptyCounts());
    expect(state.suppressedCount).toBe(2);
    expect(requestedUrls).toEqual([]);
    expect(context.sources).toEqual([]);
  });

  it("loads every shipped file once unlocked and plays one source per one-shot call", async () => {
    const context = new FakeAudioContext();
    const requestedUrls: string[] = [];
    const player = createBrowserSoundPlayer({
      createContext: () => context,
      loadBytes: (url) => {
        requestedUrls.push(url);
        return Promise.resolve(new ArrayBuffer(64));
      },
    });

    player.unlock();
    player.unlock();
    await flushAsyncWork();

    const state = player.getState();
    expect(state.unlocked).toBe(true);
    expect(state.contextCreated).toBe(true);
    expect(state.bufferCount).toBe(SOUND_KEYS.length);
    expect(state.readyBufferCount).toBe(SOUND_KEYS.length);
    expect(state.decodeFailureCount).toBe(0);
    expect(requestedUrls).toHaveLength(SOUND_KEYS.length);

    player.playOneShot("sale");
    player.playOneShot("sale");
    player.playOneShot("blocked");

    expect(context.sources.filter((source) => source.started === 1)).toHaveLength(3);
    expect(player.getState().playedCounts.sale).toBe(2);
    expect(player.getState().playedCounts.blocked).toBe(1);
  });

  it("does not throw and still plays when the context stays suspended and refuses to resume", async () => {
    const context = new FakeAudioContext();
    context.resumeRejection = new Error("autoplay blocked");
    const player = createBrowserPlayerUnderTest(context);

    expect(() => {
      player.unlock();
    }).not.toThrow();
    await flushAsyncWork();

    expect(context.resumeCalls).toBe(1);
    expect(context.state).toBe("suspended");
    expect(player.getState().readyBufferCount).toBe(SOUND_KEYS.length);

    expect(() => {
      player.playOneShot("unlock");
    }).not.toThrow();
    expect(player.getState().playedCounts.unlock).toBe(1);
  });

  it("counts a decode failure, stays silent for that key, and reports it instead of throwing", async () => {
    const context = new FakeAudioContext();
    context.decodeRejection = new Error("not a wave file");
    const player = createBrowserPlayerUnderTest(context);

    player.unlock();
    await flushAsyncWork();

    const state = player.getState();
    expect(state.decodeFailureCount).toBe(SOUND_KEYS.length);
    expect(state.readyBufferCount).toBe(0);

    expect(() => {
      player.playOneShot("sale");
    }).not.toThrow();
    expect(player.getState().unavailableCount).toBe(1);
    expect(player.getState().playedCounts.sale).toBe(0);
  });

  it("counts a play it cannot yet make as unavailable and plays it once the buffer lands", async () => {
    const context = new FakeAudioContext();
    const releases: Array<() => void> = [];
    const player = createBrowserSoundPlayer({
      createContext: () => context,
      loadBytes: () =>
        new Promise<ArrayBuffer>((resolveLoad) => {
          releases.push(() => resolveLoad(new ArrayBuffer(64)));
        }),
    });

    player.unlock();
    player.playOneShot("sale");
    expect(player.getState().unavailableCount).toBe(1);
    expect(player.getState().playedCounts.sale).toBe(0);

    for (const release of releases) {
      release();
    }
    await flushAsyncWork();

    player.playOneShot("sale");
    expect(player.getState().unavailableCount).toBe(1);
    expect(player.getState().playedCounts.sale).toBe(1);
  });

  it("runs one shared looping source per key and stops it when the last owner leaves", async () => {
    const context = new FakeAudioContext();
    const player = createBrowserPlayerUnderTest(context);

    player.unlock();
    await flushAsyncWork();

    player.startLoop("machine", "extractor-1");
    player.startLoop("machine", "extractor-2");
    player.startLoop("machine", "extractor-1");

    const looping = context.sources.filter((source) => source.loop);
    expect(looping).toHaveLength(1);
    expect(looping[0]?.started).toBe(1);
    expect(context.gains).toHaveLength(2);
    expect(player.getState().activeLoopCount).toBe(2);

    player.stopLoop("machine", "extractor-1");
    expect(looping[0]?.stopped).toBe(0);
    expect(player.getState().activeLoopCount).toBe(1);

    player.stopLoop("machine", "extractor-2");
    expect(looping[0]?.stopped).toBe(1);
    expect(player.getState().activeLoopCount).toBe(0);

    player.stopLoop("machine", "extractor-3");
    expect(context.sources.filter((source) => source.loop)).toHaveLength(1);
  });

  it("stops every loop when the player is disposed", async () => {
    const context = new FakeAudioContext();
    const player = createBrowserPlayerUnderTest(context);

    player.unlock();
    await flushAsyncWork();
    player.startLoop("machine", "extractor-1");
    player.dispose();

    expect(context.sources.filter((source) => source.stopped === 1)).toHaveLength(1);
    expect(player.getState().activeLoopCount).toBe(0);
  });

  it("survives a browser with no Web Audio at all by making no call", () => {
    const player = createBrowserSoundPlayer({
      createContext: () => {
        throw new Error("AudioContext is not defined");
      },
      loadBytes: () => Promise.resolve(new ArrayBuffer(64)),
    });

    expect(() => {
      player.unlock();
      player.playOneShot("sale");
    }).not.toThrow();

    const state = player.getState();
    expect(state.unlocked).toBe(true);
    expect(state.contextCreated).toBe(false);
    expect(state.suppressedCount).toBe(1);
    expect(state.playedCounts).toEqual(emptyCounts());
  });
});

const SOURCE_ROOT = resolve(process.cwd(), "src");
const AUDIO_PREFIX = `audio${sep}`;
const SIM_PREFIX = `sim${sep}`;
const PHASER_PREFIX = `phaser${sep}`;
const STATEMENT_PATTERN = /^\s*(?:import|export)\s+((?:[^;"']|\n)*?)\s*from\s*["']([^"']+)["']/;

interface SourceFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly source: string;
}

interface SourceStatement {
  readonly file: SourceFile;
  readonly statement: string;
  readonly clause: string;
  readonly specifier: string;
  readonly target: string | undefined;
  readonly typeOnly: boolean;
}

function listSourceFiles(directory: string = SOURCE_ROOT): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(directory)) {
    const absolutePath = resolve(directory, entry);
    if (statSync(absolutePath).isDirectory()) {
      files.push(...listSourceFiles(absolutePath));
      continue;
    }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) {
      continue;
    }
    files.push({
      absolutePath,
      relativePath: relative(SOURCE_ROOT, absolutePath),
      source: readFileSync(absolutePath, "utf8"),
    });
  }
  return files;
}

function resolveRelativeImport(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function clauseIsTypeOnly(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type ")) {
    return true;
  }
  const opening = trimmed.indexOf("{");
  const closing = trimmed.lastIndexOf("}");
  if (opening === -1 || closing < opening) {
    return false;
  }
  if (trimmed.slice(0, opening).replace(/[,\s]/g, "") !== "") {
    return false;
  }
  const names = trimmed
    .slice(opening + 1, closing)
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.length > 0 && names.every((name) => name.startsWith("type "));
}

function splitModuleStatements(source: string): string[] {
  const statements: string[] = [];
  let pending: string[] | undefined;

  for (const line of source.split("\n")) {
    if (pending === undefined) {
      if (/^\s*(?:import|export)\b/.test(line)) {
        pending = [line];
      }
      continue;
    }
    pending.push(line);
    if (/\bfrom\s*["']/.test(line) || /^\s*import\s*["']/.test(line)) {
      statements.push(pending.join("\n"));
      pending = undefined;
    }
  }

  if (pending !== undefined) {
    statements.push(pending.join("\n"));
  }
  return statements;
}

function collectStatements(files: readonly SourceFile[]): SourceStatement[] {
  const statements: SourceStatement[] = [];
  for (const file of files) {
    for (const statement of splitModuleStatements(file.source)) {
      const match = STATEMENT_PATTERN.exec(statement);
      if (match === null) {
        continue;
      }
      const clause = match[1] ?? "";
      const specifier = match[2] ?? "";
      if (!specifier.startsWith(".")) {
        continue;
      }
      statements.push({
        file,
        statement,
        clause,
        specifier,
        target: resolveRelativeImport(file.absolutePath, specifier),
        typeOnly: clauseIsTypeOnly(clause),
      });
    }
  }
  return statements;
}

function runtimeClosure(entry: string, statements: readonly SourceStatement[]): Set<string> {
  const reached = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || reached.has(current)) {
      continue;
    }
    reached.add(current);
    for (const candidate of statements) {
      if (!candidate.typeOnly && candidate.file.absolutePath === current && candidate.target !== undefined) {
        pending.push(candidate.target);
      }
    }
  }

  return reached;
}

describe("sound stays out of the simulation dependency graph", () => {
  const files = listSourceFiles();
  const statements = collectStatements(files);
  const audioPaths = new Set(
    files
      .filter((file) => file.relativePath.startsWith(AUDIO_PREFIX))
      .map((file) => file.absolutePath),
  );
  const valueStatements = statements.filter(
    (statement) => !statement.typeOnly && statement.target !== undefined,
  );

  it("finds the audio layer and reads a module graph with real value edges in it", () => {
    expect(audioPaths.size).toBeGreaterThan(0);
    expect(valueStatements.length).toBeGreaterThan(10);
  });

  it("keeps every simulation module free of any runtime path into the audio layer", () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (!file.relativePath.startsWith(SIM_PREFIX)) {
        continue;
      }
      for (const reached of runtimeClosure(file.absolutePath, valueStatements)) {
        if (audioPaths.has(reached)) {
          offenders.push(`${file.relativePath} -> ${relative(SOURCE_ROOT, reached)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("makes the audio layer reachable only from the render seam", () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (file.relativePath.startsWith(AUDIO_PREFIX)) {
        continue;
      }
      const reachesAudio = [...runtimeClosure(file.absolutePath, valueStatements)].some((path) =>
        audioPaths.has(path),
      );
      if (reachesAudio && !file.relativePath.startsWith(PHASER_PREFIX)) {
        offenders.push(file.relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("reads the simulation from the audio layer as types only", () => {
    const offenders = statements
      .filter((statement) => !statement.typeOnly)
      .filter((statement) => statement.file.relativePath.startsWith(AUDIO_PREFIX))
      .filter((statement) => statement.target?.startsWith(resolve(SOURCE_ROOT, "sim")) === true)
      .map((statement) => `${statement.file.relativePath}: ${statement.specifier}`);

    expect(offenders).toEqual([]);
  });

  it("takes the audio layer into the app only through the scene that already owned render events", () => {
    const scene = readFileSync(resolve(SOURCE_ROOT, "phaser", "FactoryScene.ts"), "utf8");

    expect(scene).toMatch(/from "\.\.\/audio\/sound"/);
    expect(scene).toMatch(/from "\.\.\/audio\/browserPlayer"/);
  });
});

function snapshotWith(unlocked: {
  readonly machines?: readonly MachineType[];
  readonly recipes?: readonly string[];
}): SimulationSnapshot {
  const state = createInitialState(7_777);
  state.unlocked.machines = [...(unlocked.machines ?? ["extractor", "belt", "depot"])];
  state.unlocked.recipes = [...(unlocked.recipes ?? [])];
  return new SimulationStore(state).getSnapshot();
}

function extractorAt(x: number, y: number): Entity {
  return {
    id: "extractor-placed",
    type: "extractor",
    x,
    y,
    rotation: 0,
    level: 1,
    resourceNode: COPPER_NODE,
  };
}

interface DeadEndLine {
  readonly state: SimulationState;
  readonly extractor: Entity;
}

function createDeadEndLine(): DeadEndLine {
  const extractor: Entity = {
    id: "extractor-dead-end-sound",
    type: "extractor",
    x: 4,
    y: 4,
    rotation: 0,
    level: DEAD_END_EXTRACTOR_LEVEL,
    resourceNode: COPPER_NODE,
  };
  const belts: Entity[] = Array.from({ length: DEAD_END_BELT_COUNT }, (_unused, index) => ({
    id: `belt-dead-end-sound-${index + 1}`,
    type: "belt",
    x: extractor.x + index + 1,
    y: extractor.y,
    rotation: 0,
    level: 1,
  }));

  const state = createInitialState(5511);
  state.grid.nodes = [
    { id: "node-copper-sound", resource: COPPER_NODE, x: 9, y: 9 },
  ];
  state.grid.entities = [extractor, ...belts];
  state.grid.machines = { [extractor.id]: createMachineRuntime(extractor) };
  state.grid.belts = {};
  for (const belt of belts) {
    state.grid.belts[belt.id] = { entityId: belt.id, progress: 0.5 };
  }
  state.unlocked.recipes = [];

  return { state, extractor };
}
