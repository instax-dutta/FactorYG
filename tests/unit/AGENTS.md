## Purpose

Own fast unit and React component tests.

## Local Contracts

- Tests assert public behavior and stable contracts, not private implementation details.
- Tests must be deterministic and independent of execution order.
- Component tests use the real store snapshot contract and accessible queries.
- A purchase control is tested against a real store, never a mocked command result. Freezing `store.subscribe` is a seam for manufacturing one narrow race, a click already queued when a tick lands so React has not re-rendered the control yet; it is not a state the app is ever in, so a refusal proven only through that seam is unproven. The consequence has to be covered again with a live subscription, by driving the tick and the click inside one `act` block so the store moves under a control that has not re-rendered.
- The Vitest default environment is `node`. A spec takes a DOM only through a `// @vitest-environment jsdom` docblock, and only when it renders components or reads `window`, `document`, or `localStorage`. Simulation, content, and persistence specs must not request jsdom, because the per-file environment is the largest cost in a run.
- The Vitest test timeout is a wall-clock budget, not a work budget, and stays at the 5 s default. A real hang must still fail inside that budget; never raise a budget to `0`. The first test in a jsdom file absorbs the per-file environment warm-up, so a spec that only needs a DOM for its first test should move that work instead of buying time with a larger budget.
- Shipped content can no longer stand in for a missing registration, because every machine and resource names art the asset manifest registers. A test that proves how a resolver or renderer behaves when art is absent must override the content row itself, through a `vi.hoisted` partial mock of `getMachine` or `getResource` that delegates to the real module. Three parts keep that mock honest and each is load-bearing, so none may be dropped. The override keeps a non-empty art key that differs from the shipped key and is absent from the manifest, so the assertion exercises the unregistered-key branch instead of the missing-key branch, which resolves the same way. The guard test also asserts that a machine the override does not touch still resolves, so a mock that stops delegating fails instead of silently returning nothing. The positive test expecting the real key runs after the guard test, so deleting the `beforeEach` clear leaks the override into it and turns the suite red. Deleting an assertion or flipping it to the registered result is not the fix.

## Work Guidance

- Use a failing test to prove a regression before fixing it.
- Keep fixtures explicit when they encode seeded world coordinates or content values.

## Verification

- `npm run test -- tests/unit`
- `npm run lint`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `tests/unit/`.
