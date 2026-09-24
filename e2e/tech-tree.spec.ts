import { test, expect } from '@playwright/test';
import {
  cellTypeAt,
  collectErrors,
  findPixelForCell,
  getCurrency,
  openTechPanel,
  seedSave,
  setTool,
  techStatus,
  toolLocked,
  waitForReady,
} from './helpers';

/** Slice 2.6: the tree gates the build panel, and buying a node opens it up. */

test('a fresh player starts with the Phase 1 machines and the smelter locked out of the rest', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await seedSave(page);
  await page.goto('/');
  await waitForReady(page, errors);

  for (const tool of ['extractor', 'belt', 'smelter', 'depot']) {
    expect(await toolLocked(page, tool), `${tool} should start unlocked`).toBe(false);
  }
  for (const tool of ['assembler', 'silo']) {
    expect(await toolLocked(page, tool), `${tool} should start locked`).toBe(true);
  }

  // And the first thing on screen says what the game is and what to do first: a
  // player used to get six buttons and no statement of the goal.
  await expect(page.getByTestId('goal-title')).toHaveText('Goal: sell a Motor');
  await expect(page.getByTestId('goal-detail')).toContainText(/Extractor/);

  await openTechPanel(page);

  // No credits yet, so the first node is visible but unaffordable.
  expect(await techStatus(page, 'assembler')).toBe('too expensive');
  expect(await page.getByTestId('tech-buy-assembler')).toBeDisabled();
  // Prerequisites read as the labels to chase, not as a dead end.
  expect(await techStatus(page, 'wire')).toBe('needs Assembler');
  expect(await techStatus(page, 'motor')).toBe('needs Circuit + Frame');
});

test('buying the assembler spends its price and opens the tool', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { currency: 100 });
  await page.goto('/');
  await waitForReady(page, errors);

  await expect.poll(() => getCurrency(page)).toBe(100);

  await openTechPanel(page);
  expect(await techStatus(page, 'assembler')).toBe('unlock');

  // A locked machine cannot even be armed, so it cannot be placed by accident.
  await expect(page.getByTestId('tool-silo')).toBeDisabled();

  await page.getByTestId('tech-buy-assembler').click();

  // Exactly the asking price, and the tool becomes usable in the same breath.
  await expect.poll(() => getCurrency(page)).toBe(25);
  expect(await toolLocked(page, 'assembler')).toBe(false);
  // Wire still needs 100, so the tree now reports it as unaffordable rather
  // than as missing a prerequisite: the requirement was satisfied, not ignored.
  await expect.poll(() => techStatus(page, 'wire')).toBe('too expensive');

  // Close the panel: it covers the middle of the map, and the point now is to
  // place the thing that was just bought.
  await page.getByTestId('tech-close').click();
  await expect(page.getByTestId('tech-panel')).toBeHidden();

  const target = { x: 27, y: 24 };
  const pixel = await findPixelForCell(page, target);
  expect(await cellTypeAt(page, pixel.x, pixel.y)).toBe('empty');

  await setTool(page, 'assembler');
  await page.mouse.click(pixel.x, pixel.y);
  await page.waitForTimeout(150);
  expect(await cellTypeAt(page, pixel.x, pixel.y)).toBe('assembler');

  // And the purchase survives a reload, so an unlock is not a per-session thing.
  await page.reload();
  await waitForReady(page, errors);
  expect(await toolLocked(page, 'assembler')).toBe(false);
  await expect.poll(() => getCurrency(page)).toBe(25);
  expect(await cellTypeAt(page, pixel.x, pixel.y)).toBe('assembler');
});
