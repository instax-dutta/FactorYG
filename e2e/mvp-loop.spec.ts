import { test, expect, type Page } from '@playwright/test';
import { SAVE_KEY } from '../src/config/constants';
import {
  cellTypeAt,
  collectErrors,
  findPixelForCell,
  getCurrency,
  setTool,
  waitForReady,
  type Cell,
} from './helpers';

/** The copper node at (22,24) and the three cells east of it. */
const CHAIN: Cell[] = [
  { x: 22, y: 24 },
  { x: 23, y: 24 },
  { x: 24, y: 24 },
  { x: 25, y: 24 },
];

async function buildChain(page: Page): Promise<Record<string, { x: number; y: number }>> {
  const pixels: Record<string, { x: number; y: number }> = {};
  for (const cell of CHAIN) {
    pixels[`${cell.x},${cell.y}`] = await findPixelForCell(page, cell);
  }

  const [node, belt1, belt2, depot] = CHAIN.map((cell) => pixels[`${cell.x},${cell.y}`]);

  // Extractors and belts must face east (+x) to connect; one R press is 90°.
  await setTool(page, 'extractor');
  await page.keyboard.press('r');
  await page.mouse.click(node.x, node.y);

  await setTool(page, 'belt');
  await page.mouse.click(belt1.x, belt1.y);
  await page.mouse.click(belt2.x, belt2.y);

  await setTool(page, 'depot');
  await page.mouse.click(depot.x, depot.y);
  await setTool(page, null);

  return pixels;
}

test('extractor -> belt -> depot produces currency', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const pixels = await buildChain(page);

  expect(await cellTypeAt(page, pixels['22,24'].x, pixels['22,24'].y)).toBe('extractor');
  expect(await cellTypeAt(page, pixels['23,24'].x, pixels['23,24'].y)).toBe('belt');
  expect(await cellTypeAt(page, pixels['24,24'].x, pixels['24,24'].y)).toBe('belt');
  expect(await cellTypeAt(page, pixels['25,24'].x, pixels['25,24'].y)).toBe('depot');

  // The chain must actually reach the depot: 10 ticks of extraction, then one
  // cell per tick, then a sale.
  await expect.poll(() => getCurrency(page), { timeout: 30_000 }).toBeGreaterThan(0);

  await page.mouse.click(pixels['22,24'].x, pixels['22,24'].y);
  await expect(page.getByTestId('info-chain')).toHaveText('feeding depot');
  await expect(page.getByTestId('info-throughput')).toHaveText('1.0 item/s');

  // Right-click demolishing mid-chain stops the deliveries.
  await page.mouse.click(pixels['23,24'].x, pixels['23,24'].y, { button: 'right' });
  await expect
    .poll(async () => cellTypeAt(page, pixels['23,24'].x, pixels['23,24'].y), { timeout: 5000 })
    .toBe('empty');

  expect(errors).toEqual([]);
});

/** Drives the app's real visibility listener from the test. */
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { value: next, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('a hidden tab pauses the factory and credits the time away', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForReady(page, errors);
  await buildChain(page);
  await expect.poll(() => getCurrency(page), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect
    .poll(async () => page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return 0;
      const save = JSON.parse(raw) as {
        productionChains?: Record<string, { steadyStateThroughput: number }>;
      };
      return save.productionChains?.['sold-copperOre']?.steadyStateThroughput ?? 0;
    }, SAVE_KEY), { timeout: 15_000 })
    .toBeGreaterThan(0);

  const before = await getCurrency(page);
  await setVisibility(page, 'hidden');
  await page.waitForTimeout(5000);

  // Paused means paused: not one tick of production while hidden.
  expect(await getCurrency(page)).toBe(before);

  await setVisibility(page, 'visible');

  // Credits land with the visibility event, so this reads the credit rather
  // than the resumed factory (~0.04 cr in the same window).
  await expect.poll(() => getCurrency(page), { timeout: 1500 }).toBeGreaterThanOrEqual(before + 1);

  // Five seconds at 0.4 cr/s is about two credits: a pause credited as the
  // whole session (or as elapsed wall time) would be far larger than this.
  const credited = (await getCurrency(page)) - before;
  expect(credited).toBeGreaterThanOrEqual(1);
  expect(credited).toBeLessThan(6);

  // A five second pause is well under the welcome-back threshold.
  await expect(page.getByTestId('offline-modal')).toBeHidden();

  // And the factory is running again.
  await expect.poll(() => getCurrency(page), { timeout: 30_000 }).toBeGreaterThan(before + 1);
  expect(errors).toEqual([]);
});

test('progress survives a reload', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page);
  const pixels = await buildChain(page);
  await expect.poll(() => getCurrency(page), { timeout: 30_000 }).toBeGreaterThan(0);

  const before = await getCurrency(page);

  // A reload must save on the way out and load the factory back in.
  await page.reload();
  await waitForReady(page);

  expect(await cellTypeAt(page, pixels['22,24'].x, pixels['22,24'].y)).toBe('extractor');
  expect(await cellTypeAt(page, pixels['25,24'].x, pixels['25,24'].y)).toBe('depot');
  expect(await getCurrency(page)).toBeGreaterThanOrEqual(before);
  await expect.poll(() => getCurrency(page), { timeout: 30_000 }).toBeGreaterThan(before);
});

test('welcome-back modal reports capped offline gains', async ({ page, browser }) => {
  await page.goto('/');
  await waitForReady(page);
  await buildChain(page);
  await expect.poll(() => getCurrency(page), { timeout: 30_000 }).toBeGreaterThan(0);

  // Wait for an autosave that actually contains the chain. A save of the empty
  // starting factory already exists (the initial mount disposes and saves), so
  // polling for any save at all would backdate a factory with nothing in it.
  await expect
    .poll(async () => {
      const raw = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
      if (!raw) return 0;
      const stored = JSON.parse(raw) as { productionChains?: Record<string, unknown> };
      return Object.keys(stored.productionChains ?? {}).length;
    }, { timeout: 45_000 })
    .toBeGreaterThan(0);

  // Backdate it by 8h in a fresh context, so the unload-time save cannot
  // overwrite the timestamp we are testing with.
  const saved = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect(saved).not.toBeNull();

  const backdated = JSON.stringify({
    ...(JSON.parse(saved as string) as Record<string, unknown>),
    lastSavedAt: Date.now() - 8 * 3600 * 1000,
  });

  // This page has served its purpose; close it so the returning page is not
  // competing with a second live software-rendered WebGL context.
  const url = page.url();
  await page.close();

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [SAVE_KEY, backdated] as [string, string],
  );
  const returning = await context.newPage();
  const returningErrors = collectErrors(returning);
  await returning.goto(url);
  await waitForReady(returning, returningErrors);

  await expect(returning.getByTestId('offline-modal')).toBeVisible();
  await expect(returning.getByTestId('offline-elapsed')).toContainText('8h 0m');
  // 8h of credit at 1 ore/sec and 0.4 cr/ore.
  await expect(returning.getByTestId('offline-total')).toContainText('11,520');

  await returning.getByTestId('offline-dismiss').click();
  await expect(returning.getByTestId('offline-modal')).toBeHidden();
  expect(await getCurrency(returning)).toBeGreaterThanOrEqual(11520);

  await context.close();
});
