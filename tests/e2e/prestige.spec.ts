import { expect, test, type Page } from "@playwright/test";
import { CAMERA_MARGIN_PX } from "../../src/phaser/cameraConfig";
import { GRID_EXPANSION_COST, PRESTIGE_THRESHOLD, STARTING_CURRENCY } from "../../src/content/balance";
import { GRID_EXPANSION_STEP, GRID_MAX_SIZE, SAVE_KEY } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import { serializeSave } from "../../src/persistence/save";

interface RuntimeBridge {
  dispatch(command: Record<string, unknown>): { ok: boolean; reason?: string };
  advanceTicks(count: number): void;
  getSnapshot(): {
    currency: number;
    prestigePoints: number;
    prestigeReady: boolean;
    permanentMultipliers: { productionSpeed: number; sellValue: number };
  };
}

interface SceneTelemetry {
  ready: boolean;
  camera: {
    scrollX: number;
    scrollY: number;
    zoom: number;
    boundsWidth: number;
    boundsHeight: number;
  };
  render: {
    entityIds: string[];
    activeEntityIds: string[];
  };
}

interface TelemetryBridge {
  getSnapshot(): SceneTelemetry;
}

interface BridgeGlobals {
  __FACTOR_Y__?: RuntimeBridge;
  __FACTOR_Y_TELEMETRY__?: TelemetryBridge;
}

const TILE_SIZE_PX = 64;
const STARTING_PLOT_PX = 64 * TILE_SIZE_PX + CAMERA_MARGIN_PX;
const EXPANDED_PLOT_PX = 96 * TILE_SIZE_PX + CAMERA_MARGIN_PX;
const COPPER_NODE = { x: 40, y: 37 };

test.use({ viewport: { width: 1000, height: 800 } });

async function waitForReady(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const globals = window as unknown as BridgeGlobals;
        const bridge = globals.__FACTOR_Y__;
        const telemetry = globals.__FACTOR_Y_TELEMETRY__;
        return bridge !== undefined && telemetry?.getSnapshot().ready === true;
      }),
    )
    .toBe(true);
}

async function getTelemetry(page: Page): Promise<SceneTelemetry> {
  return page.evaluate(() => {
    const telemetry = (window as unknown as BridgeGlobals).__FACTOR_Y_TELEMETRY__;
    if (telemetry === undefined) {
      throw new Error("Factor-Y telemetry unavailable");
    }
    return telemetry.getSnapshot();
  });
}

function watchBrowserErrors(page: Page): string[] {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  return browserErrors;
}

async function dismissOfflineSummaryIfShown(page: Page): Promise<void> {
  if ((await page.getByTestId("offline-summary-modal").count()) === 0) {
    return;
  }

  await page.getByTestId("dismiss-offline-summary").click();
  await expect(page.getByTestId("offline-summary-modal")).toHaveCount(0);
}

async function seedSave(page: Page, save: Parameters<typeof serializeSave>[0]): Promise<void> {
  const serialized = serializeSave(save);
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: SAVE_KEY, value: serialized },
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForReady(page);
  await dismissOfflineSummaryIfShown(page);
}

async function placeCopperLoop(page: Page): Promise<void> {
  const results = await page.evaluate((node) => {
    const runtime = (window as unknown as BridgeGlobals).__FACTOR_Y__;
    if (runtime === undefined) {
      throw new Error("Factor-Y runtime bridge unavailable");
    }
    return [
      runtime.dispatch({
        type: "placeEntity",
        machine: "extractor",
        x: node.x,
        y: node.y,
        rotation: 0,
        resourceNode: "copperOre",
      }),
      runtime.dispatch({ type: "placeEntity", machine: "belt", x: node.x + 1, y: node.y, rotation: 0 }),
      runtime.dispatch({ type: "placeEntity", machine: "depot", x: node.x + 2, y: node.y, rotation: 0 }),
    ];
  }, COPPER_NODE);

  expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
}

function eligibleSave(): Parameters<typeof serializeSave>[0] {
  const save = createInitialState();
  save.lifetimeCurrency = 4 * PRESTIGE_THRESHOLD;
  return save;
}

