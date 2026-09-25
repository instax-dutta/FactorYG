import { expect, test, type Page } from "@playwright/test";
import { SAVE_KEY } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import { serializeSave } from "../../src/persistence/save";

interface RuntimeBridge {
  dispatch(command: Record<string, unknown>): { ok: boolean; reason?: string };
  advanceTicks(count: number): void;
  getSnapshot(): {
    currency: number;
    offlineSummary?: {
      elapsedSeconds: number;
      cappedSeconds: number;
      earnedCurrency: number;
      chainUnits: Record<string, number>;
    };
  };
}

interface SceneTelemetry {
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

interface TelemetryBridge {
  getSnapshot(): SceneTelemetry;
}

interface StatusObservation {
  status: string;
  bridgeAbsent: boolean;
  telemetryAbsent: boolean;
}

declare global {
  interface Window {
    __FACTOR_Y__?: RuntimeBridge;
    __FACTOR_Y_TELEMETRY__?: TelemetryBridge;
    __FACTOR_Y_STATUS_HISTORY__?: StatusObservation[];
  }
}

const COPPER_NODE = { x: 20, y: 21 };
const TEST_CELL = { x: 32, y: 32 };
const TILE_SIZE_PX = 64;

async function installStatusHistory(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const history: StatusObservation[] = [];
    let previousStatus: string | undefined;
    const recordStatus = (): void => {
      const status = document
        .querySelector("[data-testid=game-canvas]")
        ?.getAttribute("data-factor-y-status");
      if (status === null || status === undefined || status === previousStatus) {
        return;
      }
      previousStatus = status;
      history.push({
        status,
        bridgeAbsent: window.__FACTOR_Y__ === undefined,
        telemetryAbsent: window.__FACTOR_Y_TELEMETRY__ === undefined,
      });
    };
    const observer = new MutationObserver(recordStatus);
    observer.observe(document, {
      attributes: true,
      attributeFilter: ["data-factor-y-status"],
      childList: true,
      subtree: true,
    });
    Object.defineProperty(window, "__FACTOR_Y_STATUS_HISTORY__", {
      configurable: true,
      value: history,
    });
    recordStatus();
  });
}

async function waitForBootingStatus(page: Page, minimumCount: number): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        (count) =>
          (window.__FACTOR_Y_STATUS_HISTORY__ ?? []).filter(
            (observation) => observation.status === "booting",
          ).length >= count,
        minimumCount,
      ),
    )
    .toBe(true);
  const observations = await page.evaluate(() =>
    (window.__FACTOR_Y_STATUS_HISTORY__ ?? []).filter(
      (observation) => observation.status === "booting",
    ),
  );
  expect(observations.every((observation) => observation.bridgeAbsent && observation.telemetryAbsent)).toBe(true);
}

async function waitForReady(page: Page): Promise<void> {
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

test.use({ viewport: { width: 1000, height: 800 } });

async function getTelemetry(page: Page): Promise<SceneTelemetry> {
  return page.evaluate(() => {
    const telemetry = window.__FACTOR_Y_TELEMETRY__;
    if (telemetry === undefined) {
      throw new Error("Factor-Y telemetry unavailable");
    }
    return telemetry.getSnapshot();
  });
}

async function screenPointForCell(
  page: Page,
  cell: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ cell, tileSize }) => {
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
        x: rect.left + (cell.x * tileSize + tileSize / 2 - snapshot.camera.scrollX) * snapshot.camera.zoom * displayScale,
        y: rect.top + (cell.y * tileSize + tileSize / 2 - snapshot.camera.scrollY) * snapshot.camera.zoom * displayScale,
      };
    },
    { cell, tileSize: TILE_SIZE_PX },
  );
}

