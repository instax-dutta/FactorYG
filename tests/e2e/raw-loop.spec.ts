import { expect, test, type Page } from "@playwright/test";
import { SAVE_KEY } from "../../src/sim/constants";
import { CURRENCY_RATE_WINDOW_TICKS } from "../../src/sim/economy";
import { createInitialState } from "../../src/sim/initialState";
import type { ResourceId } from "../../src/sim/types";

interface CommandResult {
  ok: boolean;
  reason?: string;
}

interface RuntimeBridge {
  dispatch(command: Record<string, unknown>): CommandResult;
  advanceTicks(count: number): void;
  getSnapshot(): { currency: number };
}

interface RenderTelemetry {
  entityIds: readonly string[];
  activeEntityIds: readonly string[];
  activeFrameKeys: readonly string[];
  beltItemIds: readonly string[];
  beltGlowCount: number;
  beltItemEventCount: number;
  blockedEntityIds: readonly string[];
}

interface SceneTelemetry {
  ready: boolean;
  render: RenderTelemetry;
}

interface TelemetryBridge {
  getSnapshot(): SceneTelemetry;
}

interface RuntimeWindow {
  __FACTOR_Y__?: RuntimeBridge;
  __FACTOR_Y_TELEMETRY__?: TelemetryBridge;
}

const COPPER_NODE = { x: 20, y: 21 };
const IRON_NODE = { x: 40, y: 11 };
const MAX_SCAN_TICKS = 80;

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
  expect(await page.evaluate((key) => window.localStorage.getItem(key), SAVE_KEY)).toBeNull();
  return bridgeCurrency(page);
}

function bridgeCurrency(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
    if (bridge === undefined) {
      throw new Error("Factor-Y runtime bridge unavailable");
    }
    return bridge.getSnapshot().currency;
  });
}

async function buildChain(
  page: Page,
  node: { x: number; y: number },
  resource: ResourceId,
  beltCount: number,
): Promise<void> {
  const results = await page.evaluate(
    ({ node, resource, beltCount }) => {
      const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
      if (bridge === undefined) {
        throw new Error("Factor-Y runtime bridge unavailable");
      }

      const placed: CommandResult[] = [
        bridge.dispatch({
          type: "placeEntity",
          machine: "extractor",
          x: node.x,
          y: node.y,
          rotation: 0,
          resourceNode: resource,
        }),
      ];
      for (let index = 0; index < beltCount; index += 1) {
        placed.push(
          bridge.dispatch({
            type: "placeEntity",
            machine: "belt",
            x: node.x + index + 1,
            y: node.y,
            rotation: 0,
          }),
        );
      }
      placed.push(
        bridge.dispatch({
          type: "placeEntity",
          machine: "depot",
          x: node.x + beltCount + 1,
          y: node.y,
          rotation: 0,
        }),
      );
      return placed;
    },
    { node, resource, beltCount },
  );

  expect(results).toHaveLength(beltCount + 2);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(results.filter((result) => !result.ok)).toEqual([]);
}

