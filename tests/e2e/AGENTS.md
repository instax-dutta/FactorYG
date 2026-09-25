## Purpose

Own Playwright browser flows for Factor-I.

## Local Contracts

- Browser tests run serially for the Phaser flow and assert no uncaught page errors.
- Tests use real canvas interaction or the development bridge, not private state.
- Storage tests clear or seed the save deliberately and verify reload behavior.
- No arbitrary sleeps; use condition polling, rAF synchronization, or deterministic bridge ticks.

## Work Guidance

- Keep browser selectors stable with data-testid and accessible roles.
- Cover readiness, cleanup, persistence, input, and modal behavior at the desktop viewport.

## Verification

- `npm run test:e2e -- --workers=1`
- `npm run build`

## Child DOX Index

- No child boundaries currently exist under `tests/e2e/`.
