## Purpose

Own tests that cross module boundaries without a real browser.

## Local Contracts

- Integration tests may combine store, snapshot, persistence, and runtime seams.
- They must not import Phaser, React DOM components, or browser globals.

## Work Guidance

- Use injected clocks and storage fakes for deterministic timing and persistence.
- Assert both state transitions and public snapshot effects.

## Verification

- `npm run test -- tests/integration`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `tests/integration/`.
