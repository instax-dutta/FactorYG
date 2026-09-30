import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { RECIPES } from "../../src/content/recipes";
import { RESOURCES } from "../../src/content/resources";
import { UNLOCKS } from "../../src/content/unlocks";
import { STARTING_CURRENCY } from "../../src/content/balance";
import { NEW_GAME_SEED, createInitialState } from "../../src/sim/initialState";
import { SAVE_KEY } from "../../src/sim/constants";

interface CommandResult {
  ok: boolean;
  reason?: string;
}

interface RuntimeSnapshot {
  currency: number;
  unlockedMachines: readonly string[];
  unlockedRecipes: readonly string[];
}

interface RuntimeBridge {
  dispatch(command: Record<string, unknown>): CommandResult;
  advanceTicks(count: number): void;
  getSnapshot(): RuntimeSnapshot;
}

interface RenderTelemetry {
  entityIds: readonly string[];
  activeFrameKeys: readonly string[];
  beltItemIds: readonly string[];
}

interface TelemetryBridge {
  getSnapshot(): { ready: boolean; render: RenderTelemetry };
}

interface RuntimeWindow {
  __FACTOR_Y__?: RuntimeBridge;
  __FACTOR_Y_TELEMETRY__?: TelemetryBridge;
}

interface PersistedEntity {
  id: string;
  type: string;
  x: number;
  y: number;
  rotation: number;
  recipeId?: string;
  resourceNode?: string;
}

interface PersistedMachineRuntime {
  alreadyNotifiedBlocked?: boolean;
}

interface PersistedChain {
  id: string;
  outputResource: string;
  steadyStateThroughput: number;
  sellValue: number;
}

interface PersistedSave {
  currency: number;
  lifetimeCurrency: number;
  unlocked: { machines: string[]; recipes: string[] };
  grid: { entities: PersistedEntity[]; machines: Record<string, PersistedMachineRuntime> };
  productionChains: Record<string, PersistedChain>;
}

const TICK_CHUNK = 200;
const MAX_CHUNKS = 250;
const WIRE_SELL_VALUE = RESOURCES.wire.sellValue;
const SMELTER_UNLOCK_COST = UNLOCKS.machineUnlocks.smelter.cost;
const ASSEMBLER_UNLOCK_COST = UNLOCKS.machineUnlocks.assembler.cost;
const COPPER_INGOT_UNLOCK_COST = UNLOCKS.recipeUnlocks.copperIngot.cost;
const WIRE_UNLOCK_COST = UNLOCKS.recipeUnlocks.wire.cost;

const EXTRACTOR_COST = 50;
const BELT_COST = 10;
const DEPOT_COST = 100;
const SMELTER_COST = 250;
const ASSEMBLER_COST = 500;

const ROTATED = 90;
const CHAIN_X = 22;
const ORE_NODE_Y = 19;
const SMELTER_Y = 20;
const BELT_Y = 21;
const BELT_MID_Y = 22;
const BELT_TAIL_Y = 23;
const ROTATED_ASSEMBLER_Y = 24;
const DEPOT_Y = 25;

const COAL_LINES: ReadonlyArray<{
  readonly node: readonly [number, number];
  readonly depot: readonly [number, number];
}> = [
  { node: [0, 47], depot: [1, 47] },
  { node: [28, 37], depot: [29, 37] },
  { node: [40, 54], depot: [41, 54] },
];

const COAL_LINE_COST = EXTRACTOR_COST + DEPOT_COST;
const COAL_TOTAL_COST = COAL_LINES.length * COAL_LINE_COST;
const ORE_LINE_COST = EXTRACTOR_COST + SMELTER_COST;
const BELT_RUN_COST = BELT_COST * 3;
const COMPLETION_COST = ASSEMBLER_COST + DEPOT_COST;

const ORE_EXTRACTOR_ID = "entity-7";
const SMELTER_ID = "entity-8";
const BELT_IDS = ["entity-9", "entity-10", "entity-11"] as const;
const ROTATED_ASSEMBLER_ID = "entity-12";
const WIRE_DEPOT_ID = "entity-13";
const WIRE_CHAIN_ID = `chain-${ORE_EXTRACTOR_ID}`;

