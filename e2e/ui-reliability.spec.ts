import { test, expect, type Page } from '@playwright/test';
import { MOTOR_THRESHOLD, SAVE_KEY, SAVE_VERSION } from '../src/config/constants';
import { startingUnlocks } from '../src/sim/techTree';
import {
  collectErrors,
  findPixelForCell,
  getCurrency,
  seedSave,
  setTool,
  waitForReady,
} from './helpers';

async function seedOfflineSave(page: Page, throughput = 0.5): Promise<void> {
  const starting = startingUnlocks();
  const save = {
    version: SAVE_VERSION,
    lastSavedAt: Date.now() - 120_000,
    currency: 0,
    prestige: {
      lifetimeMotors: MOTOR_THRESHOLD,
      points: 1,
      claimedPoints: 0,
      totalPrestiges: 0,
      permanentMultipliers: {
        productionSpeed: 1.25,
        sellValue: 1.5,
      },
    },
    unlocked: starting,
    grid: { width: 64, height: 64, entities: [], expansionsBought: 0 },
    productionChains: {
      'sold-motor': { steadyStateThroughput: throughput, outputResource: 'motor' },
    },
  };
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [SAVE_KEY, JSON.stringify(save)] as [string, string],
  );
}

type StoredSave = {
  lastSavedAt: number;
  grid: {
    entities: Array<{ x: number; y: number; type: string }>;
  };
};

async function readStoredSave(page: Page): Promise<StoredSave> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('missing save');
    return JSON.parse(raw) as {
      lastSavedAt: number;
      grid: { entities: Array<{ x: number; y: number; type: string }> };
    };
  }, SAVE_KEY);
}

async function failSaveWrites(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(name: string, value: string): void {
      if (name === key) throw new DOMException('storage full', 'QuotaExceededError');
      original.call(this, name, value);
    };
  }, SAVE_KEY);
}

async function delayFirstGpuProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async (): Promise<null> => {
          calls += 1;
          if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 3_000));
          return null;
        },
      },
    });
  });
}

async function contrastRatio(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).evaluate((element) => {
    type Rgba = [number, number, number, number];
    const parse = (value: string): Rgba => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const blend = (front: Rgba, back: Rgba): Rgba => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (front[0] * front[3] + back[0] * back[3] * (1 - front[3])) / alpha,
        (front[1] * front[3] + back[1] * back[3] * (1 - front[3])) / alpha,
        (front[2] * front[3] + back[2] * back[3] * (1 - front[3])) / alpha,
        alpha,
      ];
    };
    const layers: Rgba[] = [];
    let inheritedOpacity = 1;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      inheritedOpacity *= Number(style.opacity);
      const background = parse(style.backgroundColor);
      if (background[3] > 0) layers.push(background);
    }
    let background = parse(getComputedStyle(document.body).backgroundColor);
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      background = blend(layers[index], background);
    }
    const foreground = parse(getComputedStyle(element).color);
    const solidForeground = blend(
      [foreground[0], foreground[1], foreground[2], foreground[3] * inheritedOpacity],
      background,
    );
    const luminance = (color: Rgba): number => {
      const linear = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const lighter = Math.max(luminance(solidForeground), luminance(background));
    const darker = Math.min(luminance(solidForeground), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  });
}

test('Dialog locks the narrow-layout app shell while open', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await seedSave(page, { lifetimeMotors: MOTOR_THRESHOLD });
  await page.goto('/');
  await waitForReady(page, errors);

  const shell = page.locator('.app-shell');
  await shell.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.getByTestId('reset').click();
  await expect(page.getByTestId('confirm-modal')).toBeVisible();
  expect(await shell.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await shell.evaluate((element) => {
    element.scrollTop = 0;
  });
  const before = await shell.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 500);

  expect(await shell.evaluate((element) => element.scrollTop)).toBe(before);
  expect(errors).toEqual([]);
});

