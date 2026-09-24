# Factor-Y — handoff

Updated after the final-review fix wave and release gate on 2026-09-24. The
architecture, decisions, and historical gotchas below remain valid; current
counts and open gaps are based on the fresh commands in §1 and §5.

---

## 1. Where things stand

```
npm test              44 files, 449 tests passed, 0 skipped
npm run typecheck     passed
npm run build         passed; existing Vite chunk-size warning only
npm run e2e           77 passed (6.7m), 0 failed, 0 skipped
TIME_TO_FIRST_MOTOR   57.1s
```

**Headline: Tasks 1–10 remain complete; all final-review fixes are merged and the final browser gate is green.** The
326-cell Act 3 plan (29 machines, 281 belts, 16 crossings) was built through the
real UI and sold its first Motor at 57.1 seconds. The clean playthrough reports
`BOOT_TO_FIRST_CREDIT=6.8s`, `PLACEMENT_DURATION=4.6s`, and
`POST_BUILD_RAMP=0.0s`. The full run also covers corrupt saves, offline credit,
prestige, recipe unlock, panel layout, dialogs, pause/save, and keyboard input.

Commands: `npm run dev` (vite dev server, the game), `npm test` (unit),
`npm run e2e` (browser), `npm run typecheck`, `npm run build`.

| Phase / slice | State | Notes |
|---|---|---|
| Phase 0 — scaffold, camera, grid | done | pan/zoom/placement verified in Chromium |
| Phase 1 — extractor → belt → depot loop | done | offline credit, autosave, pause-on-hidden, save v2 recovery |
| 2.1 full recipe table + balance | done | 13 items, tiers 0–3, measured balance contract in `balance.ts` |
| 2.2 smelter / assembler / silo defs | done | port table per machine (`machines.ts`) |
| 2.3 chain simulation | done | full ore → Motor via `motorChain.test.ts`; obsolete hand-laid skip removed |
| 2.4 backpressure + silo + dirty-set tick | done | silo buffers persist in saves |
| 2.5 upgrades | done | level cost/speed contracts and browser coverage |
| 2.6 tech tree unlocks | done | recipe unlock wakes buffered crafters |
| 2.7 UI surfaces | done | build, inspect, Tech, placement feedback, dialogs |
| Move + undo for placed machines | done | shift + drag, ⌘Z / Ctrl+Z, Undo button |
| Playtest gate — tune `balance.ts` | done | measured curve pinned in `tests/balance.test.ts` |
| Belt-run drag (multi-place) | done | `src/sim/runs.ts` + drag input + per-cell preview |
| Splitter (one stream, two consumers) | done | alternating exits and blocked-exit fallback |
| HUD goal line | done | `src/ui/goalView.ts` |
| 3.1 prestige math + reset flow | done | claimed points are separate from cumulative points |
| 3.2 grid expansion | done | sim/save/UI/browser coverage |
| 3.3 prestige HUD button + start over | done | destructive controls confirm first |
| Stabilization Tasks 1–10 | done | final unit, type, build, and 77-test browser gate |
| Phase 4 — VFX, performance, polish | deferred / not started | VFX, instancing, 60 FPS gate, and mobile touch remain open |

No skipped unit or browser tests remain. The former map-scale `it.skip()` was
removed as obsolete in Task 10; the generated factory plan, raw-line tests, and
326-cell Act 3 browser test are the active coverage.

---

## 2. Architecture in one screen

Three layers, and the boundaries are load-bearing:

- **`src/sim/*` — plain TypeScript, no React, no three.js.** Owns all game state:
  the grid, entities, recipes, currency, unlocks, saves. `Simulation` is the root
  object; `SceneView` constructs exactly one and everything flows from it.
- **`src/ui/*` — React + zustand, UI state only.** The sim never writes into the
  store directly; `SceneView` pushes snapshots through `createThrottledPush` at
  10 Hz (`UI_HZ`), so a 10 tps sim cannot trigger a render per tick.
- **`src/render/*` — three.js.** Reads sim entities and rebuilds meshes at
  10 Hz. Nothing in here decides anything about the game.

**The tick:** a fixed-step clock (`tickLoop.ts`) is asked by a wall-clock
`setInterval`; the interval never decides how much factory time passed. Autosave
rides the same steps (`autosave.ts`), so its cadence follows the factory — a
throttled tab that isn't producing also isn't saving, and `visibilitychange` /
`pagehide` still save immediately.

