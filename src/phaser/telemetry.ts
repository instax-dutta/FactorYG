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
}

export function createSceneTelemetry(input: SceneTelemetryInput): SceneTelemetry {
  const camera = Object.freeze({ ...input.camera });
  const ghost = Object.freeze({ ...input.ghost });
  return Object.freeze({
    ready: input.ready,
    camera,
    ghost,
  });
}

export const INITIAL_SCENE_TELEMETRY = createSceneTelemetry({
  ready: false,
  camera: { scrollX: 0, scrollY: 0, zoom: 1 },
  ghost: { visible: false, valid: false, rotation: 0 },
});
