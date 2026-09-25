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

export function createSceneTelemetry(input: SceneTelemetryInput): SceneTelemetry {
  const camera = Object.freeze({ ...input.camera });
  const ghost = Object.freeze({ ...input.ghost });
  const render = Object.freeze({
    entityIds: Object.freeze([...input.render.entityIds]),
    activeEntityIds: Object.freeze([...input.render.activeEntityIds]),
    activeFrameKeys: Object.freeze([...input.render.activeFrameKeys]),
    beltItemIds: Object.freeze([...input.render.beltItemIds]),
    beltGlowCount: input.render.beltGlowCount,
    beltItemEventCount: input.render.beltItemEventCount,
  });
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
  render: {
    entityIds: [],
    activeEntityIds: [],
    activeFrameKeys: [],
    beltItemIds: [],
    beltGlowCount: 0,
    beltItemEventCount: 0,
  },
});