const PLACED_TYPES_BEFORE_DEMOLITION = [
  "extractor",
  "depot",
  "extractor",
  "depot",
  "extractor",
  "depot",
  "extractor",
  "smelter",
  "belt",
  "belt",
  "belt",
  "assembler",
  "depot",
];
const PLACED_TYPES_AFTER_DEMOLITION = [
  "extractor",
  "smelter",
  "belt",
  "belt",
  "belt",
  "assembler",
  "depot",
];

test.use({ viewport: { width: 1000, height: 800 } });

async function waitForReady(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const runtime = window as unknown as RuntimeWindow;
        return (
          runtime.__FACTOR_Y__ !== undefined &&
          runtime.__FACTOR_Y_TELEMETRY__?.getSnapshot().ready === true
        );
      }),
    )
    .toBe(true);
}

async function openWithClearedSave(page: Page): Promise<number> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReady(page);
  return (await bridgeSnapshot(page)).currency;
}

function bridgeSnapshot(page: Page): Promise<RuntimeSnapshot> {
  return page.evaluate(() => {
    const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
    if (bridge === undefined) {
      throw new Error("Factor-Y runtime bridge unavailable");
    }
    return bridge.getSnapshot();
  });
}

function bridgeCurrency(page: Page): Promise<number> {
  return bridgeSnapshot(page).then((snapshot) => snapshot.currency);
}

interface DebitEvidence {
  before: number;
  after: number;
}

function dispatchAll(
  page: Page,
  commands: ReadonlyArray<Record<string, unknown>>,
): Promise<{ debit: DebitEvidence; results: CommandResult[] }> {
  return page.evaluate((payload) => {
    const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
    if (bridge === undefined) {
      throw new Error("Factor-Y runtime bridge unavailable");
    }
    const before = bridge.getSnapshot().currency;
    const results = payload.map((command) => bridge.dispatch(command));
    return { debit: { before, after: bridge.getSnapshot().currency }, results };
  }, [...commands]);
}

function persistedSave(page: Page): Promise<PersistedSave> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      throw new Error("Expected a persisted save");
    }
    return JSON.parse(raw) as PersistedSave;
  }, SAVE_KEY);
}

function persistedEntityTypes(page: Page): Promise<string[]> {
  return persistedSave(page).then((save) => save.grid.entities.map((entity) => entity.type));
}

function hudCurrency(page: Page): Promise<number> {
  return page.getByTestId("hud-currency").innerText().then((text) => {
    const parsed = Number(text.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(parsed)) {
      throw new Error(`Unexpected HUD currency text: ${text}`);
    }
    return parsed;
  });
}

interface AdvanceOutcome {
  chunks: number;
  currency: number;
}

async function advanceUntilCurrencyAtLeast(page: Page, goal: number): Promise<AdvanceOutcome> {
  const observed = await page.evaluate(
    async ({ target, chunk, maxChunks }) => {
      const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
      if (bridge === undefined) {
        throw new Error("Factor-Y runtime bridge unavailable");
      }
      const nextFrame = (): Promise<void> =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });

      for (let chunkIndex = 0; chunkIndex < maxChunks; chunkIndex += 1) {
        const currency = bridge.getSnapshot().currency;
        if (currency >= target) {
          return { chunks: chunkIndex, currency };
        }
        bridge.advanceTicks(chunk);
        await nextFrame();
      }
      return { chunks: -1, currency: bridge.getSnapshot().currency };
    },
    { target: goal, chunk: TICK_CHUNK, maxChunks: MAX_CHUNKS },
  );

  expect(observed.chunks).toBeGreaterThanOrEqual(0);
  expect(observed.currency).toBeGreaterThanOrEqual(goal);
  return observed;
}

async function openTechTree(page: Page): Promise<void> {
  await page.getByTestId("tech-tree-toggle").click();
  await expect(page.getByTestId("tech-tree")).toBeVisible();
  await expect(page.getByTestId("tech-tree-toggle")).toHaveAttribute("aria-expanded", "true");
}

async function closeTechTree(page: Page): Promise<void> {
  await page.getByTestId("tech-tree-close").click();
  await expect(page.getByTestId("tech-tree")).toHaveCount(0);
  await expect(page.getByTestId("tech-tree-toggle")).toHaveAttribute("aria-expanded", "false");
}

interface UnlockPurchase {
  readonly key: string;
  readonly label: string;
  readonly cost: number;
  readonly notificationId: string;
}

