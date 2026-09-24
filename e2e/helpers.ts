import { expect, type Page } from '@playwright/test';
import { GRID_H, GRID_W, MOTOR_THRESHOLD, SAVE_KEY, SAVE_VERSION } from '../src/config/constants';
export { SAVE_KEY };
import { startingUnlocks } from '../src/sim/techTree';
import type { MachineType } from '../src/sim/machines';
import type { RecipeId } from '../src/sim/recipes';

export const CENTER = { x: 640, y: 360 };
export const WHEEL_NOTCH = 100;
/** Software rasterization runs at a few fps, so frames (and HUD pushes) stall. */
export const FRAME_STALL_MS = 2500;
/** World units per screen pixel at the default frustum (zoom 16 over 720px). */
export const PX_PER_UNIT = 45;
export const ZOOM_DEFAULT = 16;
/** A cell is one world unit, so adjacent cells are this far apart on screen. */
const CELL_STEP = { x: PX_PER_UNIT * 0.7071, y: PX_PER_UNIT * 0.4083 };

export interface Cell {
  x: number;
  y: number;
}

export const cellKey = (cell: Cell): string => `${cell.x},${cell.y}`;

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

export interface SeedOptions {
  currency?: number;
  /** Defaults to the tree a fresh player really starts with. */
  machines?: MachineType[];
  recipes?: RecipeId[];
  /** Motors sold across every cycle: what prestige points are derived from. */
  lifetimeMotors?: number;
  totalPrestiges?: number;
}

/**
 * Writes a save before the first script runs, so the app boots into a chosen
 * state. Currency is seeded rather than ground out: income pacing is a balance
 * question (`balance.ts` is explicitly tuned after the playtest gate), and a
 * test that waits minutes for 75 credits would be measuring the tuning, not
 * the tech tree.
 */
export async function seedSave(page: Page, options: SeedOptions = {}): Promise<void> {
  const starting = startingUnlocks();
  const lifetimeMotors = options.lifetimeMotors ?? 0;
  const points = Math.floor(lifetimeMotors / MOTOR_THRESHOLD);
  const totalPrestiges = options.totalPrestiges ?? 0;
  const save = {
    version: SAVE_VERSION,
    lastSavedAt: Date.now(),
    currency: options.currency ?? 0,
    prestige: {
      lifetimeMotors,
      points,
      claimedPoints: totalPrestiges === 0 ? 0 : points,
      totalPrestiges,
      permanentMultipliers: {
        productionSpeed: 1 + 0.25 * points,
        sellValue: 1 + 0.5 * points,
      },
    },
    unlocked: {
      machines: options.machines ?? [...starting.machines],
      recipes: options.recipes ?? [...starting.recipes],
    },
    grid: { width: GRID_W, height: GRID_H, entities: [], expansionsBought: 0 },
    productionChains: {},
  };

  await page.addInitScript(
    ([key, value]) => {
      // Only on the first load: this script re-runs on every navigation, and
      // overwriting here would silently undo whatever the app has since saved
      // (a reload in a test must see the real save, not the seed again).
      if (!localStorage.getItem(key as string)) {
        localStorage.setItem(key as string, value as string);
      }
    },
    [SAVE_KEY, JSON.stringify(save)] as [string, string],
  );
}

/** Is the build-panel button for this tool clickable? */
export async function toolLocked(page: Page, tool: string): Promise<boolean> {
  const button = page.getByTestId(`tool-${tool}`);
  await expect(button).toBeVisible();
  return (await button.getAttribute('data-locked')) === 'true';
}

export async function openTechPanel(page: Page): Promise<void> {
  await page.getByTestId('tech-toggle').click();
  await expect(page.getByTestId('tech-panel')).toBeVisible();
}

/** The tech panel's status text for a node, e.g. "needs Assembler". */
export async function techStatus(page: Page, id: string): Promise<string> {
  return ((await page.getByTestId(`tech-status-${id}`).textContent()) ?? '').trim();
}

export async function waitForReady(page: Page, errors: string[] = []): Promise<void> {
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  try {
    await expect
      .poll(async () => await canvas.getAttribute('data-renderer-backend'), { timeout: 30_000 })
      .toMatch(/webgpu|webgl2/);
  } catch {
    throw new Error(`renderer never initialised; page errors: ${errors.join(' | ') || 'none'}`);
  }
}

