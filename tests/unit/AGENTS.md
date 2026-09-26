## Purpose

Own fast unit and React component tests.

## Local Contracts

- Tests assert public behavior and stable contracts, not private implementation details.
- Tests must be deterministic and independent of execution order.
- Component tests use the real store snapshot contract and accessible queries.
- The Vitest test timeout is a wall-clock budget, not a work budget. The first test in a jsdom file absorbs the per-file environment and first accessible-query warm-up, measured near half a second, and a loaded machine stretches that wall clock, so the configured budget sits above the warm-up instead of at the 5 s default. A real hang must still fail inside that budget; never raise a budget to `0`.

## Work Guidance

- Use a failing test to prove a regression before fixing it.
- Keep fixtures explicit when they encode seeded world coordinates or content values.

## Verification

- `npm run test -- tests/unit`
- `npm run lint`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `tests/unit/`.