**The dirty set (worth understanding before touching `tick`):** `tick()` visits an
active set, not every entity. A machine holding an item is *never* pruned, so
anything waiting to move stays awake; idle machines are dropped until a delivery,
a placement or a save-restore wakes them. Measured effect: 100 ticks over 204
entities went 0.7ms → 0.3ms. The invariant to preserve is "cannot miss a
wake-up" — I chose that over aggressive pruning, so a huge jammed factory is the
case worth load-testing if perf ever regresses.

**Purity habit:** the error-prone parts are pure functions with tests, and the
scene only wires them: `offline.ts` (`resumeFromSave`, `createPauseTracker`),
`autosave.ts` (`createSaveSchedule`), `upgrades.ts`, `techTree.ts`,
`ui/techTreeView.ts`, `ui/machineInfo.ts`, `render/machineShapes.ts`. If you find
yourself testing through React or three.js, the logic belongs in one of these.

---

## 3. What this session added

### Slice 2.6 — tech tree (unlocks)

- `src/sim/techTree.ts` — 9 nodes (machines and recipes in one table), a pure
  `canUnlock` / `unlock` pair returning new state rather than mutating.
  `startingUnlocks()` = extractor, belt, depot, smelter + copper/iron ingot
  recipes. A bare `new Simulation()` defaults to `ALL_UNLOCKED` **on purpose**, so
  tests and tooling are a sandbox; the app always passes the player's real state.
- Gating is enforced in the sim, not the UI: `place()` refuses `'locked'` and
  `matchRecipe` is handed an `isRecipeUnlocked` predicate, so a locked recipe
  cannot run. Inputs are still *held* for a locked recipe, so a machine starts
  working the moment you buy the recipe instead of needing a rebuild.
- `src/ui/techTreeView.ts` — pure view model: `techEntries(unlocks, currency)` →
  `{status: unlocked | available | unaffordable | locked, missing: [...labels]}`
  and `toolLocks()` for the build panel. **Prerequisites win over affordability**:
  a node whose prereqs are missing reads `locked` even for a millionaire, so the
  panel never offers a click that always refuses.
- `src/ui/TechTreePanel.tsx` + a `Tech` toggle in `BuildPanel`. Locked tools are
  disabled and show explicit price, purse, and Tech guidance; the store's `unlocks` is `null` until the scene reports a
  tree, and `null` means "unknown, don't gate yet" rather than "everything
  locked" — that avoids a flash of all-locked on first paint. The sim refuses
  locked placements regardless, so a stale panel is never a way in.
- Save carries the tree; a pre-tech-tree save falls back to `startingUnlocks()`
  rather than being handed everything. Spending happens in `Simulation.unlock`
  only — the store forwards an id and never touches the purse, so a double click
  cannot double-charge.

### Move and undo (fixing a run instead of demolishing it)

- `Simulation.move(from, to)` relocates a machine with its id, level, buffer,
  held item and in-flight `progress` intact — only an extractor's resource is
  re-read, because that comes from the tile it stands on. `canMove()` shares the
  rules with it (and is what the drag preview asks), so the two cannot disagree.
- `src/sim/history.ts` stores *how to reverse each edit* (`place` / `demolish` /
  `move`) rather than replaying the session, so undo never touches the rest of the
  factory. A demolish entry snapshots the entity (buffer copied) so a silo comes
  back holding what it held. **In-memory only, and it starts empty after a
  reload**, because the save the player loaded is the world they accepted.
- Interaction: **shift + drag** on a machine moves it (the ghost previews the
  machine as itself, facing as it does, valid or refused), **⌘Z / Ctrl+Z** undoes,
  and the build bar has an Undo button that is disabled when there is nothing to
  reverse. A shift-click with no drag still inspects.
- `e2e/undo-move.spec.ts` proves the case that matters: a working
  extractor → belt → depot line, the belt shift-dragged one cell off, sales stop,
  ⌘Z puts it back and sales resume. It also pins that undoing a demolish restores
  the *level* (60 cr upgrade → level 2 → 114 cr on the restored machine).
