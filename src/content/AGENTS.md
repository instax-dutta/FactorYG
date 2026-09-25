## Purpose

Own immutable Factor-I content definitions.

## Ownership

- Resource, machine, recipe, unlock, and product constants are defined here.
- `types.ts` is the canonical shared type source.
- `freeze.ts` makes shipped tables deeply immutable.
- `validation.ts` validates shipped or candidate content as unknown input.
- `assetManifest.ts` connects content keys to static art.

## Local Contracts

- Tables are data-driven; machine and recipe behavior must not be hardcoded per instance.
- Resource and machine IDs are canonical and validated across tables.
- Smelters use mixed input ports, silos use shared storage, and recipe duration overrides machine fallback timing.

## Work Guidance

- Add new content with validation and tests in the same change.
- Preserve sorted, deterministic projections where serialization depends on ordering.

## Verification

- `npm run test -- tests/unit/content.test.ts tests/unit/assetManifest.test.ts`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/content/`.