test('dialog contains prestige confirmation focus and restores the opener', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { lifetimeMotors: MOTOR_THRESHOLD });
  await page.goto('/');
  await waitForReady(page, errors);
  await page.evaluate(() => {
    document.body.style.overflow = 'auto';
  });

  const opener = page.getByTestId('reset');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Start over from scratch?' });
  const confirm = page.getByTestId('confirm-yes');
  const cancel = page.getByTestId('confirm-no');

  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  const width = await dialog.evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(0);
  expect(width).toBeLessThanOrEqual(296);
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const titleId = await page.getByTestId('confirm-title').getAttribute('id');
  expect(titleId).toBeTruthy();
  await expect(dialog).toHaveAttribute('aria-labelledby', titleId as string);
  expect(await dialog.evaluate((element) => element.parentElement?.parentElement === document.body)).toBe(true);
  expect(await page.getByTestId('confirm-modal').evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThanOrEqual(100);
  await expect(confirm).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();

  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('auto');
  expect(errors).toEqual([]);
});

test('dialog contains focus after a non-dismissible backdrop click and Escape restores the opener', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { lifetimeMotors: MOTOR_THRESHOLD });
  await page.goto('/');
  await waitForReady(page, errors);

  const opener = page.getByTestId('reset');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Start over from scratch?' });
  const confirm = page.getByTestId('confirm-yes');
  const cancel = page.getByTestId('confirm-no');
  await expect(dialog).toBeVisible();

  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  const outside = page.getByTestId('tech-toggle');
  await outside.focus();
  await expect(outside).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(errors).toEqual([]);
});

test('dialog keeps offline focus in the summary and supports backdrop dismissal', async ({ page }) => {
  const errors = collectErrors(page);
  await seedOfflineSave(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  const dismiss = page.getByTestId('offline-dismiss');
  await expect(dialog).toBeVisible();
  await expect(dismiss).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dismiss).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dismiss).toBeFocused();

  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('dialog keeps offline Escape dismissal and restores page focus', async ({ page }) => {
  const errors = collectErrors(page);
  await seedOfflineSave(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  const dismiss = page.getByTestId('offline-dismiss');
  await expect(dismiss).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('body')).toBeFocused();
  expect(errors).toEqual([]);
});

test('Tech Escape closes the non-modal panel and returns focus without trapping', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const tech = page.getByTestId('tech-toggle');
  const panel = page.getByTestId('tech-panel');
  await tech.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveAttribute('role', 'dialog');
  await expect(panel).not.toHaveAttribute('aria-modal', 'true');
  await page.getByTestId('tech-close').focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(tech).toBeFocused();
  expect(errors).toEqual([]);
});

test('Tech lets focus leave the open panel in both directions', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const tech = page.getByTestId('tech-toggle');
  const panel = page.getByTestId('tech-panel');
  await tech.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();

  const focusIsInsideTech = async (): Promise<boolean> =>
    page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="tech-panel"]');
      return element?.contains(document.activeElement) ?? false;
    });

  await page.getByTestId('tech-close').focus();
  await page.keyboard.press('Tab');
  expect(await focusIsInsideTech()).toBe(false);
  await expect(panel).toBeVisible();

  await page.getByTestId('tech-close').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await focusIsInsideTech()).toBe(false);
  await expect(panel).toBeVisible();
  expect(errors).toEqual([]);
});

