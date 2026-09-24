import { expect, test, type Page } from '@playwright/test';
import { SAVE_KEY, collectErrors, seedSave, waitForReady } from './helpers';

async function readEntities(page: Page): Promise<Array<{ x: number; y: number; type: string }>> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key as string);
    if (!raw) return [];
    const save = JSON.parse(raw) as { grid?: { entities?: Array<{ x: number; y: number; type: string }> } };
    return save.grid?.entities ?? [];
  }, SAVE_KEY);
}

test('canvas keyboard map navigates, inspects, places, rotates, and demolishes', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const canvas = page.locator('canvas');
  const status = page.getByTestId('keyboard-status');
  const rotation = page.getByTestId('rotation');
  await expect(canvas).toHaveAttribute('tabindex', '0');
  await expect(canvas).toHaveAttribute('aria-label', /factory/i);
  await page.keyboard.press('Tab');
  await expect(canvas).toBeFocused();
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toContainText('Cell 32, 32');
  await expect(status).toContainText('Selected machine: empty');
  await expect(canvas).toHaveAttribute('data-keyboard-cursor-visible', 'true');

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await expect(status).toContainText('Cell 31, 31');
  await page.keyboard.press('Enter');
  await expect(status).toContainText('Selected machine: empty');

  await page.getByTestId('tool-extractor').click();
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect(status).toContainText('Placement refused: Extractor needs a resource node');
  await page.keyboard.press('Escape');
  await expect(status).toContainText('Tool: none');

  await page.getByTestId('tool-belt').focus();
  await page.keyboard.press('r');
  await expect(rotation).toHaveText('N');
  await page.getByTestId('tool-belt').click();
  await canvas.focus();
  await page.keyboard.press('r');
  await expect(rotation).toHaveText('E');
  await page.keyboard.press('Enter');
  await expect(status).toContainText('Placed Belt');
  await expect(page.getByTestId('placement-status')).toHaveText('Disconnected - this machine will idle');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 31 && entity.y === 31 && entity.type === 'belt')).toBe(true);

  await page.keyboard.press('Escape');
  await expect(canvas).toBeFocused();
  await expect(status).toContainText('Tool: none');
  await page.keyboard.press('Enter');
  await expect(status).toContainText('Selected machine: Belt');
  await page.keyboard.press('x');
  await expect(status).toContainText('Demolished Belt');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 31 && entity.y === 31 && entity.type === 'belt')).toBe(false);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 31 && entity.y === 31 && entity.type === 'belt')).toBe(true);
  await page.getByTestId('undo').click();
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 31 && entity.y === 31 && entity.type === 'belt')).toBe(false);
  await canvas.focus();
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
  }
  await expect(status).toContainText('Cell 0, 0');
  expect(errors).toEqual([]);
});

test('global map shortcuts do not fire from dialogs or controls', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { lifetimeMotors: 25 });
  await page.goto('/');
  await waitForReady(page, errors);

  const canvas = page.locator('canvas');
  const status = page.getByTestId('keyboard-status');
  const rotation = page.getByTestId('rotation');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(status).toContainText('Cell 33, 32');
  await page.getByTestId('tool-belt').click();
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect(status).toContainText('Placed Belt');

  const tool = page.getByTestId('tool-belt');
  await tool.focus();
  await page.keyboard.press('r');
  await expect(rotation).toHaveText('N');
  await page.keyboard.press('Escape');
  await expect(status).toContainText('Tool: Belt');

  await page.getByTestId('reset').click();
  await expect(page.getByTestId('confirm-modal')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('r');
  await page.keyboard.press('x');
  await expect(page.getByTestId('confirm-modal')).toBeVisible();
  await expect(rotation).toHaveText('N');
  await expect(status).toContainText('Cell 33, 32');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 33 && entity.y === 32 && entity.type === 'belt')).toBe(true);
  expect(errors).toEqual([]);
});

