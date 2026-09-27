import { expect, type Locator, type Page } from "@playwright/test";

export type PanelBox = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

const OVERLAY_SETTLE_TIMEOUT_MS = 10_000;
const SETTLE_POLL_INTERVAL_MS = 50;

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

const overlayPanels: readonly PanelDefinition[] = [
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
  readonly matches: number;
  readonly display: string | null;
  readonly visibility: string | null;
  readonly clientRects: number | null;
  readonly box: RectSnapshot | null;
}

function readOverlaySnapshot(definitions: readonly PanelDefinition[]): readonly PanelProbe[] {
  return definitions.map((definition) => {
    const elements = document.querySelectorAll(definition.selector);
    const element = elements.length === 1 ? elements.item(0) : null;
    if (element === null) {
      return {
        label: definition.label,
        matches: elements.length,
        display: null,
        visibility: null,
        clientRects: null,
        box: null,
      };
    }
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      label: definition.label,
      matches: elements.length,
      display: style.display,
      visibility: style.visibility,
      clientRects: element.getClientRects().length,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
}

function unsettledReason(probe: PanelProbe): string | null {
  if (probe.matches === 0) {
    return "no element matches the selector";
  }
  if (probe.matches > 1) {
    return "the selector is ambiguous";
  }
  if (probe.display === "none") {
    return "display=none";
  }
  if (probe.visibility === "hidden") {
    return "visibility=hidden";
  }
  if (probe.clientRects === 0) {
    return "the element has no client rect";
  }
  return null;
}

async function awaitSettledOverlay(page: Page, timeoutMs: number): Promise<readonly PanelProbe[]> {
  const startedAt = Date.now();
  for (;;) {
    const probes = await page.evaluate(readOverlaySnapshot, overlayPanels);
    const unsettled = probes.filter((probe) => unsettledReason(probe) !== null);
    if (unsettled.length === 0) {
      return probes;
    }
    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= timeoutMs) {
      const detail = unsettled
        .map(
          (probe) =>
            `  - ${probe.label}: ${unsettledReason(probe)} (matches=${probe.matches} display=${probe.display} visibility=${probe.visibility} clientRects=${probe.clientRects})`,
        )
        .join("\n");
      throw new Error(
        [
          `Overlay layout did not settle within ${timeoutMs}ms (waited ${waitedMs}ms).`,
          `Unsettled panels: ${unsettled.map((probe) => probe.label).join(", ")}`,
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
  const probes = await awaitSettledOverlay(page, OVERLAY_SETTLE_TIMEOUT_MS);
  const panels: ReadonlyArray<readonly [string, PanelBox]> = probes.flatMap((probe) =>
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
