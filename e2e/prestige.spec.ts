import { test, expect, type Page } from '@playwright/test';
import { SAVE_KEY } from '../src/config/constants';
import {
  cellTypeAt,
  collectErrors,
  findPixelForCell,
  getCurrency,
  seedSave,
  setTool,
  waitForReady,
} from './helpers';

/**
 * Slice 3.3: the two ways out of a bad factory, played through the real UI.
 *
 * Both are destructive, so both go through a confirmation, and the assertion
 * that matters is that the confirmation is what decides — the first click must
 * change nothing.
 */

const BELT = { x: 30, y: 30 };
const THRESHOLD = 25;

async function placeBelt(page: Page, cell = BELT): Promise<void> {
  const pixel = await findPixelForCell(page, cell);
  await setTool(page, 'belt');
  await page.mouse.click(pixel.x, pixel.y);
  await setTool(page, null);
}

/** The machine in a cell: `cellTypeAt` clicks a pixel, so resolve the cell first. */
async function typeAtCell(page: Page, cell: { x: number; y: number }): Promise<string> {
  const pixel = await findPixelForCell(page, cell);
  return cellTypeAt(page, pixel.x, pixel.y);
}

async function persistedBeltExists(page: Page): Promise<boolean> {
  return page.evaluate(({ key, cell }) => {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const save = JSON.parse(raw) as {
      grid?: { entities?: Array<{ type?: string; x?: number; y?: number }> };
    };
    return save.grid?.entities?.some(
      (entity) => entity.type === 'belt' && entity.x === cell.x && entity.y === cell.y,
    ) ?? false;
  }, { key: SAVE_KEY, cell: BELT });
}

test('below the threshold the prestige button is disabled and says how far off it is', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { lifetimeMotors: 10 });
  await page.goto('/');
  await waitForReady(page, errors);

  const prestige = page.getByTestId('prestige');
  await expect(page.getByTestId('prestige-panel')).toBeVisible();
  await expect(prestige).toBeDisabled();
  await expect(prestige).toHaveAttribute('data-enabled', 'false');
  await expect(page.getByTestId('prestige-label')).toHaveText('Prestige +0');
  await expect(page.getByTestId('prestige-detail')).toHaveText('sell 15 more motors');
  await expect(page.getByTestId('prestige-bonus')).toHaveText('no bonuses yet');
  await expect(page.getByTestId('prestige-cycles')).toHaveText('first run');

  // Disabled, so there is nothing to confirm either.
  await prestige.click({ force: true });
  await expect(page.getByTestId('confirm-modal')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('prestiging clears the factory, keeps the tree, and only after confirming', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { lifetimeMotors: THRESHOLD, currency: 4_000 });
  await page.goto('/');
  await waitForReady(page, errors);

  await placeBelt(page);
  expect(await typeAtCell(page, BELT)).toBe('belt');

  const prestige = page.getByTestId('prestige');
  await expect(prestige).toBeEnabled();
  await expect(page.getByTestId('prestige-label')).toHaveText('Prestige +1');
  await expect(page.getByTestId('prestige-bonus')).toHaveText('1 point · 1.25x speed · 1.5x sales');
  await expect(page.getByTestId('prestige-detail')).toHaveText(
    '1.25x speed, 1.5x sales after the reset',
  );

  // Asking is not doing: the factory is still there behind the modal.
  await prestige.click();
  await expect(page.getByTestId('confirm-modal')).toBeVisible();
  await expect(page.getByTestId('confirm-title')).toHaveText('Prestige for 1 point?');
  await expect(page.getByTestId('confirm-body')).toContainText('keeps points and the tech tree');
  await expect.poll(() => persistedBeltExists(page)).toBe(true);
  await page.getByTestId('confirm-no').click();
  await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
  expect(await typeAtCell(page, BELT)).toBe('belt');

  // Confirming is doing: the grid and the purse go, the cycle and the points stay.
  await prestige.click();
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
  await expect(page.getByTestId('prestige-cycles')).toHaveText('cycle 2');
  await expect(page.getByTestId('prestige-bonus')).toHaveText('1 point · 1.25x speed · 1.5x sales');
  await expect.poll(() => getCurrency(page), { timeout: 5_000 }).toBe(0);
  expect(await typeAtCell(page, BELT)).toBe('empty');

  // The tech tree survives a prestige, which is the whole reason to press it.
  await expect(page.getByTestId('tool-smelter')).toHaveAttribute('data-locked', 'false');

  // And it survives a reload: the points and the cycle are part of the save,
  // not just the running sim.
  await page.reload();
  await waitForReady(page, errors);
  await expect(page.getByTestId('prestige-cycles')).toHaveText('cycle 2');
  expect(await typeAtCell(page, BELT)).toBe('empty');

  expect(errors).toEqual([]);
});

test('start over wipes the save, including the points and the tree', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { lifetimeMotors: 50, totalPrestiges: 2, currency: 4_000 });
  await page.goto('/');
  await waitForReady(page, errors);

  await placeBelt(page);
  const prestige = page.getByTestId('prestige');
  await expect(page.getByTestId('prestige-cycles')).toHaveText('cycle 3');
  await expect(prestige).toBeDisabled();

  await page.getByTestId('reset').click();
  await expect(page.getByTestId('confirm-modal')).toBeVisible();
  await expect(page.getByTestId('confirm-title')).toHaveText('Start over from scratch?');
  await expect(page.getByTestId('confirm-body')).toContainText('no undo');
  await expect.poll(() => persistedBeltExists(page)).toBe(true);
  await page.getByTestId('confirm-no').click();
  expect(await typeAtCell(page, BELT)).toBe('belt');

  await page.getByTestId('reset').click();
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('confirm-modal')).toHaveCount(0);

  // A brand-new player: no motors, no points, no cycles, no currency, no grid.
  await expect(page.getByTestId('prestige-cycles')).toHaveText('first run');
  await expect(page.getByTestId('prestige-bonus')).toHaveText('no bonuses yet');
  await expect(page.getByTestId('prestige-detail')).toHaveText('sell 25 more motors');
  await expect(prestige).toBeDisabled();
  await expect.poll(() => getCurrency(page), { timeout: 5_000 }).toBe(0);
  expect(await typeAtCell(page, BELT)).toBe('empty');

  // A reload is what a player would actually do next, and it is the assertion
  // that catches a *half* wipe: if the prestige counters or the tree survived
  // `restart()`, the new player would still be holding them here. (It cannot
  // tell the save *ordering* apart — the save-on-unload rewrites it anyway —
  // which is why `clearSave` has its own unit test in `tests/save.test.ts`.)
  await page.reload();
  await waitForReady(page, errors);
  await expect(page.getByTestId('prestige-cycles')).toHaveText('first run');
  await expect(page.getByTestId('prestige')).toBeDisabled();
  expect(await typeAtCell(page, BELT)).toBe('empty');

  expect(errors).toEqual([]);
});
