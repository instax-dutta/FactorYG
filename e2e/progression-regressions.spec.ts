import { expect, test, type Page } from '@playwright/test';
import {
  collectErrors,
  findPixelForCell,
  inspectCell,
  waitForReady,
} from './helpers';
import { ALL_UNLOCKED, startingUnlocks } from '../src/sim/techTree';

const SAVE_KEY = 'factoryg.save.v1';
const TEST_CLOCK_KEY = '__factor_test_now';
const SEEDED_KEY = '__factor_save_seeded';

type PersistedSave = {
  lastSavedAt: number;
  prestige: {
    lifetimeMotors: number;
    points: number;
    claimedPoints: number;
    totalPrestiges: number;
    permanentMultipliers: { productionSpeed: number; sellValue: number };
  };
  productionChains: Record<string, { outputResource: string; steadyStateThroughput: number }>;
};

function saveAt(lastSavedAt: number, throughput = 0.1): PersistedSave & Record<string, unknown> {
  return {
    version: 2,
    lastSavedAt,
    currency: 0,
    prestige: {
      lifetimeMotors: 0,
      points: 0,
      claimedPoints: 0,
      totalPrestiges: 0,
      permanentMultipliers: { productionSpeed: 1, sellValue: 1 },
    },
    unlocked: startingUnlocks(),
    grid: { width: 64, height: 64, entities: [], expansionsBought: 0 },
    productionChains: {
      'sold-motor': { outputResource: 'motor', steadyStateThroughput: throughput },
    },
  };
}

async function installTestClock(page: Page, start: number): Promise<void> {
  await page.addInitScript(({ key, start: initial }) => {
    Object.defineProperty(Date, 'now', {
      configurable: true,
      value: () => Number(window.localStorage.getItem(key) ?? initial),
    });
  }, { key: TEST_CLOCK_KEY, start });
}

async function advanceTestClock(page: Page, amountMs: number): Promise<void> {
  await page.evaluate(({ key, amount }) => {
    const current = Number(window.localStorage.getItem(key) ?? Date.now());
    window.localStorage.setItem(key, String(current + amount));
  }, { key: TEST_CLOCK_KEY, amount: amountMs });
}

async function seedSave(page: Page, save: PersistedSave & Record<string, unknown>): Promise<void> {
  await page.addInitScript(({ value, seededKey }) => {
    if (window.sessionStorage.getItem(seededKey) !== null) return;
    window.localStorage.setItem('factoryg.save.v1', JSON.stringify(value));
    window.sessionStorage.setItem(seededKey, '1');
  }, { value: save, seededKey: SEEDED_KEY });
}

async function readSave(page: Page): Promise<PersistedSave> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) throw new Error('missing save');
    return JSON.parse(raw) as PersistedSave;
  }, SAVE_KEY);
}