async function purchaseUnlock(page: Page, purchase: UnlockPurchase): Promise<void> {
  await openTechTree(page);
  const entry = page.getByTestId(`tech-tree-entry-${purchase.key}`);
  const button = page.getByRole("button", { name: `Unlock ${purchase.label}` });

  await expect(entry).toHaveAttribute("data-cost", String(purchase.cost));
  await expect(entry).toHaveAttribute("data-state", "available");
  await expect(button).toBeEnabled();

  const debit = await page.evaluate((testId) => {
    const control = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (control === null) {
      throw new Error(`Unlock control ${testId} is absent`);
    }
    const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
    if (bridge === undefined) {
      throw new Error("Factor-Y runtime bridge unavailable");
    }
    const before = bridge.getSnapshot().currency;
    control.click();
    return { before, after: bridge.getSnapshot().currency };
  }, `tech-tree-unlock-${purchase.key}`);

  expect(debit.before).toBeGreaterThanOrEqual(purchase.cost);
  expect(debit.before - debit.after).toBe(purchase.cost);
  await expect(entry).toHaveAttribute("data-state", "unlocked");
  await closeTechTree(page);
  await expect(page.getByTestId(`notification-${purchase.notificationId}`)).toBeVisible();
}

interface WireSaleObservation {
  ticks: number;
  currencyBefore: number;
  currencyAfter: number;
  sawAssemblerActiveFrame: boolean;
  sawBeltItem: boolean;
  renderedEntityIds: readonly string[];
}

async function observeWireDepotSale(page: Page): Promise<WireSaleObservation> {
  const observed = await page.evaluate(
    async ({ maxTicks }) => {
      const runtime = window as unknown as RuntimeWindow;
      const bridge = runtime.__FACTOR_Y__;
      const telemetry = runtime.__FACTOR_Y_TELEMETRY__;
      if (bridge === undefined || telemetry === undefined) {
        throw new Error("Factor-Y bridges unavailable");
      }
      const nextFrame = (): Promise<void> =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });
      const isAssemblerFrame = (key: string): boolean =>
        /^factor-y:machine\.assembler\.active:[01]$/.test(key);

      const currencyBefore = bridge.getSnapshot().currency;
      let sawAssemblerActiveFrame = false;
      let sawBeltItem = false;
      let ticks = 0;
      let currencyAfter = currencyBefore;

      while (ticks < maxTicks) {
        bridge.advanceTicks(1);
        ticks += 1;
        await nextFrame();
        const render = telemetry.getSnapshot().render;
        sawAssemblerActiveFrame = sawAssemblerActiveFrame || render.activeFrameKeys.some(isAssemblerFrame);
        sawBeltItem = sawBeltItem || render.beltItemIds.length > 0;
        currencyAfter = bridge.getSnapshot().currency;
        if (currencyAfter > currencyBefore && sawAssemblerActiveFrame && sawBeltItem) {
          break;
        }
      }

      return {
        ticks,
        currencyBefore,
        currencyAfter,
        sawAssemblerActiveFrame,
        sawBeltItem,
        renderedEntityIds: [...telemetry.getSnapshot().render.entityIds],
      };
    },
    { maxTicks: 400 },
  );

  expect(observed.ticks).toBeGreaterThan(0);
  return observed;
}

