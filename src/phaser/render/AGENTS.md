## Purpose

Own pure Phaser render helpers for Factor-I.

## Ownership

- `textureKeys.ts` resolves machine and resource texture keys and frame paths.
- `BeltItemRenderer.ts` converts typed belt-item events into injected views and glows.
- `EntityRenderer.ts` owns entity sprite bookkeeping behind injected views: placement, removal, the idle/active texture switch, the animation frame bucket, and the active-frame cache.
- `floorGrid.ts` owns the floor tile data as a pure function of the plot size, so a floor rebuild is assertable without a live scene.
- `machineBlink.ts` owns the blocked-machine pulse rate, tint, and hold, converts a start or stop into an injected tween, and exposes `createMachineBlinkTweenSpec` as the one place the pulse becomes a real Phaser tween.

## Local Contracts

- Helpers do not import React, DOM APIs, persistence, or mutate simulation state.
- Texture fallback is per machine; never substitute another machine's art.
- Resource colors come from canonical content definitions.
- Render events are treated as immutable inputs.
- `EntityRenderer` owns the entity sprite map, the placed-entity map, and the active set. `FactoryScene` holds none of them, so the scene cannot answer a question about the world by consulting a second copy that an event never reached.
- Frame keys are resolved once per resolved machine definition and cached in a `WeakMap` keyed on that definition object, never on the type name. Port geometry in `sim/connections.ts` is cached the same way for the same reason: frame keys are a function of the definition a resolver returns, so a resolver that substitutes a definition must get a different entry rather than a plausible stale one. The content tables are deep frozen, which is what makes caching them sound.
- `advanceFrames` is gated on the animation frame bucket, so a frame whose bucket has not advanced writes no texture at all. A machine that becomes active or idle invalidates the bucket so its first animation frame lands on the next `advanceFrames` rather than waiting for the bucket to turn. A machine whose active art the factory cannot load never joins the active set, so a missing texture degrades to idle art instead of an exception per frame.
- `getWork` reports `frameWrites` and `frameKeyResolutions` so the per-frame cost is a work count that is identical on every machine rather than a millisecond figure.

## Work Guidance

- Keep view creation, movement, replacement, and removal deterministic.
- Expose pure seams for unit tests instead of requiring a live Phaser scene.

## Verification

- `npm run test -- tests/unit/beltItemRender.test.ts tests/unit/renderEvents.test.ts tests/unit/sceneTelemetry.test.ts tests/unit/machineBlink.test.ts tests/unit/expansion.test.ts`
- `npm run test:e2e -- tests/e2e/animation-state.spec.ts --workers=1`

## Child DOX Index

- No child boundaries currently exist under `src/phaser/render/`.
