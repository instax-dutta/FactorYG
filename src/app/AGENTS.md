## Purpose

Own the browser application runtime and React shell.

## Ownership

- `App.tsx` composes the header, UI overlay, and one browser runtime.
- `GameCanvas.tsx` owns the Phaser canvas lifecycle and readiness gate.
- `runtime.ts` owns browser storage loading, the development bridge, scene telemetry, and autosave.

## Local Contracts

- One `SimulationRuntime` and one `SimulationStore` are shared by Phaser and React.
- Runtime creation and autosave disposal must be safe under React StrictMode.
- Browser storage access stays in the app layer; `src/sim` remains platform-independent.
- `projectRuntimeSave` is the one place a runtime save is built, and it refreshes `productionChains` from the live state so an offline session pays out from the chains the player actually built.
- The development bridge exposes only dispatch, manual tick, and snapshot methods.

## Work Guidance

- Keep readiness and cleanup callbacks idempotent.
- Preserve the Factor-I header and test-only lifecycle contract when changing the shell.

## Verification

- `npm run test -- tests/unit/runtime.test.ts tests/unit/hud.test.tsx tests/unit/runtimeAutosave.test.ts`
- `npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1`

## Child DOX Index

- No child boundaries currently exist under `src/app/`.
