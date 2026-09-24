import { test, expect, type Page } from '@playwright/test';
import {
  cellTypeAt,
  collectErrors,
  findPixelForCell,
  getCurrency,
  seedSave,
  setTool,
  waitForReady,
  type Cell,
} from './helpers';

/**
 * Fixing a built run without demolishing it: shift + drag relocates a placed
 * machine, and undo reverses any edit.
 *
 * The line here is the shortest one that can actually sell — extractor -> belt
 * -> depot — because the point is what happens to a *working* line when a
 * single belt in it is one cell off.
 */
const EXTRACTOR = { x: 22, y: 24 };
const BELT = { x: 23, y: 24 };
const DEPOT = { x: 24, y: 24 };
/** One cell south of the belt: off the line, so nothing can flow through it. */
const OFF_LINE = { x: 23, y: 25 };

/**
 * The machine in a *cell*. `cellTypeAt` clicks a pixel, so the cell has to be
 * resolved through the app's own projection first — which is what
 * `findPixelForCell` does.
 */
async function typeAtCell(page: Page, cell: Cell): Promise<string> {
  const pixel = await findPixelForCell(page, cell);
  return cellTypeAt(page, pixel.x, pixel.y);
}

async function cellPanel(page: Page, untypedCell: Cell): Promise<{ level: string; upgrade: string }> {
  const pixel = await findPixelForCell(page, untypedCell);
  await setTool(page, null);
  await page.mouse.click(pixel.x, pixel.y);
  await page.waitForTimeout(120);
  return {
    level: ((await page.getByTestId('info-level').textContent()) ?? '').trim(),
    upgrade: ((await page.getByTestId('upgrade-cost').textContent()) ?? '').trim(),
  };
}

async function shiftDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
}

test('shift-drag moves a belt off the line, and undo puts it back so the line sells again', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const pixels: Record<string, { x: number; y: number }> = {};
  for (const cell of [EXTRACTOR, BELT, DEPOT, OFF_LINE]) {
    pixels[`${cell.x},${cell.y}`] = await findPixelForCell(page, cell);
  }
  const at = (cell: Cell) => pixels[`${cell.x},${cell.y}`];

  // Rotation starts north; one press is 90° east, the direction this line wants
  // (the depot takes from any side).
  await setTool(page, 'extractor');
  await page.keyboard.press('r');
  await page.mouse.click(at(EXTRACTOR).x, at(EXTRACTOR).y);
  await setTool(page, 'belt');
  await page.mouse.click(at(BELT).x, at(BELT).y);
  await setTool(page, 'depot');
  await page.mouse.click(at(DEPOT).x, at(DEPOT).y);
  await setTool(page, null);

  expect(await typeAtCell(page, BELT)).toBe('belt');

  // The line works: an ore is worth 0.4, so any credits at all mean the depot
  // is being fed through that belt.
  await expect.poll(() => getCurrency(page), { timeout: 15_000 }).toBeGreaterThan(0);

  await shiftDrag(page, at(BELT), at(OFF_LINE));

  expect(await typeAtCell(page, BELT)).toBe('empty');
  expect(await typeAtCell(page, OFF_LINE)).toBe('belt');

  // Broken for real, not just relocated: the graph is cut, so nothing sells.
  const stalled = await getCurrency(page);
  await page.waitForTimeout(1_500);
  expect(await getCurrency(page)).toBe(stalled);

  // ⌘Z undoes the move. This is the whole feature: the belt is where it was,
  // without demolishing it (or anything behind it) and re-placing it.
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(300);

  expect(await typeAtCell(page, BELT)).toBe('belt');
  expect(await typeAtCell(page, OFF_LINE)).toBe('empty');
  await expect.poll(() => getCurrency(page), { timeout: 15_000 }).toBeGreaterThan(stalled);

  expect(errors).toEqual([]);
});

test('the undo button is disabled until there is an edit, then reverses it', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const undo = page.getByTestId('undo');
  await expect(undo).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(undo).toHaveAttribute('data-enabled', 'false');

  const belt = { x: 30, y: 30 };
  const pixel = await findPixelForCell(page, belt);
  await setTool(page, 'belt');
  await page.mouse.click(pixel.x, pixel.y);
  await expect(undo).toBeEnabled();
  await expect(undo).toHaveAttribute('data-enabled', 'true');
  expect(await typeAtCell(page, belt)).toBe('belt');

  // Clicking (not just the shortcut) removes the belt again.
  await page.getByTestId('undo').click();
  await page.waitForTimeout(200);
  expect(await typeAtCell(page, belt)).toBe('empty');
  await expect(undo).toBeDisabled();

  expect(errors).toEqual([]);
});

test('a demolish can be undone, restoring the machine at the level it had', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { currency: 5_000 });
  await page.goto('/');
  await waitForReady(page, errors);

  // An extractor, because it is the machine a level actually changes: belts
  // move one item per tick whatever their level, so they are not for sale.
  const extractor = { x: 22, y: 24 };
  const pixel = await findPixelForCell(page, extractor);
  await setTool(page, 'extractor');
  await page.mouse.click(pixel.x, pixel.y);
  await setTool(page, null);

  // Level it up first, so the undo has something to get wrong: a demolish that
  // restored a level-1 extractor would still pass a "the machine is back" check.
  expect(await cellPanel(page, extractor)).toEqual({ level: 'level 1', upgrade: 'Upgrade · 60 cr' });
  await page.getByTestId('upgrade').click();
  await page.waitForTimeout(120);
  expect((await cellPanel(page, extractor)).level).toBe('level 2');

  // Right-click demolishes, which is the destructive action undo exists for.
  await page.mouse.click(pixel.x, pixel.y, { button: 'right' });
  await page.waitForTimeout(200);
  expect(await typeAtCell(page, extractor)).toBe('empty');

  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(200);
  expect(await typeAtCell(page, extractor)).toBe('extractor');

  // The restored machine keeps its level, so undo put *the* machine back rather
  // than a fresh one in its cell.
  const restored = await cellPanel(page, extractor);
  expect(restored.level).toBe('level 2');
  expect(restored.upgrade).toBe('Upgrade · 114 cr');

  expect(errors).toEqual([]);
});
