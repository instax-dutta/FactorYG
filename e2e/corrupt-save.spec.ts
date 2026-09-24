import { expect, test } from '@playwright/test';
import { SAVE_KEY, SAVE_VERSION } from '../src/config/constants';
import { startingUnlocks } from '../src/sim/techTree';
import { MAX_MACHINE_LEVEL } from '../src/sim/upgrades';
import { collectErrors, waitForReady } from './helpers';

test('corrupt storage starts a fresh initialized game and quarantines the bad save', async ({ page }) => {
  const errors = collectErrors(page);
  const raw = JSON.stringify({
    version: 1,
    lastSavedAt: Date.now(),
    currency: 0,
    grid: { width: 64, height: 64, entities: [{}] },
    productionChains: {},
  });

  await page.addInitScript(
    ({ key, value }) => {
      localStorage.clear();
      localStorage.setItem(key, value);
    },
    { key: SAVE_KEY, value: raw },
  );
  await page.goto('/');

  await waitForReady(page, errors);
  await expect(page.getByTestId('goal-title')).toBeVisible();

  const freshSave = await page.evaluate((key) => {
    const stored = localStorage.getItem(key);
    return stored === null ? null : JSON.parse(stored);
  }, SAVE_KEY);
  expect(freshSave).toMatchObject({
    version: SAVE_VERSION,
    currency: 0,
    grid: { entities: [] },
  });

  const corruptKeys = await page.evaluate(
    (key) => Object.keys(localStorage).filter((candidate) => candidate.startsWith(`${key}.corrupt.`)),
    SAVE_KEY,
  );
  expect(corruptKeys).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('semantically invalid v2 storage is quarantined before the fresh factory starts', async ({ page }) => {
  const errors = collectErrors(page);
  const raw = JSON.stringify({
    version: SAVE_VERSION,
    lastSavedAt: Date.now(),
    currency: 0,
    prestige: {
      lifetimeMotors: 0,
      points: 0,
      claimedPoints: 0,
      totalPrestiges: 0,
      permanentMultipliers: { productionSpeed: 1, sellValue: 1 },
    },
    unlocked: startingUnlocks(),
    grid: {
      width: 64,
      height: 64,
      expansionsBought: 0,
      entities: [{
        id: 'overlevelled',
        type: 'belt',
        x: 1,
        y: 1,
        rotation: 90,
        level: MAX_MACHINE_LEVEL + 1,
        resourceNode: null,
        item: null,
        inputs: {},
      }],
    },
    productionChains: {},
  });

  await page.addInitScript(
    ({ key, value }) => {
      localStorage.clear();
      localStorage.setItem(key, value);
    },
    { key: SAVE_KEY, value: raw },
  );
  await page.goto('/');
  await waitForReady(page, errors);

  await expect(page.getByTestId('toasts')).toContainText('Recovered from an unreadable save');
  const stored = await page.evaluate((key) => ({
    active: localStorage.getItem(key),
    corrupt: Object.keys(localStorage).filter((candidate) => candidate.startsWith(`${key}.corrupt.`)),
  }), SAVE_KEY);
  expect(JSON.parse(stored.active as string).grid.entities).toEqual([]);
  expect(stored.corrupt).toEqual([expect.stringContaining(`${SAVE_KEY}.corrupt.`)]);
  expect(errors).toEqual([]);
});
