import { test, expect } from '@playwright/test';
import {
  collectErrors,
  getCps,
  getCurrency,
  setTool,
  cellAt,
  cellToPixelAtZoom,
  zoomOutFully,
  dragBy,
  seedSave,
  waitForReady,
  CENTER,
  SAVE_KEY,
  type Cell,
} from './helpers';
import { startingUnlocks } from '../src/sim/techTree';
import { E2E_PLAN } from '../tests/support/e2ePlan';

/**
 * Act 3, end to end in the real browser (PLAYTEST.md §6 blocker).
 *
 * The unit acceptance tests (tests/factoryPlan.test.ts) prove the *sim* can run
 * the world-scale factory: applyPlan -> tick -> first Motor sale at 211 ticks
 * (21.1 sim-seconds at 10Hz). This spec proves the *player* can build it
 * through the real UI — every placement a genuine click, rotation through the
 * real `r` key — and records how long the whole thing takes to put a Motor on
 * a depot.
 *
 * Placement data comes from the same planner the sim tests use, serialized to
 * tests/support/e2ePlan.json by a generation test, so the browser drives the
 * exact layout the unit tests verified and the two cannot drift.
 *
 * Maintenance notes (the traps this spec already fell into once):
 *  - Resolve EVERY cell's pixel BEFORE arming any tool: findPixelForCell
 *    presses Escape while probing, which silently disarms the armed tool.
 *  - Rotation is one sticky store value across tools; each thing's planned
 *    facing is reached with real `r` presses before its click.
 *  - Assemblers auto-match recipes from their inputs (sim contract), so there
 *    is no recipe step: feeding the inputs IS assigning the recipe.
 */

const plan = E2E_PLAN;

type PlanThing = (typeof plan.machines)[number];

