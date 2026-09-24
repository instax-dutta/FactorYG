import { test, expect, type Page } from '@playwright/test';
import {
  cellAt,
  cellToPixel,
  cellTypeAt,
  CENTER,
  collectErrors,
  dragBy,
  findPixelForCell,
  getCurrency,
  holdKey,
  setTool,
  WHEEL_NOTCH,
  waitForReady,
  type Cell,
} from './helpers';

/**
 * Camera and placement invariants, verified through real input. "Which cell is
 * under this pixel" comes from the info panel (click with no tool selected),
 * which is exact at cell boundaries and never mutates the factory.
 *
 * Pixels for a given camera target come from `cellToPixel`, whose projection
 * matches the app's (45 px per world unit at zoom 16, foreshortened vertically).
 */

/**
 * Where the camera comes to rest after panning into the north-west corner:
 * bounds [0, 63] plus a margin of min(PAN_MARGIN, zoom / 4) = 4.
 */
const NW_CLAMP = { x: -4, y: -4 };
/** ...and the north-east corner, since D drives x up and z down together. */
const EAST_CLAMP = { x: 67, y: -4 };

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = collectErrors(page);
});

/** Drops a single belt (no resource node needed) and returns to inspect mode. */
async function placeBelt(page: Page, x: number, y: number): Promise<void> {
  await setTool(page, 'belt');
  await page.mouse.click(x, y);
  await setTool(page, null);
}

test('boots with a working renderer and no runtime errors', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  const box = await page.locator('canvas').boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  // Fallback contract: when the browser exposes WebGPU but cannot hand out an
  // adapter, the app must render through WebGL2 rather than dying.
  const hasAdapter = await page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    try {
      return (await gpu.requestAdapter()) != null;
    } catch {
      return false;
    }
  });
  const backend = (await page.locator('canvas').getAttribute('data-renderer-backend')) ?? '';
  if (!hasAdapter) expect(backend).toContain('webgl2');

  expect(errors).toEqual([]);
});

test('inspecting reports the cell under the cursor', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  // The camera starts centred on the 64x64 plot, so cell (32,32) sits just
  // below the centre pixel.
  const centre = cellToPixel({ x: 32, y: 32 });
  expect(await cellAt(page, centre.x, centre.y)).toBe('32,32');

  // An empty cell reports no machine, and the readout follows the cursor.
  expect(await cellTypeAt(page, centre.x, centre.y)).toBe('empty');

  const other = cellToPixel({ x: 30, y: 32 });
  expect(await cellAt(page, other.x, other.y)).toBe('30,32');
  expect(errors).toEqual([]);
});

test('one machine per cell, and demolish frees the cell', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  await placeBelt(page, CENTER.x, CENTER.y);
  expect(await cellTypeAt(page, CENTER.x, CENTER.y)).toBe('belt');

  // A second machine cannot overwrite the first.
  await setTool(page, 'depot');
  await page.mouse.click(CENTER.x, CENTER.y);
  await setTool(page, null);
  expect(await cellTypeAt(page, CENTER.x, CENTER.y)).toBe('belt');

  // Right-click demolishes, freeing the cell to be rebuilt.
  await page.mouse.click(CENTER.x, CENTER.y, { button: 'right' });
  await expect.poll(() => cellTypeAt(page, CENTER.x, CENTER.y), { timeout: 5000 }).toBe('empty');

  await placeBelt(page, CENTER.x, CENTER.y);
  expect(await cellTypeAt(page, CENTER.x, CENTER.y)).toBe('belt');
  expect(errors).toEqual([]);
});

test('placement feedback separates legal disconnection from structural refusals', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);
  await expect(page.getByTestId('toasts')).toHaveAttribute('aria-live', 'polite');

  const isolated = await findPixelForCell(page, { x: 32, y: 32 });
  await setTool(page, 'belt');
  await page.mouse.move(isolated.x, isolated.y);
  await expect(page.getByTestId('placement-status')).toHaveText(
    'Disconnected - this machine will idle',
  );

  await page.mouse.click(isolated.x, isolated.y);
  expect(await cellTypeAt(page, isolated.x, isolated.y)).toBe('belt');
  await setTool(page, 'depot');
  await page.mouse.move(isolated.x, isolated.y);
  await expect(page.getByTestId('placement-status')).toHaveText('Cell occupied');

  const empty = await findPixelForCell(page, { x: 30, y: 30 });
  await setTool(page, 'extractor');
  await page.mouse.move(empty.x, empty.y);
  await expect(page.getByTestId('placement-status')).toHaveText(
    'Extractor needs a resource node',
  );
  await page.mouse.click(empty.x, empty.y);
  expect(await cellTypeAt(page, empty.x, empty.y)).toBe('empty');
  expect(errors).toEqual([]);
});

