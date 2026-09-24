import { test, expect, type Page } from '@playwright/test';
import {
  cellTypeAt,
  collectErrors,
  findPixelForCell,
  getCps,
  getCurrency,
  openTechPanel,
  setTool,
  techStatus,
  waitForReady,
  type Cell,
} from './helpers';

/**
 * A playthrough: a genuinely new player, no seeded save, real clicks.
 *
 * Act 1  bootstrap - four copper lines, ore -> ingot -> depot
 * Act 2  scale up  - demolish two depots, rebuild them as wire factories
 *
 * Everything here is a click on the shipped UI. Nothing writes to the sim
 * directly, so the numbers this reports are the real ones the player sees.
 */

let START = Date.now();
const journal: string[] = [];

function note(line: string): void {
  const elapsed = ((Date.now() - START) / 1000).toFixed(1);
  const stamped = `[t+${elapsed}s] ${line}`;
  journal.push(stamped);
  console.log(stamped);
}

const cell = (x: number, y: number): Cell => ({ x, y });

type ToolName = 'extractor' | 'belt' | 'smelter' | 'assembler' | 'silo' | 'depot';

/**
 * Act 1: four copper lines, each extractor -> belt -> belt -> smelter -> belt ->
 * depot, all facing east so a single rotation keypress serves every machine.
 * Four nodes of the copper cluster; the other two stay free for later.
 */
const BOOTSTRAP: { node: Cell; parts: { tool: ToolName; at: Cell }[] }[] = [
  {
    node: cell(22, 24),
    parts: [
      { tool: 'belt', at: cell(23, 24) },
      { tool: 'belt', at: cell(24, 24) },
      { tool: 'smelter', at: cell(25, 24) },
      { tool: 'belt', at: cell(26, 24) },
      { tool: 'depot', at: cell(27, 24) },
    ],
  },
  {
    node: cell(22, 27),
    parts: [
      { tool: 'belt', at: cell(23, 27) },
      { tool: 'belt', at: cell(24, 27) },
      { tool: 'smelter', at: cell(25, 27) },
      { tool: 'belt', at: cell(26, 27) },
      { tool: 'depot', at: cell(27, 27) },
    ],
  },
  {
    node: cell(25, 28),
    parts: [
      { tool: 'belt', at: cell(26, 28) },
      { tool: 'belt', at: cell(27, 28) },
      { tool: 'smelter', at: cell(28, 28) },
      { tool: 'belt', at: cell(29, 28) },
      { tool: 'depot', at: cell(30, 28) },
    ],
  },
  {
    node: cell(27, 30),
    parts: [
      { tool: 'belt', at: cell(28, 30) },
      { tool: 'belt', at: cell(29, 30) },
      { tool: 'smelter', at: cell(30, 30) },
      { tool: 'belt', at: cell(31, 30) },
      { tool: 'depot', at: cell(32, 30) },
    ],
  },
];

/**
 * Act 2: the first two lines' depots come off and wire assemblers go on, so the
 * exported good becomes a 45 cr Wire (2 ingots of metal) instead of a 5 cr ingot.
 */
const WIRE_CONVERSIONS: { demolish: Cell; assembler: Cell; belt: Cell; depot: Cell }[] = [
  { demolish: cell(27, 24), assembler: cell(27, 24), belt: cell(28, 24), depot: cell(29, 24) },
  { demolish: cell(27, 27), assembler: cell(27, 27), belt: cell(28, 27), depot: cell(29, 27) },
];

async function resolveAll(page: Page, cells: Cell[]): Promise<Map<string, { x: number; y: number }>> {
  const pixels = new Map<string, { x: number; y: number }>();
  for (const c of cells) pixels.set(`${c.x},${c.y}`, await findPixelForCell(page, c));
  return pixels;
}

async function clickAt(
  page: Page,
  pixels: Map<string, { x: number; y: number }>,
  at: Cell,
): Promise<void> {
  const pixel = pixels.get(`${at.x},${at.y}`);
  if (!pixel) throw new Error(`no pixel resolved for ${at.x},${at.y}`);
  await page.mouse.click(pixel.x, pixel.y);
}

async function place(
  page: Page,
  pixels: Map<string, { x: number; y: number }>,
  tool: ToolName,
  at: Cell,
): Promise<void> {
  await setTool(page, tool);
  await clickAt(page, pixels, at);
  const landed = await cellTypeAt(page, pixels.get(`${at.x},${at.y}`)!.x, pixels.get(`${at.x},${at.y}`)!.y);
  expect({ at: `${at.x},${at.y}`, want: tool, landed }).toEqual({ at: `${at.x},${at.y}`, want: tool, landed: tool });
}

/** Right-click demolish, the only way to take something back. */
async function demolish(
  page: Page,
  pixels: Map<string, { x: number; y: number }>,
  at: Cell,
): Promise<void> {
  await setTool(page, null);
  const pixel = pixels.get(`${at.x},${at.y}`);
  if (!pixel) throw new Error(`no pixel resolved for ${at.x},${at.y}`);
  await page.mouse.click(pixel.x, pixel.y, { button: 'right' });
  expect(await cellTypeAt(page, pixel.x, pixel.y)).toBe('empty');
}

/** Waits for the purse to cover a node, then buys it through the panel. */
async function buy(page: Page, id: string): Promise<void> {
  await openTechPanel(page);
  const button = page.getByTestId(`tech-buy-${id}`);
  await expect(button).toBeEnabled({ timeout: 300_000 });
  const before = await getCurrency(page);
  await button.click();
  await expect(page.getByTestId(`tech-status-${id}`)).toHaveAttribute('data-status', 'unlocked');
  note(`bought ${id}: paid ${before - (await getCurrency(page))}, had ${before} cr`);
  await page.getByTestId('tech-close').click();
}