test("empties the rendered scene after a prestige confirmed in the modal", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);

  await seedSave(page, eligibleSave());
  await placeCopperLoop(page);

  await expect
    .poll(async () => (await getTelemetry(page)).render.entityIds.length)
    .toBeGreaterThanOrEqual(3);
  const before = await getTelemetry(page);
  expect(before.render.entityIds.length).toBeGreaterThanOrEqual(3);

  const button = page.getByTestId("prestige-button");
  await expect(button).toBeEnabled();
  await button.click();

  const dialog = page.getByTestId("prestige-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await page.getByTestId("prestige-confirm").click();

  await expect(page.getByTestId("prestige-modal")).toHaveCount(0);
  await expect
    .poll(async () => {
      const telemetry = await getTelemetry(page);
      return { entityIds: telemetry.render.entityIds, activeEntityIds: telemetry.render.activeEntityIds };
    })
    .toEqual({ entityIds: [], activeEntityIds: [] });
  expect((await getTelemetry(page)).render.entityIds).toEqual([]);
  expect((await getTelemetry(page)).render.activeEntityIds).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as BridgeGlobals).__FACTOR_Y__?.getSnapshot().currency)).toBe(
    STARTING_CURRENCY,
  );
  expect(browserErrors).toEqual([]);
});

test("prestiges exactly once from the modal and shows the fresh run in the HUD", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);

  await seedSave(page, eligibleSave());

  const button = page.getByTestId("prestige-button");
  await expect(button).toBeEnabled();
  await button.click();

  const dialog = page.getByTestId("prestige-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("prestige-preview-award")).toHaveText("2");
  await expect(dialog.getByTestId("prestige-preview-points")).toHaveText("2");
  const previewed = {
    productionSpeed: await dialog.getByTestId("prestige-preview-production").textContent(),
    sellValue: await dialog.getByTestId("prestige-preview-sell").textContent(),
  };

  await page.getByTestId("prestige-confirm").click();

  await expect(page.getByTestId("prestige-modal")).toHaveCount(0);
  await expect(page.getByTestId("hud-prestige-points")).toHaveText("2");
  await expect(page.getByTestId("hud-currency")).toHaveText(
    new Intl.NumberFormat("en-US").format(STARTING_CURRENCY),
  );
  await expect(button).toBeDisabled();

  const awarded = await page.evaluate(() => {
    const bridge = (window as unknown as BridgeGlobals).__FACTOR_Y__;
    if (bridge === undefined) {
      throw new Error("Factor-Y runtime bridge unavailable");
    }
    const snapshot = bridge.getSnapshot();
    return {
      points: snapshot.prestigePoints,
      ready: snapshot.prestigeReady,
      currency: snapshot.currency,
      permanentMultipliers: snapshot.permanentMultipliers,
    };
  });
  expect(awarded.points).toBe(2);
  expect(awarded.ready).toBe(false);
  expect(awarded.currency).toBe(STARTING_CURRENCY);
  expect(awarded.permanentMultipliers.productionSpeed).toBeGreaterThan(1);
  expect(awarded.permanentMultipliers.sellValue).toBeGreaterThan(1);
  expect(previewed).toEqual({
    productionSpeed: new Intl.NumberFormat("en-US").format(
      awarded.permanentMultipliers.productionSpeed,
    ),
    sellValue: new Intl.NumberFormat("en-US").format(awarded.permanentMultipliers.sellValue),
  });
  expect(await page.locator("[data-testid=prestige-modal]").count()).toBe(0);
  expect(browserErrors).toEqual([]);
});

test("keeps the prestige control disabled and inert below the threshold", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  const save = createInitialState();
  save.lifetimeCurrency = PRESTIGE_THRESHOLD - 1;

  await seedSave(page, save);

  const button = page.getByTestId("prestige-button");
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("data-prestige-ready", "false");
  await button.click({ force: true });

  expect(await page.locator("[data-testid=prestige-modal]").count()).toBe(0);
  expect(browserErrors).toEqual([]);
});

test("expands the plot from the HUD and moves the reported camera bounds", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  const save = createInitialState();
  save.lifetimeCurrency = PRESTIGE_THRESHOLD;
  save.currency = GRID_EXPANSION_COST * 2;
  save.prestige.points = 1;
  save.prestige.totalPrestiges = 1;
  save.prestige.permanentMultipliers = { productionSpeed: 1, sellValue: 1 };

  await seedSave(page, save);

  await expect
    .poll(() => getTelemetry(page).then((telemetry) => telemetry.camera.boundsWidth))
    .toBe(STARTING_PLOT_PX);
  expect((await getTelemetry(page)).camera.boundsHeight).toBe(STARTING_PLOT_PX);

  const expand = page.getByTestId("expand-grid-button");
  await expect(expand).toBeEnabled();
  await expect(expand).toHaveAttribute("data-cost", String(GRID_EXPANSION_COST));
  await expect(page.getByTestId("expand-cost")).toHaveText(
    `Costs ${new Intl.NumberFormat("en-US").format(GRID_EXPANSION_COST)}`,
  );

  const currencyBefore = await page.evaluate(() => (window as unknown as BridgeGlobals).__FACTOR_Y__?.getSnapshot().currency);
  expect(currencyBefore).toBe(GRID_EXPANSION_COST * 2);
  await expand.click();

  await expect
    .poll(() => getTelemetry(page).then((telemetry) => telemetry.camera.boundsWidth))
    .toBe(EXPANDED_PLOT_PX);
  const telemetry = await getTelemetry(page);
  expect(telemetry.camera.boundsHeight).toBe(EXPANDED_PLOT_PX);
  expect(telemetry.camera.boundsWidth).toBeGreaterThan(STARTING_PLOT_PX);
  await expect(page.getByTestId("expand-plot-size")).toHaveText("96 x 96");
  expect(await page.evaluate(() => (window as unknown as BridgeGlobals).__FACTOR_Y__?.getSnapshot().currency)).toBe(
    GRID_EXPANSION_COST,
  );
  expect(browserErrors).toEqual([]);
});