test('pause stops production and publishes accurate save lifecycle', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const cells = [
    { x: 22, y: 24 },
    { x: 23, y: 24 },
    { x: 24, y: 24 },
    { x: 25, y: 24 },
  ];
  const pixels = [];
  for (const cell of cells) pixels.push(await findPixelForCell(page, cell));

  await setTool(page, 'extractor');
  await page.keyboard.press('r');
  await page.mouse.click(pixels[0].x, pixels[0].y);
  await setTool(page, 'belt');
  await page.mouse.click(pixels[1].x, pixels[1].y);
  await page.mouse.click(pixels[2].x, pixels[2].y);
  await setTool(page, 'depot');
  await page.mouse.click(pixels[3].x, pixels[3].y);
  await setTool(page, null);
  await expect.poll(() => getCurrency(page), { timeout: 30_000 }).toBeGreaterThan(0);

  const pause = page.getByTestId('pause-toggle');
  const saveStatus = page.getByTestId('save-status');
  await expect(pause).toHaveText('Pause');
  await pause.click();
  await expect(pause).toHaveText('Resume');
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('toasts')).toContainText('Factory paused');
  await expect(saveStatus).toHaveAttribute('data-status', 'saved');

  const pausedSave = await readStoredSave(page);
  expect(Number(await saveStatus.getAttribute('data-last-saved-at'))).toBe(pausedSave.lastSavedAt);
  const pausedCurrency = await getCurrency(page);
  await page.waitForTimeout(2_500);
  expect(await getCurrency(page)).toBe(pausedCurrency);

  await pause.click();
  await expect(pause).toHaveText('Pause');
  await expect(pause).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('toasts')).toContainText('Factory resumed');
  await expect.poll(() => getCurrency(page), { timeout: 15_000 }).toBeGreaterThan(pausedCurrency);
  expect(errors).toEqual([]);
});

test('immediate edit save persists placement and demolition before autosave', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page);
  await page.goto('/');
  await waitForReady(page, errors);
  await page.getByTestId('pause-toggle').click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  const node = await findPixelForCell(page, { x: 22, y: 24 });
  await setTool(page, 'extractor');
  await page.keyboard.press('r');

  const beforePlacement = await readStoredSave(page);
  const placementStarted = Date.now();
  await page.mouse.click(node.x, node.y);
  await expect
    .poll(async () => (await readStoredSave(page)).grid.entities.some(
      (entity) => entity.x === 22 && entity.y === 24 && entity.type === 'extractor',
    ), { timeout: 4_500 })
    .toBe(true);
  const afterPlacement = await readStoredSave(page);
  expect(afterPlacement.lastSavedAt).toBeGreaterThan(beforePlacement.lastSavedAt);
  expect(Date.now() - placementStarted).toBeLessThan(4_500);

  await page.waitForTimeout(10);
  const beforeDemolition = afterPlacement;
  const demolitionStarted = Date.now();
  await page.mouse.click(node.x, node.y, { button: 'right' });
  await expect
    .poll(async () => (await readStoredSave(page)).grid.entities.some(
      (entity) => entity.x === 22 && entity.y === 24,
    ), { timeout: 4_500 })
    .toBe(false);
  const afterDemolition = await readStoredSave(page);
  expect(afterDemolition.lastSavedAt).toBeGreaterThan(beforeDemolition.lastSavedAt);
  expect(Date.now() - demolitionStarted).toBeLessThan(4_500);
  expect(errors).toEqual([]);
});

test('stale StrictMode scene disposal cannot overwrite the active scene or actions', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page);
  await delayFirstGpuProbe(page);
  await page.goto('/');
  await waitForReady(page, errors);
  await page.getByTestId('pause-toggle').click();
  await setTool(page, 'belt');
  await page.mouse.click(640, 360);
  await expect
    .poll(async () => (await readStoredSave(page)).grid.entities.some((entity) => entity.type === 'belt'))
    .toBe(true);

  await page.waitForTimeout(3_500);
  expect((await readStoredSave(page)).grid.entities.some((entity) => entity.type === 'belt')).toBe(true);
  await page.getByTestId('undo').click();
  await expect
    .poll(async () => (await readStoredSave(page)).grid.entities.some((entity) => entity.type === 'belt'))
    .toBe(false);
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('toast messages replace placement refusal Tech purchase and pause feedback', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { currency: 40 });
  await page.goto('/');
  await waitForReady(page, errors);

  const empty = await findPixelForCell(page, { x: 30, y: 30 });
  await setTool(page, 'extractor');
  await page.mouse.click(empty.x, empty.y);
  await expect(page.getByTestId('toasts')).toContainText('Extractor needs a resource node');
  await expect(page.getByTestId('toast-message')).toHaveCount(1);

  await page.getByTestId('tech-toggle').click();
  await page.getByTestId('tech-buy-refinedStone').click();
  await expect(page.getByTestId('toasts')).toContainText('Unlocked Refined Stone');
  await expect(page.getByTestId('toast-message')).toHaveCount(1);

  await page.getByTestId('pause-toggle').click();
  await expect(page.getByTestId('toasts')).toContainText('Factory paused');
  await expect(page.getByTestId('toast-message')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('save failure is visible and recoverable without an uncaught error', async ({ page }) => {
  const errors = collectErrors(page);
  await failSaveWrites(page);
  await page.goto('/');
  await waitForReady(page, errors);

  await page.getByTestId('pause-toggle').click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('save-status')).toHaveText('Save failed');
  await expect(page.getByTestId('toasts')).toContainText('Save failed');
  expect(errors).toEqual([]);
});

