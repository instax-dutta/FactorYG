import { expect, test, type Page } from "@playwright/test";
import { trackBrowserErrors, waitForReady } from "./support/runtimeBridge";
import { CAMERA_MARGIN_PX } from "../../src/phaser/cameraConfig";
import { STARTING_CURRENCY } from "../../src/content/balance";
import { SAVE_KEY, TILE_SIZE_PX } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import { serializeSave } from "../../src/persistence/save";

const FORGED_CURRENCY = 432_100;
const COPPER_NODE = { x: 40, y: 37 };
const STARTING_PLOT_BOUND = 64 * TILE_SIZE_PX + CAMERA_MARGIN_PX;

async function seedStoredSave(page: Page, raw: string): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: SAVE_KEY, value: raw },
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForReady(page);
}

function forgedExpandedPlotSave(): string {
  const save = createInitialState();
  save.currency = FORGED_CURRENCY;
  save.lifetimeCurrency = FORGED_CURRENCY;
  save.grid.width = 96;
  save.grid.height = 96;
  return JSON.stringify(save);
}

function storedSave(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), SAVE_KEY);
}

test("tells the player a rejected save started a fresh run and holds the unreadable payload", async ({
  page,
}) => {
  const browserErrors = trackBrowserErrors(page);
  const seeded = forgedExpandedPlotSave();

  await seedStoredSave(page, seeded);

  const notice = page.getByTestId("save-recovery-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("role", "dialog");
  await expect(notice).toHaveAttribute("aria-modal", "true");
  await expect(notice).toHaveAttribute("data-reason", "invalidSave");
  await expect(notice).toHaveAttribute("data-recovery-message", 'Save field "grid" is invalid.');
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByTestId("offline-summary-modal")).toHaveCount(0);
  await expect(page.getByTestId("save-recovery-summary")).toContainText("started a new one");
  await expect(page.getByTestId("save-recovery-explanation")).toBeVisible();
  await expect(notice).not.toContainText("invalidSave");
  await expect(notice).not.toContainText("Save field");

  const evidence = await page.evaluate(() => ({
    currency: window.__FACTOR_Y__?.getSnapshot().currency,
    boundsWidth: window.__FACTOR_Y_TELEMETRY__?.getSnapshot().camera.boundsWidth,
    boundsHeight: window.__FACTOR_Y_TELEMETRY__?.getSnapshot().camera.boundsHeight,
  }));

  expect(evidence.currency).toBe(STARTING_CURRENCY);
  expect(evidence.boundsWidth).toBe(STARTING_PLOT_BOUND);
  expect(evidence.boundsHeight).toBe(STARTING_PLOT_BOUND);

  const placedWhileTold = await page.evaluate(
    (node) =>
      window.__FACTOR_Y__?.dispatch({
        type: "placeEntity",
        machine: "extractor",
        x: node.x,
        y: node.y,
        rotation: 0,
        resourceNode: "copperOre",
      }),
    COPPER_NODE,
  );

  expect(placedWhileTold).toEqual({ ok: true });
  expect(await storedSave(page)).toBe(seeded);

  await page.getByTestId("dismiss-save-recovery").click();

  await expect(notice).toHaveCount(0);

  const placedAfterDismissal = await page.evaluate(
    (node) =>
      window.__FACTOR_Y__?.dispatch({
        type: "placeEntity",
        machine: "belt",
        x: node.x + 1,
        y: node.y,
        rotation: 0,
      }),
    COPPER_NODE,
  );

  expect(placedAfterDismissal).toEqual({ ok: true });
  await expect.poll(() => storedSave(page)).not.toBe(seeded);

  const persisted = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as { grid: { entities: { type: string }[] } });
  }, SAVE_KEY);

  expect(persisted?.grid.entities.map((entity) => entity.type)).toEqual(["extractor", "belt"]);
  expect(browserErrors).toEqual([]);
});

test("names a different reason when the stored save cannot be parsed at all", async ({ page }) => {
  const browserErrors = trackBrowserErrors(page);

  await seedStoredSave(page, "{ this is not a save");

  const notice = page.getByTestId("save-recovery-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-reason", "malformedJson");
  await expect(notice).toHaveAttribute("data-recovery-message", "Save data is not valid JSON.");
  await expect(page.getByTestId("save-recovery-summary")).toContainText("started a new one");

  const explanation = (await page.getByTestId("save-recovery-explanation").textContent())?.trim();

  expect(explanation ?? "").not.toBe("");
  expect(explanation).not.toContain("malformedJson");
  expect(await storedSave(page)).toBe("{ this is not a save");

  await page.getByTestId("dismiss-save-recovery").click();

  await expect(notice).toHaveCount(0);
  expect(await storedSave(page)).toBe("{ this is not a save");
  expect(browserErrors).toEqual([]);
});

test("shows no notice when a stored save is read into the run", async ({ page }) => {
  const browserErrors = trackBrowserErrors(page);
  const save = createInitialState();
  save.currency = 100;
  save.lifetimeCurrency = 100;

  await seedStoredSave(page, serializeSave(save));

  await expect(page.getByTestId("save-recovery-notice")).toHaveCount(0);
  expect(await page.evaluate(() => window.__FACTOR_Y__?.getSnapshot().currency)).toBe(100);
  await expect(page.getByTestId("hud-currency")).toHaveText("100");
  expect(browserErrors).toEqual([]);
});

test("shows no notice for a player who has never had a save", async ({ page }) => {
  const browserErrors = trackBrowserErrors(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForReady(page);

  await expect(page.getByTestId("save-recovery-notice")).toHaveCount(0);
  expect(await storedSave(page)).toBeNull();
  expect(await page.evaluate(() => window.__FACTOR_Y__?.getSnapshot().currency)).toBe(
    STARTING_CURRENCY,
  );
  expect(browserErrors).toEqual([]);
});
