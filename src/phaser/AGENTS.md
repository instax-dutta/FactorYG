## Purpose

Own the Phaser scene, camera, world input, and render orchestration.

## Ownership

- `FactoryScene.ts` owns scene lifecycle, entity sprites, ghost preview, the floor tilemap, camera bounds, and render events.
- `createGame.ts` owns Phaser boot configuration and renderer/scale setup.
- `inputAdapter.ts` owns pan, zoom, pointer, keyboard, and drag state.
- `telemetry.ts` owns the development/test scene snapshot, and `cameraConfig.ts` owns the camera margin and the zoom range as exported constants so the scene and a browser assertion read the same numbers.
- `render/` owns pure render helpers and adapters, including the blocked-machine blink and the entity sprite renderer.

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
- The scene's world bookkeeping is event-driven and never reconciled from a snapshot: `syncExistingWorld` runs once at boot, and `EntityRenderer`'s sprite map, placed-entity map, and active set and the belt-item views move only on `entityPlaced` and `entityRemoved`. A command that clears or replaces the world, such as a prestige reset, must publish one `entityRemoved` per removed entity, because nothing in the scene notices an entity that vanished without its event and the browser keeps drawing it, hit-testing it, and reporting it in telemetry entity ids. The renderer is where that bookkeeping moved to, so the contract is unchanged and the renderer is the single owner: `FactoryScene` no longer holds a sprite map, a placed-entity map, or an active set of its own.
- `syncActive` exists for the boot reconcile only, and reads `store.getActiveMachineIds()`. It is not a per-tick reconcile, because a per-tick reconcile would repair a dropped `machineStateChanged` event and hide the very regression the dirty-set optimisation could introduce. The equivalence is proved instead by `tests/unit/renderEvents.test.ts`, which drives a real store's event stream into the renderer and asserts the renderer's active set equals the store's own set after every tick of a real run without ever calling `syncActive`.
- The animation frame loop is a bucket gate, not a per-frame rewrite. `updateActiveFrames` does nothing at all unless `EntityRenderer.advanceFrames` reports that the bucket moved, so an idle frame costs one integer division. The blink reads its base tint from `EntityView.baseTint`, which the scene reads back from the sprite, so restoring a blocked machine's tint still restores the tint it actually carried.
- The three v1 VFX families are wired to exactly three events, and the render-event switch shows it. `machineStateChanged` is the only arm that reaches `VfxRenderer` for heat, `saleCompleted` is the only arm that reaches it for a burst, and `blockedFull` and `storageFull` never reach it at all. A sale no longer renders the old `vfx.spark` notice: it renders the coin burst, and `renderNotice` is left on `storageFull` alone as the transient notice it has always been.
- VFX sprites live in the VFX layer above the machine and belt-item layers, and the heat overlay is a separate sprite from the machine rather than a tint on it, because the blocked blink owns the machine sprite's tint and alpha channels.
- The scene reads the plot size from `store.getGridDimensions()` and never from a local grid constant, so a world that boots from an expanded save starts with the floor and the camera bounds the save actually describes. A duplicated local constant would silently floor a 96 by 96 world at 64 by 64.
- `refreshGridBounds` rebuilds the floor tilemap and calls `camera.setBounds` with the new dimensions, and it runs on every published snapshot rather than on a render event, because the store publishes the snapshot before it publishes events and an expansion changes no entity. It compares the dimensions first and does nothing when they match, so a 10 Hz tick does not rebuild the map.
- The floor tile data is a pure function of the plot size in `render/floorGrid.ts`, and the previous map and layer are destroyed before a rebuild, so an expanded plot cannot leave a stale 64 by 64 floor under the new one. Keeping the data pure is what makes the rebuild testable without a live scene.
- Render telemetry publishes `blockedEntityIds` so a browser test can observe which machines are blinking without reaching into a sprite or a tween.
- Render telemetry also publishes `camera.boundsWidth` and `camera.boundsHeight`, read back from `camera.getBounds()` rather than recomputed from the config the scene intended to apply. Reporting the intent would report a correct-looking number even when `setBounds` was never called, so the observable is the camera's real bounds. A browser test seeds an expanded save and reads them, which is the only proof that a world loaded at a non-default size sizes its floor and its camera from the store.
- The scene owns the floor tilemap for its whole lifetime: `rebuildFloor` destroys the previous map and layer before building, and `cleanup` destroys the current map and layer and clears the remembered dimensions, so shutdown and a rebuild cannot leave a stale floor behind.

## Work Guidance

- Keep pointer-to-cell conversion aligned with the live canvas transform.
- Keep render helpers free of simulation mutation and DOM ownership.

## Verification

- `npm run test -- tests/unit/cameraConfig.test.ts tests/unit/expansion.test.ts tests/unit/primaryInteraction.test.ts tests/unit/sceneTelemetry.test.ts tests/unit/renderEventContract.test.ts tests/unit/renderEvents.test.ts tests/unit/vfx.test.ts tests/unit/machineBlink.test.ts`
- `npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1`

## Child DOX Index

- `render/AGENTS.md` - texture resolution, entity and belt-item render adapters, and the blocked-machine blink.
