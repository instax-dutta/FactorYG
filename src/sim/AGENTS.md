## Purpose

Own deterministic Factor-I simulation state and production rules.

## Ownership

- `types.ts` defines the simulation and save-facing contracts.
- `constants.ts` locks tick, grid, tile, and economy constants.
- `grid.ts` and `rotation.ts` own coordinate transforms.
- `placement.ts` and `connections.ts` own validation and port connectivity.
- `machines.ts`, `economy.ts`, `tick.ts`, and `offline.ts` own production and sales.
- `store.ts` owns private state, commands, snapshots, and the fixed-step driver.
- `initialState.ts` owns deterministic new-game world creation.

## Local Contracts

- Simulation modules are pure TypeScript and never import React, Phaser, DOM, or persistence.
- Production advances on a fixed 10 Hz logical clock, never Phaser render frames.
- Runtime-only fields such as tick samples and offline summaries are not save data.
- Extractor progress is a normalized fractional cycle accumulator; blocked output pauses progress.
- Processor progress is a discrete recipe-tick counter; inputs are charged once when a run starts, a blocked completion holds the counter only while the recipe remains valid, and an unresolvable recipe discards the run so a later run must pay again.
- Content tables and shared types remain the single source of truth.

## Work Guidance

- Write a failing behavior test before changing simulation code.
- Keep command validation shared between UI ghost previews and dispatch.
- Preserve deterministic event ordering for render consumers.

## Verification

- `npm run test`
- `npm run lint`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/sim/`.
