## Purpose

Own Playwright browser flows for Factor-I.

## Local Contracts

- Browser tests run serially for the Phaser flow and assert no uncaught page errors.
- Tests use real canvas interaction or the development bridge, not private state.
- Storage tests clear or seed the save deliberately and verify reload behavior.
- No arbitrary sleeps; use condition polling, rAF synchronization, or deterministic bridge ticks.
- Render telemetry is published from the scene update, so it trails the simulation by the events of the current tick. Read it only after a frame boundary, and never gate a frame wait on a telemetry value read earlier in the same tick; a scan that advances a tick and then reads render state synchronously steps over short-lived windows such as a belt item in flight.
- Geometry helpers such as `boundingBox` do not auto-wait and return `null` until the element is laid out. Poll them until a box exists instead of reading once.

## Work Guidance

- Keep browser selectors stable with data-testid and accessible roles.
- Cover readiness, cleanup, persistence, input, and modal behavior at the desktop viewport.

## Verification

- `npm run test:e2e -- --workers=1`
- `npm run build`

## Child DOX Index

- No child boundaries currently exist under `tests/e2e/`.
