## Purpose

Own pure Phaser render helpers for Factor-I.

## Ownership

- `textureKeys.ts` resolves machine and resource texture keys and frame paths.
- `BeltItemRenderer.ts` converts typed belt-item events into injected views and glows.
- `machineBlink.ts` owns the blocked-machine pulse rate, tint, and hold, and converts a start or stop into an injected tween.

## Local Contracts

- Helpers do not import React, DOM APIs, persistence, or mutate simulation state.
- Texture fallback is per machine; never substitute another machine's art.
- Resource colors come from canonical content definitions.
- Render events are treated as immutable inputs.

## Work Guidance

- Keep view creation, movement, replacement, and removal deterministic.
- Expose pure seams for unit tests instead of requiring a live Phaser scene.

## Verification

- `npm run test -- tests/unit/beltItemRender.test.ts tests/unit/sceneTelemetry.test.ts tests/unit/machineBlink.test.ts`

## Child DOX Index

- No child boundaries currently exist under `src/phaser/render/`.
