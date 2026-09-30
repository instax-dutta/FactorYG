import { expect, test, type Page } from "@playwright/test";
import { trackBrowserErrors, waitForReady } from "./support/runtimeBridge";

interface RenderTelemetry {
  entityIds: readonly string[];
  activeEntityIds: readonly string[];
  activeFrameKeys: readonly string[];
  beltItemIds: readonly string[];
  beltGlowCount: number;
  blockedEntityIds: readonly string[];
  heatEntityIds: readonly string[];
  saleBurstCount: number;
  liveBurstCount: number;
}

interface RuntimeWindow {
  __FACTOR_Y__?: {
    dispatch(command: Record<string, unknown>): { ok: boolean; reason?: string };
    advanceTicks(count: number): void;
  };
  __FACTOR_Y_TELEMETRY__?: { getSnapshot(): { ready: boolean; render: RenderTelemetry } };
}

const COPPER_NODE = { x: 40, y: 37 };
const SALE_POLL_LIMIT = 60;

test.use({ viewport: { width: 1000, height: 800 } });

interface LineObservation {
  readonly maxGlowCount: number;
  readonly glowCountWithCarriedItem: number;
  readonly saleBurstCount: number;
  readonly maxLiveBursts: number;
  readonly settled: RenderTelemetry;
}

async function observeRawLine(page: Page): Promise<LineObservation> {
  return page.evaluate(
    async ({ node, pollLimit }) => {
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

      const refused: string[] = [];
      for (const command of [
        { type: "placeEntity", machine: "extractor", x: node.x, y: node.y, rotation: 0, resourceNode: "copperOre" },
        { type: "placeEntity", machine: "belt", x: node.x + 1, y: node.y, rotation: 0 },
        { type: "placeEntity", machine: "belt", x: node.x + 2, y: node.y, rotation: 0 },
        { type: "placeEntity", machine: "belt", x: node.x + 3, y: node.y, rotation: 0 },
        { type: "placeEntity", machine: "depot", x: node.x + 4, y: node.y, rotation: 0 },
      ]) {
        const result = bridge.dispatch(command);
        if (!result.ok) {
          refused.push(result.reason ?? "unknown");
        }
      }
      if (refused.length > 0) {
        throw new Error(`Expected the line to place: ${refused.join(", ")}`);
      }

      let maxGlowCount = 0;
      let glowCountWithCarriedItem = 0;
      let maxLiveBursts = 0;
      let previousBursts = telemetry.getSnapshot().render.saleBurstCount;

      for (let tick = 0; tick < pollLimit; tick += 1) {
        bridge.advanceTicks(1);
        await nextFrame();
        const render = telemetry.getSnapshot().render;
        maxGlowCount = Math.max(maxGlowCount, render.beltGlowCount);
        if (render.beltItemIds.length > 0) {
          glowCountWithCarriedItem = Math.max(glowCountWithCarriedItem, render.beltGlowCount);
        }
        if (render.saleBurstCount > previousBursts) {
          maxLiveBursts = Math.max(maxLiveBursts, render.liveBurstCount);
          previousBursts = render.saleBurstCount;
        }
      }

      return {
        maxGlowCount,
        glowCountWithCarriedItem,
        saleBurstCount: telemetry.getSnapshot().render.saleBurstCount,
        maxLiveBursts,
        settled: telemetry.getSnapshot().render,
      };
    },
    { node: COPPER_NODE, pollLimit: SALE_POLL_LIMIT },
  );
}

test("the depot sale burst and the belt glow are the only vfx a raw line produces", async ({ page }) => {
  const browserErrors = trackBrowserErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReady(page);

  const line = await observeRawLine(page);

  expect(line.maxGlowCount).toBeGreaterThan(0);
  expect(line.glowCountWithCarriedItem).toBeGreaterThan(0);
  expect(line.maxGlowCount).toBe(line.glowCountWithCarriedItem);

  expect(line.saleBurstCount).toBeGreaterThan(0);
  expect(line.maxLiveBursts).toBeGreaterThan(0);

  expect(line.settled.heatEntityIds).toEqual([]);
  expect(line.settled.blockedEntityIds).toEqual([]);

  expect(browserErrors).toEqual([]);
});