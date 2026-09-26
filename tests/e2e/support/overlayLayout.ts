import { expect, type Locator, type Page } from "@playwright/test";

export type PanelBox = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

export function boxesOverlap(first: PanelBox, second: PanelBox): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

export async function waitForBoundingBox(locator: Locator, label: string): Promise<PanelBox> {
  let box: Awaited<ReturnType<Locator["boundingBox"]>> = null;
  await expect
    .poll(async () => {
      box = await locator.boundingBox();
      return box !== null;
    })
    .toBe(true);
  if (box === null) {
    throw new Error(`${label} bounding box unavailable`);
  }
  return box;
}

export async function expectNoPanelOverlap(page: Page): Promise<void> {
  const panels = [
    ["Header", await waitForBoundingBox(page.getByRole("banner"), "Header")],
    ["Hud", await waitForBoundingBox(page.getByTestId("hud"), "Hud")],
    [
      "Entity inspector",
      await waitForBoundingBox(page.getByTestId("entity-inspector"), "Inspector"),
    ],
    ["Build dock", await waitForBoundingBox(page.getByTestId("build-dock"), "Build dock")],
    [
      "Notification stack",
      await waitForBoundingBox(page.getByTestId("notification-stack"), "Notification stack"),
    ],
    [
      "Tech tree toggle",
      await waitForBoundingBox(page.getByTestId("tech-tree-toggle"), "Tech tree toggle"),
    ],
  ] as const;

  expect(
    panels.flatMap(([leftLabel, left], index) =>
      panels
        .slice(index + 1)
        .filter(([, right]) => boxesOverlap(left, right))
        .map(([rightLabel]) => `${leftLabel} / ${rightLabel}`),
    ),
  ).toEqual([]);
}