test('locked tools show their Tech price and unlock location', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  const assembler = page.getByTestId('tool-assembler');
  await expect(assembler).toContainText('Assembler · 75 cr');
  await expect(assembler).toHaveAttribute('title', /Tech/);
  expect(errors).toEqual([]);
});

test('clears placement status when the placement context ends', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  const cell = await findPixelForCell(page, { x: 32, y: 32 });
  const status = page.getByTestId('placement-status');

  await setTool(page, 'belt');
  await page.mouse.move(cell.x, cell.y);
  await expect(status).toHaveText('Disconnected - this machine will idle');
  await page.getByTestId('tool-depot').click();
  await expect(status).toHaveText('');

  await setTool(page, 'belt');
  await page.mouse.move(cell.x, cell.y);
  await expect(status).toHaveText('Disconnected - this machine will idle');
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('');

  await setTool(page, 'belt');
  await page.mouse.move(cell.x, cell.y);
  await expect(status).toHaveText('Disconnected - this machine will idle');
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('canvas missing');
    canvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 77, button: 0 }));
  });
  await expect(status).toHaveText('');
  expect(errors).toEqual([]);
});

test('clicking off the plot clears the info panel', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  await placeBelt(page, CENTER.x, CENTER.y);
  expect(await cellTypeAt(page, CENTER.x, CENTER.y)).toBe('belt');

  const panel = page.getByTestId('info-panel');
  await expect(panel.getByTestId('demolish')).toBeVisible();
  await expect(page.getByTestId('info-cell')).not.toHaveText('—');

  // The plot always fills the view at the default camera, so pan to the clamp
  // first: past the north-west corner there is empty space to click.
  await holdKey(page, 'w', 7000);
  const cornerPixel = cellToPixel({ x: 0, y: 0 }, NW_CLAMP);
  expect(await cellAt(page, cornerPixel.x, cornerPixel.y)).toBe('0,0');

  const offPlot = { x: cornerPixel.x, y: cornerPixel.y - 307 };
  await setTool(page, null);
  await page.mouse.click(offPlot.x, offPlot.y);

  // Nothing is under the cursor, so nothing is selected: no stale machine, no
  // cell readout, and no demolish button for a cell that is not on the plot.
  await expect(panel).toBeHidden();

  await setTool(page, 'belt');
  await page.mouse.move(cornerPixel.x, cornerPixel.y);
  await expect(page.getByTestId('placement-status')).toHaveText(
    'Disconnected - this machine will idle',
  );
  await page.mouse.click(offPlot.x, offPlot.y);
  await expect(page.getByTestId('placement-status')).toHaveText('');
  expect(errors).toEqual([]);
});

test('horizontal drag pans the map 1:1 with the cursor', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  await placeBelt(page, CENTER.x, CENTER.y);
  await dragBy(page, CENTER, -120, 0);

  // A 120px left drag must carry the grabbed cell exactly 120px left.
  expect(await cellTypeAt(page, CENTER.x - 120, CENTER.y)).toBe('belt');
  expect(await cellTypeAt(page, CENTER.x, CENTER.y)).toBe('empty');
  expect(errors).toEqual([]);
});

test('vertical drag pans the map 1:1 with the cursor', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  await placeBelt(page, CENTER.x, CENTER.y);
  await dragBy(page, CENTER, 0, 120);

  // Isometric ground is foreshortened vertically (0.408 of the horizontal
  // scale), so a per-axis `zoom / height` scale would move this cell ~69px.
  expect(await cellTypeAt(page, CENTER.x, CENTER.y + 120)).toBe('belt');
  expect(await cellTypeAt(page, CENTER.x, CENTER.y)).toBe('empty');
  expect(errors).toEqual([]);
});

test('wheel zooms in around the cursor by the frustum ratio', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  const anchor = { x: CENTER.x - 300, y: CENTER.y };
  const neighbourOffset = 100;
  const zoomFactor = 4;

  await placeBelt(page, anchor.x, anchor.y);
  await placeBelt(page, anchor.x + neighbourOffset, anchor.y);

  // Baseline: 400px out is several cells away, so it is empty.
  expect(await cellTypeAt(page, anchor.x + neighbourOffset * zoomFactor, anchor.y)).toBe('empty');

  await page.mouse.move(anchor.x, anchor.y);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -WHEEL_NOTCH);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(300);

  // Six notches take the frustum 16 -> 4, so the same world offset appears 4x
  // further out. It is occupied only if the zoom happened AND was anchored.
  expect(await cellTypeAt(page, anchor.x + neighbourOffset * zoomFactor, anchor.y)).toBe('belt');
  expect(await cellTypeAt(page, anchor.x, anchor.y)).toBe('belt');
  expect(errors).toEqual([]);
});