test('restart clears state and reports failure when storage removal throws', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { currency: 321 });
  await page.goto('/');
  await waitForReady(page, errors);
  await page.evaluate((key) => {
    const originalRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function removeItem(name: string): void {
      if (name === key) throw new DOMException('storage locked', 'SecurityError');
      originalRemove.call(this, name);
    };
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(name: string, value: string): void {
      if (name === key) throw new DOMException('storage full', 'QuotaExceededError');
      originalSet.call(this, name, value);
    };
  }, SAVE_KEY);

  await page.getByTestId('reset').click();
  await page.getByTestId('confirm-yes').click();

  await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
  await expect(page.getByTestId('currency')).toHaveText('0 cr');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('toasts')).toContainText('Save failed');
  expect(errors).toEqual([]);
});

test('recovered save toast is shown once through the non-obscuring layer', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, '{broken save');
  }, SAVE_KEY);
  await page.goto('/');
  await waitForReady(page, errors);

  const toasts = page.getByTestId('toasts');
  await expect(toasts).toContainText('Recovered from an unreadable save');
  await expect(page.getByTestId('toast-message')).toHaveCount(1);
  await expect(toasts).toHaveCSS('pointer-events', 'none');
  expect(errors).toEqual([]);
});

test('offline modal preserves fractional item amounts', async ({ page }) => {
  const errors = collectErrors(page);
  await seedOfflineSave(page, 0.005);
  await page.goto('/');
  await waitForReady(page, errors);

  await expect(page.getByTestId('offline-dialog')).toContainText(/Motor × 0\.6/);
  expect(errors).toEqual([]);
});

test('resource label formatting covers legend and offline gains', async ({ page }) => {
  const errors = collectErrors(page);
  await seedOfflineSave(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const legend = page.getByTestId('node-legend');
  await expect(legend.getByText('Copper Ore', { exact: true })).toBeVisible();
  await expect(legend.getByText('Iron Ore', { exact: true })).toBeVisible();
  await expect(legend).not.toContainText('copperOre');
  const dialog = page.getByTestId('offline-dialog');
  await expect(dialog).toContainText('Motor');
  expect((await dialog.textContent()) ?? '').not.toMatch(/\bmotor\b/);
  expect(errors).toEqual([]);
});

test('locked tool copy and muted status text meet contrast without backend debug copy', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { currency: 100 });
  await page.goto('/');
  await waitForReady(page, errors);

  const assembler = page.getByTestId('tool-assembler');
  const silo = page.getByTestId('tool-silo');
  await expect(assembler).toHaveText('Assembler · 75 cr · 100 cr purse · ready in Tech');
  await expect(assembler).toHaveAttribute('title', /100 cr purse/);
  await expect(assembler).toHaveAttribute('data-affordable', 'true');
  await expect(silo).toHaveText('Storage Silo · 150 cr · 100 cr purse · needs 50 cr + Assembler in Tech');
  await expect(silo).toHaveAttribute('data-affordable', 'false');

  expect(await contrastRatio(page, 'tool-assembler')).toBeGreaterThanOrEqual(4.5);
  expect(await contrastRatio(page, 'save-status')).toBeGreaterThanOrEqual(4.5);
  await expect(page.getByTestId('backend')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('webgl2');
  expect(errors).toEqual([]);
});
