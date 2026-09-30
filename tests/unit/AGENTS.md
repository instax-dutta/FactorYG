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
- A healthy saturated line and a dead line are told apart in these tests by whether the line can ever drain, so the healthy fixture has to actually saturate rather than merely run, and the only way to do that without waiting for a warm-up is to raise the producer's level. A level-1 producer fills nothing, refuses nothing, and passes for the wrong reason: a spec asserting "never flagged" over such a line proves only that an idle machine is silent, and it stays green under the defect it exists to catch. So each healthy fixture packs its producer past its downstream consumer's rate, and each is paired with the same line minus its sale terminal, which is the negative half of the same claim. The committed motor layout is the same contract at full scale, and it is saturated the same way rather than by running long enough for its own warm-up to back up.
- A tick over a long saturated belt run costs far more than a tick over a quiet world, so a fixture that saturates the committed motor layout must keep its window at the smallest tick count that still proves the property, and must assert that the saturation actually happened rather than assuming it. Measured on the full layout at extractor level 20, every extractor reads full from 60 ticks and stays full through 300, while the run cost is about 320 ms at 60 ticks against about 1,871 ms at 300. A 300-tick window was therefore five times the work for no extra proof, and it pushed the spec past the 5 s budget on a loaded host even though it never failed an assertion; the failure mode was a wall-clock timeout, which reads as a hang and hides the real cause. Saturation is reached by raising the level, not by extending the window, so the window is not where warmth is bought.
- The motor layout spec runs the whole 133-entity world, so its tick count is what keeps it inside the 5 s default rather than any per-test timeout. It reaches saturation by upgrading the extractors and asserts over a few hundred ticks, which is what makes it affordable; a spec that instead waits for an unsaturated layout to jam on its own needs over a thousand ticks and will blow the default budget under full-suite parallelism, where a file's work is stretched several times over. The remedy is to make the fixture reach the condition, not to buy time with a larger timeout.
- A "never flagged" spec over a layout asserts the precondition it depends on, not just the absence it forbids. Asserting that the extractors' output buffers are full is what proves the producers were actually refusing, so the spec cannot pass by watching an idle world; asserting that the layout sold something only proves the same thing after the slowest recipe in the chain has run, which on the Motor chain is over 200 ticks of work for a signal a cheaper assertion already gives. Claim what the spec is about and let the spec that already owns throughput own throughput.

## Work Guidance

- Use a failing test to prove a regression before fixing it.
- Keep fixtures explicit when they encode seeded world coordinates or content values.

## Verification

- `npm run test -- tests/unit`
- `npm run lint`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `tests/unit/`.