test("earns the tech tree from ore sales and runs copper to wire on a rotated assembler", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  const startingCurrency = await openWithClearedSave(page);
  expect(startingCurrency).toBe(STARTING_CURRENCY);
  expect(await hudCurrency(page)).toBe(STARTING_CURRENCY);

  const coalCommands = COAL_LINES.flatMap((line) => [
    { type: "placeEntity", machine: "extractor", x: line.node[0], y: line.node[1], rotation: 0 },
    { type: "placeEntity", machine: "depot", x: line.depot[0], y: line.depot[1], rotation: 0 },
  ]);
  const coal = await dispatchAll(page, coalCommands);
  expect(coal.results).toEqual(coalCommands.map(() => ({ ok: true })));
  expect(coal.debit.before - coal.debit.after).toBe(COAL_TOTAL_COST);
  expect(coal.debit.before).toBeGreaterThanOrEqual(COAL_TOTAL_COST);
  expect(coal.debit.after).toBeGreaterThanOrEqual(0);
  expect(await hudCurrency(page)).toBe(coal.debit.after);

  await openTechTree(page);
  await expect(page.getByTestId("tech-tree-entry-machine-smelter")).toHaveAttribute(
    "data-state",
    "unaffordable",
  );
  await expect(page.getByTestId("tech-tree-entry-machine-smelter")).toHaveAttribute(
    "data-reason",
    "insufficientCurrency",
  );
  await expect(page.getByTestId("tech-tree-entry-machine-assembler")).toHaveAttribute(
    "data-state",
    "prerequisite-locked",
  );
  await expect(page.getByTestId("tech-tree-entry-recipe-wire")).toHaveAttribute(
    "data-state",
    "prerequisite-locked",
  );
  await expect(page.getByTestId("build-assembler")).toBeDisabled();
  await closeTechTree(page);

  await advanceUntilCurrencyAtLeast(page, SMELTER_UNLOCK_COST);
  await purchaseUnlock(page, {
    key: "machine-smelter",
    label: "Smelter",
    cost: SMELTER_UNLOCK_COST,
    notificationId: "unlock-machine-smelter",
  });
  const afterSmelter = await bridgeSnapshot(page);
  expect(afterSmelter.unlockedMachines).toEqual(["extractor", "belt", "depot", "smelter"]);
  await expect(page.getByTestId("build-smelter")).toBeEnabled();
  await expect(page.getByTestId("build-assembler")).toBeDisabled();

  await advanceUntilCurrencyAtLeast(page, COPPER_INGOT_UNLOCK_COST);
  await purchaseUnlock(page, {
    key: "recipe-copperIngot",
    label: "Copper Ingot",
    cost: COPPER_INGOT_UNLOCK_COST,
    notificationId: "unlock-recipe-copperIngot",
  });
  const afterCopperIngot = await bridgeSnapshot(page);
  expect(afterCopperIngot.unlockedRecipes).toEqual(["copperIngot"]);

  const refusedAssembler = await page.evaluate(() => {
    const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
    if (bridge === undefined) {
      throw new Error("Factor-Y runtime bridge unavailable");
    }
    return bridge.dispatch({ type: "unlockMachine", machine: "assembler" });
  });
  expect(refusedAssembler).toEqual({ ok: false, reason: "insufficientCurrency" });
  expect((await bridgeSnapshot(page)).unlockedMachines).not.toContain("assembler");

  await advanceUntilCurrencyAtLeast(page, ORE_LINE_COST);
  const oreLine = await dispatchAll(page, [
    {
      type: "placeEntity",
      machine: "extractor",
      x: CHAIN_X,
      y: ORE_NODE_Y,
      rotation: ROTATED,
      resourceNode: "copperOre",
    },
    {
      type: "placeEntity",
      machine: "smelter",
      x: CHAIN_X,
      y: SMELTER_Y,
      rotation: ROTATED,
      recipeId: "copperIngot",
    },
  ]);
  expect(oreLine.results).toEqual([{ ok: true }, { ok: true }]);
  expect(oreLine.debit.before - oreLine.debit.after).toBe(ORE_LINE_COST);
  expect(oreLine.debit.after).toBeGreaterThanOrEqual(0);
  expect(oreLine.debit.after).toBeLessThan(ASSEMBLER_UNLOCK_COST);

  await advanceUntilCurrencyAtLeast(page, ASSEMBLER_UNLOCK_COST);
  await purchaseUnlock(page, {
    key: "machine-assembler",
    label: "Assembler",
    cost: ASSEMBLER_UNLOCK_COST,
    notificationId: "unlock-machine-assembler",
  });
  expect((await bridgeSnapshot(page)).unlockedMachines).toEqual([
    "extractor",
    "belt",
    "depot",
    "smelter",
    "assembler",
  ]);
  await expect(page.getByTestId("build-assembler")).toBeEnabled();

  await advanceUntilCurrencyAtLeast(page, WIRE_UNLOCK_COST);
  await purchaseUnlock(page, {
    key: "recipe-wire",
    label: "Wire",
    cost: WIRE_UNLOCK_COST,
    notificationId: "unlock-recipe-wire",
  });
  expect((await bridgeSnapshot(page)).unlockedRecipes).toEqual(["copperIngot", "wire"]);

  await advanceUntilCurrencyAtLeast(page, COMPLETION_COST + BELT_RUN_COST);
  const completion = await dispatchAll(page, [
    { type: "placeEntity", machine: "belt", x: CHAIN_X, y: BELT_Y, rotation: ROTATED },
    { type: "placeEntity", machine: "belt", x: CHAIN_X, y: BELT_MID_Y, rotation: ROTATED },
    { type: "placeEntity", machine: "belt", x: CHAIN_X, y: BELT_TAIL_Y, rotation: ROTATED },
    {
      type: "placeEntity",
      machine: "assembler",
      x: CHAIN_X,
      y: ROTATED_ASSEMBLER_Y,
      rotation: ROTATED,
      recipeId: "wire",
    },
    { type: "placeEntity", machine: "depot", x: CHAIN_X, y: DEPOT_Y, rotation: ROTATED },
  ]);
  expect(completion.results).toEqual([
    { ok: true },
    { ok: true },
    { ok: true },
    { ok: true },
    { ok: true },
  ]);
  expect(completion.debit.before - completion.debit.after).toBe(
    COMPLETION_COST + BELT_RUN_COST,
  );

  await expect.poll(() => persistedEntityTypes(page)).toEqual(PLACED_TYPES_BEFORE_DEMOLITION);
  const rotatedChain = (await persistedSave(page)).grid.entities.filter(
    (entity) =>
      entity.id === ORE_EXTRACTOR_ID ||
      entity.id === SMELTER_ID ||
      entity.id === ROTATED_ASSEMBLER_ID ||
      entity.id === WIRE_DEPOT_ID,
  );
  expect(
    rotatedChain.map((entity) => ({
      id: entity.id,
      type: entity.type,
      x: entity.x,
      y: entity.y,
      rotation: entity.rotation,
      recipeId: entity.recipeId,
      resourceNode: entity.resourceNode,
    })),
  ).toEqual([
    {
      id: ORE_EXTRACTOR_ID,
      type: "extractor",
      x: CHAIN_X,
      y: ORE_NODE_Y,
      rotation: ROTATED,
      recipeId: undefined,
      resourceNode: "copperOre",
    },
    {
      id: SMELTER_ID,
      type: "smelter",
      x: CHAIN_X,
      y: SMELTER_Y,
      rotation: ROTATED,
      recipeId: "copperIngot",
      resourceNode: undefined,
    },
    {
      id: ROTATED_ASSEMBLER_ID,
      type: "assembler",
      x: CHAIN_X,
      y: ROTATED_ASSEMBLER_Y,
      rotation: ROTATED,
      recipeId: "wire",
      resourceNode: undefined,
    },
    {
      id: WIRE_DEPOT_ID,
      type: "depot",
      x: CHAIN_X,
      y: DEPOT_Y,
      rotation: ROTATED,
      recipeId: undefined,
      resourceNode: undefined,
    },
  ]);

  const demolition = await dispatchAll(
    page,
    ["entity-1", "entity-2", "entity-3", "entity-4", "entity-5", "entity-6"].map(
      (entityId) => ({ type: "demolishEntity", entityId }),
    ),
  );
  expect(demolition.results).toEqual([
    { ok: true },
    { ok: true },
    { ok: true },
    { ok: true },
    { ok: true },
    { ok: true },
  ]);
  expect(demolition.debit.before - demolition.debit.after).toBe(0);
  await expect.poll(() => persistedEntityTypes(page)).toEqual(PLACED_TYPES_AFTER_DEMOLITION);

  const sale = await observeWireDepotSale(page);
  expect(sale.renderedEntityIds).toEqual([
    ORE_EXTRACTOR_ID,
    SMELTER_ID,
    ...BELT_IDS,
    ROTATED_ASSEMBLER_ID,
    WIRE_DEPOT_ID,
  ]);
  expect(sale.sawAssemblerActiveFrame).toBe(true);
  expect(sale.sawBeltItem).toBe(true);

  const saleGain = sale.currencyAfter - sale.currencyBefore;
  expect(saleGain).toBeGreaterThanOrEqual(WIRE_SELL_VALUE);
  expect(saleGain % WIRE_SELL_VALUE).toBe(0);

  const bridgeAfterSale = await bridgeCurrency(page);
  expect(bridgeAfterSale).toBeGreaterThanOrEqual(sale.currencyAfter);
  await expect.poll(() => hudCurrency(page)).toBeGreaterThanOrEqual(bridgeAfterSale);
  expect((await hudCurrency(page)) % WIRE_SELL_VALUE).toBe(
    demolition.debit.after % WIRE_SELL_VALUE,
  );

  await expect
    .poll(
      async () =>
        (await persistedSave(page)).productionChains[WIRE_CHAIN_ID]?.steadyStateThroughput ?? 0,
    )
    .toBeGreaterThan(0);
  const savedChains = (await persistedSave(page)).productionChains;
  expect(Object.keys(savedChains)).toEqual([WIRE_CHAIN_ID]);
  expect(savedChains[WIRE_CHAIN_ID]).toEqual({
    id: WIRE_CHAIN_ID,
    outputResource: "wire",
    steadyStateThroughput: expect.any(Number),
    sellValue: WIRE_SELL_VALUE,
  });
  expect(savedChains[WIRE_CHAIN_ID]?.steadyStateThroughput).toBeGreaterThan(0);

  const finalSave = await persistedSave(page);
  expect(finalSave.unlocked).toEqual({
    machines: ["extractor", "belt", "depot", "smelter", "assembler"],
    recipes: ["copperIngot", "wire"],
  });
  expect(finalSave.lifetimeCurrency).toBeGreaterThan(0);
  expect(browserErrors).toEqual([]);
});

