# Factor-I Release Checklist

The release procedure for a Factor-I build, the checks a machine can make, and the two things
it cannot. Factor-I is a desktop browser game: no server, no account, no install, one
`localStorage` key. Everything below runs from a clean checkout.

## Before anything runs

- Use a machine that is otherwise idle. The browser suite is serial, single-worker, and
  zero-retry by contract (`tests/e2e/AGENTS.md`), and this app's renderer main thread is
  saturated by the Phaser loop, so a busy host turns a correct build into a wall-clock
  failure that says nothing about the code.
- Record the toolchain you are on. The numbers below were measured on Node 22.23.0 and npm
  10.9.8. There is no `engines` field, so a newer Node is not a checked contract and
  recording the version is the check.
- Run the steps in order. Later steps assume earlier ones: the browser suite builds the
  production bundle itself, and the preview check needs that build.

## 1. Clean install

```bash
rm -rf node_modules
npm ci
```

`package-lock.json` is committed, so `npm ci` is the clean install and `npm install` is not
a substitute: it can resolve a different tree than the lock records. Confirm the install
reaches a lockfile-exact tree:

```bash
npm ls --depth=0
```

## 2. Unit and component tests

```bash
npm run test
```

One Vitest project covers both, because `vite.config.ts` includes
`tests/**/*.{test,spec}.{ts,tsx}`. The component specs are the `tests/unit/*.test.tsx`
files, and they declare `// @vitest-environment jsdom` themselves because the shared
default is `node`.

To run only the component specs:

```bash
npx vitest run tests/unit/buildDock.test.tsx tests/unit/gameHeader.test.tsx \
  tests/unit/modalFocus.test.tsx tests/unit/prestigeControl.test.tsx \
  tests/unit/saveRecoveryNotice.test.tsx tests/unit/techTree.test.tsx
```

## 3. Browser tests

```bash
npm run test:e2e
```

The config starts two servers: the dev server on `127.0.0.1:5173` and
`npm run build && npm run preview` on `127.0.0.1:4173`. The second one is the release
check; `tests/e2e/release-smoke.spec.ts` is the only spec that runs against the production
bundle and asserts that the development bridges are absent, so a run that quietly reached
the dev server fails rather than passing.

## 4. Lint and typecheck

```bash
npm run lint
npm run typecheck
```

`npm run typecheck` is `tsc --noEmit` over `src` and `tests`, followed by
`tsc -p tsconfig.scripts.json` over `scripts`. The second project is not optional
bookkeeping: `scripts/benchmark-grid.ts` and `scripts/generate-audio.ts` are TypeScript
that ships no code but decides what the release gate measures and what audio the game
loads, and they used to sit outside both `tsc` and `eslint` while both commands
reported a clean tree. `npm run build` runs `tsc -b` as well, so a typecheck failure
will also surface there.

## 5. Build

```bash
npm run build
```

One warning is expected and is not a failure: the chunk-size warning for the single bundle.
Vite 8 emits it because Phaser ships as one large dependency; code-splitting it is not part
of this release. Anything else on stderr is a real failure.

## 6. Preview

```bash
npm run preview
```

Then open `http://127.0.0.1:4173/` and confirm by hand what no assertion covers: the canvas
fills the window, the header and HUD read correctly, the build dock places an extractor on
a copper node and currency rises, the tech tree opens and closes on Escape, and the browser
console is empty. Reload and confirm the run comes back from storage.

## 7. Save reset

There are two resets and they are not the same thing.

- **Prestige** is the in-game reset. It empties the world, keeps permanent multipliers, and
  may expand the plot. It is a normal gameplay action, not a maintenance step.
- **A full wipe** is a storage edit, because the game has no reset button. In the browser
  console on the running page:

  ```js
  localStorage.removeItem("factor-y:save");
  location.reload();
  ```

  The save key is `factor-y:save` (`SAVE_KEY` in `src/sim/constants.ts`); the public name
  Factor-I did not change it, deliberately, so an existing run survives the rename.

  Expect after the reload: a fresh 64 by 64 plot, `500` currency, no welcome-back modal
  (there is no saved run to credit), and no save-recovery notice. A removed key is not a
  rejected save: the recovery notice is for a payload the game found and refused to read.

  A rejected save behaves differently and deliberately: the unreadable bytes stay in storage
  until the notice is acknowledged, so do not delete the key before reading the notice if
  you are diagnosing one.

## 8. Art review

This is the one release step no command can perform.

```bash
npm run art:sheet
```

The script needs `rsvg-convert` and ImageMagick `magick` on `PATH` and fails loudly if
either is missing. It writes `.art-preview/`, which is gitignored, and prints the sheets:

- `machines-animation.png` - every machine's idle, active, and active-1 frames side by side.
  This is the sheet that exposes port-marker or indicator drift between frames.
- `machines-rotated-90.png` - the same set rotated a quarter turn. This is the sheet that
  exposes a broken facing read.
- `machines-silhouettes.png` - solid silhouettes, to check that a machine is identifiable
  without colour.
- `resources.png` - every resource icon at 6x.