test("disables the expansion control a run has not earned or cannot afford", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  const save = createInitialState();
  save.currency = GRID_EXPANSION_COST * 2;

  await seedSave(page, save);

  const expand = page.getByTestId("expand-grid-button");
  await expect(expand).toBeDisabled();
  await expect(expand).toHaveAttribute("data-reason", "expansionLocked");

  const broke = createInitialState();
  broke.lifetimeCurrency = PRESTIGE_THRESHOLD;
  broke.prestige.totalPrestiges = 1;
  broke.currency = GRID_EXPANSION_COST - 1;

  await seedSave(page, broke);

  await expect(expand).toBeDisabled();
  await expect(expand).toHaveAttribute("data-reason", "insufficientExpansionCost");
  await expect(page.locator("[data-testid=expand-grid-button][disabled]")).toHaveCount(1);
  expect(browserErrors).toEqual([]);
});

test("recovers from a corrupt oversized save instead of hanging on it", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  const save = createInitialState();
  save.grid.width = 100_000;
  save.grid.height = 100_000;
  save.currency = 432_100;
  save.prestige.totalPrestiges = 1;
  save.prestige.points = 4;
  save.prestige.permanentMultipliers = { productionSpeed: 1.5, sellValue: 2 };

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: SAVE_KEY, value: JSON.stringify(save) },
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForReady(page);
  await dismissOfflineSummaryIfShown(page);

  const telemetry = await getTelemetry(page);
  expect(telemetry.camera.boundsWidth).toBe(STARTING_PLOT_PX);
  expect(telemetry.camera.boundsHeight).toBe(STARTING_PLOT_PX);
  expect(await page.evaluate(() => (window as unknown as BridgeGlobals).__FACTOR_Y__?.getSnapshot().currency)).toBe(
    STARTING_CURRENCY,
  );
  expect(await page.evaluate(() => (window as unknown as BridgeGlobals).__FACTOR_Y__?.getSnapshot().prestigePoints)).toBe(0);
  await expect(page.getByTestId("expand-grid-button")).toBeDisabled();
  await expect(page.getByTestId("prestige-button")).toBeDisabled();
  expect(GRID_EXPANSION_STEP).toBe(32);
  expect(GRID_MAX_SIZE).toBe(256);
  expect(browserErrors).toEqual([]);
});

test("keeps the overlay panels from overlapping once the prestige controls are live", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);

  await seedSave(page, eligibleSave());

  await page.getByTestId("prestige-button").click();
  await expect(page.getByTestId("prestige-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("prestige-modal")).toHaveCount(0);

  const panels = [
    ["Header", await page.getByRole("banner").boundingBox()],
    ["Hud", await page.getByTestId("hud").boundingBox()],
    ["Entity inspector", await page.getByTestId("entity-inspector").boundingBox()],
    ["Build dock", await page.getByTestId("build-dock").boundingBox()],
    ["Notification stack", await page.getByTestId("notification-stack").boundingBox()],
    ["Tech tree toggle", await page.getByTestId("tech-tree-toggle").boundingBox()],
  ] as const;

  const boxes = panels.map(([label, box]) => {
    if (box === null) {
      throw new Error(`${label} bounding box unavailable`);
    }
    return [label, box] as const;
  });

  const overlaps = boxes.flatMap(([leftLabel, left], index) =>
    boxes
      .slice(index + 1)
      .filter(
        ([, right]) =>
          left.x < right.x + right.width &&
          left.x + left.width > right.x &&
          left.y < right.y + right.height &&
          left.y + left.height > right.y,
      )
      .map(([rightLabel]) => `${leftLabel} / ${rightLabel}`),
  );

  expect(overlaps).toEqual([]);
  expect(browserErrors).toEqual([]);
});
