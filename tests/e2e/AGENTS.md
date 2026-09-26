## Purpose

Own Playwright browser flows for Factor-I.

## Local Contracts

- Browser tests run serially for the Phaser flow and assert no uncaught page errors. `playwright.config.ts` must keep `fullyParallel` off, `workers` at 1, and `retries` at 0, so the committed config is the serial, no-retry configuration the determinism evidence was gathered under.
- Tests use real canvas interaction or the development bridge, not private state.
- Overlay layout is asserted, not assumed: `expectNoPanelOverlap` compares every pair of persistent panels, notification stack included, at the desktop viewport and reports each overlapping pair by name, so adding a panel cannot silently cover another. Run it with the modal closed, because a focus-managed modal hides the background from the accessibility tree and a role-based locator cannot see it.
- Storage tests clear or seed the save deliberately and verify reload behavior.
- No arbitrary sleeps; use condition polling, rAF synchronization, or deterministic bridge ticks.
- Render telemetry is published from the scene update, so it trails the simulation by the events of the current tick. Read it only after a frame boundary, and never gate a frame wait on a telemetry value read earlier in the same tick; a scan that advances a tick and then reads render state synchronously steps over short-lived windows such as a belt item in flight. A state that persists, such as a blocked producer, may be scanned in batches of several ticks per frame instead.
- A geometry read such as `boundingBox` auto-waits for the element to be attached but then reads the box once, so it returns `null` while an attached element has no layout yet. Poll until a box exists, and pass an explicit timeout plus a label so a failure names the element instead of waiting out the whole test deadline.

## Work Guidance

- Keep browser selectors stable with data-testid and accessible roles.
- Cover readiness, cleanup, persistence, input, and modal behavior at the desktop viewport.

## Verification

- `npm run test:e2e`
- `npm run build`

## Child DOX Index

- No child boundaries currently exist under `tests/e2e/`.
