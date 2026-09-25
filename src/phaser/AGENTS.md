## Purpose

Own the Phaser scene, camera, world input, and render orchestration.

## Ownership

- `FactoryScene.ts` owns scene lifecycle, entity sprites, ghost preview, and render events.
- `createGame.ts` owns Phaser boot configuration and renderer/scale setup.
- `inputAdapter.ts` owns pan, zoom, pointer, keyboard, and drag state.
- `telemetry.ts` owns the development/test scene snapshot.
- `render/` owns pure render helpers and adapters.

## Local Contracts

- Phaser reads simulation snapshots and dispatches commands; `update()` contains no economic logic.
- Machine textures resolve only to the same machine's idle/active art.
- The scene signals readiness only after store subscriptions and input are installed.
- Cleanup is idempotent and handles both shutdown and destroy events.

## Work Guidance

- Keep pointer-to-cell conversion aligned with the live canvas transform.
- Keep render helpers free of simulation mutation and DOM ownership.

## Verification

- `npm run test -- tests/unit/cameraConfig.test.ts tests/unit/primaryInteraction.test.ts tests/unit/sceneTelemetry.test.ts`
- `npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1`

## Child DOX Index

- `render/AGENTS.md` - texture resolution and belt-item render adapters.
