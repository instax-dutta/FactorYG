## Purpose

Own automated verification for Factor-I.

## Ownership

- `unit/` covers pure simulation, content, persistence, runtime helpers, and component behavior.
- `integration/` covers store and multi-module behavior without a browser.
- `e2e/` covers Phaser, React overlay, storage, reload, and browser input flows.

## Local Contracts

- New production behavior begins with a focused failing test.
- Unit tests do not require a live Phaser game; render seams use injected fakes.
- Browser tests use the public runtime bridge or real pointer interaction and avoid arbitrary sleeps.
- Vitest must not collect Playwright specs.

## Work Guidance

- Keep tests behavior-focused and independent of test execution order.
- Record red evidence for regression fixes in the task report.

## Verification

- `npm run test`
- `npm run test:e2e -- --workers=1`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Child DOX Index

- `unit/AGENTS.md` - pure and component test contracts.
- `integration/AGENTS.md` - store and module integration tests.
- `e2e/AGENTS.md` - browser flow contracts.
