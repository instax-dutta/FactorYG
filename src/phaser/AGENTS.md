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
- The blink puts state in the tint channel and motion in the alpha channel: the blocked red is set once per transition and the tint the machine carried is restored exactly when the flow resumes, so a future recipe tint can never mask a block. `machineBlink.ts` owns those constants, and no shipped machine sprite carries a tint today.
- The blink is started by `blockedFull` and reconciled against `getBlockedMachineIds` on every snapshot, because the event reports only the transition into a blocked state. A `machineStateChanged` event never stops a blink: a blocked producer is also idle, so both events land in the same tick.
- Render telemetry publishes `blockedEntityIds` so a browser test can observe which machines are blinking without reaching into a sprite or a tween.

## Work Guidance

- Keep pointer-to-cell conversion aligned with the live canvas transform.
- Keep render helpers free of simulation mutation and DOM ownership.

## Verification

- `npm run test -- tests/unit/cameraConfig.test.ts tests/unit/primaryInteraction.test.ts tests/unit/sceneTelemetry.test.ts tests/unit/renderEventContract.test.ts tests/unit/machineBlink.test.ts`
- `npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1`

## Child DOX Index

- `render/AGENTS.md` - texture resolution and belt-item render adapters.
