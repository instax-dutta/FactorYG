import { expect, test } from "@playwright/test";

interface RuntimeBridge {
  dispatch(command: Record<string, unknown>): { ok: boolean; reason?: string };
  advanceTicks(count: number): void;
  getSnapshot(): { currency: number };
}

declare global {
  interface Window {
    __FACTOR_Y__?: RuntimeBridge;
  }
}

const COPPER_NODE = { x: 20, y: 21 };

test("mounts the canvas and runs the Phase 0 raw loop through the test bridge", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");

  const wrapper = page.getByTestId("game-canvas");
  await expect(wrapper).toBeVisible();
  await expect(wrapper.locator("canvas")).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => window.__FACTOR_Y__ !== undefined))
    .toBe(true);

  const buildResults = await page.evaluate((node) => {
    const runtime = window.__FACTOR_Y__;
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
  }, COPPER_NODE);

  expect(buildResults).toEqual([{ ok: true }, { ok: true }, { ok: true }]);

  const postBuildCurrency = await page.evaluate(() => window.__FACTOR_Y__?.getSnapshot().currency ?? 0);
  await page.evaluate(() => window.__FACTOR_Y__?.advanceTicks(25));
  const postTickCurrency = await page.evaluate(() => window.__FACTOR_Y__?.getSnapshot().currency ?? 0);

  expect(postTickCurrency).toBeGreaterThan(postBuildCurrency);

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
  expect(browserErrors).toEqual([]);
});
