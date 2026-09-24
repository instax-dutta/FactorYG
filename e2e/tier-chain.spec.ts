import { test, expect, type Page } from '@playwright/test';
import {
  cellTypeAt,
  collectErrors,
  findPixelForCell,
  getCurrency,
  inspectCell,
  seedSave,
  setTool,
  waitForReady,
  type Cell,
} from './helpers';
import { ALL_UNLOCKED } from '../src/sim/techTree';

/**
 * Slice 2.7: the Tier 0 -> Tier 2 chain played through the real UI, on the
 * copper node the earlier phases already use.
 *
 *   extractor(22,24) -> belt, belt -> smelter(25,24) -> belt -> assembler(27,24)
 *                    -> belt -> depot(29,24)
 */
const EXTRACTOR = { x: 22, y: 24 };
const SMELTER = { x: 25, y: 24 };
const ASSEMBLER = { x: 27, y: 24 };
const DEPOT = { x: 29, y: 24 };
const BELTS: Cell[] = [
  { x: 23, y: 24 },
  { x: 24, y: 24 },
  { x: 26, y: 24 },
  { x: 28, y: 24 },
];
const CHAIN: Cell[] = [EXTRACTOR, ...BELTS, SMELTER, ASSEMBLER, DEPOT];

/** A wire is worth 45, an ingot 5, ore 0.4 — only a wire can reach the depot. */
const WIRE_VALUE = 45;

/** What the info panel says about a cell, read in one consistent sample. */
async function panel(
  page: Page,
  pixel: { x: number; y: number },
): Promise<{ type: string; recipe: string; throughput: string; buffer: string }> {
  await inspectCell(page, pixel.x, pixel.y);
  return {
    type: ((await page.getByTestId('info-type').textContent()) ?? '').trim(),
    recipe: ((await page.getByTestId('info-recipe').textContent()) ?? '').trim(),
    throughput: ((await page.getByTestId('info-throughput').textContent()) ?? '').trim(),
    buffer: ((await page.getByTestId('info-buffer').textContent()) ?? '').trim(),
  };
}

