import { test, expect } from '@playwright/test';
import {
  collectErrors,
  findPixelForCell,
  getCurrency,
  inspectCell,
  seedSave,
  setTool,
  waitForReady,
} from './helpers';
import { ALL_UNLOCKED } from '../src/sim/techTree';
import { MAX_MACHINE_LEVEL } from '../src/sim/upgrades';

/**
 * Slice 2.5: buying machine levels through the info panel. The extractor is
 * placed on a node with nothing downstream, so it never sells anything and the
 * purse only moves when an upgrade is bought — which makes the spend exact.
 */
const NODE = { x: 22, y: 24 };

/** Prices pinned by the stub curve in `upgrades.ts`. */
const PRICES = [60, 114, 217, 412];
const TOTAL_TO_MAX = PRICES.reduce((sum, price) => sum + price, 0);

async function placeExtractor(page: import('@playwright/test').Page): Promise<{
  x: number;
  y: number;
}> {
  await seedSave(page, {
    currency: 1_000,
    machines: [...ALL_UNLOCKED.machines],
    recipes: [...ALL_UNLOCKED.recipes],
  });
  await page.goto('/');
  await waitForReady(page, []);

  const pixel = await findPixelForCell(page, NODE);
  await setTool(page, 'extractor');
  await page.mouse.click(pixel.x, pixel.y);
  await page.waitForTimeout(120);
  await inspectCell(page, pixel.x, pixel.y);
  return pixel;
}

const level = async (page: import('@playwright/test').Page): Promise<string> =>
  ((await page.getByTestId('info-level').textContent()) ?? '').trim();

const throughput = async (page: import('@playwright/test').Page): Promise<string> =>
  ((await page.getByTestId('info-throughput').textContent()) ?? '').trim();

test('buying a level spends its price and speeds the machine up', async ({ page }) => {
  const errors = collectErrors(page);
  const pixel = await placeExtractor(page);

  expect(await level(page)).toBe('level 1');
  expect(await throughput(page)).toBe('1.0 item/s');
  expect(await page.getByTestId('upgrade-cost').textContent()).toBe('Upgrade · 60 cr');
  await expect.poll(() => getCurrency(page)).toBe(1_000);

  await page.getByTestId('upgrade').click();

  // Exactly the price, and the readout follows the level: 10tps / 10 ticks * 1.25.
  await expect.poll(() => getCurrency(page)).toBe(1_000 - PRICES[0]);
  expect(await level(page)).toBe('level 2');
  await expect.poll(() => throughput(page)).toBe('1.3 item/s');
  expect(await page.getByTestId('upgrade-cost').textContent()).toBe('Upgrade · 114 cr');

  // A level is a property of the machine, so a reload keeps it.
  await page.reload();
  await waitForReady(page, errors);
  await inspectCell(page, pixel.x, pixel.y);
  expect(await level(page)).toBe('level 2');
  expect(await throughput(page)).toBe('1.3 item/s');
  await expect.poll(() => getCurrency(page)).toBe(1_000 - PRICES[0]);
});

test('a machine a level cannot speed up is not offered one', async ({ page }) => {
  await seedSave(page, {
    currency: 1_000,
    machines: [...ALL_UNLOCKED.machines],
    recipes: [...ALL_UNLOCKED.recipes],
  });
  await page.goto('/');
  await waitForReady(page, []);

  // A belt moves one item per tick at any level, so there is nothing to sell
  // here and the panel must not pretend otherwise.
  const belt = { x: 23, y: 24 };
  const pixel = await findPixelForCell(page, belt);
  await setTool(page, 'belt');
  await page.mouse.click(pixel.x, pixel.y);
  await page.waitForTimeout(120);
  await inspectCell(page, pixel.x, pixel.y);

  expect(((await page.getByTestId('info-level').textContent()) ?? '').trim()).toBe('level 1');
  expect(await page.getByTestId('upgrade-cost').textContent()).toBe('not upgradeable');
  await expect(page.getByTestId('upgrade')).toHaveCount(0);
});

test('a machine can be taken to the cap, and there is nothing left to buy', async ({ page }) => {
  const errors = collectErrors(page);
  const pixel = await placeExtractor(page);
  let purse = 1_000;

  for (const price of PRICES) {
    expect(await page.getByTestId('upgrade-cost').textContent()).toBe(`Upgrade · ${price} cr`);
    await page.getByTestId('upgrade').click();
    purse -= price;
    await expect.poll(() => getCurrency(page)).toBe(purse);
  }

  expect(await level(page)).toBe(`level ${MAX_MACHINE_LEVEL}`);
  // 1.0 + 4 steps of 0.25.
  expect(await throughput(page)).toBe('2.0 item/s');

  // At the cap the button is gone rather than disabled: there is no price to
  // quote, so there is no offer to make.
  await expect(page.getByTestId('upgrade')).toHaveCount(0);
  expect(await page.getByTestId('upgrade-cost').textContent()).toBe('max level');
  expect(purse).toBe(1_000 - TOTAL_TO_MAX);

  await page.reload();
  await waitForReady(page, errors);
  await inspectCell(page, pixel.x, pixel.y);
  expect(await level(page)).toBe(`level ${MAX_MACHINE_LEVEL}`);
  expect(await page.getByTestId('upgrade-cost').textContent()).toBe('max level');
});