async function hudCurrency(page: Page): Promise<number> {
  const text = await page.getByTestId("hud-currency").innerText();
  const parsed = Number(text.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Unexpected HUD currency text: ${text}`);
  }
  return parsed;
}

async function advanceUntilCurrencyGrows(
  page: Page,
  baseline: number,
  maxTicks = MAX_SCAN_TICKS,
): Promise<number> {
  const observed = await page.evaluate(
    ({ baseline, maxTicks }) => {
      const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
      if (bridge === undefined) {
        throw new Error("Factor-Y runtime bridge unavailable");
      }

      for (let tick = 0; tick < maxTicks; tick += 1) {
        bridge.advanceTicks(1);
        const currency = bridge.getSnapshot().currency;
        if (currency > baseline) {
          return { tick: tick + 1, currency };
        }
      }
      return { tick: -1, currency: bridge.getSnapshot().currency };
    },
    { baseline, maxTicks },
  );

  expect(observed.tick).toBeGreaterThan(0);
  return observed.currency;
}

interface BeltLineObservation {
  readonly glowTicks: number;
  readonly glow: RenderTelemetry;
  readonly drainedTicks: number;
  readonly settled: RenderTelemetry;
}

async function observeBeltLine(page: Page, beltCount: number): Promise<BeltLineObservation> {
  const observed = await page.evaluate(
    async ({ maxTicks, beltCount }) => {
      const runtime = window as unknown as RuntimeWindow;
      const bridge = runtime.__FACTOR_Y__;
      const telemetry = runtime.__FACTOR_Y_TELEMETRY__;
      if (bridge === undefined || telemetry === undefined) {
        throw new Error("Factor-Y bridges unavailable");
      }
      const isBeltFrame = (key: string): boolean =>
        /^factor-y:machine\.belt\.active:[01]$/.test(key);
      const nextFrame = (): Promise<void> =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });

      let glowTicks = 0;
      let glow: ReturnType<typeof telemetry.getSnapshot>["render"] | undefined;
      for (let tick = 0; tick < maxTicks && glow === undefined; tick += 1) {
        bridge.advanceTicks(1);
        await nextFrame();
        const framed = telemetry.getSnapshot().render;
        if (framed.beltGlowCount > 0 && framed.activeFrameKeys.some(isBeltFrame)) {
          glowTicks = tick + 1;
          glow = framed;
        }
      }

      if (glow === undefined) {
        const current = telemetry.getSnapshot().render;
        return { glowTicks: -1, glow: current, drainedTicks: -1, settled: current };
      }

      const drainLimit = beltCount + 2;
      let drainedTicks = 0;
      while (drainedTicks < drainLimit) {
        bridge.advanceTicks(1);
        drainedTicks += 1;
        await nextFrame();
        if (telemetry.getSnapshot().render.beltGlowCount === 0) {
          break;
        }
      }

      return { glowTicks, glow, drainedTicks, settled: telemetry.getSnapshot().render };
    },
    { maxTicks: MAX_SCAN_TICKS, beltCount },
  );

  expect(observed.glowTicks).toBeGreaterThan(0);
  expect(observed.glow.beltGlowCount).toBe(1);
  expect(observed.glow.beltItemIds).toHaveLength(1);
  expect(observed.drainedTicks).toBeGreaterThan(0);
  expect(observed.drainedTicks).toBeLessThanOrEqual(beltCount + 2);
  expect(observed.settled.beltGlowCount).toBe(0);
  expect(observed.settled.beltItemIds).toEqual([]);
  return observed;
}

interface TelemetryRebuildSample {
  readonly frames: number;
  readonly rebuilds: number;
  readonly elapsedMs: number;
  readonly sawActiveEntity: boolean;
}

async function measureRenderTelemetryRebuilds(
  page: Page,
  frames = 24,
): Promise<TelemetryRebuildSample> {
  return page.evaluate(async (frameCount) => {
    const runtime = window as unknown as RuntimeWindow;
    const bridge = runtime.__FACTOR_Y__;
    const telemetry = runtime.__FACTOR_Y_TELEMETRY__;
    if (bridge === undefined || telemetry === undefined) {
      throw new Error("Factor-Y bridges unavailable");
    }

    for (let tick = 0; tick < 8; tick += 1) {
      if (telemetry.getSnapshot().render.activeEntityIds.length > 0) {
        break;
      }
      bridge.advanceTicks(1);
    }

    const seen = new Set<object>();
    let sawActiveEntity = false;
    const started = performance.now();
    for (let frame = 0; frame < frameCount; frame += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      const render = telemetry.getSnapshot().render;
      seen.add(render);
      sawActiveEntity = sawActiveEntity || render.activeEntityIds.length > 0;
    }

    return {
      frames: frameCount,
      rebuilds: seen.size,
      elapsedMs: performance.now() - started,
      sawActiveEntity,
    };
  }, frames);
}

async function renderTelemetry(page: Page): Promise<RenderTelemetry> {
  return page.evaluate(() => {
    const telemetry = (window as unknown as RuntimeWindow).__FACTOR_Y_TELEMETRY__;
    if (telemetry === undefined) {
      throw new Error("Factor-Y telemetry unavailable");
    }
    return telemetry.getSnapshot().render;
  });
}

async function persistedEntityTypes(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      throw new Error("Expected a persisted save");
    }
    const save = JSON.parse(raw) as { grid?: { entities?: Array<{ type: string }> } };
    return (save.grid?.entities ?? []).map((entity) => entity.type);
  }, SAVE_KEY);
}

async function persistedChainSummaries(
  page: Page,
): Promise<Array<{ id: string; outputResource: string; steadyStateThroughput: number }>> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      throw new Error("Expected a persisted save");
    }
    const save = JSON.parse(raw) as {
      productionChains?: Record<
        string,
        { id: string; outputResource: string; steadyStateThroughput: number }
      >;
    };
    return Object.values(save.productionChains ?? {});
  }, SAVE_KEY);
}

async function persistedSave(page: Page): Promise<{
  currency: number;
  lifetimeCurrency: number;
  lastSavedAt: number;
  entityTypes: string[];
  raw: string;
}> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      throw new Error("Expected a persisted save");
    }
    const save = JSON.parse(raw) as {
      currency: number;
      lifetimeCurrency: number;
      lastSavedAt: number;
      grid?: { entities?: Array<{ type: string }> };
    };
    return {
      currency: save.currency,
      lifetimeCurrency: save.lifetimeCurrency,
      lastSavedAt: save.lastSavedAt,
      entityTypes: (save.grid?.entities ?? []).map((entity) => entity.type),
      raw,
    };
  }, SAVE_KEY);
}

test("sells copper through a raw chain and restores it after a reload", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  const startingCurrency = await openWithClearedSave(page);
  expect(startingCurrency).toBe(500);
  expect(await hudCurrency(page)).toBe(500);

  await buildChain(page, COPPER_NODE, "copperOre", 1);
  const baseline = await bridgeCurrency(page);
  expect(baseline).toBe(340);
  await expect.poll(() => hudCurrency(page)).toBe(340);

  await expect.poll(() => persistedEntityTypes(page)).toEqual(["extractor", "belt", "depot"]);

  const soldCurrency = await advanceUntilCurrencyGrows(page, baseline);
  expect(soldCurrency).toBeGreaterThan(baseline);
  await expect.poll(() => hudCurrency(page)).toBeGreaterThan(baseline);

  const extractorActive = await page.evaluate(async (maxTicks) => {
    const runtime = window as unknown as RuntimeWindow;
    const bridge = runtime.__FACTOR_Y__;
    const telemetry = runtime.__FACTOR_Y_TELEMETRY__;
    if (bridge === undefined || telemetry === undefined) {
      throw new Error("Factor-Y bridges unavailable");
    }
    const isExtractorFrame = (key: string): boolean =>
      /^factor-y:machine\.extractor\.active:[01]$/.test(key);

    for (let tick = 0; tick < maxTicks; tick += 1) {
      bridge.advanceTicks(1);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
      const render = telemetry.getSnapshot().render;
      if (
        render.activeEntityIds.includes("entity-1") &&
        render.activeFrameKeys.some(isExtractorFrame)
      ) {
        return render;
      }
    }
    return telemetry.getSnapshot().render;
  }, MAX_SCAN_TICKS);

  expect(
    extractorActive.activeFrameKeys.some((key) => /^factor-y:machine\.extractor\.active:[01]$/.test(key)),
  ).toBe(true);
  expect(extractorActive.activeFrameKeys.every((key) => key.startsWith("factor-y:machine."))).toBe(true);
  expect(extractorActive.beltItemEventCount).toBeGreaterThanOrEqual(2);
  expect(extractorActive.entityIds).toEqual(["entity-1", "entity-2", "entity-3"]);

  await expect.poll(async () => (await persistedSave(page)).currency).toBeGreaterThan(baseline);
  await page.evaluate((ticks) => {
    const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
    if (bridge === undefined) {
      throw new Error("Factor-Y bridge unavailable");
    }
    bridge.advanceTicks(ticks);
  }, CURRENCY_RATE_WINDOW_TICKS);
  await expect
    .poll(async () => (await persistedChainSummaries(page))[0]?.steadyStateThroughput ?? 0)
    .toBeGreaterThan(0);
  const persistedChains = await persistedChainSummaries(page);
  expect(persistedChains.map((chain) => chain.id)).toEqual(["chain-entity-1"]);
  expect(persistedChains[0]?.outputResource).toBe("copperOre");
  const telemetrySample = await measureRenderTelemetryRebuilds(page);
  expect(telemetrySample.sawActiveEntity).toBe(true);
  expect(telemetrySample.rebuilds).toBeLessThan(telemetrySample.frames);
  expect(telemetrySample.rebuilds).toBeLessThanOrEqual(
    Math.ceil(telemetrySample.elapsedMs / 160) + 6,
  );

  const beforeReload = await persistedSave(page);
  expect(beforeReload.entityTypes).toEqual(["extractor", "belt", "depot"]);
  expect(beforeReload.lifetimeCurrency).toBeGreaterThan(0);
  expect(beforeReload.lastSavedAt).toBeGreaterThan(0);
  expect(beforeReload.raw).not.toContain("tickCount");
  expect(beforeReload.raw).not.toContain("currencySamples");
  expect(beforeReload.raw).not.toContain("selectedEntityId");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReady(page);

  expect(await bridgeCurrency(page)).toBeGreaterThanOrEqual(beforeReload.currency);
  expect(await hudCurrency(page)).toBeGreaterThanOrEqual(baseline);
  await expect.poll(() => renderTelemetry(page).then((render) => render.entityIds)).toEqual([
    "entity-1",
    "entity-2",
    "entity-3",
  ]);
  expect(await persistedEntityTypes(page)).toEqual(["extractor", "belt", "depot"]);
  expect(browserErrors).toEqual([]);
});

test("carries a glowing iron item across a belt line and sells it", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  const startingCurrency = await openWithClearedSave(page);
  expect(startingCurrency).toBe(500);

  const beltCount = 5;
  await buildChain(page, IRON_NODE, "ironOre", beltCount);
  const baseline = await bridgeCurrency(page);
  expect(baseline).toBe(300);
  await expect.poll(() => persistedEntityTypes(page)).toEqual([
    "extractor",
    "belt",
    "belt",
    "belt",
    "belt",
    "belt",
    "depot",
  ]);

  const line = await observeBeltLine(page, beltCount);

  expect(line.glow.beltItemIds[0]).toMatch(/^entity-[2-6]$/);
  expect(line.glow.activeEntityIds).toContain(line.glow.beltItemIds[0]);
  expect(
    line.glow.activeFrameKeys.some((key) => /^factor-y:machine\.belt\.active:[01]$/.test(key)),
  ).toBe(true);
  expect(line.glow.activeFrameKeys.every((key) => key.startsWith("factor-y:machine."))).toBe(true);
  expect(line.glow.beltItemEventCount).toBeGreaterThanOrEqual(2);
  expect(line.settled.beltItemEventCount).toBeGreaterThanOrEqual(line.glow.beltItemEventCount);

  const soldCurrency = await advanceUntilCurrencyGrows(page, baseline);
  expect(soldCurrency).toBeGreaterThan(baseline);
  await expect.poll(() => hudCurrency(page)).toBeGreaterThan(baseline);
  await expect.poll(() => persistedSave(page).then((save) => save.lifetimeCurrency)).toBeGreaterThan(0);
  expect(browserErrors).toEqual([]);
});

interface BlockedBlinkObservation {
  readonly blockedAtTick: number;
  readonly heldFrames: number;
  readonly blocked: RenderTelemetry;
  readonly clearedAtTick: number;
  readonly cleared: RenderTelemetry;
}

async function observeBlockedBlink(
  page: Page,
  entityId: string,
  maxBatches: number,
  ticksPerBatch: number,
): Promise<BlockedBlinkObservation> {
  const observed = await page.evaluate(
    async ({ observedId, batchLimit, batchTicks }) => {
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

      let blockedAtTick = -1;
      let ticks = 0;
      for (let batch = 0; batch < batchLimit && blockedAtTick < 0; batch += 1) {
        for (let step = 0; step < batchTicks; step += 1) {
          bridge.advanceTicks(1);
          ticks += 1;
        }
        await nextFrame();
        if (telemetry.getSnapshot().render.blockedEntityIds.includes(observedId)) {
          blockedAtTick = ticks;
        }
      }

      let heldFrames = 0;
      for (let frame = 0; frame < 6; frame += 1) {
        await nextFrame();
        if (telemetry.getSnapshot().render.blockedEntityIds.includes(observedId)) {
          heldFrames += 1;
        }
      }

      const blocked = telemetry.getSnapshot().render;

      bridge.dispatch({ type: "demolishEntity", entityId: "entity-2" });
      let clearedAtTick = -1;
      for (let batch = 0; batch < batchLimit && clearedAtTick < 0; batch += 1) {
        for (let step = 0; step < batchTicks; step += 1) {
          bridge.advanceTicks(1);
          ticks += 1;
        }
        await nextFrame();
        if (!telemetry.getSnapshot().render.blockedEntityIds.includes(observedId)) {
          clearedAtTick = ticks;
        }
      }

      return {
        blockedAtTick,
        heldFrames,
        blocked,
        clearedAtTick,
        cleared: telemetry.getSnapshot().render,
      };
    },
    { observedId: entityId, batchLimit: maxBatches, batchTicks: ticksPerBatch },
  );

  expect(observed.blockedAtTick).toBeGreaterThan(0);
  return observed;
}

test("blinks a producer that cannot hand off its goods and stops when the line is fixed", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  await openWithClearedSave(page);
  await expect(page.getByTestId("game-canvas")).toHaveAttribute("data-factor-y-status", "ready");

  const beltCount = 3;
  const results = await page.evaluate(
    ({ node, belts }) => {
      const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
      if (bridge === undefined) {
        throw new Error("Factor-Y runtime bridge unavailable");
      }
      const placed: CommandResult[] = [
        bridge.dispatch({
          type: "placeEntity",
          machine: "extractor",
          x: node.x,
          y: node.y,
          rotation: 0,
          resourceNode: "copperOre",
        }),
      ];
      for (let index = 0; index < belts; index += 1) {
        placed.push(
          bridge.dispatch({
            type: "placeEntity",
            machine: "belt",
            x: node.x + index + 1,
            y: node.y,
            rotation: 0,
          }),
        );
      }
      return placed;
    },
    { node: COPPER_NODE, belts: beltCount },
  );

  expect(results.every((result) => result.ok)).toBe(true);
  expect(results.filter((result) => !result.ok)).toEqual([]);
  await expect.poll(() => renderTelemetry(page).then((render) => render.entityIds)).toHaveLength(
    beltCount + 1,
  );
  expect((await renderTelemetry(page)).blockedEntityIds).toEqual([]);

  const blocked = await observeBlockedBlink(page, "entity-1", 40, 5);

  expect(blocked.blocked.blockedEntityIds).toEqual(["entity-1"]);
  expect(blocked.heldFrames).toBe(6);
  expect(blocked.clearedAtTick).toBeGreaterThan(blocked.blockedAtTick);
  expect(blocked.cleared.blockedEntityIds).toEqual([]);
  expect(blocked.cleared.entityIds).toEqual(["entity-1", "entity-3", "entity-4"]);
  expect(browserErrors).toEqual([]);
});

test("keeps deterministic copper and iron node coordinates for the raw loop", () => {
  const state = createInitialState(1337);
  const copper = state.grid.nodes.find((node) => node.resource === "copperOre");
  const iron = state.grid.nodes.find((node) => node.resource === "ironOre");

  expect(copper).toMatchObject(COPPER_NODE);
  expect(iron).toMatchObject(IRON_NODE);
  expect(COPPER_NODE.x + 6).toBeLessThan(state.grid.width);
  expect(IRON_NODE.x + 6).toBeLessThan(state.grid.width);
});
