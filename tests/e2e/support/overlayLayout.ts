import { expect, type Locator, type Page } from "@playwright/test";

export type PanelBox = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

export const OVERLAY_SETTLE_TIMEOUT_MS = 10_000;
export const SETTLE_POLL_INTERVAL_MS = 50;

export function boxesOverlap(first: PanelBox, second: PanelBox): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

interface PanelDefinition {
  readonly label: string;
  readonly selector: string;
}

const OVERLAY_PANELS: readonly PanelDefinition[] = [
  { label: "Header", selector: 'header[role="banner"]' },
  { label: "Hud", selector: '[data-testid="hud"]' },
  { label: "Entity inspector", selector: '[data-testid="entity-inspector"]' },
  { label: "Build dock", selector: '[data-testid="build-dock"]' },
  { label: "Notification stack", selector: '[data-testid="notification-stack"]' },
  { label: "Tech tree toggle", selector: '[data-testid="tech-tree-toggle"]' },
];

interface RectSnapshot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PanelProbe {
  readonly label: string;
  readonly present: boolean;
  readonly rendered: boolean;
  readonly detail: string;
  readonly box: RectSnapshot | null;
}

interface OverlaySnapshot {
  readonly unsettled: readonly string[];
  readonly probes: readonly PanelProbe[];
}

function readOverlaySnapshot(definitions: readonly PanelDefinition[]): OverlaySnapshot {
  const probes: PanelProbe[] = definitions.map((definition) => {
    const element = document.querySelector(definition.selector);
    if (element === null) {
      return {
        label: definition.label,
        present: false,
        rendered: false,
        detail: "no element matches the selector",
        box: null,
      };
    }
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const clientRects = element.getClientRects().length;
    return {
      label: definition.label,
      present: true,
      rendered: style.display !== "none" && style.visibility !== "hidden" && clientRects > 0,
      detail: `display=${style.display} visibility=${style.visibility} clientRects=${clientRects} rect=${rect.width}x${rect.height} at ${rect.x},${rect.y}`,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  return {
    unsettled: probes.filter((probe) => !probe.rendered).map((probe) => probe.label),
    probes,
  };
}

async function awaitSettledOverlay(page: Page, timeoutMs: number): Promise<OverlaySnapshot> {
  const startedAt = Date.now();
  for (;;) {
    const snapshot = await page.evaluate(readOverlaySnapshot, OVERLAY_PANELS);
    if (snapshot.unsettled.length === 0) {
      return snapshot;
    }
    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= timeoutMs) {
      const detail = snapshot.probes
        .filter((probe) => !probe.rendered)
        .map((probe) => `  - ${probe.label}: ${probe.detail}`)
        .join("\n");
      throw new Error(
        [
          `Overlay layout did not settle within ${timeoutMs}ms (waited ${waitedMs}ms).`,
          `Unsettled panels: ${snapshot.unsettled.join(", ")}`,
          "Observed state:",
          detail,
        ].join("\n"),
      );
    }
    await page.waitForTimeout(SETTLE_POLL_INTERVAL_MS);
  }
}

export async function waitForBoundingBox(
  locator: Locator,
  label: string,
  timeoutMs: number = OVERLAY_SETTLE_TIMEOUT_MS,
): Promise<PanelBox> {
  const page = locator.page();
  const startedAt = Date.now();
  let lastError: string | null = null;
  for (;;) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    let box: Awaited<ReturnType<Locator["boundingBox"]>> = null;
    if (remainingMs > 0) {
      try {
        box = await locator.boundingBox({ timeout: remainingMs });
        lastError = null;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (box !== null) {
      return box;
    }
    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= timeoutMs) {
      throw new Error(
        [
          `${label} did not produce a bounding box within ${timeoutMs}ms (waited ${waitedMs}ms).`,
          lastError === null
            ? "Observed state: the locator resolved to a node that has no rendered box."
            : `Observed state: ${lastError.split("\n")[0] ?? lastError}`,
        ].join("\n"),
      );
    }
    await page.waitForTimeout(SETTLE_POLL_INTERVAL_MS);
  }
}

export async function expectNoPanelOverlap(page: Page): Promise<void> {
  const snapshot = await awaitSettledOverlay(page, OVERLAY_SETTLE_TIMEOUT_MS);
  const panels: ReadonlyArray<readonly [string, PanelBox]> = snapshot.probes.flatMap((probe) =>
    probe.box === null ? [] : [[probe.label, probe.box] as const],
  );

  expect(
    panels.flatMap(([leftLabel, left], index) =>
      panels
        .slice(index + 1)
        .filter(([, right]) => boxesOverlap(left, right))
        .map(([rightLabel]) => `${leftLabel} / ${rightLabel}`),
    ),
  ).toEqual([]);
}