Look at them. Reading the SVG source does not catch a wrong colour or an ambiguous
silhouette, and `tests/unit/assetManifest.test.ts` cannot either: it proves the palette is
one of the seven locked hex values, the dimensions are right, and no port marker moves or
recolours between frames. It cannot prove the result reads as a smelter. **A human has to
look at the sheets before a release ships.**

## What the machine checks cannot sign off

- **Art review.** Step 8 is a human act. Nothing in this repository performs it, and the
  Phase 4 exit check for it stays unticked until someone does.
- **Audibility.** `tests/e2e/sound.spec.ts` and `tests/unit/audioAssets.test.ts` prove the
  autoplay gate, the decode path, the format, the loop point, and the event-to-sound
  cardinality. Whether any of it is pleasant is a headphone judgement.
- **Cross-platform layout.** The panel-overlap assertion was found to pass on one operating
  system and fail on another, so the browser suite must be run somewhere other than the
  machine that wrote it before a release is called green.

## Prohibited non-goals

The design specification's list is explicit: multiplayer/co-op, combat/enemies,
mobile/touch controls, responsive layout, monetization/IAP, backend accounts/cloud sync, a
power grid system, and fluid/pipe systems. The plan adds machine module slots to the same
list. None of them is built, and the claim is checked rather than asserted:
`tests/unit/nonGoals.test.ts` reads every `.ts`, `.tsx`, and `.html` file under `src/` plus
`index.html` and fails on any of them.

| Non-goal | What the guard checks |
| --- | --- |
| Multiplayer / co-op | Vocabulary scan for multiplayer, co-op, lobby, matchmaking, opponent, rival, WebRTC, `BroadcastChannel`, and room-with-membership forms |
| Backend accounts / cloud sync | No absolute URL of any scheme in shipped source; the only network transport in `src/` is the audio asset decoder's `fetch`, pinned by file and by count, and every sound asset URL must be same-origin relative |
| Combat / enemies | Vocabulary scan, content id scan, and the machine table pinned to the six shipped types |
| Power grid | Vocabulary scan plus machine and port field scans |
| Fluid / pipe systems | Vocabulary scan plus the port kind set pinned to `input` and `output` |
| Machine module slots | Vocabulary scan plus content ids, and the machine field set pinned |
| Responsive layout | No `@media`, `matchMedia`, viewport reads, or resize listener, and no stylesheet file anywhere in `src/` or `public/` |
| Touch controls | No `touchstart`, `touchend`, `touchmove`, `touchcancel`, or `ontouch*` handler; `touchAction` is pinned to the Phaser canvas surface alone, where Phaser requires it |
| Monetization / IAP | Vocabulary scan for payment, subscription, and storefront providers |

Two vocabulary collisions are worth knowing about, because they are why the guard scans
mechanism rather than words. `room` is a local variable for free buffer space in
`src/sim/machines.ts`, so a multiplayer room has to be a room with membership to count. And
`attack` is an ADSR envelope in `src/audio/synth.ts`, so the combat scan names enemy and
health concepts rather than `attack`, `damage`, or `WAVE`.

The one viewport unit in the application is `100vw`/`100vh` on the full-bleed canvas and app
root, and `index.html` carries a standard `<meta name="viewport">`. Neither is a responsive
breakpoint system, which is what the non-goal prohibits.

## Balance changes and existing saves

Shipping a balance change reprices a save that is already in a player's browser, without
asking them. This is not hypothetical: moving the balance numbers into `src/content/balance.ts`
retuned `PRESTIGE_PRODUCTION_BONUS_PER_POINT` and `PRESTIGE_SELL_BONUS_PER_POINT`, and
`repairPermanentMultipliers` now recomputes the stored multiplier pair from the points the
player banked on every load. A player who earned 4 points under the old numbers is paid
under the new ones.

So a release that touches `src/content/balance.ts` is not finished when it is green:

1. Ship a release note that says the balance changed, names the constants that moved, and
   says plainly that a run already in progress is repriced on its next load rather than
   preserved.
2. Update `tests/unit/migration.test.ts`, which pins the repriced numbers as literals as well
   as against `permanentMultipliersForPoints`. Retuning a per-point constant must turn that
   assertion red rather than silently repricing every existing save.
3. Re-run the full set above. A balance change moves `tests/unit/balance.test.ts`,
   `tests/unit/upgrades.test.ts`, `tests/unit/permanentMultipliers.test.ts`, the prestige
   and expansion specs, and the browser economy specs in `tests/e2e/production-chain.spec.ts`,
   which play whole economies to the Motor chain.

The retune that already shipped is the precedent: `PRESTIGE_PRODUCTION_BONUS_PER_POINT` moved
from 0.1 to 0.125 and `PRESTIGE_SELL_BONUS_PER_POINT` from 0.2 to 0.25 when the numbers moved
into `src/content/balance.ts`. A player who banked points before that load is paid 25% more
per point afterwards. That is a fair reward for banking early and an unexplained change to a
run in progress, which is why it gets a line in the release notes rather than a commit
message.

## Where the result of the last run is recorded

This checklist is the procedure, not a log. The measured outcome of the most recent full
verification is recorded in the Phase 4 exit check of
`docs/superpowers/plans/2026-09-25-factor-y-implementation.md` and in that task's report,
so a stale copy of this file cannot claim a green run.
