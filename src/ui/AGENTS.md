## Purpose

Own the React DOM overlay for Factor-I.

## Ownership

- `components/` contains HUD, build dock, inspector, notifications, offline modal, and header.
- `hooks/` contains the external-store subscription bridge.

## Local Contracts

- UI reads immutable `SimulationSnapshot` values through `useSyncExternalStore`.
- UI dispatches commands but never imports simulation math or mutates private store state.
- Deferred actions are visibly disabled until their simulation command exists and the action is wired. A command existing in the store is necessary but not sufficient: `EntityInspector` stays disabled for upgrades until the TechTree task wires the button.
- The offline summary is a real focus-managed modal and background content is inert while open.
- The Factor-I header must remain visible and panels must not overlap at the supported desktop viewport.

## Work Guidance

- Use semantic buttons, labels, and stable data-testid hooks.
- Scope pointer events to interactive controls so the canvas remains usable.
- Keep presentation formatting separate from simulation calculations.

## Verification

- `npm run test -- tests/unit/hud.test.tsx tests/unit/buildDock.test.tsx tests/unit/gameHeader.test.tsx`
- `npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1`

## Child DOX Index

- No child boundaries currently exist under `src/ui/`.
