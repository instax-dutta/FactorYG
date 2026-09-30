import type { SoundKey } from "../audio/assets";
import type { SoundPlaybackState, SoundTriggerCounts } from "../audio/sound";

export interface SceneRenderTelemetry {
  readonly entityIds: readonly string[];
  readonly activeEntityIds: readonly string[];
  readonly activeFrameKeys: readonly string[];
  readonly beltItemIds: readonly string[];
  readonly beltGlowCount: number;
  readonly beltItemEventCount: number;
  readonly blockedEntityIds: readonly string[];
  readonly heatEntityIds: readonly string[];
  readonly saleBurstCount: number;
  readonly liveBurstCount: number;
  readonly nodeSpriteCount: number;
  readonly nodeSpriteCells: readonly string[];
}

export interface SceneSoundTelemetry {
  readonly unlocked: boolean;
  readonly contextCreated: boolean;
  readonly bufferCount: number;
  readonly readyBufferCount: number;
  readonly decodeFailureCount: number;
  readonly triggeredCounts: Readonly<Record<SoundKey, number>>;
  readonly playedCounts: Readonly<Record<SoundKey, number>>;
  readonly suppressedCount: number;
  readonly unavailableCount: number;
  readonly loopStartCount: number;
  readonly loopStopCount: number;
  readonly activeLoopCount: number;
}

export interface SceneTelemetry {
  readonly ready: boolean;
  readonly camera: {
    readonly scrollX: number;
    readonly scrollY: number;
    readonly zoom: number;
    readonly boundsWidth: number;
    readonly boundsHeight: number;
  };
  readonly ghost: {
    readonly visible: boolean;
    readonly valid: boolean;
    readonly rotation: number;
  };
  readonly render: SceneRenderTelemetry;
  readonly sound: SceneSoundTelemetry;
}

export interface SceneTelemetryInput {
  ready: boolean;
  camera: {
    scrollX: number;
    scrollY: number;
    zoom: number;
    boundsWidth: number;
    boundsHeight: number;
  };
  ghost: {
    visible: boolean;
    valid: boolean;
    rotation: number;
  };
  render: SceneRenderTelemetry;
  sound: SceneSoundTelemetry;
}

export interface SceneRenderTelemetryCache {
  markDirty(): void;
  read(refresh: () => SceneRenderTelemetry): SceneRenderTelemetry;
}

export function createSceneRenderTelemetry(input: SceneRenderTelemetry): SceneRenderTelemetry {
  return Object.freeze({
    entityIds: Object.freeze([...input.entityIds]),
    activeEntityIds: Object.freeze([...input.activeEntityIds]),
    activeFrameKeys: Object.freeze([...input.activeFrameKeys]),
    beltItemIds: Object.freeze([...input.beltItemIds]),
    beltGlowCount: input.beltGlowCount,
    beltItemEventCount: input.beltItemEventCount,
    blockedEntityIds: Object.freeze([...input.blockedEntityIds]),
    heatEntityIds: Object.freeze([...input.heatEntityIds]),
    saleBurstCount: input.saleBurstCount,
    liveBurstCount: input.liveBurstCount,
    nodeSpriteCount: input.nodeSpriteCount,
    nodeSpriteCells: input.nodeSpriteCells,
  });
}

export function createRenderTelemetryCache(
  initial: SceneRenderTelemetry,
): SceneRenderTelemetryCache {
  let current = initial;
  let dirty = false;

  return {
    markDirty: (): void => {
      dirty = true;
    },
    read: (refresh: () => SceneRenderTelemetry): SceneRenderTelemetry => {
      if (dirty) {
        current = createSceneRenderTelemetry(refresh());
        dirty = false;
      }
      return current;
    },
  };
}

export function createSceneSoundTelemetry(
  triggerCounts: SoundTriggerCounts,
  playback: SoundPlaybackState,
): SceneSoundTelemetry {
  return Object.freeze({
    unlocked: playback.unlocked,
    contextCreated: playback.contextCreated,
    bufferCount: playback.bufferCount,
    readyBufferCount: playback.readyBufferCount,
    decodeFailureCount: playback.decodeFailureCount,
    triggeredCounts: Object.freeze({ ...triggerCounts.triggeredCounts }),
    playedCounts: Object.freeze({ ...playback.playedCounts }),
    suppressedCount: playback.suppressedCount,
    unavailableCount: playback.unavailableCount,
    loopStartCount: triggerCounts.loopStartCount,
    loopStopCount: triggerCounts.loopStopCount,
    activeLoopCount: playback.activeLoopCount,
  });
}

export function createSceneTelemetry(input: SceneTelemetryInput): SceneTelemetry {
  const camera = Object.freeze({ ...input.camera });
  const ghost = Object.freeze({ ...input.ghost });
  const render = Object.isFrozen(input.render)
    ? input.render
    : createSceneRenderTelemetry(input.render);
  return Object.freeze({
    ready: input.ready,
    camera,
    ghost,
    render,
    sound: input.sound,
  });
}

export const INITIAL_SCENE_TELEMETRY = createSceneTelemetry({
  ready: false,
  camera: { scrollX: 0, scrollY: 0, zoom: 1, boundsWidth: 0, boundsHeight: 0 },
  ghost: { visible: false, valid: false, rotation: 0 },
  render: createSceneRenderTelemetry({
    entityIds: [],
    activeEntityIds: [],
    activeFrameKeys: [],
    beltItemIds: [],
    beltGlowCount: 0,
    beltItemEventCount: 0,
    blockedEntityIds: [],
    heatEntityIds: [],
    saleBurstCount: 0,
    liveBurstCount: 0,
    nodeSpriteCount: 0,
    nodeSpriteCells: [],
  }),
  sound: createSceneSoundTelemetry(
    {
      triggeredCounts: {} as Readonly<Record<SoundKey, number>>,
      loopStartCount: 0,
      loopStopCount: 0,
      activeLoopCount: 0,
    },
    {
      unlocked: false,
      contextCreated: false,
      bufferCount: 0,
      readyBufferCount: 0,
      decodeFailureCount: 0,
      playedCounts: {} as Readonly<Record<SoundKey, number>>,
      suppressedCount: 0,
      unavailableCount: 0,
      activeLoopCount: 0,
    },
  ),
});