- Mutation-checked: forcing `dragSource = null` fails the drag test; neutering the
  registered `undo` action fails only the button test (the shortcut tests keep
  passing), which is the evidence that both input paths are really exercised.

### Slice 2.5 — upgrades

- `src/sim/upgrades.ts` — pure rules:
  - `speedMultiplierFor(level) = 1 + (level - 1) * 0.25` (level 1 is exactly
    today's speed, so existing factories and saves are untouched)
  - `nextUpgradeCost(level) = round(60 * 1.9 ** (level - 1))`, `null` at the cap;
    **pinned prices are 60 / 114 / 217 / 412**, `MAX_MACHINE_LEVEL = 5` (803 cr
    to max a machine)
  - `applyUpgrade` returns new level + purse; a refusal hands both back untouched
- The multiplier is applied where `progress` accumulates, so it speeds extraction
  **and** crafting: a level-2 extractor mines in 8 ticks instead of 10; a level-3
  smelter finishes a 20-tick recipe in 15 ticks total (1 match tick + 14).
- `Simulation.upgrade(cell)` owns the purse; reasons are `'empty' |
  'not-upgradeable' | 'max-level' | 'insufficient-currency'`.
- Panel: `InfoPanel` gains an `Upgrade · <price> cr` button, disabled when
  unaffordable, replaced by `max level` at the cap and `not upgradeable` where a
  level would do nothing. `MachineInfo` now carries `upgradeable` and
  `upgradeCost`, and its `throughput` is multiplied by the level so the panel and
  the sim cannot disagree.

### The bug this session found (worth knowing about)

While checking that a level does something for *every* machine the panel offers
one for, I found it didn't: **the sim was happily selling belt/silo levels that
change nothing**. Only extractors and crafters accumulate `progress`; a belt
carries one item per tick and a silo releases one per tick at any level.
`isUpgradeable()` now gates both the sale and the panel, derived from the recipe
table (crafters) plus `extractor`, with a comment explaining why the belt's
`ticksPerItem = 1` (its belt-speed figure) cannot be used as the signal.

---

## 4. Test-first practice used here (please keep it)

Every slice in this session was RED → GREEN: the test file was written and run
first, the failure was read and confirmed to be for the intended reason, then the
implementation was written. Interface-level e2e went in after the wiring existed,
so its teeth were proven by **mutation**: making `speedMultiplierFor` return a
constant 1 failed 4 unit tests and both browser tests. If you add a test that
passes on the first run, mutate the code it is supposed to guard and confirm it
fails; several tests here (conservation guards, "no dead content" reachability
checks) are deliberate guards that pass immediately. The earlier pass that
enforced the no-comments rule labelled those guards in code comments; Task 10's
later comment cleanup removed the labels without changing the guards.

---

## 5. Known gaps, precisely

### Remediated and verified

- **Save recovery:** v2 structural and semantic validation, quarantine, migration, renderer
  cleanup, and a fresh recoverable session are covered by the corrupt-save unit
  and browser suites.
- **Offline output:** persisted sellable Motor throughput, prestige-aware sell
  value, and lifetime-Motor accounting are covered by the ledger/integration
  tests and the offline browser regressions.
- **Prestige:** cumulative points and claimed points are separate; a point can
  be claimed once, and a repeated claim is refused without changing the factory.
- **Recipe wake-up:** a successful recipe unlock wakes buffered crafters, covered
  in both simulation and the real UI.
- **Routing and Act 3:** all eight raw lines remain covered by
  `tests/mapCorridors.test.ts`; the generated 29-machine/281-belt/16-crossing
  plan is covered by `e2e/act3.spec.ts`. The obsolete hand-laid map-scale skip
  was deleted rather than retained or replaced.
- **Inspector and layout:** route health, prestige-aware throughput, and the
  `gross at current output` estimate are implemented in
  `src/ui/machineInfo.ts` and `src/ui/InfoPanel.tsx` and covered by
  `tests/machineInfo.test.ts` and `e2e/tier-chain.spec.ts`. Non-overlapping
  panels, placement reasons, dialog focus/Escape, pause/save state, labels,
  contrast, and keyboard controls are covered by the final unit and browser
  suites.

### Still open or explicitly deferred

1. **Phase 4 VFX:** ore glow, heat shimmer, sale-burst VFX, toggles, and effect
   tests are not implemented.
2. **Render performance:** entity/item instancing, the 500-entity scale test,
   and the 60 FPS real-hardware gate are not implemented. The build still emits
   the existing >500 kB chunk advisory.
3. **Causal/realized per-machine attribution:** `src/ui/machineInfo.ts` and
   `src/ui/InfoPanel.tsx` now show a gross current-output cr/s estimate, covered
   by `tests/machineInfo.test.ts` and `e2e/tier-chain.spec.ts`. What remains open
   is attributing realized sales causally to each machine, not a missing estimate.
4. **Crash durability, not delayed edit persistence:** successful placement,
   demolition, movement/run edits, undo, and other edits force immediate saves
   through `src/sim/autosave.ts` and `src/render/SceneView.ts`. A process crash
   during or after a forced write remains the residual risk; in-progress item
   simulation is intentionally not serialized as a completed edit.
5. **Mobile touch UX:** touch controls and gesture-specific behavior are outside
   the supported v1 scope; the responsive layout contract is tested, but small
   touch-target ergonomics are not a completed mobile product.
6. **Belt/silo upgrade deferral:** belts and silos remain non-upgradeable by
   design because a level would not change their behavior. If upgraded later,
   define what the level changes rather than only adding a price.
7. **Silo semantics:** release is insertion-ordered rather than strict FIFO across
   mixed resources, and capacity is 50 buffered items plus the released item.
8. **Recipe selection:** auto-matching prefers full consumption, but an explicit
   player-selected recipe remains future work.
9. **Balance tuning:** `MOTOR_THRESHOLD`, sell values, and the measured pacing
   contracts remain tunable; the current values are not a promise that future
   balance changes will preserve wall-clock timings.

---

## 6. Decisions not worth re-litigating (and why)

- **Belts can turn corners** (`ports.input = 'all-but-output'`). Specced as
  `behind`, a belt could only run straight, which made the tier-2/3 chain
  unbuildable with no splitters in v1. A belt still never accepts from the cell it
  outputs into, so items can't push backwards up a line. This changed a Phase 1
  test assertion (the old one asserted the now-wrong rule); it was replaced with
  the meaningful contract, plus a test that a run turns a corner and delivers.
- **Autosave follows sim time, not wall time** (§2). Consequence: a hidden,
  paused tab does not autosave; it has nothing new to lose, and hide/pagehide save
  immediately.
- **A pause reuses the welcome-back modal** past 60s, the same threshold as the
  load path. One line to change if you'd rather it never or always pop.
- **`inputs` is optional in the save schema** so pre-silo saves load; buffers
  persist for every machine, while in-flight `recipe`/`progress` deliberately do
  not (a half-finished craft is worth a fraction of an item, 50 stored ore is
  not).
- **One source of truth for machine silhouettes** (`render/machineShapes.ts`)
  feeds the real mesh, the ghost and scene positioning; the ghost is
  type- and rotation-aware so you can see which side outputs *before* committing.

---

## 7. Gotchas when working on this

- **React StrictMode's mount/unmount runs `dispose()`, which saves.** So an
  empty-factory save exists before you build anything. A test that polls for "any
  save" will grab that one — this bit me once in the offline e2e; poll for a save
  that *contains* what you need instead.
- **`e2e/helpers.ts#seedSave` writes its save only if `localStorage` is empty.**
  `addInitScript` re-runs on every navigation, so without that guard a `reload()`
  in a test silently undoes whatever the app has since saved. Currency is seeded
  rather than ground out, because income pacing is a balance question and a test
  that waits minutes for 75 credits would be measuring the tuning.
- **The browser suite is the real integration test.** Every spec boots the actual
  render path (software rasterization in CI-like conditions, so frames stall at a
  few fps): `FRAME_STALL_MS`, generous `waitForReady`, and no assertions on exact
  frame timing. Assert observable outcomes instead.
- **Positioning is verified, not projected.** Use `findPixelForCell` from the
  helpers (it asks the app which cell a pixel maps to) instead of trusting
  `cellToPixel` maths.
- **At the default camera the 64×64 plot fills the viewport**, so there is no
  "off the plot" pixel to click without panning to the clamp first (the
  click-off-clears-selection test spends ~7s on a key hold for that reason).
- The tech panel covers the middle of the map; tests that place machines close it
  first.

---

## 8. Suggested next steps, in order

1. ~~Final-review fixes and documentation re-baseline~~ — DONE. Use the fresh
   counts and `TIME_TO_FIRST_MOTOR=57.1s` above as the current baseline.
2. **Phase 4 VFX and performance:** implement the deferred effect contracts,
   instancing/pooling, the 500-entity scale test, and a real-hardware 60 FPS
   gate; address the existing build chunk advisory.
3. **Player economics and durability:** add causal/realized per-machine
   attribution if desired, and define crash durability for forced writes. The
   existing gross current-output estimate and immediate edit persistence remain
   in place.
4. **Product follow-ups:** explicit recipe selection, strict FIFO semantics if
   required, belt/silo upgrade semantics, and mobile touch UX when that scope is
   intentionally opened.
5. **Balance maintenance:** rerun the final four commands after any tuning change;
   `tests/balance.test.ts` is the early warning, while the browser metric is the
   player-facing check.

---

## 9. Module index (what owns what)

```
src/sim/
  simulation.ts   Simulation: grid, entities, tick, placement, sell, chains, unlocks, upgrades
  tickLoop.ts     fixed-step clock — owns how much factory time passes
  autosave.ts     createSaveSchedule — autosave cadence on sim time
  offline.ts      resumeFromSave / createPauseTracker — absence credit, pause pairing
  save.ts         versioned SaveData, serialize/apply, v1-to-v2 migration, localStorage IO
  machines.ts     machine defs + the port table (which sides take input)
  recipes.ts      tier 0-3 recipe graph, matchRecipe/consumeInputs, sell values
  balance.ts      pacing contract + derived metrics (TECH_TOTAL_COST, fullLadderCostSeconds), SELL_VALUES, timeToFirstMotor
  techTree.ts     TECH_NODES, startingUnlocks, ALL_UNLOCKED, canUnlock/unlock
  upgrades.ts     cost curve, speed multiplier, isUpgradeable, applyUpgrade
  history.ts      undo entries for place/run/demolish/move (in-memory, capped at 64)
  runs.ts         straightRun: a drag snapped to its dominant axis, with facing
  worldgen.ts     deterministic resource nodes (copper/iron/coal/stone)
  placement.ts    canPlace, cell<->world, grid bounds
src/ui/
  store.ts        zustand: currency, cps, tool, rotation, selection, unlocks, actions
  machineInfo.ts  pure sim -> inspect panel mapping (incl. level/upgrade price)
  techTreeView.ts pure tech -> panel mapping (statuses, prerequisites, tool locks)
  goalView.ts     pure HUD goal line (always names the goal and the next action)
  BuildPanel / InfoPanel / Hud / OfflineModal / TechTreePanel / PrestigePanel
src/render/
  SceneView.ts    mounts three.js, owns the sim instance, input, pushes snapshots
  machineShapes.ts one shape table for mesh + ghost
  GhostPreview / EntityMeshFactory / IsoCamera / GridRenderer / rendererFactory
tests/            449 unit tests across 44 files, 0 skipped, pure logic first
                  `tests/support/factoryPlan.ts` is the act 3 layout planner; see
                  `tests/factoryPlan.test.ts` and PLAYTEST.md §5 before touching it
e2e/              77 browser tests (playwright): Phase 0 verification, mvp loop,
                  corrupt-save recovery, offline/progression, prestige, tech,
                  upgrades, panel layout, dialogs, pause/save, keyboard map,
                  playthrough, undo-move, belt-run, splitter, tier chain, and
                  the 326-cell Act 3 plan.
                  `panel-layout.spec.ts` hit-tests every control of every open
                  panel at 1280x720, 1024x720, 390x844, and 320x568.
                  The full `npm run e2e` run takes about 6.7 minutes on this
                  software-rendered environment; the playthrough itself takes
                  about 2 minutes.
                  `cellTypeAt`/`inspectCell` take *pixel* coordinates and click
                  them; resolve a cell with `findPixelForCell` first.
```

Reference documents: `factory-idle-game-spec.md` (the product spec — vision,
machines, chain, save schema, phases) and `plan.md` (slice-by-slice build order
with a RED test list per slice). Where they disagree, the plan's slices have been
treated as authoritative; disagreements are flagged in §5 and §6.
