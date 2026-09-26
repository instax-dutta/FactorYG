import { expect, test, type Page } from "@playwright/test";
import { RESOURCES } from "../../src/content/resources";
import { UNLOCKS } from "../../src/content/unlocks";
import { SAVE_KEY, STARTING_CURRENCY } from "../../src/sim/constants";

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
  grid: { entities: PersistedEntity[] };
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
  expect(oreLine.debit.after).toBeLessThan(EXTRACTOR_COST);

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
