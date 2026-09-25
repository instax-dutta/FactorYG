## Purpose

Own immutable Factor-I content definitions.

## Ownership

- Resource, machine, recipe, unlock, and product constants are defined here.
- `types.ts` is the canonical shared type source.
- `freeze.ts` makes shipped tables deeply immutable.
- `validation.ts` validates shipped or candidate content as unknown input.
- `assetManifest.ts` connects content keys to static art.
- `unlocks.ts` owns the initial free lists and the paid cost and prerequisite requirements for every other machine and recipe.

## Local Contracts

- Tables are data-driven; machine and recipe behavior must not be hardcoded per instance.
- Resource and machine IDs are canonical and validated across tables.
- Smelters and assemblers use mixed input ports, silos use shared storage, and recipe duration overrides machine fallback timing.
- An unlock requirement cost must equal the machine or recipe `unlockCost` it prices, every paid entry must declare a requirement, and an initially unlocked entry must not.
- Unlock prerequisites are canonical IDs, never self-referential or duplicated, always cheaper than the entry that requires them so the tree stays purchasable in order, and a recipe always requires the machine that runs it.
- A recipe must require every recipe that produces one of its inputs. An input with no producer recipe, such as a raw resource, requires nothing, and a recipe that consumes its own output is exempt because it can never be its own prerequisite. The rule is a lower bound, so an extra non-producer prerequisite is allowed for tier or tutorial gating. A declared cycle is a cost error, not a producer gap, because only one direction of a cycle can be cheaper.

## Work Guidance

- Add new content with validation and tests in the same change.
- Preserve sorted, deterministic projections where serialization depends on ordering.

## Verification

- `npm run test -- tests/unit/content.test.ts tests/unit/assetManifest.test.ts`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/content/`.