test('act 3: a player builds the refinery and sells a Motor', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const errors = collectErrors(page);
  const start = Date.now();
  const note = (line: string) => console.log(`[t+${((Date.now() - start) / 1000).toFixed(1)}s] ${line}`);

  await seedSave(page, {
    // The tree is a prerequisite for act 3, not what this spec measures; the
    // pace measurement is placement + ramp-up, from a funded purse.
    currency: 2500,
    machines: [...startingUnlocks().machines, 'assembler', 'silo'],
    // EXTEND the starting recipes — seedSave REPLACES the list. Missing ids
    // lock recipes the sim then legally refuses to run: passing only tier-2/3
    // locked the tier-1 ingots (cps 0.0, nothing flowed), and missing
    // refinedStone made the stone smelter sit on raw stone forever, starving
    // plate -> frame -> motor while every other arm of the factory ran fine.
    recipes: [
      ...startingUnlocks().recipes,
      'refinedStone',
      'wire',
      'gear',
      'plate',
      'circuit',
      'frame',
      'motor',
    ],
  });
  await page.goto('/');
  await waitForReady(page, errors);

  // --- camera: zoom out, then re-centre on the plan's centroid ------------
  // The plan spans x 16..58 and y 15..58. Even at ZOOM_MAX the default-centred
  // view pushes the refinery's south-east tail below the viewport (cell 58,58
  // projects to y≈754) — the first run of this spec silently never placed
  // those machines and no Motor could ever sell. So: zoom out fully, then pan
  // the map so the plan's centroid sits at screen centre, and project the
  // whole plan relative to that target.
  await zoomOutFully(page);
  const ZOOM = 40;
  const things: PlanThing[] = [...plan.machines, ...plan.belts, ...plan.crossings];
  const cx = Math.round(things.reduce((s, t) => s + t.x, 0) / things.length);
  const cy = Math.round(things.reduce((s, t) => s + t.y, 0) / things.length);
  const target: Cell = { x: cx, y: cy };
  const projectionOffsetY = -60;

  // Pan by dragging the map 1:1: the centroid's current pixel must end at the
  // screen centre. Disarm tools first so the drag pans instead of building.
  const from = cellToPixelAtZoom(target, ZOOM); // default camera still centred
  const dx = CENTER.x - from.x;
  const dy = CENTER.y + projectionOffsetY - from.y;
  if (dx !== 0 || dy !== 0) {
    await setTool(page, null);
    await dragBy(page, { x: CENTER.x, y: CENTER.y }, dx, dy);
  }

  const projectCell = (cell: Cell): { x: number; y: number } => {
    const point = cellToPixelAtZoom(cell, ZOOM, target);
    return { x: point.x, y: point.y + projectionOffsetY };
  };

  // Validate the projection against the app itself before trusting 326
  // placements to the math: one probe per plan extreme.
  const probeCells: Cell[] = [
    { x: 16, y: 38 }, // stone, west
    { x: 35, y: 18 }, // coal, north
    { x: 58, y: 58 }, // refinery tail, south-east — the cells the first run lost
  ];
  for (const probe of probeCells) {
    const p = projectCell(probe);
    const reported = await cellAt(page, p.x, p.y);
    if (reported !== `${probe.x},${probe.y}`) {
      throw new Error(
        `projection probe failed: cell ${probe.x},${probe.y} -> pixel ${p.x},${p.y} reported "${reported}"`,
      );
    }
  }

  const pixels = new Map<string, { x: number; y: number }>();
  for (const thing of things) {
    pixels.set(`${thing.x},${thing.y}`, projectCell({ x: thing.x, y: thing.y }));
  }
  note(`${things.length} pixels resolved, camera centred on ${cx},${cy} (plan: ${plan.machines.length} machines, ${plan.belts.length} belts, ${plan.crossings.length} crossings)`);

  // --- place everything, rotating to the plan's facing --------------------
  // Order matters and is not cosmetic: applyPlan places machines, then
  // crossings, then belts. The first run of this spec placed belts before
  // crossings — so every crossing cell already held a belt, sim.place refused
  // silently, 16 crossings never existed, and no corridor that rides one could
  // ever deliver. Same order as the planner, or the same plan builds broken.
  const order = [...plan.machines, ...plan.crossings, ...plan.belts];
  const buildStart = Date.now();
  let rotation = 0; // the store's sticky rotation, sim convention (0 = north)
  for (const thing of order) {
    await setTool(page, thing.type as 'belt');
    const wanted = ((thing.rotation % 360) + 360) % 360;
    const presses = (wanted / 90 - rotation / 90 + 4) % 4;
    for (let i = 0; i < presses; i++) await page.keyboard.press('r');
    rotation = wanted;

    const pixel = pixels.get(`${thing.x},${thing.y}`)!;
    await page.mouse.click(pixel.x, pixel.y);
  }
  note(`${order.length} things placed in ${((Date.now() - buildStart) / 1000).toFixed(1)}s`);

  // --- verify the arrangement from the save (ground truth, incl. rotation) --
  // The inspector can confirm a cell's TYPE but not its facing, and this
  // spec's first runs failed on exactly the things pixels can't see: a
  // silently-refused placement, a belt facing the wrong way. The save holds
  // every entity with its rotation, so diff the whole world against the plan
  // and name the first mismatches — before waiting on an economy that cannot
  // start.
  await setTool(page, null);
  // The autosave lands every 5 sim-seconds; a blind short wait races it and
  // the tail of the build reads as "missing" (this spec did exactly that).
  // Poll until the save holds every placement before diffing.
  const readEntities = () =>
    page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { grid?: { entities?: Array<{ type: string; x: number; y: number; rotation: number }> } };
      return parsed.grid?.entities ?? null;
    }, SAVE_KEY);
  let world: Array<{ type: string; x: number; y: number; rotation: number }> | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    world = await readEntities();
    if (world && world.length >= order.length) break;
    await page.waitForTimeout(500);
  }
  expect(world, 'a save with entities exists').not.toBeNull();

  const planned = new Map(order.map((t) => [`${t.x},${t.y}`, t]));
  const placed = new Map(world!.map((e) => [`${e.x},${e.y}`, e]));
  const problems: string[] = [];
  for (const [at, want] of planned) {
    const got = placed.get(at);
    if (!got) problems.push(`${at}: missing (wanted ${want.type})`);
    else if (got.type !== want.type) problems.push(`${at}: ${got.type}, wanted ${want.type}`);
    else if (got.rotation !== want.rotation) problems.push(`${at}: ${got.type} faces ${got.rotation}, wanted ${want.rotation}`);
  }
  for (const [at, got] of placed) {
    if (!planned.has(at)) problems.push(`${at}: unexpected ${got.type}`);
  }
  if (problems.length > 0) {
    throw new Error(`world differs from plan (${problems.length} cells):\n  ${problems.slice(0, 12).join('\n  ')}`);
  }
  note(`all ${order.length} placements verified against the save, rotations included`);

  // --- the pace measurement: wait for the first Motor's worth of income ---
  // The refinery's only depot feed is the motor assembler's line, so every
  // sale here is a motor worth 1500. Baseline is the purse after placement
  // (before any sale — nothing sells until the belts close the loops), and the
  // first sale is baseline + 1500 exactly. Comparing against the baseline,
  // not against zero, keeps this correct however much the seed left in it.
  const baseline = await getCurrency(page);
  const saleStart = Date.now();
  const SALE_WINDOW_MS = 5 * 60_000;
  let firstMotorAt: number | null = null;
  let lastHolding = '';
  while (Date.now() - saleStart < SALE_WINDOW_MS) {
    await page.waitForTimeout(2000);
    const currency = await getCurrency(page);
    if (currency > baseline && (currency - baseline) % 1500 === 0) {
      firstMotorAt = (Date.now() - start) / 1000;
      break;
    }
    // Live trace of the jam forming: what each assembler holds, so a leak
    // (input that can never be consumed) names its machine while it happens.
    const trace = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return 'no save';
      const parsed = JSON.parse(raw) as { grid?: { entities?: Array<{ type: string; x: number; y: number; item: string | null; inputs?: Record<string, number>; recipe?: string | null }> } };
      const entities = parsed.grid?.entities ?? [];
      return entities
        .filter((e) => e.type === 'assembler')
        .map((e) => `a@${e.x},${e.y} recipe=${e.recipe ?? '-'} in=${JSON.stringify(e.inputs ?? {})}`)
        .join(' | ');
    }, SAVE_KEY);
    if (trace !== lastHolding) {
      lastHolding = trace;
      note(`trace: ${trace}`);
    }
  }

  if (firstMotorAt === null) {
    // Name the stage that stalled instead of leaving a ten-minute blank:
    // machines holding items means the belts broke; silos full means the
    // corridors work and the refinery is the problem.
    const diag = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return 'no save';
      const parsed = JSON.parse(raw) as {
        grid?: { entities?: Array<{ type: string; item: string | null; inputs?: Record<string, number> }> };
        productionChains?: Record<string, unknown>;
      };
      const entities = parsed.grid?.entities ?? [];
      const holding = entities.filter((e) => e.item !== null || Object.keys(e.inputs ?? {}).length > 0);
      const byType: Record<string, number> = {};
      for (const e of holding) byType[`${e.type}:${e.item ?? Object.keys(e.inputs ?? {}).join('+')}`] = (byType[`${e.type}:${e.item ?? Object.keys(e.inputs ?? {}).join('+')}`] ?? 0) + 1;
      return `chains=${Object.keys(parsed.productionChains ?? {}).length} holding=${JSON.stringify(byType)}`;
    }, SAVE_KEY);
    note(`STALL DIAGNOSTICS: ${diag}`);
  }
  expect(firstMotorAt, 'a Motor was never sold').not.toBeNull();
  note(`FIRST MOTOR SOLD at t+${firstMotorAt!.toFixed(1)}s; rate ${await getCps(page)} cr/s`);
  console.log(`TIME_TO_FIRST_MOTOR=${firstMotorAt!.toFixed(1)}s`);

  expect(errors).toEqual([]);
});