test('modified map keys are ignored and Ctrl/Cmd+Z still undoes', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const canvas = page.locator('canvas');
  const status = page.getByTestId('keyboard-status');
  const rotation = page.getByTestId('rotation');
  await canvas.focus();
  await page.getByTestId('tool-belt').click();
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 32 && entity.y === 32 && entity.type === 'belt')).toBe(true);
  await page.keyboard.press('Escape');

  const defaults = await page.evaluate(() => {
    const target = document.querySelector('canvas');
    if (!target) throw new Error('canvas missing');
    const keys = ['r', 'x', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '];
    const modifiers = [
      { ctrlKey: true, metaKey: false, altKey: false },
      { ctrlKey: false, metaKey: true, altKey: false },
      { ctrlKey: false, metaKey: false, altKey: true },
    ];
    return modifiers.flatMap((modifier) =>
      keys.map((key) => {
        const event = new KeyboardEvent('keydown', {
          ...modifier,
          key,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    );
  });

  expect(defaults.every((prevented) => !prevented)).toBe(true);
  await expect(rotation).toHaveText('N');
  await expect(status).toContainText('Cell 32, 32');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 32 && entity.y === 32 && entity.type === 'belt')).toBe(true);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 32 && entity.y === 32 && entity.type === 'belt')).toBe(false);
  await page.getByTestId('tool-belt').click();
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 32 && entity.y === 32 && entity.type === 'belt')).toBe(true);
  const metaUndoPrevented = await page.evaluate(() => {
    const target = document.querySelector('canvas');
    if (!target) throw new Error('canvas missing');
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(metaUndoPrevented).toBe(true);
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 32 && entity.y === 32 && entity.type === 'belt')).toBe(false);
  expect(errors).toEqual([]);
});

test('Space mirrors Enter for inspect and place and prevents page scroll', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const canvas = page.locator('canvas');
  const status = page.getByTestId('keyboard-status');
  await canvas.focus();
  const initialScroll = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => {
    const target = document.querySelector('canvas');
    if (!target) throw new Error('canvas missing');
    target.addEventListener('keydown', (event) => {
      if (event.key === ' ') {
        (window as Window & { __task9SpacePrevented?: boolean }).__task9SpacePrevented = event.defaultPrevented;
      }
    }, { once: true });
  });
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => (window as Window & { __task9SpacePrevented?: boolean }).__task9SpacePrevented)).toBe(true);
  await expect(status).toContainText('Selected machine: empty');

  await page.getByTestId('tool-belt').click();
  await canvas.focus();
  await page.evaluate(() => {
    const target = document.querySelector('canvas');
    if (!target) throw new Error('canvas missing');
    target.addEventListener('keydown', (event) => {
      if (event.key === ' ') {
        (window as Window & { __task9SpacePrevented?: boolean }).__task9SpacePrevented = event.defaultPrevented;
      }
    }, { once: true });
  });
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => (window as Window & { __task9SpacePrevented?: boolean }).__task9SpacePrevented)).toBe(true);
  await expect(status).toContainText('Placed Belt');
  await expect(page.getByTestId('placement-status')).toHaveText('Disconnected - this machine will idle');
  expect(await page.getByTestId('placement-status').evaluate(() =>
    Array.from(document.querySelectorAll('[aria-live="polite"]')).filter((live) => live.textContent?.includes('Disconnected - this machine will idle')).length,
  )).toBe(1);
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 32 && entity.y === 32 && entity.type === 'belt')).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);
  expect(errors).toEqual([]);
});

test('Tech owns Escape and disables background map keys', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForReady(page, errors);

  const canvas = page.locator('canvas');
  const status = page.getByTestId('keyboard-status');
  const rotation = page.getByTestId('rotation');
  const tech = page.getByTestId('tech-toggle');
  const panel = page.getByTestId('tech-panel');
  await canvas.focus();
  await page.getByTestId('tool-belt').click();
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 32 && entity.y === 32 && entity.type === 'belt')).toBe(true);
  await tech.click();
  await expect(panel).toBeVisible();
  await canvas.focus();

  await page.keyboard.press('r');
  await expect(rotation).toHaveText('N');
  await page.keyboard.press('x');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 32 && entity.y === 32 && entity.type === 'belt')).toBe(true);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(panel).toBeVisible();
  await expect(status).toContainText('Cell 32, 32');
  await expect(status).toContainText('Tool: Belt');
  await expect.poll(async () => (await readEntities(page)).some((entity) => entity.x === 32 && entity.y === 32 && entity.type === 'belt')).toBe(true);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(tech).toBeFocused();
  await expect(status).toContainText('Tool: Belt');
  expect(errors).toEqual([]);
});
