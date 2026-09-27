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
- A saved plot larger than the starting one additionally requires the run's expansion rights, read through `hasPrestigedForExpansion` from `sim/grid` rather than restated, and the growth test itself is `isGridGrowth` measured against the starting dimensions. A plot is a privilege a completed prestige grants for good, so no save the game can produce is rejected by this, while a save claiming an unearned plot is a rejected save instead of a silently honored one. The load layer and the command layer therefore tell the same story about who may own a larger plot, and `tests/unit/migration.test.ts` pins the validator's verdict to `hasGridExpansionRights` so the two cannot drift apart.
- A rejected save is never rewritten, settled by Task 3.5. `loadSaveWithResult` and `loadSaveWithOfflineResult` both recover to a new game in memory and write nothing, so the stored value stays byte for byte intact and every reload re-recovers identically. Overwriting it with the recovered new game would destroy the only copy of a payload the game cannot currently read, and the load layer cannot tell a corrupt save from one written by a newer build, so the destruction would be irreversible and premature.
- Not rewriting is not preservation, and the difference is load-bearing. The app autosave writes the recovered run as soon as its state differs, so a rejected save is gone within seconds and is not a recoverable artifact. The decision is only about not destroying the payload before the recovery is observable, and it means a rejected save is a silent loss for the player today: the recovery reason reaches `loadBrowserSimulationState`, which discards it. Surfacing it is app-layer work and is tracked in the plan, not here.
- The three tests behind that decision cover the persistence load path only, through `loadSaveWithResult` and `loadSaveWithOfflineResult`. They do not cover the shipped entry point, which is `loadBrowserSimulationState` in the app layer, and they would all still pass if the app were unchanged. The app-layer path is deliberately out of scope for the decision and is the reason the decision is not a preservation guarantee, so nothing in this subtree should be read as covering the player-visible behavior.
- `SAVE_MIGRATIONS` is the one registry, keyed by source version. `migrateSave` parses the input, reads the source version, and hands the candidate to that version's migration without validating it first, so each migration owns validating its own unknown-shape input and returns a `SaveGame` or a failure rather than throwing. A migration never mutates the object it was given, and a save that already satisfies the current shape comes back as the same object with `migrated: false`, so a current save is never reallocated.
- The totality claim over migration shapes is carried by `tests/unit/migration.test.ts`, whose fixtures are deliberately wider than any run the game can produce: they unlock the silo, which a reset does not restore. A fixture the game could never write is the safe direction for a totality claim, because it can only prove more rather than less, so the fixtures are not narrowed to the real unlock set. The one shape a hand-authored fixture cannot reach, a real producer standing in an area the real expansion added, is covered in `tests/integration/prestigeReset.test.ts` instead, which drives the real `performPrestige` and the real `expandGrid` and round-trips the result.
- `permanentMultipliers` stays in the save shape and is still validated for shape on load, so a save carrying a non-finite or non-positive pair is still a rejected save. The validated number is not the number the run is then priced with: loading a state normalizes the field from the stored point count through `repairPermanentMultipliers`, so the pair that survives is always the one the current balance produces for the points the player banked and a save written under older numbers is repriced rather than honored. The repair is a normalization on the way in, not a repair of a rejected save: the field stays in the save shape, no version is added, and `loadSaveWithOfflineResult` writes the normalized state back so the price is not paid for twice. The offline payout is computed from the already-repaired state, so an offline session is never paid at the stale price.
- The persisted pair is a cache of the rule, not durable data, and the split between the two layers is deliberate: a migration carries the stored pair through unchanged and the load-time repair is the only repricer, so no migration ever rewrites it on the way past. `tests/unit/migration.test.ts` pins both halves, and it pins the repriced numbers as literals as well as against `permanentMultipliersForPoints`, so retuning a per-point constant turns one covered assertion red instead of silently repricing every existing save.
- Storage access uses an injected `SaveStorage`; modules do not read browser globals directly.

## Work Guidance

- Add migrations through the registry instead of branching at call sites.
- Keep projections deterministic and validate before writing.

## Verification

- `npm run test -- tests/unit/migration.test.ts`
- `npm run test -- tests/unit/persistence.test.ts tests/unit/offline.test.ts tests/unit/blockedProducer.test.ts tests/unit/permanentMultipliers.test.ts`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/persistence/`.