interface FarmLine {
  readonly extractor: { readonly x: number; readonly y: number; readonly rotation: number };
  readonly depot: { readonly x: number; readonly y: number; readonly rotation: number };
  readonly cost: number;
}

interface UnlockStep {
  readonly key: string;
  readonly cost: number;
  readonly machines: readonly string[];
  readonly recipes: readonly string[];
}

const MOTOR_LAYOUT_FILE = fileURLToPath(
  new URL("../../scripts/motor-chain-layout.json", import.meta.url),
);

const FARM_CHUNK = 200;
const FARM_MAX_CHUNKS = 600;
const FARM_TARGET = 35_000;
const PRODUCTION_CHUNK = 200;
const PRODUCTION_MAX_CHUNKS = 150;
const MOTOR_SELL_VALUE = RECIPES.motor.sellValue;
const MOTOR_PROCESSORS = ["motor", "frame", "plate", "circuit", "gear", "wire"] as const;

function motorLayout(): ReadonlyArray<Record<string, number | string>> {
  return JSON.parse(readFileSync(MOTOR_LAYOUT_FILE, "utf8")) as ReadonlyArray<
    Record<string, number | string>
  >;
}

function farmPlan(): FarmLine[] {
  const nodes = createInitialState(NEW_GAME_SEED).grid.nodes;
  const nodeCells = new Set(nodes.map((node) => `${node.x},${node.y}`));
  const taken = new Set<string>();
  const directions: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const plan: FarmLine[] = [];

  for (const node of [...nodes].sort(
    (a, b) => RESOURCES[b.resource].sellValue - RESOURCES[a.resource].sellValue,
  )) {
    for (let rotation = 0; rotation < directions.length; rotation += 1) {
      const [dx, dy] = directions[rotation];
      const depotX = node.x + dx;
      const depotY = node.y + dy;
      const depotCell = `${depotX},${depotY}`;
      if (depotX < 0 || depotY < 0 || depotX > 63 || depotY > 63) {
        continue;
      }
      if (nodeCells.has(depotCell) || taken.has(depotCell)) {
        continue;
      }
      plan.push({
        extractor: { x: node.x, y: node.y, rotation },
        depot: { x: depotX, y: depotY, rotation },
        cost: EXTRACTOR_COST + DEPOT_COST,
      });
      taken.add(`${node.x},${node.y}`);
      taken.add(depotCell);
      break;
    }
  }
  return plan;
}

