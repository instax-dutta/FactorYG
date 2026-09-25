export interface SceneRenderTelemetry {
  readonly entityIds: readonly string[];
  readonly activeEntityIds: readonly string[];
  readonly activeFrameKeys: readonly string[];
  readonly beltItemIds: readonly string[];
  readonly beltGlowCount: number;
  readonly beltItemEventCount: number;
}

export interface SceneTelemetry {
  readonly ready: boolean;
  readonly camera: {
    readonly scrollX: number;
    readonly scrollY: number;
    readonly zoom: number;
  };
  readonly ghost: {
    readonly visible: boolean;
    readonly valid: boolean;
    readonly rotation: number;
  };
  readonly render: SceneRenderTelemetry;
}

export interface SceneTelemetryInput {
  ready: boolean;
  camera: {
    scrollX: number;
    scrollY: number;
    zoom: number;
  };
  ghost: {
    visible: boolean;
    valid: boolean;
    rotation: number;
  };
  render: SceneRenderTelemetry;
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
  });
}

export const INITIAL_SCENE_TELEMETRY = createSceneTelemetry({
  ready: false,
  camera: { scrollX: 0, scrollY: 0, zoom: 1 },
  ghost: { visible: false, valid: false, rotation: 0 },
  render: createSceneRenderTelemetry({
    entityIds: [],
    activeEntityIds: [],
    activeFrameKeys: [],
    beltItemIds: [],
    beltGlowCount: 0,
    beltItemEventCount: 0,
  }),
});
