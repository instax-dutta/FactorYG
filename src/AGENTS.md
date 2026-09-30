## Purpose

Own the Factor-I browser application source tree.

## Ownership

- `app/` owns runtime composition and lifecycle.
- `content/` owns immutable game data and asset metadata.
- `persistence/` owns save projection, migration, and storage adapters.
- `phaser/` owns rendering, camera, and world input.
- `sim/` owns deterministic game state and production logic.
- `audio/` owns the sound asset table, its generator, the event-driven sound director, and the browser audio adapter.
- `ui/` owns the React DOM overlay.

## Local Contracts

- Dependencies point inward: UI and Phaser consume `sim`; `sim` does not import React, Phaser, DOM, or persistence.
- One browser runtime owns one `SimulationStore` for the whole app.
- Custom art and public naming contracts are defined by the root and docs contracts.

## Work Guidance

- Keep files focused on one responsibility and follow existing test-first patterns.
- Update the nearest child contract when a durable boundary changes.

## Verification

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:e2e -- --workers=1`

## Child DOX Index

- `app/AGENTS.md` - runtime composition, autosave, and React/Phaser lifecycle.
- `audio/AGENTS.md` - sound asset table, generator, event-driven director, and browser adapter.
- `content/AGENTS.md` - canonical immutable content and asset manifests.
- `persistence/AGENTS.md` - save schema, migration, and injected storage.
- `phaser/AGENTS.md` - scene, camera, input, and render orchestration.
- `sim/AGENTS.md` - deterministic simulation and runtime state.
- `ui/AGENTS.md` - DOM overlay components and subscriptions.
