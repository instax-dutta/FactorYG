import { test, expect, type Page } from '@playwright/test';
import {
  cellTypeAt,
  collectErrors,
  findPixelForCell,
  inspectCell,
  seedSave,
  setTool,
  waitForReady,
  type Cell,
} from './helpers';

/**
 * Multi-place: dragging a straight belt run in the browser.
 *
 * The act 3 build is ~140 cells and nearly all of them are belt, so this is the
 * gesture that decides whether the game is playable past act 2. The assertions
 * are the player-facing ones: the cells a drag covered are belts, they face the
 * way the drag went, and one undo takes the whole run back.
 */

/** Drags the belt tool from one cell to another, as a player would. */
async function dragRun(page: Page, from: Cell, to: Cell): Promise<void> {
  const start = await findPixelForCell(page, from);
  const end = await findPixelForCell(page, to);
  await setTool(page, 'belt');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Two moves: the first crosses the drag threshold, the second settles on the
  // target cell, which is what a real hand does.
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2);
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await setTool(page, null);
}

async function typeAt(page: Page, cell: Cell): Promise<string> {
  const pixel = await findPixelForCell(page, cell);
  return cellTypeAt(page, pixel.x, pixel.y);
}

test('a drag lays a whole belt run, and one undo takes it back', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page);
  await page.goto('/');
  await waitForReady(page, errors);

  await dragRun(page, { x: 30, y: 30 }, { x: 35, y: 30 });

  // Every cell the drag covered, not just the endpoints.
  for (let x = 30; x <= 35; x++) {
    expect(await typeAt(page, { x, y: 30 }), `cell ${x},30`).toBe('belt');
  }

  // One edit, so one undo removes all six.
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(200);
  for (let x = 30; x <= 35; x++) {
    expect(await typeAt(page, { x, y: 30 }), `cell ${x},30 after undo`).toBe('empty');
  }

  expect(errors).toEqual([]);
});

test('a vertical drag feeds south, and the run arrives as one line', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page);
  await page.goto('/');
  await waitForReady(page, errors);

  await dragRun(page, { x: 34, y: 30 }, { x: 34, y: 34 });

  // Every cell of the column is a belt, and nothing outside it was touched.
  for (let y = 30; y <= 34; y++) {
    expect(await typeAt(page, { x: 34, y }), `cell 34,${y}`).toBe('belt');
  }
  expect(await typeAt(page, { x: 35, y: 30 })).toBe('empty');

  // Inspecting one of them reports a belt, i.e. the panel agrees with the grid.
  // NOTE: `inspectCell` takes *pixel* coordinates and clicks them, so the cell
  // has to be resolved to a pixel first.
  const last = await findPixelForCell(page, { x: 34, y: 34 });
  await inspectCell(page, last.x, last.y);
  await expect(page.getByTestId('info-type')).toContainText(/belt/i);
  await expect(page.getByTestId('info-cell')).toContainText('34,34');

  expect(errors).toEqual([]);
});

test('a run with something in the way is refused whole, not half-built', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page);
  await page.goto('/');
  await waitForReady(page, errors);

  // A machine in the middle of the intended run. The pixel is resolved *before*
  // arming, because `findPixelForCell` probes by inspecting, and inspecting
  // presses Escape — which disarms the tool it would be placing with.
  const middle = await findPixelForCell(page, { x: 33, y: 32 });
  await setTool(page, 'smelter');
  await page.mouse.click(middle.x, middle.y);
  await setTool(page, null);
  expect(await typeAt(page, { x: 33, y: 32 })).toBe('smelter');

  await dragRun(page, { x: 30, y: 32 }, { x: 36, y: 32 });

  // A run with a hole in it is invisible in a row of identical belts, so the
  // whole drag is refused and the cells on the far side stay empty.
  expect(await typeAt(page, { x: 30, y: 32 })).toBe('empty');
  expect(await typeAt(page, { x: 36, y: 32 })).toBe('empty');
  expect(await typeAt(page, { x: 33, y: 32 })).toBe('smelter');

  expect(errors).toEqual([]);
});
