## Purpose

Own tests that cross module boundaries without a real browser.

## Local Contracts

- Integration tests may combine store, snapshot, persistence, and runtime seams.
- They must not import Phaser, React DOM components, or browser globals.
- A deferred-command test names a command the store does not implement yet, so it has a one-task shelf life. `store.test.ts` uses `expandGrid` today, and the moment Task 3.3 implements that command the test needs a different deferred command; the assertion that the store returns a `CommandResult` and publishes no snapshot must survive that swap rather than be deleted.

## Work Guidance

- Use injected clocks and storage fakes for deterministic timing and persistence.
- Assert both state transitions and public snapshot effects.

## Verification

- `npm run test -- tests/integration`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `tests/integration/`.
