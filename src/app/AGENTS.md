## Purpose

Own the browser application runtime and React shell.

## Ownership

- `App.tsx` composes the header, UI overlay, and one browser runtime.
- `GameCanvas.tsx` owns the Phaser canvas lifecycle and readiness gate.
- `runtime.ts` owns browser storage loading including the recovery a rejected save reports, the development bridge, scene telemetry, and autosave.

## Local Contracts

- One `SimulationRuntime` and one `SimulationStore` are shared by Phaser and React.
- Runtime creation and autosave disposal must be safe under React StrictMode.
- Browser storage access stays in the app layer; `src/sim` remains platform-independent.
- `projectRuntimeSave` is the one place a runtime save is built, and it refreshes `productionChains` from the live state so an offline session pays out from the chains the player actually built.
- `projectRuntimeSave` is also what stamps `lastSavedAt` with the current time, so the app layer owns that guarantee rather than the simulation. A command that rebuilds the world, such as a prestige reset, can hand back the new-game `lastSavedAt` and rely on the projection to stamp the real one before the write, which is what stops a reset from claiming offline time. `src/sim` does not know about autosave and must not describe it.
- The development bridge exposes only dispatch, manual tick, and snapshot methods.
- `loadBrowserSimulationResult` is the shipped app-layer load, and it returns the recovered state together with the `reason` and `message` the persistence layer already reported. It replaced a `loadBrowserSimulationState` that returned the state alone, so a refusal cannot be dropped between the load and the overlay: `SimulationRuntime.saveRecovery` is the carried record, and the overlay is the only thing that decides what the player is told. A load with no refusal, including a first-time player with nothing stored, reports no recovery, so the ordinary case is silence rather than a notice.
- Autosave writes are suspended from the moment a recovery exists until `acknowledgeSaveRecovery` is called, on both the `sync` and `flush` paths, so the page-hide path cannot destroy the payload either. The gate is a property rather than an accident of what a fresh run happens to serialize: an untouched new game projects the same value and structure the autosave was seeded with, so without the gate the payload would survive only until the player touched anything.
- Suspension lasts exactly as long as the player is being told, and no longer. The recovered run autosaves normally once acknowledged, which keeps autosave working for the rest of the session; the unreadable payload is therefore not a durable artifact and this is deliberately not a save-backup feature. A player who wants the rejected bytes afterwards has to copy them out of storage while the notice is up.
- `createSimulationRuntime` reports no recovery and a no-op `acknowledgeSaveRecovery`, so the overlay renders one component with no branch for where the runtime came from.
- The recovery is not persisted, and the acknowledgement is not either: a reload of a rejected save re-reports it, which is the honest answer because the payload is still unreadable.

## Work Guidance

- Keep readiness and cleanup callbacks idempotent.
- Preserve the Factor-I header and test-only lifecycle contract when changing the shell.

## Verification

- `npm run test -- tests/unit/runtime.test.ts tests/unit/hud.test.tsx tests/unit/runtimeAutosave.test.ts tests/unit/saveRecoveryNotice.test.tsx`
- `npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1`
- `npm run test:e2e -- tests/e2e/saveRecovery.spec.ts --workers=1`

## Child DOX Index

- No child boundaries currently exist under `src/app/`.
