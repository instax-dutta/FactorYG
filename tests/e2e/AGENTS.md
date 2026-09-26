## Purpose

Own Playwright browser flows for Factor-I.

## Local Contracts

- Browser tests run serially for the Phaser flow and assert no uncaught page errors. `playwright.config.ts` must keep `fullyParallel` off, `workers` at 1, and `retries` at 0, so the committed config is the serial, no-retry configuration the determinism evidence was gathered under.
- Tests use real canvas interaction or the development bridge, not private state.
- Overlay layout is asserted, not assumed: `expectNoPanelOverlap` compares every pair of persistent panels, notification stack included, at the desktop viewport and reports each overlapping pair by name, so adding a panel cannot silently cover another. Run it with the modal closed, because a focus-managed modal hides the background from the accessibility tree and a role-based locator cannot see it.
- Storage tests clear or seed the save deliberately and verify reload behavior.
- A saved world that the runtime is supposed to honour is proven by seeding it through `addInitScript` under `SAVE_KEY`, reloading, waiting for ready, and reading a value the renderer derived from it. A camera bound is the observable for plot size, and it must be read from the camera rather than from the value the scene intended to configure, or the assertion passes whether or not the scene applied it.
- The browser layer is the last place a recovery guard can be proven. Seeding a plot far outside the contract must reach ready with the starting plot and the starting currency, because a world that trusts an unbounded saved dimension builds a tilemap that never yields. Here the per-test budget is the hang detector, which is the browser form of the wall-clock contract in `tests/unit/AGENTS.md`, so the test asserts readiness rather than timing out.
- No arbitrary sleeps; use condition polling, rAF synchronization, or deterministic bridge ticks.
- Render telemetry is published from the scene update, so it trails the simulation by the events of the current tick. Read it only after a frame boundary, and never gate a frame wait on a telemetry value read earlier in the same tick; a scan that advances a tick and then reads render state synchronously steps over short-lived windows such as a belt item in flight. A state that persists, such as a blocked producer, may be scanned in batches of several ticks per frame instead.
- A geometry read such as `boundingBox` auto-waits for the element to be attached but then reads the box once, so it returns `null` while an attached element has no layout yet. Poll until a box exists, and pass an explicit timeout plus a label so a failure names the element instead of waiting out the whole test deadline.
- The runtime's own fixed-step clock keeps selling between Playwright round trips, so a currency read in one `evaluate` and another in the next include whatever sales landed in between. Read currency on both sides of a dispatch inside the same `evaluate` and assert the exact debit from that pair; never difference two separate reads.
- An unlock purchase whose debit must be exact is driven by a real DOM `click()` on the control's own `data-testid` from inside the page, after Playwright has asserted the affordance with `data-cost`, `data-state`, and enabled. That keeps the read-click-read atomic; the surrounding modal lifecycle is still driven with Playwright locators, and the committed unlock is proven from the store snapshot, the entry state, and the unlock notification.
- A React readout trails the store by a render, so a rendered value is compared toward a bridge value the store has already reached with `expect.poll(...).toBeGreaterThanOrEqual(...)`, never by equality against a bridge read taken afterwards.
- A long manual-tick run advances in bounded chunks with a frame boundary between them. Every sale adds a spark sprite whose tween retires only while the game loop runs, so one unbounded `advanceTicks` leaves thousands of live sprites behind; chunking with a double `requestAnimationFrame` is what keeps a long economy run cheap.
- Render telemetry shows a belt item at a tick boundary only when at least three belt cells separate the producer from the consuming machine's input port cell. A producer's push and the consumer's pull otherwise land in the same tick, so a one- or two-belt run is invisible in telemetry even though the chain is working. Size the run for the observation, not the other way round.
- Machine ports are offset geometry rather than cell occupancy, so a chain connects only when each machine's rotation puts the expected ports on the expected faces. A persisted `rotation` together with a traced production chain whose `outputResource` is the chain's last product is the proof that the rotated ports resolved; there is no negative assertion to write for the unrotated layout.
- Playwright's per-test timeout is a wall-clock budget, not a work budget. A spec that plays a whole economy through thousands of deterministic ticks sets `test.setTimeout` explicitly instead of trimming the chain it is proving.

## Work Guidance

- Keep browser selectors stable with data-testid and accessible roles.
- Cover readiness, cleanup, persistence, input, and modal behavior at the desktop viewport.

## Verification

- `npm run test:e2e`
- `npm run build`

## Child DOX Index

- No child boundaries currently exist under `tests/e2e/`.