test("mounts, controls, previews, simulates, and remounts the Phase 0 scene", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  await installStatusHistory(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(await page.title()).toBe("Factor-I");
  expect(await page.locator('meta[name="description"]').getAttribute("content")).toBe(
    "Build, optimize, and grow your Factor-I factory.",
  );
  await expect(page.getByRole("heading", { name: "Factor-I" })).toBeVisible();
  const wrapper = page.getByTestId("game-canvas");
  await expect(wrapper).toBeVisible();
  await waitForBootingStatus(page, 1);
  await expect(wrapper).toHaveAttribute("data-factor-y-status", "ready");
  await expect(wrapper.locator("canvas")).toBeVisible();
  await waitForReady(page);

  expect(
    await page.evaluate(() => Object.keys(window.__FACTOR_Y__ ?? {}).sort()),
  ).toEqual(["advanceTicks", "dispatch", "getSnapshot"]);
  expect(
    await page.evaluate(() => Object.keys(window.__FACTOR_Y_TELEMETRY__ ?? {}).sort()),
  ).toEqual(["getSnapshot"]);

  const scaleEvidence = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=game-canvas] canvas");
    if (canvas === null) {
      throw new Error("Factor-Y canvas unavailable");
    }
    const rect = canvas.getBoundingClientRect();
    return {
      intrinsicWidth: canvas.width,
      intrinsicHeight: canvas.height,
      displayScale: Math.min(rect.width / canvas.width, rect.height / canvas.height),
    };
  });
  expect(scaleEvidence.displayScale).toBeGreaterThan(0);
  expect(scaleEvidence.displayScale).not.toBe(1);

  const initialTelemetry = await getTelemetry(page);
  expect(initialTelemetry.ready).toBe(true);
  expect(initialTelemetry.ghost.visible).toBe(false);

  await page.evaluate(() => {
    window.__FACTOR_Y__?.dispatch({ type: "setPlacementMode", machine: "extractor" });
  });
  let point = await screenPointForCell(page, TEST_CELL);
  await page.mouse.move(point.x, point.y);
  await expect.poll(async () => (await getTelemetry(page)).ghost.visible).toBe(true);
  await expect.poll(async () => (await getTelemetry(page)).ghost.valid).toBe(false);

  await page.evaluate(() => {
    window.__FACTOR_Y__?.dispatch({ type: "setPlacementMode", machine: "belt" });
  });
  point = await screenPointForCell(page, TEST_CELL);
  await page.mouse.move(point.x + 1, point.y + 1);
  await expect.poll(async () => (await getTelemetry(page)).ghost.valid).toBe(true);
  expect((await getTelemetry(page)).ghost.rotation).toBe(0);

  await page.keyboard.press("r");
  await expect.poll(async () => (await getTelemetry(page)).ghost.rotation).toBe(90);

  const beforeDrag = await getTelemetry(page);
  const canvasBox = await wrapper.locator("canvas").boundingBox();
  if (canvasBox === null) {
    throw new Error("Canvas bounding box unavailable");
  }
  const dragStart = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 120, dragStart.y + 80, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => {
    const telemetry = await getTelemetry(page);
    return telemetry.camera.scrollX !== beforeDrag.camera.scrollX || telemetry.camera.scrollY !== beforeDrag.camera.scrollY;
  }).toBe(true);

  const beforeZoom = (await getTelemetry(page)).camera.zoom;
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await getTelemetry(page)).camera.zoom).not.toBe(beforeZoom);

  const economy = await page.evaluate((node) => {
    const runtime = window.__FACTOR_Y__;
    if (runtime === undefined) {
      throw new Error("Factor-Y runtime bridge unavailable");
    }
    const results = [
      runtime.dispatch({
        type: "placeEntity",
        machine: "extractor",
        x: node.x,
        y: node.y,
        rotation: 0,
        resourceNode: "copperOre",
      }),
      runtime.dispatch({
        type: "placeEntity",
        machine: "belt",
        x: node.x + 1,
        y: node.y,
        rotation: 0,
      }),
      runtime.dispatch({
        type: "placeEntity",
        machine: "depot",
        x: node.x + 2,
        y: node.y,
        rotation: 0,
      }),
    ];
    const before = runtime.getSnapshot().currency;
    runtime.advanceTicks(25);
    return { results, before, after: runtime.getSnapshot().currency };
  }, COPPER_NODE);

  expect(economy.results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  expect(economy.after).toBeGreaterThan(economy.before);

  const occupiedResult = await page.evaluate((node) => {
    return window.__FACTOR_Y__?.dispatch({
      type: "placeEntity",
      machine: "belt",
      x: node.x + 1,
      y: node.y,
      rotation: 0,
    });
  }, COPPER_NODE);
  expect(occupiedResult).toEqual({ ok: false, reason: "occupied" });

  const demolishResult = await page.evaluate(() => {
    return window.__FACTOR_Y__?.dispatch({ type: "demolishEntity", entityId: "entity-3" });
  });
  expect(demolishResult).toEqual({ ok: true });

  await page.evaluate(() => {
    window.dispatchEvent(new Event("factor-y:lifecycle-toggle"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__FACTOR_Y__ === undefined && window.__FACTOR_Y_TELEMETRY__ === undefined,
      ),
    )
    .toBe(true);
  expect(await page.locator("[data-testid=game-canvas] canvas").count()).toBe(0);

  await page.evaluate(() => {
    window.dispatchEvent(new Event("factor-y:lifecycle-toggle"));
  });
  const remountedWrapper = page.getByTestId("game-canvas");
  await expect(remountedWrapper).toBeVisible();
  await waitForBootingStatus(page, 2);
  await expect(remountedWrapper).toHaveAttribute("data-factor-y-status", "ready");
  await waitForReady(page);
  expect(await page.locator("[data-testid=game-canvas] canvas").count()).toBe(1);
  expect((await getTelemetry(page)).ready).toBe(true);
  expect(await page.evaluate(() => Object.keys(window.__FACTOR_Y__ ?? {}).sort())).toEqual([
    "advanceTicks",
    "dispatch",
    "getSnapshot",
  ]);
  expect(
    await page.evaluate(() => Object.keys(window.__FACTOR_Y_TELEMETRY__ ?? {}).sort()),
  ).toEqual(["getSnapshot"]);
  expect(browserErrors).toEqual([]);
});

test("loads and anchors persisted offline state during browser startup", async ({ page }) => {
  const save = createInitialState();
  save.lastSavedAt = 10_000;
  save.currency = 100;
  save.lifetimeCurrency = 200;
  save.prestige.permanentMultipliers.sellValue = 2;
  save.productionChains = {
    copper: {
      id: "copper",
      outputResource: "copperIngot",
      steadyStateThroughput: 1,
      sellValue: 5,
    },
  };
  const serialized = serializeSave(save);

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: SAVE_KEY, value: serialized },
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForReady(page);

  const evidence = await page.evaluate((key) => {
    const snapshot = window.__FACTOR_Y__?.getSnapshot();
    const raw = window.localStorage.getItem(key);
    return {
      currency: snapshot?.currency,
      offlineSummary: snapshot?.offlineSummary,
      raw,
    };
  }, SAVE_KEY);

  expect(evidence.currency).toBe(432_100);
  expect(evidence.offlineSummary).toEqual({
    elapsedSeconds: expect.any(Number),
    cappedSeconds: 43_200,
    earnedCurrency: 432_000,
    chainUnits: { copperIngot: 43_200 },
  });
  expect(evidence.raw).not.toBeNull();
  expect(evidence.raw).not.toContain("offlineSummary");
  const persisted = JSON.parse(evidence.raw ?? "{}") as {
    currency: number;
    lifetimeCurrency: number;
    lastSavedAt: number;
  };
  expect(persisted.currency).toBe(432_100);
  expect(persisted.lifetimeCurrency).toBe(432_200);
  expect(persisted.lastSavedAt).toBeGreaterThan(10_000);
});