async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((nextState) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => nextState,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('offline modal uses the persisted sellable Motor chain', async ({ page }) => {
  await seedSave(page, saveAt(Date.now() - 8 * 60 * 60 * 1000));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  await expect.poll(async () => (await readSave(page)).lastSavedAt).toBeGreaterThan(0);
  const save = await readSave(page);
  expect(save.productionChains['sold-motor']).toEqual({
    outputResource: 'motor',
    steadyStateThroughput: 0.1,
  });
  expect(save.prestige.lifetimeMotors).toBeGreaterThan(0);

  const text = await page.locator('body').innerText();
  const modalText = text.slice(text.indexOf('Welcome back'));
  expect(modalText).toMatch(/motor/i);
  expect(modalText).not.toMatch(/copperore/i);
});

test('offline visibility credit is saved immediately and not repeated after reload', async ({ page }) => {
  const start = Date.now();
  await installTestClock(page, start);
  await seedSave(page, saveAt(start, 1));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  await setVisibility(page, 'hidden');
  await advanceTestClock(page, 1200);
  await setVisibility(page, 'visible');
  await expect.poll(async () => (await readSave(page)).prestige.lifetimeMotors).toBeGreaterThan(0);
  const first = await readSave(page);

  await setVisibility(page, 'hidden');
  await advanceTestClock(page, 1200);
  await setVisibility(page, 'visible');
  await expect.poll(async () => (await readSave(page)).prestige.lifetimeMotors).toBeGreaterThan(
    first.prestige.lifetimeMotors,
  );
  const second = await readSave(page);
  expect(second.lastSavedAt).toBeGreaterThan(first.lastSavedAt);

  await page.evaluate(({ key, timestamp }) => {
    window.localStorage.setItem(key, String(timestamp));
  }, { key: TEST_CLOCK_KEY, timestamp: second.lastSavedAt });
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  const reloaded = await readSave(page);
  expect(reloaded.prestige.lifetimeMotors).toBeLessThan(
    second.prestige.lifetimeMotors + 0.75,
  );
});

test('prestige claims each point exactly once in the browser', async ({ page }) => {
  const save = saveAt(Date.now());
  save.prestige.lifetimeMotors = 25;
  save.prestige.points = 1;
  save.prestige.permanentMultipliers = { productionSpeed: 1.25, sellValue: 1.5 };
  await seedSave(page, save);
  await page.goto('/');

  const prestigeButton = page.getByTestId('prestige');
  await expect(prestigeButton).toBeVisible({ timeout: 15_000 });
  await expect(prestigeButton).toHaveText('Prestige +1');
  await expect(prestigeButton).toBeEnabled();
  await prestigeButton.click();
  await page.getByRole('button', { name: 'Prestige', exact: true }).click();
  await expect.poll(async () => (await readSave(page)).prestige.totalPrestiges).toBe(1);
  await expect(prestigeButton).toHaveText('Prestige +0');
  await expect(prestigeButton).toBeDisabled();
  expect((await readSave(page)).prestige.claimedPoints).toBe(1);
});

test('recipe unlock wakes a loaded assembler with Circuit inputs', async ({ page }) => {
  const errors = collectErrors(page);
  const save = saveAt(Date.now());
  const loadedSave = {
    ...save,
    currency: 400,
    unlocked: {
      ...ALL_UNLOCKED,
      recipes: ALL_UNLOCKED.recipes.filter((id) => !['circuit', 'frame', 'motor'].includes(id)),
    },
    grid: {
      width: 64,
      height: 64,
      entities: [
        {
          id: 'e1',
          type: 'assembler',
          x: 30,
          y: 30,
          rotation: 90,
          level: 1,
          resourceNode: null,
          item: null,
          inputs: { wire: 1, gear: 1 },
        },
      ],
      expansionsBought: 0,
    },
    productionChains: {},
  };
  await seedSave(page, loadedSave);
  await page.goto('/');
  await waitForReady(page, errors);

  const assembler = await findPixelForCell(page, { x: 30, y: 30 });
  await inspectCell(page, assembler.x, assembler.y);
  await expect(page.getByTestId('info-item')).toHaveText('idle');
  await expect(page.getByTestId('info-recipe')).toHaveText('idle');
  await expect(page.getByTestId('info-buffer')).toHaveText('1× Wire, 1× Gear');

  await page.getByTestId('tech-toggle').click();
  await expect(page.getByTestId('tech-panel')).toBeVisible();
  await expect(page.getByTestId('tech-buy-circuit')).toBeEnabled();
  await page.getByTestId('tech-buy-circuit').click();

  await expect
    .poll(async () => (await page.getByTestId('info-recipe').textContent())?.trim(), { timeout: 15_000 })
    .toBe('crafting Circuit');
  await expect(page.getByTestId('info-buffer')).toHaveText('nothing held');
  await expect
    .poll(async () => (await page.getByTestId('info-item').textContent())?.trim(), { timeout: 30_000 })
    .toBe('Circuit');
  expect(errors).toEqual([]);
});
