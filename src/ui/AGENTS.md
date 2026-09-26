## Purpose

Own the React DOM overlay for Factor-I.

## Ownership

- `components/` contains HUD, build dock, inspector, tech tree, notifications, offline modal, and header.
- `hooks/` contains the external-store subscription bridge and `useModalFocus`, the one focus-trap, inert-background, and keyboard-dismissal implementation shared by every modal.
- `presentation.ts` owns machine labels and the copy for command rejection reasons, so two components never word the same refusal differently.

## Local Contracts

- UI reads immutable `SimulationSnapshot` values through `useSyncExternalStore`.
- UI dispatches commands but never imports simulation math or mutates private store state.
- Deferred actions are visibly disabled until their simulation command exists and the action is wired. A command existing in the store is necessary but not sufficient. The tech tree wires the machine and recipe purchases and the inspector wires the level upgrade. The prestige command now exists in the store with a `canResetPrestige` preflight, but the prestige button and its confirmation modal are still unwired, so prestige remains deferred and no control may present it as available until the UI is built.
- A purchase control is enabled from the shared store preflight, `canUnlock` for a tree entry and `canUpgrade` for a level, so the affordance and the dispatch cannot disagree about whether an action is legal.
- A refused purchase surfaces the real store reason as visible text plus a `data-reason` hook. A click that the store refuses never fails silently, because a stale affordance and a stale store are a real race.
- A refused purchase is displayed from the store's current answer, never from a remembered one. A refused command publishes no snapshot, so the surface forces a re-read, and the reason shown is whatever the store's preflight says at that moment: the tech tree's alert stays up while the store still refuses that entry and clears as soon as the entry is purchasable, and the inspector's inline status simply reads the preflight. No refusal is gated on snapshot identity, because the store publishes a new snapshot every tick, so on any surface that keeps a remembered refusal an identity check would drop a true refusal within one tick. A refusal with no stated reason is shown with generic copy rather than being dropped or attributed to some other reason.
- The tech tree renders every machine and recipe from `MACHINES`, `RECIPES`, and `UNLOCKS`, orders entries by unlock cost, prices an included entry from its table `unlockCost`, and shows a locked entry's missing prerequisites. A new machine or recipe needs a content entry and nothing else.
- The tech tree and the offline summary are real focus-managed modals: focus moves inside on open, Tab is trapped, Escape dismisses, background content is inert while open, and focus returns to the trigger on close. The component that owns a dialog owns that dialog's lifecycle, and the mechanics live in exactly one implementation, `useModalFocus`, so a new modal wires the hook instead of copying an effect. The hook keeps only the topmost open dialog interactive, so two modals open at once cannot both consume Escape or mark each other's portal inert. `tests/unit/modalFocus.test.tsx` is where those mechanics are specified; a component spec drives its own dialog through the hook as well, which is deliberate wiring coverage for that dialog, and it must not become a second place where the mechanics are specified.
- The Factor-I header must remain visible and panels must not overlap at the supported desktop viewport, which is 1000x800. The tech tree toggle is currently pinned at a fixed `top: 400` and its bottom is 446, while the build dock's top is `viewportHeight - 126`, so the two collide below a 572px viewport height. The supported viewport is tall enough that this never fires today; any overlay work must replace the fixed offset with a flow layout rather than retune the number.

## Work Guidance

- Use semantic buttons, labels, and stable data-testid hooks.
- Scope pointer events to interactive controls so the canvas remains usable.
- Keep presentation formatting separate from simulation calculations.

## Verification

- `npm run test -- tests/unit/hud.test.tsx tests/unit/buildDock.test.tsx tests/unit/gameHeader.test.tsx tests/unit/techTree.test.tsx tests/unit/modalFocus.test.tsx`
- `npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1`

## Child DOX Index

- No child boundaries currently exist under `src/ui/`.
