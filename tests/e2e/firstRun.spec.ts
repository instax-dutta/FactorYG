import { expect, test, type Page } from "@playwright/test";
import { NEW_GAME_SEED, createInitialState } from "../../src/sim/initialState";
import { screenPointForCell } from "./support/runtimeBridge";
import { TILE_SIZE_PX } from "../../src/sim/constants";

interface SceneSnapshot {
  ghost: { visible: boolean; valid: boolean };
  render: { nodeSpriteCount: number; nodeSpriteCells: readonly string[] };
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
    return {
      ghost: snapshot.ghost,
      render: {
        nodeSpriteCount: snapshot.render.nodeSpriteCount,
        nodeSpriteCells: snapshot.render.nodeSpriteCells,
      },
    };
  });
}

/**
 * The nodes whose cell actually lands on the canvas, which is what a new player
 * can see and click. Walking every node in the world instead is both wrong and
 * too slow to finish: a cell outside the viewport has no usable screen point, so
 * each one costs the full per-node poll timeout and the spec overruns the
 * Playwright test timeout before it reaches an assertion. Restricting the walk to
 * the drawn area is also the honest version of the claim these tests make, which
 * is about a node *in view*.
 */
async function nodesInInitialView(page: Page): Promise<Cell[]> {
  const box = await page.locator("[data-testid=game-canvas] canvas").boundingBox();
  if (box === null) {
    throw new Error("the Factor-I canvas produced no bounding box");
  }

  const onScreen: Cell[] = [];
  for (const node of createInitialState(NEW_GAME_SEED).grid.nodes) {
    const point = await screenPointForCell(page, { x: node.x, y: node.y }, TILE_SIZE_PX);
    if (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    ) {
      onScreen.push({ x: node.x, y: node.y });
    }
  }
  return onScreen;
}

test("every resource node in the world is actually drawn, not merely present in state", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__FACTOR_Y_TELEMETRY__ !== undefined);

  const expected = createInitialState(NEW_GAME_SEED).grid.nodes.map(
    (node) => `${node.x},${node.y}`,
  );

  await expect
    .poll(async () => (await scene(page)).render.nodeSpriteCount, { timeout: 10000 })
    .toBe(expected.length);

  const drawn = (await scene(page)).render.nodeSpriteCells;
  expect([...drawn].sort()).toEqual([...expected].sort());
});

test("a drawn node reaches the screen, proved by two node cells differing from bare floor", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__FACTOR_Y_TELEMETRY__ !== undefined);
  await expect
    .poll(async () => (await scene(page)).render.nodeSpriteCount, { timeout: 10000 })
    .toBeGreaterThan(0);

  const canvas = (await page.locator("canvas").boundingBox()) as NonNullable<
    Awaited<ReturnType<() => Promise<{ x: number; y: number; width: number; height: number } | null>>>
  >;
  expect(canvas).not.toBeNull();

  const state = createInitialState(NEW_GAME_SEED);
  const inView: { x: number; y: number; resource: string }[] = [];
  for (const node of state.grid.nodes) {
    const point = await screenPointForCell(page, node, TILE_SIZE_PX);
    if (
      point.x >= canvas.x &&
      point.x <= canvas.x + canvas.width &&
      point.y >= canvas.y &&
      point.y <= canvas.y + canvas.height
    ) {
      inView.push({ x: node.x, y: node.y, resource: node.resource });
    }
  }
  expect(inView.length).toBeGreaterThan(1);

  const clipFor = async (cell: { x: number; y: number }) => {
    const point = await screenPointForCell(page, cell, TILE_SIZE_PX);
    const size = Math.round(TILE_SIZE_PX * (canvas.width / 1280));
    return {
      x: Math.round(point.x - size / 2),
      y: Math.round(point.y - size / 2),
      width: size,
      height: size,
    };
  };

  const first = inView[0];
  const second = inView.find(
    (node) => node.resource !== first.resource && node.x !== first.x,
  );
  expect(second).toBeDefined();

  const firstClip = await clipFor(first);
  const secondClip = await clipFor(second as { x: number; y: number });
  const nodeCells = new Set(state.grid.nodes.map((node) => `${node.x},${node.y}`));
  const view = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=game-canvas] canvas");
    const telemetry = window.__FACTOR_Y_TELEMETRY__;
    if (canvas === null || telemetry === undefined) {
      throw new Error("Factor-Y canvas or telemetry unavailable");
    }
    const snapshot = telemetry.getSnapshot();
    return {
      scrollX: snapshot.camera.scrollX,
      scrollY: snapshot.camera.scrollY,
      zoom: snapshot.camera.zoom,
      intrinsicWidth: canvas.width,
      intrinsicHeight: canvas.height,
    };
  });
  const firstVisibleX = Math.max(
    0,
    Math.floor(view.scrollX / (TILE_SIZE_PX * view.zoom)),
  );
  const firstVisibleY = Math.max(
    0,
    Math.floor(view.scrollY / (TILE_SIZE_PX * view.zoom)),
  );
  const lastVisibleX = Math.min(
    state.grid.width,
    Math.ceil((view.scrollX + view.intrinsicWidth) / (TILE_SIZE_PX * view.zoom)),
  );
  const lastVisibleY = Math.min(
    state.grid.height,
    Math.ceil((view.scrollY + view.intrinsicHeight) / (TILE_SIZE_PX * view.zoom)),
  );

  let floorCell: { x: number; y: number } | undefined;
  for (let y = firstVisibleY; y < lastVisibleY && floorCell === undefined; y += 1) {
    for (let x = firstVisibleX; x < lastVisibleX; x += 1) {
      if (!nodeCells.has(`${x},${y}`)) {
        floorCell = { x, y };
        break;
      }
    }
  }
  expect(floorCell).toBeDefined();
  const floorPoint = await screenPointForCell(page, floorCell as { x: number; y: number }, TILE_SIZE_PX);
  const size = sizeOf(canvas);
  const floorClip = {
    x: Math.round(floorPoint.x - size / 2),
    y: Math.round(floorPoint.y - size / 2),
    width: size,
    height: size,
  };

  const firstShot = await page.screenshot({ clip: firstClip });
  const secondShot = await page.screenshot({ clip: secondClip });
  const floorShot = await page.screenshot({ clip: floorClip });

  expect(firstShot.byteLength).toBeGreaterThan(0);
  expect(firstShot.equals(floorShot)).toBe(false);
  expect(firstShot.equals(secondShot)).toBe(false);
});

function sizeOf(canvas: { width: number }): number {
  return Math.round(TILE_SIZE_PX * (canvas.width / 1280));
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

  const candidates = await nodesInInitialView(page);
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

  const candidates = await nodesInInitialView(page);
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
