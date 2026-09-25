## Purpose

Own versioned local persistence for Factor-I.

## Ownership

- `save.ts` projects runtime state to `SaveGame`, validates, and reads/writes injected storage.
- `migrate.ts` validates save graphs and dispatches version migrations.
- Persistence is responsible for safe recovery, not simulation rules.

## Local Contracts

- The save key is `factor-y:save` for compatibility.
- Only explicit `SaveGame` fields are serialized; runtime samples, selection, notifications, and offline summaries are excluded.
- Machine/belt records must reference existing entities and correct runtime partitions.
- Storage access uses an injected `SaveStorage`; modules do not read browser globals directly.

## Work Guidance

- Add migrations through the registry instead of branching at call sites.
- Keep projections deterministic and validate before writing.

## Verification

- `npm run test -- tests/unit/persistence.test.ts tests/unit/offline.test.ts`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/persistence/`.
