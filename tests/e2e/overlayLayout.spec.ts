import { expect, test, type Page } from "@playwright/test";
import { expectNoPanelOverlap, waitForBoundingBox } from "./support/overlayLayout";
import { waitForReady } from "./support/runtimeBridge";

test.use({ viewport: { width: 1000, height: 800 } });

async function rejectionMessage(work: Promise<unknown>): Promise<string> {
  const outcome = await work.then(
    () => null,
    (error: unknown) => (error instanceof Error ? (error.stack ?? error.message) : String(error)),
  );
  if (outcome === null) {
    throw new Error("expected the overlay layout check to fail, but it resolved");
  }
  return outcome;
}

async function openGame(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForReady(page);
}

async function saturateRenderer(page: Page, frameBudgetMs: number): Promise<void> {
  await page.evaluate((budget) => {
    const burn = (): void => {
      const until = performance.now() + budget;
      let sink = 0;
      while (performance.now() < until) {
        sink += Math.sqrt(sink + 1);
      }
      void sink;
      requestAnimationFrame(burn);
    };
    requestAnimationFrame(burn);
  }, frameBudgetMs);
}

test("names every unsettled panel, the wait, and the observed state", async ({ page }) => {
  await openGame(page);
  await page.addStyleTag({ content: '[data-testid="build-dock"] { display: none !important; }' });

  const message = await rejectionMessage(expectNoPanelOverlap(page));

  expect(message).toContain("Build dock");
  expect(message).toContain("display=none");
  expect(message).toMatch(/waited \d+ms/);
  expect(message).toMatch(/within \d+ms/);
});

test("reports every overlapping pair by name", async ({ page }) => {
  await openGame(page);
  await page.addStyleTag({
    content: '[data-testid="hud"] { top: 674px !important; right: auto !important; left: 32px !important; }',
  });

  const message = await rejectionMessage(expectNoPanelOverlap(page));

  expect(message).toContain("Hud / Build dock");
  expect(message).not.toContain("Tech tree toggle /");
});

test("is not defeated by a saturated renderer main thread", async ({ page }) => {
  await openGame(page);
  await saturateRenderer(page, 600);

  await expect(expectNoPanelOverlap(page)).resolves.toBeUndefined();
});

test("waitForBoundingBox returns viewport-relative geometry for a present panel", async ({ page }) => {
  await openGame(page);

  const box = await waitForBoundingBox(page.getByTestId("build-dock"), "Build dock");
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("Viewport size unavailable");
  }

  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
});

test("waitForBoundingBox names a panel that never appears and honours its explicit bound", async ({ page }) => {
  await openGame(page);

  const startedAt = Date.now();
  const message = await rejectionMessage(
    waitForBoundingBox(page.getByTestId("never-rendered-panel"), "Ghost panel", 1500),
  );
  const elapsed = Date.now() - startedAt;

  expect(message).toContain("Ghost panel");
  expect(message).toMatch(/waited \d+ms/);
  expect(elapsed).toBeLessThan(20_000);
});