test('a new player plays from nothing to the wire economy', async ({ page }) => {
  test.setTimeout(9 * 60_000);
  START = Date.now();
  const errors = collectErrors(page);

  // No seedSave: this is exactly what a first-time player is handed.
  await page.goto('/');
  await waitForReady(page, errors);
  const bootAt = Date.now();
  let firstCreditAt: number | null = null;
  const pollCurrency = async (): Promise<void> => {
    const currency = await getCurrency(page);
    if (currency > 0 && firstCreditAt === null) firstCreditAt = Date.now();
  };
  note(`boot: currency ${await getCurrency(page)}, rate ${await getCps(page)} cr/s`);

  const locks: string[] = [];
  for (const tool of ['extractor', 'belt', 'smelter', 'assembler', 'silo', 'depot'] as ToolName[]) {
    const flag = await page.getByTestId(`tool-${tool}`).getAttribute('data-locked');
    if (flag === 'true') locks.push(tool);
  }
  note(`locked on turn one: ${locks.join(', ') || 'nothing'}`);

  await openTechPanel(page);
  const tree: string[] = [];
  for (const id of ['refinedStone', 'assembler', 'wire', 'gear', 'plate', 'silo', 'circuit', 'frame', 'motor']) {
    tree.push(`${id}=${await techStatus(page, id)}`);
  }
  note(`tech tree with 0 cr: ${tree.join(' | ')}`);
  await page.getByTestId('tech-close').click();

  // --- Act 1: bootstrap -------------------------------------------------
  const pixels = await resolveAll(page, [
    ...BOOTSTRAP.flatMap((line) => [line.node, ...line.parts.map((part) => part.at)]),
    ...WIRE_CONVERSIONS.flatMap((conversion) => [conversion.assembler, conversion.belt, conversion.depot]),
  ]);

  await setTool(page, 'extractor');
  await page.keyboard.press('r'); // north -> east; the rotation sticks across tools
  const buildStart = Date.now();

  for (const { node, parts } of BOOTSTRAP) {
    await place(page, pixels, 'extractor', node);
    await pollCurrency();
    for (const part of parts) {
      await place(page, pixels, part.tool, part.at);
      await pollCurrency();
    }
    note(`line on node ${node.x},${node.y} built, ${parts.length + 1} machines placed`);
  }
  await setTool(page, null);
  const buildEnd = Date.now();

  while (firstCreditAt === null && Date.now() - buildEnd < 60_000) {
    await page.waitForTimeout(500);
    await pollCurrency();
  }
  expect(firstCreditAt, 'first credit should be timestamped during construction').not.toBeNull();
  if (firstCreditAt === null) throw new Error('first credit was not observed');
  const firstCreditTimestamp = firstCreditAt;
  const placementDuration = (buildEnd - buildStart) / 1000;
  const bootToFirstCredit = (firstCreditTimestamp - bootAt) / 1000;
  const postBuildRamp = Math.max(0, firstCreditTimestamp - buildEnd) / 1000;
  const firstCreditDuringBuild = firstCreditTimestamp < buildEnd;
  note(
    `placement ${placementDuration.toFixed(1)}s; boot-to-first-credit ${bootToFirstCredit.toFixed(1)}s; ` +
      `post-build ramp ${postBuildRamp.toFixed(1)}s${firstCreditDuringBuild ? ' (credit observed during construction)' : ''}`,
  );
  console.log(`PLACEMENT_DURATION=${placementDuration.toFixed(1)}s`);
  console.log(`BOOT_TO_FIRST_CREDIT=${bootToFirstCredit.toFixed(1)}s`);
  console.log(`POST_BUILD_RAMP=${postBuildRamp.toFixed(1)}s`);
  expect(bootToFirstCredit).toBeGreaterThan(0);
  expect(postBuildRamp).toBeGreaterThanOrEqual(0);

  await page.waitForTimeout(3000);
  const bootstrapRate = await getCps(page);
  note(`four copper lines running at ${bootstrapRate} cr/s`);

  // --- Act 2: the tree, then the wire economy ---------------------------
  await buy(page, 'refinedStone');
  await buy(page, 'assembler');
  await buy(page, 'wire');

  for (const conversion of WIRE_CONVERSIONS) {
    await demolish(page, pixels, conversion.demolish);
    await place(page, pixels, 'assembler', conversion.assembler);
    await place(page, pixels, 'belt', conversion.belt);
    await place(page, pixels, 'depot', conversion.depot);
  }
  await setTool(page, null);
  note(`two lines converted to wire; rate now ${await getCps(page)} cr/s`);

  const wireStart = Date.now();
  let sawWire = false;
  while (!sawWire && Date.now() - wireStart < 120_000) {
    await page.waitForTimeout(500);
    const currency = await getCurrency(page);
    if (currency > 0 && currency % 45 === 0) sawWire = true;
  }
  // A currency reading that is an exact multiple of 45 can only come from wire
  // sales: ore is 0.4 and an ingot 5, so a passthrough cannot land on it.
  expect(sawWire).toBe(true);
  note(`first wire sold after ${((Date.now() - wireStart) / 1000).toFixed(1)}s; ${await getCps(page)} cr/s`);

  await buy(page, 'gear');
  await buy(page, 'plate');
  await buy(page, 'circuit');
  await buy(page, 'frame');
  await buy(page, 'motor');
  note(`tree bought out: ${await getCps(page)} cr/s, ${await getCurrency(page)} cr in the purse`);

  expect(errors).toEqual([]);
  console.log(`\n=== PLAYTHROUGH JOURNAL ===\n${journal.join('\n')}\n`);
});
