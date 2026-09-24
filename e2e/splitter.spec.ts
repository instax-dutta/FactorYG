import { test, expect } from '@playwright/test';
import {
  cellTypeAt,
  collectErrors,
  findPixelForCell,
  getCps,
  seedSave,
  setTool,
  waitForReady,
  type Cell,
} from './helpers';

/**
 * Browser smoke for the splitter: placeable through the real build panel, and
 * the fallback path earning through the real sim.
 *
 * The unit tests (tests/splitter.test.ts) own the routing rules. This spec owns
 * the two things only the browser can prove: the tool is in the panel and
 * clickable, and a splitter whose FACING exit is a dead end still earns through
 * its right exit — no income at all would mean the fallback is UI-broken.
 *
 * Fixture (copper node 22,24, same as every spec):
 *
 *   extractor(22,24)->E   belt(23,24)->E   splitter(24,24)->E
 *   splitter exits: east -> belt(25,24)->E dead end (blocked branch)
 *                   right/south -> depot(24,25)  (the only earner)
 */
const EXTRACTOR: Cell = { x: 22, y: 24 };
const FEED_BELT: Cell = { x: 23, y: 24 };
const SPLITTER: Cell = { x: 24, y: 24 };
const DEAD_END: Cell = { x: 25, y: 24 };
const DEPOT: Cell = { x: 24, y: 25 };

test('a splitter feeds its open exit when the facing one is blocked', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page);
  await page.goto('/');
  await waitForReady(page, errors);

  // Resolve every pixel FIRST: findPixelForCell presses Escape while probing,
  // which silently disarms an armed tool (the act-3 lesson).
  const px = {
    extractor: await findPixelForCell(page, EXTRACTOR),
    belt: await findPixelForCell(page, FEED_BELT),
    splitter: await findPixelForCell(page, SPLITTER),
    deadEnd: await findPixelForCell(page, DEAD_END),
    depot: await findPixelForCell(page, DEPOT),
  };

  // Everything faces east (splitter input from the west, exits east + south);
  // one 'r' turns the sticky rotation from N to E. Depots do not care.
  await page.keyboard.press('r');

  await setTool(page, 'extractor');
  await page.mouse.click(px.extractor.x, px.extractor.y);
  await setTool(page, 'belt');
  await page.mouse.click(px.belt.x, px.belt.y);
  await setTool(page, 'splitter');
  await page.mouse.click(px.splitter.x, px.splitter.y);
  await setTool(page, 'belt');
  await page.mouse.click(px.deadEnd.x, px.deadEnd.y);
  await setTool(page, 'depot');
  await page.mouse.click(px.depot.x, px.depot.y);

  // cellTypeAt takes PIXELS (it clicks), so verify through the resolved ones.
  expect(await cellTypeAt(page, px.splitter.x, px.splitter.y)).toBe('splitter');

  // The facing exit is a dead end, so every credit here arrived through the
  // splitter's right exit: fallback works end to end in the real sim.
  await expect
    .poll(() => getCps(page), { timeout: 20_000, intervals: [500] })
    .toBeGreaterThan(0);

  // Undo pops in reverse placement order: depot, dead-end belt, then the
  // splitter (whose removal exercises the removeAt cleanup path).
  await page.getByTestId('undo').click();
  expect(await cellTypeAt(page, px.depot.x, px.depot.y)).not.toBe('depot');
  await page.getByTestId('undo').click();
  expect(await cellTypeAt(page, px.deadEnd.x, px.deadEnd.y)).not.toBe('belt');
  await page.getByTestId('undo').click();
  expect(await cellTypeAt(page, px.splitter.x, px.splitter.y)).not.toBe('splitter');

  expect(errors).toEqual([]);
});
