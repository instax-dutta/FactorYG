import { expect, test, type Page } from "@playwright/test";
import { trackBrowserErrors, waitForReady } from "./support/runtimeBridge";

interface RenderTelemetry {
  entityIds: readonly string[];
  activeEntityIds: readonly string[];
  activeFrameKeys: readonly string[];
  beltItemIds: readonly string[];
  beltGlowCount: number;
  beltItemEventCount: number;
  blockedEntityIds: readonly string[];
}

interface RuntimeWindow {
  __FACTOR_Y__?: {
    dispatch(command: Record<string, unknown>): { ok: boolean; reason?: string };
    advanceTicks(count: number): void;
  };
  __FACTOR_Y_TELEMETRY__?: { getSnapshot(): { ready: boolean; render: RenderTelemetry } };
}

const COPPER_NODE = { x: 40, y: 37 };
const EXTRACTOR_ACTIVE_FRAME = /^factor-y:machine\.extractor\.active:[01]$/;

test.use({ viewport: { width: 1000, height: 800 } });

interface AnimationObservation {
  readonly placed: RenderTelemetry;
  readonly activeWhileProducing: RenderTelemetry;
  readonly idleOnceBufferIsFull: RenderTelemetry;
}

async function observeExtractorAnimation(page: Page): Promise<AnimationObservation> {
  return page.evaluate(
    async ({ node }) => {
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

      const placed = bridge.dispatch({
        type: "placeEntity",
        machine: "extractor",
        x: node.x,
        y: node.y,
        rotation: 0,
        resourceNode: "copperOre",
      });
      if (!placed.ok) {
        throw new Error(`Expected the extractor to place: ${placed.reason ?? "unknown"}`);
      }

      await nextFrame();
      const placedRender = telemetry.getSnapshot().render;

      const activeWhileProducing = telemetry.getSnapshot().render;
      bridge.advanceTicks(40);
      await nextFrame();
      const idleOnceBufferIsFull = telemetry.getSnapshot().render;

      return { placed: placedRender, activeWhileProducing, idleOnceBufferIsFull };
    },
    { node: COPPER_NODE },
  );
}

interface RemovalObservation {
  readonly before: RenderTelemetry;
  readonly after: RenderTelemetry;
}

async function observeSingleRemoval(page: Page): Promise<RemovalObservation> {
  return page.evaluate(
    async ({ node }) => {
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
        { type: "placeEntity", machine: "belt", x: node.x + 1, y: node.y, rotation: 0 },
        { type: "placeEntity", machine: "belt", x: node.x + 2, y: node.y, rotation: 0 },
        { type: "placeEntity", machine: "depot", x: node.x + 3, y: node.y, rotation: 0 },
      ]) {
        const result = bridge.dispatch(command);
        if (!result.ok) {
          refused.push(result.reason ?? "unknown");
        }
      }
      if (refused.length > 0) {
        throw new Error(`Expected the belt run to place: ${refused.join(", ")}`);
      }

      bridge.advanceTicks(2);
      await nextFrame();
      const before = telemetry.getSnapshot().render;

      const demolition = bridge.dispatch({ type: "demolishEntity", entityId: "entity-2" });
      if (!demolition.ok) {
        throw new Error(`Expected the belt to demolish: ${demolition.reason ?? "unknown"}`);
      }

      await nextFrame();
      return { before, after: telemetry.getSnapshot().render };
    },
    { node: COPPER_NODE },
  );
}

test("a machine animates only while it produces and a removal disposes only its own sprite", async ({
  page,
}) => {
  const browserErrors = trackBrowserErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReady(page);

  const animation = await observeExtractorAnimation(page);

  expect(animation.placed.entityIds).toEqual(["entity-1"]);

  expect(animation.activeWhileProducing.activeEntityIds).toEqual(["entity-1"]);
  expect(
    animation.activeWhileProducing.activeFrameKeys.some((key) =>
      EXTRACTOR_ACTIVE_FRAME.test(key),
    ),
  ).toBe(true);

  expect(animation.idleOnceBufferIsFull.activeEntityIds).toEqual([]);
  expect(animation.idleOnceBufferIsFull.activeFrameKeys).toEqual([]);
  expect(animation.idleOnceBufferIsFull.entityIds).toEqual(["entity-1"]);
  expect(animation.idleOnceBufferIsFull.blockedEntityIds).toEqual([]);

  const removal = await observeSingleRemoval(page);
  expect(removal.before.entityIds).toEqual(["entity-1", "entity-2", "entity-3", "entity-4"]);
  expect(removal.after.entityIds).toEqual(["entity-1", "entity-3", "entity-4"]);

  expect(browserErrors).toEqual([]);
});