import { expect, test } from "@playwright/test";
import { ASSET_MANIFEST } from "../../src/content/assetManifest";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";

interface AssetProbe {
  readonly path: string;
  readonly status: number;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
}

const MANIFEST_FRAME_PATHS: string[] = Object.values(ASSET_MANIFEST).flatMap(
  (entry) => [...entry.framePaths],
);

test("serves the production build, every manifest asset, and no browser errors", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(`console: ${message.text()}`);
    }
  });

  await page.goto(`${PREVIEW_ORIGIN}/`, { waitUntil: "domcontentloaded" });

  expect(await page.title()).toBe("Factor-I");
  expect(await page.locator('meta[name="description"]').getAttribute("content")).toBe(
    "Build, optimize, and grow your Factor-I factory.",
  );
  await expect(page.getByRole("heading", { name: "Factor-I" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();

  const canvas = page.getByTestId("game-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas.locator("canvas")).toBeVisible();

  expect(MANIFEST_FRAME_PATHS.length).toBeGreaterThan(0);

  const probes = await page.evaluate(async (paths: string[]): Promise<AssetProbe[]> => {
    const results: AssetProbe[] = [];

    for (const path of paths) {
      const response = await fetch(path);
      const objectUrl = URL.createObjectURL(await response.blob());
      const image = new Image();
      const decoded = await new Promise<{ width: number; height: number }>((resolve) => {
        image.addEventListener("load", () =>
          resolve({ width: image.naturalWidth, height: image.naturalHeight }),
        );
        image.addEventListener("error", () => resolve({ width: 0, height: 0 }));
        image.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);
      results.push({
        path,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        ...decoded,
      });
    }

    return results;
  }, MANIFEST_FRAME_PATHS);

  expect(probes.map((probe) => probe.path)).toEqual(MANIFEST_FRAME_PATHS);

  const unserved = probes.filter(
    (probe) => probe.status !== 200 || probe.width <= 0 || probe.height <= 0,
  );
  expect(
    unserved,
    `manifest assets the production build failed to serve or decode: ${JSON.stringify(unserved)}`,
  ).toEqual([]);

  const wrongMediaType = probes.filter((probe) => !probe.contentType.includes("svg"));
  expect(
    wrongMediaType,
    `manifest assets the production build served under the wrong media type: ${JSON.stringify(wrongMediaType)}`,
  ).toEqual([]);

  await expect(canvas).toHaveAttribute("data-factor-y-status", "ready");

  const bridgeTypes = await page.evaluate(() => {
    const runtimeWindow = window as unknown as {
      __FACTOR_Y__?: unknown;
      __FACTOR_Y_TELEMETRY__?: unknown;
    };
    return {
      runtime: typeof runtimeWindow.__FACTOR_Y__,
      telemetry: typeof runtimeWindow.__FACTOR_Y_TELEMETRY__,
    };
  });
  expect(
    bridgeTypes,
    "the development bridges must be absent, or this is the dev server and the production bundle is unproven",
  ).toEqual({ runtime: "undefined", telemetry: "undefined" });

  expect(browserErrors, `browser errors from the production build: ${browserErrors.join(" | ")}`).toEqual([]);
});
