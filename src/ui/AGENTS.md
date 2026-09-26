## Purpose

Own the React DOM overlay for Factor-I.

## Ownership

- `components/` contains HUD, build dock, inspector, tech tree, notifications, offline modal, and header.
- `hooks/` contains the external-store subscription bridge.
- `presentation.ts` owns machine labels and the copy for command rejection reasons, so two components never word the same refusal differently.

## Local Contracts

- UI reads immutable `SimulationSnapshot` values through `useSyncExternalStore`.
- UI dispatches commands but never imports simulation math or mutates private store state.
- Deferred actions are visibly disabled until their simulation command exists and the action is wired. A command existing in the store is necessary but not sufficient. The tech tree wires the machine and recipe purchases and the inspector wires the level upgrade, so prestige is the only action still deferred and it keeps saying so on the control itself.
- A purchase control is enabled from the shared store preflight, `canUnlock` for a tree entry and `canUpgrade` for a level, so the affordance and the dispatch cannot disagree about whether an action is legal.
- A refused purchase surfaces the real store reason as visible text plus a `data-reason` hook. A click that the store refuses never fails silently, because a stale affordance and a stale store are a real race.
- A refusal is stamped with the snapshot it was taken against and is dropped as soon as a new snapshot arrives, so a reason that has stopped being true disappears on its own instead of sticking to the panel.
- The tech tree renders every machine and recipe from `MACHINES`, `RECIPES`, and `UNLOCKS`, orders entries by unlock cost, prices an included entry from its table `unlockCost`, and shows a locked entry's missing prerequisites. A new machine or recipe needs a content entry and nothing else.
- The tech tree and the offline summary are real focus-managed modals: focus moves inside on open, Tab is trapped, Escape dismisses, background content is inert while open, and focus returns to the trigger on close. Focus management stays local to the component that owns the dialog.
- The Factor-I header must remain visible and panels must not overlap at the supported desktop viewport.

## Work Guidance

- Use semantic buttons, labels, and stable data-testid hooks.
- Scope pointer events to interactive controls so the canvas remains usable.
- Keep presentation formatting separate from simulation calculations.

## Verification

- `npm run test -- tests/unit/hud.test.tsx tests/unit/buildDock.test.tsx tests/unit/gameHeader.test.tsx tests/unit/techTree.test.tsx`
- `npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1`

## Child DOX Index

- No child boundaries currently exist under `src/ui/`.
