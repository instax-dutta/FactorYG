import { expect, test, type Page } from "@playwright/test";
import { NEW_GAME_SEED, createInitialState } from "../../src/sim/initialState";
import { screenPointForCell } from "./support/runtimeBridge";
import { TILE_SIZE_PX } from "../../src/sim/constants";

interface SceneSnapshot {
  ghost: { visible: boolean; valid: boolean };
}

interface Cell {
  x: number;
  y: number;
}

function scene(page: Page): Promise<SceneSnapshot> {
  return page.evaluate(() => {
    const telemetry = window.__FACTOR_Y_TELEMETRY__;
    if (telemetry === undefined) {
      throw new Error("Factor-Y telemetry unavailable");
    }
    const snapshot = telemetry.getSnapshot();
    return { ghost: snapshot.ghost };
  });
}

function nodesInInitialView(): Cell[] {
  return createInitialState(NEW_GAME_SEED).grid.nodes.map((node) => ({ x: node.x, y: node.y }));
}

test("a new player is told how to place a machine before anything is built", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/");
  await page.waitForFunction(() => window.__FACTOR_Y_TELEMETRY__ !== undefined);

  const hint = page.getByTestId("first-run-hint");
  await expect(hint).toBeVisible();

  const text = (await hint.innerText()).toLowerCase();
  expect(text).toContain("dock");
  expect(text).toContain("node");
  expect(errors).toEqual([]);
});

test("the first machine a new player is offered can actually be placed on a node in view", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__FACTOR_Y_TELEMETRY__ !== undefined);
  await page.getByTestId("build-extractor").click();

  const candidates = nodesInInitialView();
  expect(candidates.length).toBeGreaterThan(0);

  const placeable: Cell[] = [];
  for (const cell of candidates) {
    const point = await screenPointForCell(page, cell, TILE_SIZE_PX);
    await page.mouse.move(point.x, point.y);
    const valid = await expect
      .poll(async () => (await scene(page)).ghost.valid, { timeout: 2000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (valid) {
      placeable.push(cell);
    }
  }

  expect(placeable.length).toBeGreaterThan(0);
});

test("following the hint places a machine, and the hint then gets out of the way", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__FACTOR_Y_TELEMETRY__ !== undefined);
  await expect(page.getByTestId("first-run-hint")).toBeVisible();

  const candidates = nodesInInitialView();
  let placed = false;

  await page.getByTestId("build-extractor").click();
  for (const cell of candidates) {
    const point = await screenPointForCell(page, cell, TILE_SIZE_PX);
    await page.mouse.move(point.x, point.y);
    const valid = await expect
      .poll(async () => (await scene(page)).ghost.valid, { timeout: 2000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (!valid) {
      continue;
    }
    await page.mouse.click(point.x, point.y);
    placed = true;
    break;
  }

  expect(placed).toBe(true);
  await expect(page.getByTestId("first-run-hint")).toBeHidden();

  const entityCount = await page.evaluate(() => {
    const raw = window.localStorage.getItem("factor-y:save");
    if (raw === null) {
      return 0;
    }
    return (JSON.parse(raw) as { grid: { entities: unknown[] } }).grid.entities.length;
  });
  expect(entityCount).toBe(1);
});

test("the hint never intercepts a click the player has to make", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__FACTOR_Y_TELEMETRY__ !== undefined);

  const pointerEvents = await page
    .getByTestId("first-run-hint")
    .evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).toBe("none");
});

test("the hint never covers one of the persistent overlay panels", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__FACTOR_Y_TELEMETRY__ !== undefined);

  const hint = await page.getByTestId("first-run-hint").boundingBox();
  expect(hint).not.toBeNull();
  const box = hint as NonNullable<typeof hint>;

  for (const testId of ["entity-inspector", "tech-tree-toggle", "build-dock", "hud"]) {
    const panel = await page.getByTestId(testId).boundingBox();
    if (panel === null) {
      continue;
    }
    const overlaps =
      box.x < panel.x + panel.width &&
      box.x + box.width > panel.x &&
      box.y < panel.y + panel.height &&
      box.y + box.height > panel.y;
    expect(overlaps, `${testId} overlaps the first-run hint`).toBe(false);
  }
});
