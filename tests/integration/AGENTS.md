## Purpose

Own tests that cross module boundaries without a real browser.

## Local Contracts

- Integration tests may combine store, snapshot, persistence, and runtime seams.
- They must not import Phaser, React DOM components, or browser globals.
- The store's default branch must stay proven. Every declared `SimulationCommand` variant is now implemented, so `store.test.ts` reaches that branch with a command that is not in the union rather than with a variant that is merely late. The assertion that the store returns a `CommandResult` and publishes no snapshot is the durable part and must survive any further change to the command list.

## Work Guidance

- Use injected clocks and storage fakes for deterministic timing and persistence.
- Assert both state transitions and public snapshot effects.

## Verification

- `npm run test -- tests/integration`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `tests/integration/`.