test('W pans the view north and stops at the clamp', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  await holdKey(page, 'w', 8000);

  // Clamped at the north-west corner: cell (0,0) now sits below the centre, so
  // the plot is still on screen. Two independent cells pin the target exactly.
  // (Probing further north is no use: the raycast plane only spans the plot,
  // so an off-plot click misses and the panel keeps its previous cell.)
  const cornerPixel = cellToPixel({ x: 0, y: 0 }, NW_CLAMP);
  expect(await cellAt(page, cornerPixel.x, cornerPixel.y)).toBe('0,0');
  const innerPixel = cellToPixel({ x: 1, y: 1 }, NW_CLAMP);
  expect(await cellAt(page, innerPixel.x, innerPixel.y)).toBe('1,1');

  // Build on the clamped view, then push further: the camera must not drift.
  await placeBelt(page, cornerPixel.x, cornerPixel.y);
  expect(await cellTypeAt(page, cornerPixel.x, cornerPixel.y)).toBe('belt');

  await holdKey(page, 'w', 2500);
  expect(await cellTypeAt(page, cornerPixel.x, cornerPixel.y)).toBe('belt');
  expect(await cellAt(page, cornerPixel.x, cornerPixel.y)).toBe('0,0');
  expect(errors).toEqual([]);
});

test('D pans the view east and stops at the clamp', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  await holdKey(page, 'd', 8000);

  // Clamped at (67, -4): the plot's eastern column (63, 0) is left of centre.
  const edgePixel = cellToPixel({ x: 63, y: 0 }, EAST_CLAMP);
  expect(await cellAt(page, edgePixel.x, edgePixel.y)).toBe('63,0');
  const innerPixel = cellToPixel({ x: 62, y: 1 }, EAST_CLAMP);
  expect(await cellAt(page, innerPixel.x, innerPixel.y)).toBe('62,1');

  await placeBelt(page, edgePixel.x, edgePixel.y);
  expect(await cellTypeAt(page, edgePixel.x, edgePixel.y)).toBe('belt');

  await holdKey(page, 'd', 2500);
  expect(await cellTypeAt(page, edgePixel.x, edgePixel.y)).toBe('belt');
  expect(await cellAt(page, edgePixel.x, edgePixel.y)).toBe('63,0');
  expect(errors).toEqual([]);
});

test('a crowded factory keeps producing', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, errors);

  // A working chain first (copper node at 22,24 plus three cells east of it),
  // so progress stays measurable under load.
  const chain: Cell[] = [
    { x: 22, y: 24 },
    { x: 23, y: 24 },
    { x: 24, y: 24 },
    { x: 25, y: 24 },
  ];
  const pixels = new Map<Cell, { x: number; y: number }>();
  for (const cell of chain) pixels.set(cell, await findPixelForCell(page, cell));

  await setTool(page, 'extractor');
  await page.keyboard.press('r'); // extractors and belts carry east (+x)
  const first = pixels.get(chain[0]) as { x: number; y: number };
  await page.mouse.click(first.x, first.y);
  await setTool(page, 'belt');
  for (const cell of chain.slice(1, 3)) {
    const pixel = pixels.get(cell) as { x: number; y: number };
    await page.mouse.click(pixel.x, pixel.y);
  }
  await setTool(page, 'depot');
  const last = pixels.get(chain[3]) as { x: number; y: number };
  await page.mouse.click(last.x, last.y);

  // The chain is live before the bulk placement starts.
  await expect.poll(() => getCurrency(page), { timeout: 30_000 }).toBeGreaterThan(0);

  // Four passes of a belt lattice, panning between passes so the cells are new.
  const spacingX = 90; // ~1.5 cells apart, so clicks never share a cell
  const spacingY = 78;
  const batch = { x: 320, y: 140 };
  await setTool(page, 'belt');
  for (let pass = 0; pass < 4; pass++) {
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        await page.mouse.click(batch.x + col * spacingX, batch.y + row * spacingY);
      }
    }
    await setTool(page, null);
    // Sample this pass before the camera moves again.
    expect(await cellTypeAt(page, batch.x, batch.y)).toBe('belt');
    expect(await cellTypeAt(page, batch.x + 5 * spacingX, batch.y + 5 * spacingY)).toBe('belt');
    if (pass < 3) {
      await setTool(page, 'belt');
      await dragBy(page, CENTER, -300, 0);
    }
  }

  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const started = performance.now();
        const sample = () => {
          frames++;
          const elapsed = performance.now() - started;
          if (elapsed >= 1000) {
            resolve((frames * 1000) / elapsed);
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );

  // The sim must keep ticking under load (the plan's frame-rate target needs a
  // real GPU; this software rasterizer is the wrong instrument for it).
  const before = await getCurrency(page);
  await expect.poll(() => getCurrency(page), { timeout: 30_000 }).toBeGreaterThan(before);
  console.log(`fps=${fps.toFixed(1)} (software rasterizer), currency ${before} -> ${await getCurrency(page)}`);

  expect(fps).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
