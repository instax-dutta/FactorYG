import { expect, type Page } from "@playwright/test";

export interface RuntimeSnapshot {
  currency: number;
  placementMode?: string;
  selectedEntityId?: string;
  offlineSummary?: {
    elapsedSeconds: number;
    cappedSeconds: number;
    earnedCurrency: number;
    chainUnits: Record<string, number>;
  };
}

export interface RuntimeBridge {
  dispatch(command: Record<string, unknown>): { ok: boolean; reason?: string };
  advanceTicks(count: number): void;
  getSnapshot(): RuntimeSnapshot;
}

export interface SceneTelemetry {
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
  render: {
    nodeSpriteCount: number;
    nodeSpriteCells: readonly string[];
  };
}

export interface TelemetryBridge {
  getSnapshot(): SceneTelemetry;
}

declare global {
  interface Window {
    __FACTOR_Y__?: RuntimeBridge;
    __FACTOR_Y_TELEMETRY__?: TelemetryBridge;
  }
}

export async function waitForReady(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const bridge = window.__FACTOR_Y__;
        const telemetry = window.__FACTOR_Y_TELEMETRY__;
        return bridge !== undefined && telemetry?.getSnapshot().ready === true;
      }),
    )
    .toBe(true);
}

export function trackBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

export async function screenPointForCell(
  page: Page,
  cell: { x: number; y: number },
  tileSize: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ cell: target, tileSize: size }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=game-canvas] canvas");
      const telemetry = window.__FACTOR_Y_TELEMETRY__;
      if (canvas === null || telemetry === undefined) {
        throw new Error("Factor-Y canvas or telemetry unavailable");
      }
      const rect = canvas.getBoundingClientRect();
      const intrinsicWidth = canvas.width;
      const intrinsicHeight = canvas.height;
      if (intrinsicWidth <= 0 || intrinsicHeight <= 0) {
        throw new Error("Factor-Y canvas intrinsic dimensions unavailable");
      }
      const displayScale = Math.min(
        rect.width / intrinsicWidth,
        rect.height / intrinsicHeight,
      );
      const snapshot = telemetry.getSnapshot();
      return {
        x:
          rect.left +
          (target.x * size + size / 2 - snapshot.camera.scrollX) *
            snapshot.camera.zoom *
            displayScale,
        y:
          rect.top +
          (target.y * size + size / 2 - snapshot.camera.scrollY) *
            snapshot.camera.zoom *
            displayScale,
      };
    },
    { cell, tileSize },
  );
}