test('smelter and assembler turn copper ore into a sold Wire', async ({ page }) => {
  const errors = collectErrors(page);
  // This spec is about the production chain, so it starts with the tree wide
  // open; `tech-tree.spec.ts` covers the gating that would otherwise make the
  // assembler a paid unlock.
  await seedSave(page, {
    machines: [...ALL_UNLOCKED.machines],
    recipes: [...ALL_UNLOCKED.recipes],
  });
  await page.goto('/');
  await waitForReady(page, errors);

  // Every v1 machine has to be reachable from the build panel.
  for (const tool of ['extractor', 'belt', 'smelter', 'assembler', 'silo', 'depot']) {
    await expect(page.getByTestId(`tool-${tool}`)).toBeVisible();
  }

  const pixels: Record<string, { x: number; y: number }> = {};
  for (const cell of CHAIN) pixels[`${cell.x},${cell.y}`] = await findPixelForCell(page, cell);
  const at = (cell: Cell) => pixels[`${cell.x},${cell.y}`];

  // Rotation starts north; one press is 90° east, which is the direction every
  // machine in this line wants. It survives tool changes.
  await setTool(page, 'extractor');
  await page.keyboard.press('r');

  // Place the crafters before their suppliers so an idle crafter can be
  // inspected deterministically: empty buffers, nothing to craft.
  await setTool(page, 'smelter');
  await page.mouse.click(at(SMELTER).x, at(SMELTER).y);
  expect(await panel(page, at(SMELTER))).toEqual({
    type: 'smelter',
    recipe: 'idle',
    throughput: 'idle',
    buffer: 'nothing held',
  });

  await setTool(page, 'assembler');
  await page.mouse.click(at(ASSEMBLER).x, at(ASSEMBLER).y);
  // Placing does not move the panel, so this inspects the cell to confirm it landed.
  expect(await cellTypeAt(page, at(ASSEMBLER).x, at(ASSEMBLER).y)).toBe('assembler');

  await setTool(page, 'extractor');
  await page.mouse.click(at(EXTRACTOR).x, at(EXTRACTOR).y);

  await setTool(page, 'belt');
  for (const belt of BELTS) await page.mouse.click(at(belt).x, at(belt).y);

  await setTool(page, 'depot');
  await page.mouse.click(at(DEPOT).x, at(DEPOT).y);
  await setTool(page, null);

  expect(await cellTypeAt(page, at(EXTRACTOR).x, at(EXTRACTOR).y)).toBe('extractor');
  expect(await cellTypeAt(page, at(SMELTER).x, at(SMELTER).y)).toBe('smelter');
  expect(await cellTypeAt(page, at(ASSEMBLER).x, at(ASSEMBLER).y)).toBe('assembler');
  expect(await cellTypeAt(page, at(DEPOT).x, at(DEPOT).y)).toBe('depot');

  // The headline: ore becomes an ingot becomes a component, and the depot sells
  // it. Two ingots go into every wire, so a sale of exactly 45 proves the
  // assembler consumed both rather than passing metal through.
  await expect.poll(() => getCurrency(page), { timeout: 90_000 }).toBeGreaterThanOrEqual(WIRE_VALUE);
  for (let sample = 0; sample < 3; sample++) {
    expect({ sample, remainder: (await getCurrency(page)) % WIRE_VALUE }).toEqual({
      sample,
      remainder: 0,
    });
    await page.waitForTimeout(500);
  }

  // The panels have to describe the chain while it runs, not just exist.
  await expect
    .poll(async () => {
      const { recipe, throughput } = await panel(page, at(SMELTER));
      return `${recipe} @ ${throughput}`;
    }, { timeout: 30_000 })
    .toBe('crafting Copper Ingot @ 0.5 item/s');

  await expect
    .poll(async () => {
      const { recipe, throughput } = await panel(page, at(ASSEMBLER));
      return `${recipe} @ ${throughput}`;
    }, { timeout: 30_000 })
    .toBe('crafting Wire @ 0.3 item/s');

  // A held ingot waiting for its pair is visible, which is how a player sees a
  // stalled input.
  await expect
    .poll(async () => (await panel(page, at(ASSEMBLER))).buffer, { timeout: 30_000 })
    .toContain('Copper Ingot');

  // A depot is a sink, not an idle machine.
  expect((await panel(page, at(DEPOT))).throughput).toBe('sink');

  expect(errors).toEqual([]);
});

test('refreshes selected machine data and route health after topology changes', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, {
    machines: [...ALL_UNLOCKED.machines],
    recipes: [...ALL_UNLOCKED.recipes],
  });
  await page.goto('/');
  await waitForReady(page, errors);

  const extractor = { x: 22, y: 24 };
  const belt = { x: 23, y: 24 };
  const depot = { x: 24, y: 24 };
  const extractorPixel = await findPixelForCell(page, extractor);
  const beltPixel = await findPixelForCell(page, belt);
  const depotPixel = await findPixelForCell(page, depot);

  await inspectCell(page, extractorPixel.x, extractorPixel.y);
  expect((await page.getByTestId('info-type').textContent())?.trim()).toBe('empty');

  await setTool(page, 'extractor');
  await page.keyboard.press('r');
  await page.mouse.click(extractorPixel.x, extractorPixel.y);
  await expect(page.getByTestId('info-type')).toHaveText('extractor');
  await expect
    .poll(async () => (await page.getByTestId('info-item').textContent())?.trim(), { timeout: 30_000 })
    .toBe('Copper Ore');
  await expect(page.getByTestId('info-chain')).toHaveText('no depot on route');

  await setTool(page, 'belt');
  await page.mouse.click(beltPixel.x, beltPixel.y);
  await setTool(page, 'depot');
  await page.mouse.click(depotPixel.x, depotPixel.y);

  await expect(page.getByTestId('info-chain')).toHaveText('feeding depot');
  expect(errors).toEqual([]);
});
