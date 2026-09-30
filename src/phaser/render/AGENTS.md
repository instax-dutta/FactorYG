## Purpose

Own pure Phaser render helpers for Factor-I.

## Ownership

- `textureKeys.ts` resolves machine and resource texture keys and frame paths.
- `BeltItemRenderer.ts` converts typed belt-item events into injected views and glows.
- `NodeRenderer.ts` draws the world resource nodes. Nodes were in the save, in the simulation, and in the content tables, and were drawn by nothing at all, so the one cell an extractor is allowed to stand on was invisible and a new player had no way to find it. Every node is a sprite in the node layer, resolved through `resolveResourceTextureKey` to that resource's own art, centred on its cell the same way `EntityRenderer` centres a machine. A node whose art cannot be loaded produces no sprite and no exception, so missing art degrades to an absent node rather than a broken scene.
- Node art is drawn from `SimulationStore.getNodes()`, a read-only view like `getEntities` and `getBeltItems`, so the renderer cannot answer a question about the world by consulting a second copy. `NodeRenderer.sync` is idempotent and destroys a sprite for a node that left the world, because a prestige reset or an expansion rebuilds the node list and a leaked sprite would be drawn over a world that no longer has that cell.
- The node layer sits below the machine and belt layers, so a machine built on a node covers it rather than the other way round, and node art is never substituted for machine art. A node is the only thing a player can mine, so its visibility is load-bearing gameplay rather than decoration, which is why `tests/e2e/firstRun.spec.ts` proves a node reaches the screen by comparing two node cells against bare floor instead of trusting a counter.
- `EntityRenderer.ts` owns entity sprite bookkeeping behind injected views: placement, removal, the idle/active texture switch, the animation frame bucket, and the active-frame cache.
- `floorGrid.ts` owns the floor tile data as a pure function of the plot size, so a floor rebuild is assertable without a live scene.
- `machineBlink.ts` owns the blocked-machine pulse rate, tint, and hold, converts a start or stop into an injected tween, and exposes `createMachineBlinkTweenSpec` as the one place the pulse becomes a real Phaser tween.
- `VfxRenderer.ts` owns the three v1 VFX families: the additive smelter heat overlay and the one-shot depot sale burst. It creates no particle emitter and no post-processing, and it is the only place either family's lifetime or tint is decided.

## Local Contracts

- Helpers do not import React, DOM APIs, persistence, or mutate simulation state.
- Texture fallback is per machine; never substitute another machine's art.
- Resource colors come from canonical content definitions.
- Render events are treated as immutable inputs.
- VFX is exactly the three named families: belt glow, smelter heat, and depot sale burst. There is no fourth family, and a new event or machine type does not acquire a visual by arriving in `apply`.
- Smelter heat is its own overlay view in the VFX layer and never writes the machine sprite's tint or alpha. `machineBlink` owns those two channels on the machine sprite, state in tint and motion in alpha, and a heat pulse on the same sprite would mask a blocked smelter's alarm red. The separation is asserted in `tests/unit/renderEventContract.test.ts` by reading the renderer source for tint and angle writes, so it cannot be quietly undone.
- Heat is scheduled from `machineStateChanged` on the transition into active and stopped on the transition out, and only for the machine types in `HEATED_MACHINE_TYPES`. A blocked producer is idle, so a block stops the heat and starts the blink on the same tick and the two never both run.
- A sale burst is one short view per `saleCompleted`, tinted from the sold resource's own content colour, and never a per-unit effect. `saleCompleted` is emitted only by a machine the machine table marks `saleTerminal`, so the depot-only rule comes from the simulation rather than from a check here.
- Views are pooled and the burst pool is capped at `MAX_LIVE_SALE_BURSTS`. A retired view is stopped, hidden, and returned to the pool rather than destroyed, and the completion callback is idempotent, so a view retired by the cap and then completed by its own tween cannot be released twice. The cap is what stops a long manual-tick run from leaving thousands of live sprites behind.
- `createSmelterHeatPulseSpec` and `createSaleBurstSpec` are the only places a VFX motion becomes a tween config, and both are asserted directly so the motion cannot be silently flattened the way an inlined tween could be.
- `EntityRenderer` owns the entity sprite map, the placed-entity map, and the active set. `FactoryScene` holds none of them, so the scene cannot answer a question about the world by consulting a second copy that an event never reached.
- Frame keys are resolved once per resolved machine definition and cached in a `WeakMap` keyed on that definition object, never on the type name. Port geometry in `sim/connections.ts` is cached the same way for the same reason: frame keys are a function of the definition a resolver returns, so a resolver that substitutes a definition must get a different entry rather than a plausible stale one. The content tables are deep frozen, which is what makes caching them sound.
- `advanceFrames` is gated on the animation frame bucket, so a frame whose bucket has not advanced writes no texture at all. A machine that becomes active or idle invalidates the bucket so its first animation frame lands on the next `advanceFrames` rather than waiting for the bucket to turn. A machine whose active art the factory cannot load never joins the active set, so a missing texture degrades to idle art instead of an exception per frame.
- `getWork` reports `frameWrites` and `frameKeyResolutions` so the per-frame cost is a work count that is identical on every machine rather than a millisecond figure.

## Work Guidance

- Keep view creation, movement, replacement, and removal deterministic.
- Expose pure seams for unit tests instead of requiring a live Phaser scene.

## Verification

- `npm run test -- tests/unit/nodeRenderer.test.ts tests/unit/beltItemRender.test.ts tests/unit/renderEvents.test.ts tests/unit/vfx.test.ts tests/unit/renderEventContract.test.ts tests/unit/sceneTelemetry.test.ts tests/unit/machineBlink.test.ts tests/unit/expansion.test.ts`
- `npm run test:e2e -- tests/e2e/animation-state.spec.ts --workers=1`
- `npm run test:e2e -- tests/e2e/vfx.spec.ts --workers=1`

## Child DOX Index

- No child boundaries currently exist under `src/phaser/render/`.