function unlockSteps(): UnlockStep[] {
  const entries = [
    ...Object.entries(UNLOCKS.machineUnlocks).map(([id, entry]) => ({
      key: `machine-${id}`,
      cost: entry.cost,
      machines: entry.requiresMachines,
      recipes: entry.requiresRecipes,
    })),
    ...Object.entries(UNLOCKS.recipeUnlocks).map(([id, entry]) => ({
      key: `recipe-${id}`,
      cost: entry.cost,
      machines: entry.requiresMachines,
      recipes: entry.requiresRecipes,
    })),
  ];
  const ordered: UnlockStep[] = [];
  const done = new Set<string>();
  const locked = new Set(entries.map((entry) => entry.key));
  const unmet = (entry: UnlockStep): boolean =>
    entry.machines.some((id) => locked.has(`machine-${id}`) && !done.has(`machine-${id}`)) ||
    entry.recipes.some((id) => locked.has(`recipe-${id}`) && !done.has(`recipe-${id}`));

  while (ordered.length < entries.length) {
    const next = entries.find((entry) => !done.has(entry.key) && !unmet(entry));
    if (next === undefined) {
      throw new Error("Unlock prerequisites are not satisfiable");
    }
    done.add(next.key);
    ordered.push(next);
  }
  return ordered;
}

