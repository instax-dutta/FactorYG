## What this changes

<!-- One or two sentences. Link the issue it closes, if any: Closes #123 -->

## Why

<!-- The motivation. If this touches the design, say how it relates to docs/SPEC.md -->

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test` (449 unit/integration tests)
- [ ] `npm run e2e` (77 Playwright tests)
- [ ] `npm run build`

<!-- Tick only what you actually ran, and say which. -->

## Checklist

- [ ] Game logic changes stay inside `src/sim/` with no React or three.js imports
- [ ] Economy changes update the balance contract in `tests/balance.test.ts` in the same commit
- [ ] New behavior has a test; fixed bugs have a regression test
- [ ] Design changes are reflected in `docs/SPEC.md`
- [ ] Save schema changes bump the save version and keep old saves recoverable
