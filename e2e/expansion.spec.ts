import { test, expect, type Page } from '@playwright/test';
import {
  CENTER,
  cellTypeAt,
  collectErrors,
  inspectCell,
  getCurrency,
  holdKey,
  seedSave,
  setTool,
  waitForReady,
  zoomOutFully,
  type Cell,
} from './helpers';
import { BASE_EXPANSION_COST } from '../src/sim/expansion';

/**
 * Browser smoke for grid expansion (slice 3.2): the build-bar control spends
 * the sim's currency, and the plot actually grows — placement beyond the old
 * 64x64 edge starts working, which no unit test can prove (they never click).
 *
 * The strongest observable is the bounds change itself: the pixel just past
 * the old edge refuses a belt before the buy and takes one after it. Currency
 * and button state come along for free; the re-priced button (800 -> 1760,
 * one cost-growth step) pins that the plot grew by exactly ONE expansion.
 *
 * Camera handling — the hard-won lesson of this spec: frozen projections go
 * stale the moment the camera moves another frame, and the app names only
 * cells INSIDE the plot (off-plot clicks clear the panel — deselect is a
 * feature), so a target past the edge can never be aimed at directly. So:
 * aim at the LAST ON-PLOT diagonal cell (65,65) by name — the app itself
 * confirms each convergence step — then the target pixel (66,66) is exactly
 * one diagonal step further. Every claim is verified by a fresh readout;
 * no projection is ever trusted across a camera move.
 */
const LAST_ON_PLOT: Cell = { x: 63, y: 63 }; // on the 64x64 plot (cells 0..63)
/** Zoomed fully out, the frustum half-height is ZOOM_MAX world units. */
const ZOOM_MAX = 40;
const PX_PER_WORLD = 720 / ZOOM_MAX;
/** Screen px per +1 world x (dx-dy) and per +1 world "south" (dx+dy). */
const PX_PER_X = PX_PER_WORLD * 0.7071;
const PX_PER_SOUTH = PX_PER_WORLD * 0.7071 * (1 / Math.sqrt(3));

/** Parse "x,y" from the info panel; NaNs when the panel is empty. */
async function namedCell(page: Page): Promise<Cell> {
  const infoCell = page.getByTestId('info-cell');
  if ((await infoCell.count()) === 0) return { x: Number.NaN, y: Number.NaN };
  const raw = ((await infoCell.textContent()) ?? '').trim();
  const [x, y] = raw.split(',').map((n) => Number.parseInt(n.trim(), 10));
  return { x, y };
}

/** Click a pixel with no tool and return what the app names there ('—' if off-plot). */
async function probeCell(page: Page, p: { x: number; y: number }): Promise<string> {
  await inspectCell(page, p.x, p.y);
  const infoCell = page.getByTestId('info-cell');
  if ((await infoCell.count()) === 0) return '—';
  return ((await infoCell.textContent()) ?? '').trim();
}

/**
 * Pixel for an ON-PLOT `cell`, found entirely by asking the app. Coarse
 * phase: pan south in hops until the cell named at screen centre is close
 * (each hop re-reads — nothing cached). If a readout dies (pre-buy the clamp
 * can push the centre off-plot), nudge back north. Exact phase: probe ->
 * read the named cell -> jump from THAT pixel by the exact world delta (the
 * iso projection is linear, verified in this spec's history to ±6px on
 * ~23px cells). Converges in 1-2 rounds.
 */
async function aimAt(page: Page, cell: Cell): Promise<{ x: number; y: number }> {
  const wanted = `${cell.x},${cell.y}`;
  for (let hop = 0; hop < 12; hop++) {
    await probeCell(page, CENTER);
    const read = await namedCell(page);
    if (!Number.isFinite(read.x) || !Number.isFinite(read.y)) {
      await holdKey(page, 'w', 400); // centre off-plot: back up
      continue;
    }
    if (Math.abs(read.x - cell.x) + Math.abs(read.y - cell.y) <= 8) break;
    await holdKey(page, 's', 500);
  }

  let probePx = { ...CENTER };
  for (let round = 0; round < 7; round++) {
    await probeCell(page, probePx);
    const read = await namedCell(page);
    if (!Number.isFinite(read.x) || !Number.isFinite(read.y)) {
      probePx = { ...CENTER }; // dead readout: fall back to the centre anchor
      continue;
    }
    if (`${read.x},${read.y}` === wanted) return probePx;
    const dx = cell.x - read.x;
    const dy = cell.y - read.y;
    probePx = {
      x: probePx.x + PX_PER_X * (dx - dy),
      y: probePx.y + PX_PER_SOUTH * (dx + dy),
    };
  }
  throw new Error(`could not aim at ${wanted}`);
}

test('buying an expansion grows the plot and debits the currency', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, { currency: BASE_EXPANSION_COST });
  await page.goto('/');
  await waitForReady(page, errors);
  await zoomOutFully(page);

  // Aim at the last on-plot diagonal cell — the app names it exactly.
  const pxLast = await aimAt(page, LAST_ON_PLOT);
  expect(await probeCell(page, pxLast)).toBe('63,63');

  // One diagonal step further is (64,64): pre-buy it is off the plot, and
  // the app names only on-plot cells, so the probe reads exactly '—'.
  const pxTarget = {
    x: pxLast.x, // (dx - dy) unchanged down the diagonal
    y: pxLast.y + PX_PER_SOUTH * 2,
  };
  expect(await probeCell(page, pxTarget)).toBe('—');

  const expand = page.getByTestId('expand-plot');
  await expect(expand).toBeEnabled();
  await expect(expand).toContainText(String(BASE_EXPANSION_COST));

  // The purchase itself: one click, 800 cr gone.
  await expand.click();
  await expect
    .poll(() => getCurrency(page), { timeout: 10_000, intervals: [250] })
    .toBe(0);

  // After: (64,64) is INSIDE the grown plot — the app can name it now. Aim
  // at it by name (fresh readouts, no trust in the pre-buy pixel), which is
  // itself proof the grid grew past the old edge: pre-buy this cell could
  // not be named at all.
  const pxResolved = await aimAt(page, { x: 64, y: 64 });
  expect(await probeCell(page, pxResolved)).toBe('64,64');

  // And the cell takes the belt now.
  await setTool(page, 'belt');
  await page.mouse.click(pxResolved.x, pxResolved.y);
  expect(await cellTypeAt(page, pxResolved.x, pxResolved.y)).toBe('belt');

  // The button now prices the NEXT step (800 * 2.2 = 1760) and, with the
  // purse empty, reads unaffordable. The price pinning expansionsBought = 1
  // is also the proof the plot grew by exactly ONE expansion step.
  await expect(expand).toContainText('1760');
  await expect(expand).toBeDisabled();
});