async function farmUntilCurrency(
  page: Page,
  target: number,
  plan: ReadonlyArray<FarmLine>,
): Promise<number> {
  const outcome = await page.evaluate(
    async ({ goal, lines, chunk, maxChunks }) => {
      const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
      if (bridge === undefined) {
        throw new Error("Factor-Y runtime bridge unavailable");
      }
      const nextFrame = (): Promise<void> =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });
      let next = 0;
      let built = 0;

      for (let step = 0; step < maxChunks; step += 1) {
        if (bridge.getSnapshot().currency >= goal) {
          return { reached: true, currency: bridge.getSnapshot().currency, built };
        }
        while (next < lines.length) {
          const line = lines[next];
          if (bridge.getSnapshot().currency < line.cost) {
            break;
          }
          bridge.dispatch({ type: "placeEntity", machine: "depot", x: line.depot.x, y: line.depot.y, rotation: line.depot.rotation });
          const placed = bridge.dispatch({
            type: "placeEntity",
            machine: "extractor",
            x: line.extractor.x,
            y: line.extractor.y,
            rotation: line.extractor.rotation,
          });
          if (placed.ok) {
            built += 1;
          }
          next += 1;
        }
        bridge.advanceTicks(chunk);
        await nextFrame();
      }
      return { reached: false, currency: bridge.getSnapshot().currency, built };
    },
    { goal: target, lines: [...plan], chunk: FARM_CHUNK, maxChunks: FARM_MAX_CHUNKS },
  );

  expect(outcome.reached).toBe(true);
  expect(outcome.currency).toBeGreaterThanOrEqual(target);
  expect(outcome.built).toBeGreaterThan(0);
  return outcome.currency;
}

async function purchaseUnlockByKey(page: Page, step: UnlockStep): Promise<void> {
  await openTechTree(page);
  const entry = page.getByTestId(`tech-tree-entry-${step.key}`);
  await expect(entry).toHaveAttribute("data-cost", String(step.cost));
  await expect(entry).toHaveAttribute("data-state", "available");
  await expect(page.getByTestId(`tech-tree-unlock-${step.key}`)).toBeEnabled();

  const debit = await page.evaluate((key) => {
    const control = document.querySelector<HTMLButtonElement>(`[data-testid="tech-tree-unlock-${key}"]`);
    if (control === null) {
      throw new Error(`Unlock control tech-tree-unlock-${key} is absent`);
    }
    const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
    if (bridge === undefined) {
      throw new Error("Factor-Y runtime bridge unavailable");
    }
    const before = bridge.getSnapshot().currency;
    control.click();
    return { before, after: bridge.getSnapshot().currency };
  }, step.key);

  expect(debit.before - debit.after).toBe(step.cost);
  expect(debit.after).toBeGreaterThanOrEqual(0);
  await closeTechTree(page);
}

async function demolishFarm(page: Page): Promise<number> {
  const farm = await persistedSave(page).then((save) =>
    save.grid.entities
      .filter((entity) => entity.type === "extractor" || entity.type === "depot")
      .map((entity) => entity.id),
  );
  const removed = await dispatchAll(
    page,
    farm.map((entityId) => ({ type: "demolishEntity", entityId })),
  );
  expect(removed.results).toEqual(farm.map(() => ({ ok: true })));
  return farm.length;
}

