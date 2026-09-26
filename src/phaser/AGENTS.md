## Purpose

Own the Phaser scene, camera, world input, and render orchestration.

## Ownership

- `FactoryScene.ts` owns scene lifecycle, entity sprites, ghost preview, and render events.
- `createGame.ts` owns Phaser boot configuration and renderer/scale setup.
- `inputAdapter.ts` owns pan, zoom, pointer, keyboard, and drag state.
- `telemetry.ts` owns the development/test scene snapshot.
- `render/` owns pure render helpers and adapters, including the blocked-machine blink.

## Local Contracts

- Phaser reads simulation snapshots and dispatches commands; `update()` contains no economic logic.
- The render-event switch is exhaustive, so an unhandled `RenderEvent` variant is a compile error rather than a silent no-op.
- Machine textures resolve only to the same machine's idle/active art.
- The scene signals readiness only after store subscriptions and input are installed.
- Cleanup is idempotent and handles both shutdown and destroy events.
- A blocked machine blinks and nothing else does. The blink is a persistent machine-sprite tint plus a repeating pulse, never the one-shot `vfx.spark` sprite `renderNotice` uses, so a sale and a block never share one visual.
- The blink puts state in the tint channel and motion in the alpha channel: the blocked red is set once per transition and the tint the machine carried is restored exactly when the flow resumes, so a future recipe tint can never mask a block. `machineBlink.ts` owns those constants and builds the tween through `createMachineBlinkTweenSpec`, which is the single place the pulse becomes a real Phaser tween and is asserted directly so the motion cannot be silently flattened. No shipped machine sprite carries a tint today.
- The snapshot reconcile owns the blink in both directions. `SimulationStore` publishes the snapshot before it publishes events, so `refreshBlockedMachines` always starts a blocked machine first and the `blockedFull` arm always finds it already blinking. The event is kept as the documented contract for the exhaustive switch and as the seam for a future immediate effect; it is not what starts the visual today.
- A `machineStateChanged` event never starts or stops a blink: a blocked producer is also idle, so both events land in the same tick.
- The scene's world bookkeeping is event-driven and never reconciled from a snapshot: `syncExistingWorld` runs once at boot, and `entitySprites`, `placedEntities`, `activeEntityIds`, and the belt-item views move only on `entityPlaced` and `entityRemoved`. A command that clears or replaces the world, such as a prestige reset, must publish one `entityRemoved` per removed entity, because nothing in the scene notices an entity that vanished without its event and the browser keeps drawing it, hit-testing it, and reporting it in telemetry entity ids.
- Render telemetry publishes `blockedEntityIds` so a browser test can observe which machines are blinking without reaching into a sprite or a tween.

## Work Guidance

- Keep pointer-to-cell conversion aligned with the live canvas transform.
- Keep render helpers free of simulation mutation and DOM ownership.

## Verification

- `npm run test -- tests/unit/cameraConfig.test.ts tests/unit/primaryInteraction.test.ts tests/unit/sceneTelemetry.test.ts tests/unit/renderEventContract.test.ts tests/unit/machineBlink.test.ts`
- `npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1`

## Child DOX Index

- `render/AGENTS.md` - texture resolution and belt-item render adapters.
