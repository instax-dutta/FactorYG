## Purpose

Own immutable Factor-I content definitions.

## Ownership

- Resource, machine, recipe, unlock, and product constants are defined here.
- `types.ts` is the canonical shared type source.
- `freeze.ts` makes shipped tables deeply immutable.
- `validation.ts` validates shipped or candidate content as unknown input.
- `assetManifest.ts` connects content keys to static art.
- `unlocks.ts` owns the initial free lists and the paid cost and prerequisite requirements for every other machine and recipe.
- `balance.ts` owns every number that prices progression rather than describing content: `STARTING_CURRENCY`, `PRESTIGE_THRESHOLD`, the two per-point prestige bonuses, `GRID_EXPANSION_COST`, and the per-tier sell value bands. Nothing else declares a balance number, and the simulation reads them from here.
- `machines.ts` owns the machine table, level normalization, the upgrade price of a level, and which machine types a level can affect.

## Local Contracts

- Tables are data-driven; machine and recipe behavior must not be hardcoded per instance.
- Resource and machine IDs are canonical and validated across tables.
- Smelters and assemblers each take two mixed input ports at offsets `(-1, 0)` and `(0, -1)`, so two upstream lines converge on one machine. Silos use shared storage, and recipe duration overrides machine fallback timing.
- A port is reachable from exactly one cell, because a connection requires the input port offset to be the negation of the source-to-target delta. A connection is made when the source's output port offset equals the target delta and the target's input port offset equals the negation of that same delta, which means the source entity sits exactly on the target's input port cell. A direct feed therefore puts the source adjacent to the target, and a belt feed puts the last belt on the target's port cell with that belt pointing into the target. One cell holds one entity and a belt carries one resource, so a machine with a single input port can only ever receive one resource type. Any recipe needing two distinct inputs therefore requires a machine with two input ports, and a recipe needing one can still use either.
- A producer's output port cell is where the product lands, so the consumer of that product occupies that cell, and a belt run continues from it. Routing must reserve every machine cell and every port cell before laying belts, because a run that crosses a machine cell is invalid and a run that stops one cell short of a port cell delivers nothing.
- An unlock requirement cost must equal the machine or recipe `unlockCost` it prices, every paid entry must declare a requirement, and an initially unlocked entry must not.
- Unlock prerequisites are canonical IDs, never self-referential or duplicated, always cheaper than the entry that requires them so the tree stays purchasable in order, and a recipe always requires the machine that runs it.
- A recipe must require every recipe that produces one of its inputs. An input with no producer recipe, such as a raw resource, requires nothing, and a recipe that consumes its own output is exempt because it can never be its own prerequisite. The rule is a lower bound, so an extra non-producer prerequisite is allowed for tier or tutorial gating. A declared cycle is a cost error, not a producer gap, because only one direction of a cycle can be cheaper.
- A level value is normalized before it is read: a value below one or not finite reads as one and a fractional value is floored, so a level is always a whole number of one or more.
- A machine level prices as the machine `cost` multiplied by the level squared, so an upgrade is never free. Pricing derives from the existing machine `cost` field and adds no content field to validate.
- A machine eligible for a level upgrade must have a positive integer `cost`, because that field is the upgrade base price; `validateContent` rejects a zero, negative, or fractional cost on such a machine.
- A level affects a machine only where the machine produces. Shared storage is not upgrade-eligible, and a machine that takes an input port without running a recipe only transports what others make, so extractors and recipe machines are the upgrade-eligible types. The gate is derived from the machine table and the recipe table, never from a hand-written type list.
- A machine that sells everything it receives declares `saleTerminal`, and the sales tick and chain analysis read that flag rather than naming a machine type. The flag must be a boolean, and such a machine must accept every resource on one of its input ports, because it sells its whole input buffer.
- Sell values live only in the resource table, and `balance.ts` never copies a per-resource value; it owns the band each tier's values must fall inside instead. A new resource is balanced by its table row, and moving a tier's band is a balance decision recorded in one place. `SELL_VALUE_BANDS` is ordered and non-overlapping, so a later tier can never undercut an earlier one, and tier 0 is capped by the named `RAW_SELL_VALUE_CEILING` so raw units cannot be farmed past the rest of the tree.
- The two per-point prestige bonuses are exactly representable binary fractions, so a multiplier derived from a point count is the same double whether the simulation or a preview computes it, and the number a player is shown cannot drift from the number the award stores.

## Work Guidance

- Add new content with validation and tests in the same change.
- Preserve sorted, deterministic projections where serialization depends on ordering.

## Verification

- `npm run test -- tests/unit/content.test.ts tests/unit/assetManifest.test.ts tests/unit/upgrades.test.ts tests/unit/balance.test.ts`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/content/`.
