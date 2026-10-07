## Purpose

Own Node-only developer, release, benchmark, asset, and layout-generation scripts.

## Ownership

- `art-contact-sheet.mjs` renders public machine and resource contact-sheet previews.
- `benchmark-grid.ts` builds deterministic simulation fixtures and measures tick-level scenarios for `tests/e2e/performance.spec.ts` and `docs/performance-baseline.md`.
- `generate-audio.ts` regenerates the committed public audio assets from `src/audio` specifications.
- `solve-motor-chain.ts` generates `motor-chain-layout.json`; unit, integration, and browser tests consume that layout fixture.
- `ts-resolve.mjs` resolves extensionless TypeScript imports when Node executes scripts directly.
- `tsconfig.scripts.json` is the TypeScript project for these scripts.

## Local Contracts

- Scripts run only under Node and must not depend on browser, React, Phaser, or DOM behavior.
- Shipped game code must not import these scripts. Tests may import their reusable fixtures, validators, and benchmark helpers.
- Direct Node execution uses the repository's TypeScript resolver hook. Type errors are caught by `tsconfig.scripts.json`, not by Node's runtime type stripping.
- Keep fixtures, generated measurements, and other committed artifacts reproducible from the checked-in game code.
- A change to benchmark behavior, its measured output, or the release gate updates `docs/performance-baseline.md`.

## Work Guidance

- Keep each script focused on one reproducible generation or measurement task.
- Run the tests that consume a fixture after changing the script that produces it.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm run audio:generate`
- `npm run bench:grid`
- `npm run art:sheet`

## Child DOX Index

- No child boundaries currently exist under `scripts/`.
