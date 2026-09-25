## Purpose

Own immutable Factor-I content definitions.

## Ownership

- Resource, machine, recipe, unlock, and product constants are defined here.
- `types.ts` is the canonical shared type source.
- `freeze.ts` makes shipped tables deeply immutable.
- `validation.ts` validates shipped or candidate content as unknown input.
- `assetManifest.ts` connects content keys to static art.
- `unlocks.ts` owns the initial free lists and the paid cost and prerequisite requirements for every other machine and recipe.
- `machines.ts` owns the machine table, level normalization, the upgrade price of a level, and which machine types a level can affect.

## Local Contracts

- Tables are data-driven; machine and recipe behavior must not be hardcoded per instance.
- Resource and machine IDs are canonical and validated across tables.
- Smelters and assemblers use mixed input ports, silos use shared storage, and recipe duration overrides machine fallback timing.
- An unlock requirement cost must equal the machine or recipe `unlockCost` it prices, every paid entry must declare a requirement, and an initially unlocked entry must not.
- Unlock prerequisites are canonical IDs, never self-referential or duplicated, always cheaper than the entry that requires them so the tree stays purchasable in order, and a recipe always requires the machine that runs it.
- A recipe must require every recipe that produces one of its inputs. An input with no producer recipe, such as a raw resource, requires nothing, and a recipe that consumes its own output is exempt because it can never be its own prerequisite. The rule is a lower bound, so an extra non-producer prerequisite is allowed for tier or tutorial gating. A declared cycle is a cost error, not a producer gap, because only one direction of a cycle can be cheaper.
- A level value is normalized before it is read: a value below one or not finite reads as one and a fractional value is floored, so a level is always a whole number of one or more.
- A machine level prices as the machine `cost` multiplied by the level squared, so an upgrade is never free. Pricing derives from the existing machine `cost` field and adds no content field to validate.
- A machine eligible for a level upgrade must have a positive integer `cost`, because that field is the upgrade base price; `validateContent` rejects a zero, negative, or fractional cost on such a machine.
- A level affects a machine only where the machine produces. Shared storage is not upgrade-eligible, and a machine that takes an input port without running a recipe only transports what others make, so extractors and recipe machines are the upgrade-eligible types. The gate is derived from the machine table and the recipe table, never from a hand-written type list.

## Work Guidance

- Add new content with validation and tests in the same change.
- Preserve sorted, deterministic projections where serialization depends on ordering.

## Verification

- `npm run test -- tests/unit/content.test.ts tests/unit/assetManifest.test.ts tests/unit/upgrades.test.ts`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/content/`.
