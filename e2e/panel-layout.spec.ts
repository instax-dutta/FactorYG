import { test, expect, type Page } from '@playwright/test';
import { MOTOR_THRESHOLD, SAVE_KEY, SAVE_VERSION } from '../src/config/constants';
import { startingUnlocks } from '../src/sim/techTree';
import { collectErrors, openTechPanel, waitForReady } from './helpers';

/**
 * Regression: the build bar used to wrap into a 122px-tall strip because
 * `left: 50%` capped its shrink-to-fit width at half the viewport. It painted
 * over the bottom of the tech panel, and since the panel's last row is the
 * Motor unlock, the game could not be finished by hand at 1280x720: the button
 * was rendered, enabled, and completely behind the bar.
 *
 * The assertion is the player-facing one — the point a player aims at is the
 * element that actually receives the click — plus a geometry check that says
 * which of the two boxes is on top when they do meet.
 */

const TECH_ORDER = [
  'refinedStone',
  'assembler',
  'wire',
  'gear',
  'plate',
  'silo',
  'circuit',
  'frame',
  'motor',
];

const PANEL_VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1024, height: 720 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];

async function assertModalHitTargets(page: Page, overlay: string, controls: string[]) {
  const report = await page.evaluate(
    ({ overlay, controls }) => {
      const root = document.querySelector<HTMLElement>(`[data-testid="${overlay}"]`);
      const rootBox = root?.getBoundingClientRect();
      const blocked: string[] = [];
      for (const id of controls) {
        const control = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        if (!control) {
          blocked.push(`${id}: missing`);
          continue;
        }
        const box = control.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (!hit || (hit !== control && !control.contains(hit))) {
          const offender = hit as HTMLElement | null;
          blocked.push(`${id} <- ${offender?.getAttribute('data-testid') ?? offender?.tagName ?? 'nothing'}`);
        }
      }
      return {
        blocked,
        root: rootBox
          ? { left: rootBox.left, right: rootBox.right, top: rootBox.top, bottom: rootBox.bottom }
          : null,
        dialogWidth: root?.firstElementChild?.getBoundingClientRect().width ?? 0,
        viewportWidth: window.innerWidth,
      };
    },
    { overlay, controls },
  );
  expect(report.blocked).toEqual([]);
  expect(report.root).not.toBeNull();
  expect(report.root?.left).toBeLessThanOrEqual(0);
  expect(report.root?.right).toBeGreaterThanOrEqual(report.viewportWidth);
  expect(report.dialogWidth).toBeLessThanOrEqual(report.viewportWidth - 16);
}

