## Purpose

Own versioned local persistence for Factor-I.

## Ownership

- `save.ts` projects runtime state to `SaveGame`, validates, and reads/writes injected storage.
- `migrate.ts` validates save graphs and dispatches version migrations.
- Persistence is responsible for safe recovery, not simulation rules.

## Local Contracts

- The save key is `factor-y:save` for compatibility.
- Only explicit `SaveGame` fields are serialized; runtime samples, selection, notifications, and offline summaries are excluded.
- `productionChains` persists only the four summary fields per chain, sorted by chain id, so a save never carries item positions or chain edges.
- Shared storage persists its locked resource, and a legacy machine runtime without one derives it from the first stored resource so a migrated silo stays single-resource.
- `alreadyNotifiedBlocked` is machine save data and a legacy runtime that lacks it migrates to `false`; the version-1 migration returns the parsed save unchanged when every runtime already carries the field, so a current save is never reallocated. The `blockedRefusalTicks` debounce counter is runtime-only and is never projected, so a reloaded blocked machine resumes from the flag alone.
- Machine/belt records must reference existing entities and correct runtime partitions.
- Grid width and height are save data, and `validateGrid` checks node and entity coordinates against the dimensions the save itself carries rather than against `GRID_WIDTH`, so an expanded plot round-trips through serialize and load with no migration and no version bump. Plot expansion is permanent by design, so its persistence is a value the save already had, not a new field.
- A saved grid dimension must satisfy the same `isValidGridDimension` and `isAlignedGridDimension` rules an expansion request does, read from `sim/grid` rather than restated. The renderer sizes the floor tilemap from the saved plot, so an out-of-contract width is a rejected save rather than an unbounded world, and the validator and the command cannot drift into accepting different sizes.
- Storage access uses an injected `SaveStorage`; modules do not read browser globals directly.

## Work Guidance

- Add migrations through the registry instead of branching at call sites.
- Keep projections deterministic and validate before writing.

## Verification

- `npm run test -- tests/unit/persistence.test.ts tests/unit/offline.test.ts tests/unit/blockedProducer.test.ts`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/persistence/`.
