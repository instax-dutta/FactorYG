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