async function seedOfflineSave(page: Page, lifetimeMotors = 0): Promise<void> {
  const points = Math.floor(lifetimeMotors / MOTOR_THRESHOLD);
  const starting = startingUnlocks();
  const save = {
    version: SAVE_VERSION,
    lastSavedAt: Date.now() - 120_000,
    currency: 0,
    prestige: {
      lifetimeMotors,
      points,
      claimedPoints: 0,
      totalPrestiges: 0,
      permanentMultipliers: {
        productionSpeed: 1 + 0.25 * points,
        sellValue: 1 + 0.5 * points,
      },
    },
    unlocked: starting,
    grid: { width: 64, height: 64, entities: [], expansionsBought: 0 },
    productionChains: {
      'sold-motor': { steadyStateThroughput: 0.5, outputResource: 'motor' },
    },
  };
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [SAVE_KEY, JSON.stringify(save)] as [string, string],
  );
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1024, height: 720 },
]) {
  test(`every tech unlock is clickable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await waitForReady(page, errors);
    await openTechPanel(page);

    const report = await page.evaluate((ids: string[]) => {
      const bar = document.querySelector('[data-testid="build-bar"]') as HTMLElement | null;
      const panel = document.querySelector('[data-testid="tech-panel"]') as HTMLElement | null;
      const barBox = bar?.getBoundingClientRect();
      const panelBox = panel?.getBoundingClientRect();

      const blocked: string[] = [];
      for (const id of ids) {
        const button = document.querySelector(`[data-testid="tech-buy-${id}"]`);
        if (!button) {
          blocked.push(`${id}: missing`);
          continue;
        }
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        // A button with an inner span still counts as hit; something else is a bug.
        if (!hit || (hit !== button && !button.contains(hit))) {
          const offender = hit as HTMLElement | null;
          blocked.push(`${id} <- ${offender?.getAttribute('data-testid') ?? offender?.tagName ?? 'nothing'}`);
        }
      }

      return {
        blocked,
        bar: barBox ? `y ${Math.round(barBox.top)}..${Math.round(barBox.bottom)} (${Math.round(barBox.height)}px tall)` : 'no bar',
        panel: panelBox
          ? `y ${Math.round(panelBox.top)}..${Math.round(panelBox.bottom)}`
          : 'no panel',
        overlapPx:
          barBox && panelBox ? Math.max(0, Math.round(Math.min(barBox.bottom, panelBox.bottom) - Math.max(barBox.top, panelBox.top))) : 0,
      };
    }, TECH_ORDER);

    console.log(`[${viewport.width}x${viewport.height}] ${JSON.stringify(report)}`);
    expect(report.blocked).toEqual([]);
  });
}

/**
 * The same bug class, watched from the other end: every overlay panel on screen
 * at once. The tech panel shares the screen with the build bar and the prestige
 * panel, and the prestige panel is newer than both — so the property worth
 * holding is that no panel silences another's controls, not just the one pair
 * that happened to break.
 */
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1024, height: 720 },
]) {
  test(`no panel covers another panel's controls at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await waitForReady(page, errors);
    await openTechPanel(page);

    const report = await page.evaluate(() => {
      // Everything a player is meant to be able to press right now.
      const ids = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="build-bar"] button, [data-testid="prestige-panel"] button, [data-testid="tech-panel"] button',
        ),
      ).map((el) => el.getAttribute('data-testid') ?? '(unnamed)');

      const blocked: string[] = [];
      const boxes: Record<string, string> = {};
      for (const panelId of ['build-bar', 'tech-panel', 'prestige-panel']) {
        const box = document.querySelector(`[data-testid="${panelId}"]`)?.getBoundingClientRect();
        if (box) {
          boxes[panelId] = `x ${Math.round(box.left)}..${Math.round(box.right)} y ${Math.round(box.top)}..${Math.round(box.bottom)}`;
        }
      }

      for (const id of ids) {
        const button = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        if (!button) continue;
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        if (!hit || (hit !== button && !button.contains(hit))) {
          const offender = hit as HTMLElement | null;
          blocked.push(`${id} <- ${offender?.getAttribute('data-testid') ?? offender?.tagName ?? 'nothing'}`);
        }
      }

      return { controls: ids.length, blocked, boxes };
    });

    console.log(`[${viewport.width}x${viewport.height}] ${JSON.stringify(report)}`);

    // A sanity floor: a guard that hit-tests nothing would pass vacuously.
    expect(report.controls).toBeGreaterThanOrEqual(10);
    expect(report.blocked).toEqual([]);
  });
}

