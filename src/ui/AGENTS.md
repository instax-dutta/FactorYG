## Purpose

Own the React DOM overlay for Factor-I.

## Ownership

- `components/` contains HUD, build dock, inspector, tech tree, notifications, prestige modal, offline modal, and header.
- `hooks/` contains the external-store subscription bridge and `useModalFocus`, the one focus-trap, inert-background, and keyboard-dismissal implementation shared by every modal.
- `presentation.ts` owns machine labels and the copy for command rejection reasons, so two components never word the same refusal differently.
- The HUD owns the two permanent-progression controls: the prestige button, which opens the confirmation modal it also renders, and the plot expansion button. Nothing else in the overlay dispatches a prestige or an expansion.

## Local Contracts

- Every refusal a shipped control can surface has its own sentence in `commandReasonMessages`, covering the unlock, upgrade, prestige, and grid expansion reasons. A missing entry falls through to `The store refused that action: <reason>.`, which shows a player an internal token, so `tests/unit/presentation.test.ts` asserts that no reachable reason reaches the fallback and that no message repeats its own reason string. A command that adds a rejection reason adds its copy in the same change.
- `notImplemented` is the copy for a command the store has not routed yet, and it stays. It is unreachable from every shipped control today, but a command added to the shared union and not yet wired is a real intermediate state during development, and a refusal from one must read as "not available yet" rather than echo the token.

- UI reads immutable `SimulationSnapshot` values through `useSyncExternalStore`.
- UI dispatches commands but never imports simulation math or mutates private store state.
- Deferred actions are visibly disabled until their simulation command exists and the action is wired. A command existing in the store is necessary but not sufficient. The tech tree wires the machine and recipe purchases, the inspector wires the level upgrade, and the HUD wires the prestige reset and the plot expansion. No control is deferred today, so a future command added to the union but not yet wired is the only case this rule still covers.
- A purchase control is enabled from the shared store preflight, `canUnlock` for a tree entry, `canUpgrade` for a level, `canResetPrestige` for a prestige, and `canExpandGrid` for a plot growth, so the affordance and the dispatch cannot disagree about whether an action is legal. The prestige modal reports a refusal from the same re-read the tech tree uses, so a stale affordance and a stale store surface a real reason instead of failing silently.
- A refused purchase surfaces the real store reason as visible text plus a `data-reason` hook. A click that the store refuses never fails silently, because a stale affordance and a stale store are a real race.
- A refused purchase is displayed from the store's current answer, never from a remembered one. A refused command publishes no snapshot, so the surface forces a re-read, and the reason shown is whatever the store's preflight says at that moment: the tech tree's alert stays up while the store still refuses that entry and clears as soon as the entry is purchasable, and the inspector's inline status simply reads the preflight. No refusal is gated on snapshot identity, because the store publishes a new snapshot every tick, so on any surface that keeps a remembered refusal an identity check would drop a true refusal within one tick. A refusal with no stated reason is shown with generic copy rather than being dropped or attributed to some other reason.
- The tech tree renders every machine and recipe from `MACHINES`, `RECIPES`, and `UNLOCKS`, orders entries by unlock cost, prices an included entry from its table `unlockCost`, and shows a locked entry's missing prerequisites. A new machine or recipe needs a content entry and nothing else.
- The prestige confirmation, the tech tree, and the offline summary are real focus-managed modals: focus moves inside on open, Tab is trapped, Escape dismisses, background content is inert while open, and focus returns to the trigger on close. The component that owns a dialog owns that dialog's lifecycle, and the mechanics live in exactly one implementation, `useModalFocus`, so a new modal wires the hook instead of copying an effect. The hook keeps only the topmost open dialog interactive, so two modals open at once cannot both consume Escape or mark each other's portal inert. `tests/unit/modalFocus.test.tsx` is where those mechanics are specified; a component spec drives its own dialog through the hook as well, which is deliberate wiring coverage for that dialog, and it must not become a second place where the mechanics are specified.
- The Factor-I header must remain visible and panels must not overlap at the supported desktop viewport, which is 1000x800. The tech tree toggle is currently pinned at a fixed `top: 400` and its bottom is 446, while the build dock's top is `viewportHeight - 126`, so the two collide below a 572px viewport height. The supported viewport is tall enough that this never fires today; any overlay work must replace the fixed offset with a flow layout rather than retune the number.
- The notification stack is anchored to the bottom right and grows upward, so a HUD of any height can never collide with it. It was pinned below the HUD at a fixed `top: 220`, which duplicated knowledge of the HUD's height and broke the moment the prestige and expansion controls made the HUD taller; a right-hand column flows from its edges rather than from a measured sibling.

## Work Guidance

- Use semantic buttons, labels, and stable data-testid hooks.
- Scope pointer events to interactive controls so the canvas remains usable.
- Keep presentation formatting separate from simulation calculations.

## Verification

- `npm run test -- tests/unit/hud.test.tsx tests/unit/prestigeControl.test.tsx tests/unit/buildDock.test.tsx tests/unit/gameHeader.test.tsx tests/unit/techTree.test.tsx tests/unit/modalFocus.test.tsx tests/unit/presentation.test.ts`
- `npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1`

## Child DOX Index

- No child boundaries currently exist under `src/ui/`.