export async function getCps(page: Page): Promise<number> {
  return Number.parseFloat((await page.getByTestId('cps').textContent()) ?? '0');
}

export async function getCurrency(page: Page): Promise<number> {
  return Number.parseInt(
    ((await page.getByTestId('currency').textContent()) ?? '0').replace(/\D/g, ''),
    10,
  );
}

/** Selecting a tool arms placement; Escape (or null) returns to inspect mode. */
export async function setTool(
  page: Page,
  tool: MachineType | null,
): Promise<void> {
  // Escape first: the tool buttons toggle, so this makes the click deterministic.
  await page.locator('canvas').focus();
  await page.keyboard.press('Escape');
  if (tool) {
    await page.getByTestId(`tool-${tool}`).click();
    await page.locator('canvas').focus();
  }
}

export async function inspectCell(page: Page, x: number, y: number): Promise<void> {
  await setTool(page, null);
  await page.mouse.click(x, y);
  await page.waitForTimeout(60);
}

/** The machine type in that cell, or 'empty'. Non-destructive. */
export async function cellTypeAt(page: Page, x: number, y: number): Promise<string> {
  await inspectCell(page, x, y);
  return ((await page.getByTestId('info-type').textContent()) ?? 'empty').trim();
}

/** The cell the app reports under a pixel, as "x,y". */
export async function cellAt(page: Page, x: number, y: number): Promise<string> {
  await inspectCell(page, x, y);
  return ((await page.getByTestId('info-cell').textContent()) ?? '').trim();
}

/** Where a cell's centre should land on screen with the default camera. */
export function cellToPixel(cell: Cell, target: Cell = { x: 31.5, y: 31.5 }): { x: number; y: number } {
  const dx = cell.x - target.x;
  const dy = cell.y - target.y;
  return {
    x: CENTER.x + CELL_STEP.x * (dx - dy),
    y: CENTER.y + CELL_STEP.y * (dx + dy),
  };
}

/** Screen-y foreshortening of the ground plane: sin of the true-iso elevation. */
const SIN_EL = 1 / Math.sqrt(3);

/**
 * Analytic projection at a chosen zoom (the frustum's world-unit half-height).
 * `cellToPixel` hardcodes the default camera; a factory plan that spans most
 * of the 64-unit map only fits on screen zoomed out, so callers zoom first and
 * project with this. Validate a few cells against `cellAt` before trusting it.
 */
export function cellToPixelAtZoom(
  cell: Cell,
  zoom: number,
  target: Cell = { x: 31.5, y: 31.5 },
): { x: number; y: number } {
  const pxPerWorld = 720 / zoom;
  const dx = cell.x - target.x;
  const dy = cell.y - target.y;
  return {
    x: CENTER.x + pxPerWorld * 0.7071 * (dx - dy),
    y: CENTER.y + pxPerWorld * 0.7071 * SIN_EL * (dx + dy),
  };
}

/**
 * Zoom fully out (frustum 16 -> 40, ZOOM_MAX). The cursor stays at the map
 * centre, so `zoomAbout` pins the camera target: the analytic projection's
 * assumption (target = map centre) survives the zoom.
 */
export async function zoomOutFully(page: Page): Promise<void> {
  await page.mouse.move(CENTER.x, CENTER.y);
  // zoom += deltaY * 0.02 per notch: 16 -> 28 -> 40.
  await page.mouse.wheel(0, 600);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
}

/**
 * Resolves the pixel for a cell by asking the app, so the tests do not depend
 * on the projection arithmetic being right.
 */
export async function findPixelForCell(page: Page, cell: Cell): Promise<{ x: number; y: number }> {
  const guess = cellToPixel(cell);
  const wanted = cellKey(cell);

  if ((await cellAt(page, guess.x, guess.y)) === wanted) return guess;

  for (let dy = -30; dy <= 30; dy += 10) {
    for (let dx = -30; dx <= 30; dx += 10) {
      const candidate = { x: guess.x + dx, y: guess.y + dy };
      if ((await cellAt(page, candidate.x, candidate.y)) === wanted) return candidate;
    }
  }
  throw new Error(`no pixel maps to cell ${wanted}`);
}

export async function dragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

export async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(300);
}
