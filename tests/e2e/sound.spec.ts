import { expect, test, type Page } from "@playwright/test";
import { trackBrowserErrors, waitForReady } from "./support/runtimeBridge";

interface SoundTelemetry {
  unlocked: boolean;
  contextCreated: boolean;
  bufferCount: number;
  readyBufferCount: number;
  decodeFailureCount: number;
  triggeredCounts: Record<string, number>;
  playedCounts: Record<string, number>;
  suppressedCount: number;
  unavailableCount: number;
  loopStartCount: number;
  loopStopCount: number;
  activeLoopCount: number;
}

interface RenderTelemetry {
  saleBurstCount: number;
}

interface TelemetrySnapshot {
  ready: boolean;
  render: RenderTelemetry;
  sound: SoundTelemetry;
}

interface RuntimeWindow {
  __FACTOR_Y__?: {
    dispatch(command: Record<string, unknown>): { ok: boolean; reason?: string };
    advanceTicks(count: number): void;
  };
  __FACTOR_Y_TELEMETRY__?: { getSnapshot(): TelemetrySnapshot };
}

const FIRST_COPPER_NODE = { x: 40, y: 37 };
const SECOND_COPPER_NODE = { x: 5, y: 60 };
const SOUND_KEY_COUNT = 5;
const CHUNK_TICKS = 10;
const MAX_CHUNKS = 24;
const UNLOCK_CLICK = { x: 500, y: 240 };

test.use({ viewport: { width: 1000, height: 800 } });

interface LinePlacement {
  readonly node: { x: number; y: number };
  readonly beltCount: number;
}

async function placeRawLine(page: Page, line: LinePlacement): Promise<void> {
  await page.evaluate(
    ({ node, beltCount }) => {
      const bridge = (window as unknown as RuntimeWindow).__FACTOR_Y__;
      if (bridge === undefined) {
        throw new Error("Factor-Y bridge unavailable");
      }

      const refusals: string[] = [];
      const commands: Array<Record<string, unknown>> = [
        {
          type: "placeEntity",
          machine: "extractor",
          x: node.x,
          y: node.y,
          rotation: 0,
          resourceNode: "copperOre",
        },
      ];
      for (let belt = 0; belt < beltCount; belt += 1) {
        commands.push({
          type: "placeEntity",
          machine: "belt",
          x: node.x + belt + 1,
          y: node.y,
          rotation: 0,
        });
      }
      commands.push({
        type: "placeEntity",
        machine: "depot",
        x: node.x + beltCount + 1,
        y: node.y,
        rotation: 0,
      });

      for (const command of commands) {
        const result = bridge.dispatch(command);
        if (!result.ok) {
          refusals.push(result.reason ?? "unknown");
        }
      }
      if (refusals.length > 0) {
        throw new Error(`Expected the line to place: ${refusals.join(", ")}`);
      }
    },
    line,
  );
}

async function readSound(page: Page): Promise<SoundTelemetry> {
  return page.evaluate(() => {
    const telemetry = (window as unknown as RuntimeWindow).__FACTOR_Y_TELEMETRY__;
    if (telemetry === undefined) {
      throw new Error("Factor-Y telemetry bridge unavailable");
    }
    return telemetry.getSnapshot().sound;
  });
}

type RunGoal = "saleFired" | "soundPlayed";

async function runUntil(page: Page, goal: RunGoal): Promise<TelemetrySnapshot> {
  return page.evaluate(
    async ({ runGoal, chunkTicks, maxChunks }) => {
      const runtime = window as unknown as RuntimeWindow;
      const bridge = runtime.__FACTOR_Y__;
      const telemetry = runtime.__FACTOR_Y_TELEMETRY__;
      if (bridge === undefined || telemetry === undefined) {
        throw new Error("Factor-Y bridges unavailable");
      }

      const reached = (snapshot: TelemetrySnapshot): boolean =>
        runGoal === "saleFired"
          ? snapshot.render.saleBurstCount > 0
          : snapshot.sound.playedCounts.sale > 0 && snapshot.sound.activeLoopCount > 0;

      const nextFrame = (): Promise<void> =>
        new Promise<void>((resolveFrame) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolveFrame());
          });
        });

      let latest = telemetry.getSnapshot();
      for (let chunk = 0; chunk < maxChunks; chunk += 1) {
        if (reached(latest)) {
          return latest;
        }
        bridge.advanceTicks(chunkTicks);
        await nextFrame();
        latest = telemetry.getSnapshot();
      }
      return latest;
    },
    { runGoal: goal, chunkTicks: CHUNK_TICKS, maxChunks: MAX_CHUNKS },
  );
}

test("a sound layer that stays silent until a gesture and plays every shipped file once unlocked", async ({
  page,
}) => {
  const browserErrors = trackBrowserErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReady(page);

  await placeRawLine(page, { node: FIRST_COPPER_NODE, beltCount: 3 });
  const beforeGesture = await runUntil(page, "saleFired");

  expect(beforeGesture.render.saleBurstCount).toBeGreaterThan(0);
  expect(beforeGesture.sound.unlocked).toBe(false);
  expect(beforeGesture.sound.contextCreated).toBe(false);
  expect(beforeGesture.sound.bufferCount).toBe(SOUND_KEY_COUNT);
  expect(beforeGesture.sound.readyBufferCount).toBe(0);
  expect(beforeGesture.sound.triggeredCounts.sale).toBeGreaterThan(0);
  expect(Object.values(beforeGesture.sound.playedCounts).every((count) => count === 0)).toBe(true);
  expect(beforeGesture.sound.suppressedCount).toBeGreaterThan(0);

  await page.mouse.click(UNLOCK_CLICK.x, UNLOCK_CLICK.y);

  await expect
    .poll(async () => {
      const sound = await readSound(page);
      return sound.unlocked && sound.contextCreated;
    }, { timeout: 15_000, message: "a real gesture never unlocked the audio adapter" })
    .toBe(true);

  await expect
    .poll(async () => {
      const sound = await readSound(page);
      return sound.readyBufferCount === sound.bufferCount;
    }, { timeout: 20_000, message: "the shipped audio never finished decoding" })
    .toBe(true);

  const decoded = await readSound(page);
  expect(decoded.bufferCount).toBe(SOUND_KEY_COUNT);
  expect(decoded.readyBufferCount).toBe(SOUND_KEY_COUNT);
  expect(decoded.decodeFailureCount).toBe(0);

  await placeRawLine(page, { node: SECOND_COPPER_NODE, beltCount: 2 });
  const afterGesture = await runUntil(page, "soundPlayed");

  expect(afterGesture.sound.playedCounts.sale).toBeGreaterThan(0);
  expect(afterGesture.sound.activeLoopCount).toBeGreaterThan(0);
  expect(afterGesture.sound.triggeredCounts.machine).toBeGreaterThan(0);
  expect(afterGesture.sound.loopStartCount).toBeGreaterThan(0);
  expect(afterGesture.sound.decodeFailureCount).toBe(0);

  expect(browserErrors).toEqual([]);
});