test("earns the whole tech tree from ore sales and runs the committed Motor chain to sold motors", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  const startingCurrency = await openWithClearedSave(page);
  expect(startingCurrency).toBe(STARTING_CURRENCY);

  const layout = motorLayout();
  const unlockTotal = Object.values(UNLOCKS.machineUnlocks).reduce((t, e) => t + e.cost, 0) +
    Object.values(UNLOCKS.recipeUnlocks).reduce((t, e) => t + e.cost, 0);
  const steps = unlockSteps();
  expect(steps).toHaveLength(
    Object.keys(UNLOCKS.machineUnlocks).length + Object.keys(UNLOCKS.recipeUnlocks).length,
  );
  expect(steps.reduce((total, step) => total + step.cost, 0)).toBe(unlockTotal);

  const farmed = await farmUntilCurrency(page, FARM_TARGET, farmPlan());
  expect(farmed).toBeGreaterThanOrEqual(FARM_TARGET);

  for (const step of steps) {
    await purchaseUnlockByKey(page, step);
  }
  const unlocked = await bridgeSnapshot(page);
  expect([...unlocked.unlockedMachines].sort()).toEqual(
    [
      ...createInitialState(NEW_GAME_SEED).unlocked.machines,
      ...Object.keys(UNLOCKS.machineUnlocks),
    ].sort(),
  );
  expect([...unlocked.unlockedRecipes].sort()).toEqual(Object.keys(UNLOCKS.recipeUnlocks).sort());

  const farmCount = await demolishFarm(page);
  expect(farmCount).toBeGreaterThan(0);
  expect((await persistedEntityTypes(page)).length).toBe(0);

  const commands = layout.map((entity) => ({
    type: "placeEntity",
    machine: entity.type,
    x: entity.x,
    y: entity.y,
    rotation: entity.rotation,
    ...(entity.recipeId === undefined ? {} : { recipeId: entity.recipeId }),
    ...(entity.resourceNode === undefined ? {} : { resourceNode: entity.resourceNode }),
  }));
  const built = await dispatchAll(page, commands);
  expect(built.results).toEqual(commands.map(() => ({ ok: true })));
  expect(built.debit.before - built.debit.after).toBeGreaterThan(0);
  expect(built.debit.after).toBeGreaterThanOrEqual(0);

  const save = await persistedSave(page);
  expect(save.grid.entities).toHaveLength(layout.length);
  const placedRecipes = new Set(save.grid.entities.map((entity) => entity.recipeId));
  for (const recipe of MOTOR_PROCESSORS) {
    expect(placedRecipes.has(recipe)).toBe(true);
  }

  const beforeProduction = await bridgeCurrency(page);
  const run = await page.evaluate(
    async ({ chunk, maxChunks, floor }) => {
      const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
      if (bridge === undefined) {
        throw new Error("Factor-Y runtime bridge unavailable");
      }
      const nextFrame = (): Promise<void> =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });

      for (let step = 0; step < maxChunks; step += 1) {
        bridge.advanceTicks(chunk);
        await nextFrame();
        if (bridge.getSnapshot().currency >= floor) {
          return { currency: bridge.getSnapshot().currency, chunks: step + 1 };
        }
      }
      return { currency: bridge.getSnapshot().currency, chunks: -1 };
    },
    { chunk: PRODUCTION_CHUNK, maxChunks: PRODUCTION_MAX_CHUNKS, floor: beforeProduction + MOTOR_SELL_VALUE },
  );

  expect(run.chunks).toBeGreaterThan(0);
  expect(run.currency - beforeProduction).toBeGreaterThanOrEqual(MOTOR_SELL_VALUE);

  const finalSave = await persistedSave(page);
  const motorChain = Object.values(finalSave.productionChains).find(
    (chain) => chain.outputResource === "motor",
  );
  expect(motorChain).toBeDefined();
  expect(motorChain?.sellValue).toBe(MOTOR_SELL_VALUE);

  expect(Object.keys(finalSave.grid.machines).length).toBeGreaterThan(0);
  const flagged = finalSave.grid.entities
    .filter((entity) => finalSave.grid.machines[entity.id]?.alreadyNotifiedBlocked === true)
    .map((entity) => `${entity.type}:${entity.recipeId ?? entity.resourceNode ?? "-"}@${entity.x},${entity.y}`);
  expect(flagged).toEqual([]);

  expect(await hudCurrency(page)).toBeGreaterThanOrEqual(run.currency);
  expect(browserErrors).toEqual([]);
});