for (const viewport of PANEL_VIEWPORTS) {
  test(`keeps panels separated and controls usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await waitForReady(page, errors);

    await expect(page.getByTestId('info-panel')).not.toBeVisible();
    await page.mouse.click(viewport.width - 2, viewport.height / 2);
    await expect(page.getByTestId('info-panel')).toBeVisible();
    await openTechPanel(page);

    const status = page.getByTestId('placement-status');
    await page.getByTestId('tool-belt').click();
    const statusPoints = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return [];
      const box = canvas.getBoundingClientRect();
      const points: { x: number; y: number }[] = [];
      for (let y = box.top + box.height * 0.15; y < box.bottom; y += 16) {
        for (let x = box.left + box.width * 0.1; x < box.right; x += 16) {
          if (document.elementFromPoint(x, y) === canvas) points.push({ x, y });
        }
      }
      return points;
    });
    for (const point of statusPoints) {
      await page.mouse.move(point.x, point.y);
      if ((await status.textContent())?.trim() === 'Disconnected - this machine will idle') break;
    }
    await expect(status).toHaveText('Disconnected - this machine will idle');

    const report = await page.evaluate((techOrder) => {
      const boxesIntersect = (a: DOMRect, b: DOMRect): boolean =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const topLevel = ['hud-panel', 'right-rail', 'node-legend', 'build-bar', 'tech-panel'];
      const children = ['info-panel', 'prestige-panel'];
      const boxes: Record<string, DOMRect> = {};
      const missing: string[] = [];
      for (const id of [...topLevel, ...children]) {
        const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        if (!element) {
          missing.push(id);
          continue;
        }
        boxes[id] = element.getBoundingClientRect();
      }

      const overlaps: string[] = [];
      for (let i = 0; i < topLevel.length; i += 1) {
        for (let j = i + 1; j < topLevel.length; j += 1) {
          const a = boxes[topLevel[i]];
          const b = boxes[topLevel[j]];
          if (a && b && boxesIntersect(a, b)) overlaps.push(`${topLevel[i]} / ${topLevel[j]}`);
        }
      }
      for (const child of children) {
        for (const parent of topLevel.filter((id) => id !== 'right-rail')) {
          const a = boxes[child];
          const b = boxes[parent];
          if (a && b && boxesIntersect(a, b)) overlaps.push(`${child} / ${parent}`);
        }
      }
      if (boxes['info-panel'] && boxes['prestige-panel'] && boxesIntersect(boxes['info-panel'], boxes['prestige-panel'])) {
        overlaps.push('info-panel / prestige-panel');
      }

      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="build-bar"] button, [data-testid="tech-panel"] button, [data-testid="info-panel"] button, [data-testid="prestige-panel"] button',
        ),
      );
      const blocked: string[] = [];
      for (const control of controls) {
        control.scrollIntoView({ block: 'center', inline: 'center' });
        const box = control.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (!hit || (hit !== control && !control.contains(hit))) {
          const offender = hit as HTMLElement | null;
          blocked.push(`${control.getAttribute('data-testid')} <- ${offender?.getAttribute('data-testid') ?? offender?.tagName ?? 'nothing'}`);
        }
      }

      const toastElement = document.querySelector<HTMLElement>('[data-testid="toasts"]');
      const toast = toastElement?.getBoundingClientRect();
      const statusOverlaps = toast && toast.width > 0 && toast.height > 0
        ? controls
            .filter((control) => {
              const box = control.getBoundingClientRect();
              return boxesIntersect(toast, box);
            })
            .map((control) => control.getAttribute('data-testid') ?? '(unnamed)')
        : [];
      const rail = document.querySelector<HTMLElement>('[data-testid="right-rail"]');
      const legend = document.querySelector<HTMLElement>('[data-testid="node-legend"]');
      const tech = boxes['tech-panel'];
      const build = boxes['build-bar'];
      return {
        missing,
        overlaps,
        blocked,
        statusOverlaps,
        controls: controls.length,
        railDisplay: rail ? getComputedStyle(rail).display : null,
        railDirection: rail ? getComputedStyle(rail).flexDirection : null,
        toastPointerEvents: toastElement ? getComputedStyle(toastElement).pointerEvents : null,
        legendPointerEvents: legend ? getComputedStyle(legend).pointerEvents : null,
        techWidth: tech?.width ?? 0,
        build: build
          ? { left: build.left, right: build.right, top: build.top, bottom: build.bottom }
          : null,
        techIds: techOrder.filter((id) => document.querySelector(`[data-testid="tech-buy-${id}"]`)),
      };
    }, TECH_ORDER);

    expect(report.missing).toEqual([]);
    expect(report.overlaps).toEqual([]);
    expect(report.blocked).toEqual([]);
    expect(report.statusOverlaps).toEqual([]);
    expect(report.controls).toBeGreaterThanOrEqual(12);
    expect(report.railDisplay).toBe('flex');
    expect(report.railDirection).toBe('column');
    expect(report.toastPointerEvents).toBe('none');
    expect(report.legendPointerEvents).toBe('none');
    expect(report.techWidth).toBeLessThanOrEqual(viewport.width - 16);
    expect(report.build?.left).toBeGreaterThanOrEqual(0);
    expect(report.build?.right).toBeLessThanOrEqual(viewport.width);
    expect(report.techIds).toEqual(TECH_ORDER);
    expect(errors).toEqual([]);
  });

  test(`keeps both modals usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(viewport);
    await seedOfflineSave(page, MOTOR_THRESHOLD);
    await page.goto('/');
    await waitForReady(page, errors);

    await expect(page.getByTestId('offline-modal')).toBeVisible();
    await assertModalHitTargets(page, 'offline-modal', ['offline-dismiss']);
    await page.getByTestId('offline-dismiss').click();

    await expect(page.getByTestId('prestige')).toBeEnabled();
    await page.getByTestId('prestige').click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    await assertModalHitTargets(page, 'confirm-modal', ['confirm-yes', 'confirm-no']);
    expect(errors).toEqual([]);
  });
}
