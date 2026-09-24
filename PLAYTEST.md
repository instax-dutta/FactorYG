# Factor-Y — playtest notes

Played as a **new player**, no seeded save, every action a click on the shipped
UI: `npx playwright test e2e/playthrough.spec.ts` (~2 min, prints the journal
below). Nothing in that spec writes to the sim directly, so its numbers are the
ones a player actually experiences.

**Status: final-review fix wave and release gate complete (2026-09-24).**
Fresh `npm test`, `npm run typecheck`, `npm run build`, and full `npm run e2e` all pass:
449 unit tests in 44 files, 77 browser tests, and zero skipped tests. The final
Act 3 run completed the 326-cell browser plan and printed `TIME_TO_FIRST_MOTOR=57.1s`.
The playthrough now reports boot-to-first-credit and post-build ramp separately.
The original audit history remains in §7, with each finding marked remediated or
still open; deferred VFX, rendering-performance, and mobile-touch work remains
explicitly listed in §8.

---

## 1. What the playthrough did, with timings

```
[t+0.3s]   boot: currency 0, rate 0 cr/s
[t+0.3s]   locked on turn one: assembler, silo
[t+4.9s]   line on node 22,24 built   [t+5.7s]  line on node 22,27 built
[t+6.9s]   line on node 25,28 built   [t+8.0s]  line on node 27,30 built
[t+8.0s]   placement 4.6s; boot-to-first-credit 6.8s; post-build ramp 0.0s
          (credit observed during construction)
[t+11.1s]  four copper lines running at 10 cr/s
[t+12.0s]  bought refinedStone (40)   [t+20.1s] assembler (75)
[t+30.6s]  bought wire (100)
[t+32.2s]  two lines converted to wire; rate now 10 cr/s
[t+37.8s]  first wire sold after 5.6s; 14 cr/s
[t+39.2s]  gear (100)   [t+43.3s] plate (120)
[t+59.0s]  circuit (400)  [t+77.1s] frame (500)
[t+114.8s] bought motor (1000)
[t+114.9s] tree bought out: 32 cr/s, 0 cr in the purse
```

The Motor recipe is affordable after **114.8 seconds of play** (2,335 cr of
tech). The first credit is observed **6.8 seconds after boot**, during the
4.6-second placement run; the post-build sale ramp is therefore **0.0 seconds**.
Every unlock through `wire` arrives by 30.6 seconds.

## 2. Bugs (ranked; the first one was fatal)

### B1 — FIXED: the build bar covered the tech panel, making the game unfinishable

At 1280×720 the last two tech rows sat *behind* the build bar. Measured, not
guessed — `document.elementFromPoint` at the Frame button's centre returned the
build bar:

```
button[tech-buy-frame] box=796,576 61x23
elementAt(826,588) -> div[Extractor Belt Smelter 🔒 A…] box=320,586 640x122
```

Cause: the bar is `position: absolute; left: 50%; transform: translateX(-50%)`
with **no width**, so its shrink-to-fit box was capped at half the viewport
(640px). The row wrapped into a 122px-tall strip, and because `BuildPanel`
renders the tech panel *before* the bar, the bar painted on top. **Motor was
covered entirely — the game could not be won by hand.**

Fixed in `src/ui/BuildPanel.tsx` (`width: max-content`, plus `maxWidth`,
`flexWrap`, `zIndex`). `e2e/panel-layout.spec.ts` now hit-tests **every control of
every panel open at once** — build bar, tech, prestige, 21 controls — at 1280×720
and 1024×720, so this class of bug cannot come back silently.

### B2 — FIXED: nothing told the player the goal, or what to do first

A fresh player got 0 cr, six tool buttons (two locked) and no statement of what
the game is. A Motor — the win condition — was one more 1,000 cr row in the tech
panel with nothing marking it.

Fixed by a goal line in the HUD (`src/ui/goalView.ts`, 6 tests, plus a browser
assertion in `e2e/tech-tree.spec.ts`). It always names the goal and names the
next action, which changes as the factory does:

```
nothing built          Goal: sell a Motor · Start here: an Extractor on a resource
                                            node, belts to a Depot
an extractor running   Goal: sell a Motor · It needs copper, iron, coal and stone
                                            — buy the rest in Tech
recipe bought          Goal: sell a Motor · Build the chain: smelters, assemblers,
                                            and a Depot at the end
a Motor sold           Motor sold ×7      · Prestige at 25 motors for a bonus
```

### B3 — REMEDIATED IN TASK 8: locked tools were dead ends

**Original finding.** `Assembler` and `Silo` render disabled with a `title`
tooltip only (invisible on touch, easy to miss on hover). The Tech button that
sells them is a separate, unlabelled control. With B2's goal line the player is
at least pointed at Tech, but the locked button itself still does not say what
it costs or where it is bought.

**Current resolution.** `src/ui/BuildPanel.tsx` derives the locked label from
`techEntries()` and shows the price, purse, missing funds, prerequisites, and
Tech location. `e2e/phase0.verify.spec.ts` covers the price/location contract;
`e2e/ui-reliability.spec.ts` covers the full locked copy and affordability
contract.

### B4 — FIXED IN FULL: drag a straight run of belts

**Move and undo** (previous pass): shift + drag relocates a machine, ⌘Z / Ctrl+Z
or the Undo button reverses the last edit, and undoing a demolish restores the
machine *as it was*, level and buffer included.

**Multi-place** (this pass): with the Belt tool armed, **drag** and the drag lays
a straight run of belts, each facing the way the drag went, snapped to the
dominant axis so a never-quite-straight mouse drag still produces a clean line. A
run is **one edit**, so it is **one undo**: taking twelve belts back one click at
a time would be its own punishment. The run previews under the cursor, tinted
**per cell**, so a run that is blocked on its far end shows *which* cell is the
problem. A blocked run is refused whole, never half-built — a single missing cell
is invisible in a row of identical belts.

```
src/sim/runs.ts        straightRun(): snapping + facing, 5 unit tests
Simulation             canPlaceRun() (non-mutating) / placeRun() (all-or-nothing)
history                recordRun(): one entry, and undo skips a cell the player
                       has since built on
e2e/belt-run.spec.ts   3 tests: a drag lays the run and one undo takes it back;
                       a vertical drag feeds south; a blocked run stays empty
```

Mutation-checked: making `straightRun` return only its first cell fails 5 unit
tests.

### B5 — REMEDIATED: the map is unreadable without clicking

The original audit found no resource legend or overlay; the player learned what
was where by inspecting cells one at a time. `NodeLegendPanel`, resource labels,
and the node-disc palette now provide the missing map context.

### B6 — REMEDIATED IN TASK 8: no pause, no save/load UI

**Original finding.** The original audit found only the automatic hidden-tab
pause and no visible save state.

**Current resolution.** `src/ui/Hud.tsx` exposes manual Pause/Resume, save
lifecycle state, and the last successful save time; `src/sim/autosave.ts` and
`src/render/SceneView.ts` force successful edits to save immediately.
`e2e/ui-reliability.spec.ts` covers pause behavior, save timestamps, forced
placement/demolition persistence, and recovery feedback.

### B7 — REMEDIATED IN TASK 5: the only rate readout is global

**Original finding.** `cr/s` is one number for the whole factory; the info panel
shows throughput per machine but never earnings, so finding a bottleneck means
clicking machine by machine.

**Current resolution.** The inspector now shows a gross current-output estimate,
`gross at current output`, from `src/ui/machineInfo.ts` through the
`info-gross` row in `src/ui/InfoPanel.tsx`. `tests/machineInfo.test.ts` covers
the estimate and sell-value multiplier; `e2e/tier-chain.spec.ts` covers live
route and selected-machine refresh. What remains open is causal/realized
per-machine attribution, not the absence of a per-machine estimate.

### B8 — The Silo gates nothing on the way to a Motor

`silo` costs 150 cr, sits between Plate and Circuit in the list, requires only
the Assembler, and unlocks no recipe. A player working down the panel buys a
buffer that no other node needs. (It becomes useful only if a build needs a raw
buffer — see §5, where it turns out to be part of the routing problem.)

## 3. Balance observations

- **The economy reads well at the start.** First credit at t+6.8s from boot; the
  first three unlocks (215 cr) arrive by t+30.6s. The first credit is observed
  during construction, so the post-build ramp is 0.0s.
- **Wire is the first real spike**: 2 copper ingots (10 cr of metal) become a 45
  cr item, and the observed global rate steps **6 → 10 cr/s** immediately. The
  item's own value is a 4.5× cliff that makes everything before the Assembler a
  formality.
- **The tree is back-loaded**: 1,900 of the 2,335 cr sits in Circuit + Frame +
  Motor, so ~80% of the time to a Motor is those three nodes.
- Machines are **free to place**, so over-building is strictly optimal and
  placement carries no tension — worth confirming that is intended, because §5
  shows placement difficulty is what the game currently has instead.

## 4. Two smaller things worth a look

- The demolish affordance refunds nothing (machines are free) but gives no
  confirmation, so a mis-click on a long line silently deletes a belt. Undo now
  makes that recoverable, which lowers the priority a lot.
- **Historical finding, remediated in Task 6:** a refused placement was tinted
  red but did not say *why* ("occupied" vs "extractor needs a node" vs "locked"),
  which mattered most for an extractor off a node. `src/sim/placement.ts` and
  `src/render/GhostPreview.ts` now provide the structured reason/status, and
  `src/ui/Toasts.tsx` plus `e2e/phase0.verify.spec.ts` and
  `e2e/ui-reliability.spec.ts` cover the player-facing refusal text.

## 5. Why act 3 was not finished: it was not buildable — RESOLVED

*(The section below is the historical finding from the pass that could not beat
act 3. The crossing tile has since been built, the planner routes all 28
connections, and `e2e/act3.spec.ts` now plays the whole factory through the real
UI and sells a Motor. See §5b for the resolved story.)*

Beating the game means selling a Motor, which needs eight raw streams into a
refinery of 5 smelters, 7 assemblers and 1 depot — about 140 cells. I wrote a
planner to lay that factory out *before* placing anything
(`tests/support/factoryPlan.ts`: Dijkstra routing over the free grid, all 28
connections, shuffled orders, pick the shortest complete plan) so a collision
would be a one-line fix instead of a bisect through a half-built factory.

**It could not find a plan at all.** Three facts, any one of which was enough:

1. **The refinery is sealed from the north.** Its whole top row is machines and
   belts, so the only way in is the west edge (`x35 → x36`) on rows 47–58; column
   50 is a second wall that cuts the eastern pocket off entirely. Every raw line
   has to funnel through one doorway.
2. **A descending line is a wall.** With no splitter, no bridge and no
   two-things-in-one-cell, two streams that must meet at a machine cannot both
   arrive from the north without one crossing the other. Whatever is left on the
   far side of a corridor is cut off.
3. **The map's clusters are in the worst possible places for it.** `coal` is the
   northern cluster, `iron` the eastern one, `stone` the south-western one, so
   each of the three iron smelters needs a coal line to cross the iron lines (or
   vice versa) at some row — and in both directions the crossing lands on a
   machine.

So act 3 failed for a **design** reason, not a difficulty one: v1's rules could
not express the factory the recipes require.

### 5b. RESOLVED: the crossing tile made act 3 buildable, and the browser beat it

The crossing tile (§6.1) shipped first: a pass-through cell that carries two
perpendicular streams straight through one another, never holding an item of its
own (`tests/crossing.test.ts`, 14 cases). The planner learned to convert a
straight belt cell into a crossing where a perpendicular stream must ride over
(`tests/factoryPlan.test.ts`, all un-skipped and passing), and the act-3
acceptance tests went from "cannot route in 200 orders" to a verified 326-tile
plan: 29 machines, 281 belts, 16 crossings.

Then `e2e/act3.spec.ts` played it through the real UI — every one of the 326
placements a genuine click, rotation through the real `r` key, the whole world
diffed against the plan (types **and** rotations) from the save — and sold a
Motor. The final `npm run e2e` release-gate run recorded:

```
[t+2.9s]   326 pixels resolved, camera centred on the plan
[t+40.9s]  326 things placed in 38.0s
[t+41.0s]  all 326 placements verified against the save, rotations included
[t+57.1s]  FIRST MOTOR SOLD; rate 300 cr/s
TIME_TO_FIRST_MOTOR=57.1s
```

The fresh metric is **57.1 s** from the Act 3 test start: **2.9 s of
setup/projection + 38.0 s of placement + 16.2 s of post-build ramp**. The spec
prints `TIME_TO_FIRST_MOTOR=` for whoever tunes `balance.ts`; the documented
48–66 s range and the earlier 197.6 s observation are historical, not current
baselines.

The playthrough also caught a **real sim bug no headless test had hit**: with
`{ironIngot: 2, refinedStone: 1}` held, an assembler picked *gear* (declared
first, craftable, blind to the stone) and the refinedStone sat forever — plate
stopped, frame starved, every belt stayed busy. Timing-dependent: the fast solo
game won the race, the slow full-suite game stalled for ten minutes. Fixed in
`matchRecipe` (prefer the recipe that consumes every distinct held resource,
`tests/recipes.test.ts`), and the full suite now sells the Motor on the first
try.

## 6. Historical next-pass notes and current disposition

1. ~~**A belt crossing (underpass) tile**~~ — DONE, act 3 is buildable and won.
2. ~~**Pause control and visible save state**~~ — DONE in Task 8: manual pause,
   save lifecycle, timestamps, and recoverable feedback are covered.
3. ~~**Legend the resource nodes**~~ — DONE: `NodeLegendPanel` + `stateLabel`, and
   the node discs now share the cargo palette with the legend.
4. ~~**Tune `balance.ts` from the measured number**~~ — DONE. The measured curve
   (first sale 3.4s, one line 2.3 cr/s, act-2 techs 18–64s, ladder ≈108s at
   23 cr/s, prestige ≈2.5 min past the endgame factory) is now a *contract* in
   `tests/balance.test.ts`: 11 pinned scenarios, mutation-checked (gutting early
   income fails 3, cheapening the motor node or the prestige threshold fails 1
   each). Every knob still carries `TUNE_AFTER_PLAYABLE` — the tune happened;
   the tag now means "change the test window with it".
5. ~~**Splitter**~~ — DONE, test-first: one-in/two-out belt-pace tile that takes
   from behind only (never a merge), alternates exits when both accept (fair
   halves), and skips a blocked exit so backpressure cannot stall the open
   branch. Ships unlocked with the road tiles. `tests/splitter.test.ts` (10
   cases, 3 mutation-checked) + `e2e/splitter.spec.ts` (browser smoke incl.
   fallback-earning and undo).
     **Still open: the recipe picker** — an assembler cannot be *told* its recipe
     when auto-matching would pick a legal-but-wrong one (the matcher now prefers
     full-consume, but explicit choice would be better still).


---

## 7. Clean-session audit — 2026-09-24

### Method

A real Chromium session was driven through the shipped UI with no seeded save.
The run built four copper production lines, converted two to Wire, bought every
Tech node through Motor, opened the Tech and confirmation overlays, inspected a
machine, and attempted invalid/disconnected placements. Four isolated browser
contexts then reproduced offline progress, repeated prestige, recipe unlocking,
and corrupt-save startup.

Two independent read-only reviews also examined the UI and source: one focused
on the player experience and heuristics, the other on deterministic technical
checks. The clean session had no console errors, page errors, or failed requests.

### What the clean player run achieved

```text
boot                         0 cr, 0.0 cr/s
four copper lines            6 cr/s once construction finished
Refined Stone                40 cr
Assembler                    75 cr
Wire                         95 cr
first Wire observed          12.5s after conversion, 21 cr/s
Gear                         100 cr
Plate                        120 cr
Circuit                      400 cr
Frame                        500 cr
Motor recipe                1000 cr
tree bought out              20 cr/s, 0 cr remaining
```

The original first-credit timing was not trustworthy: construction itself took
long enough for income to begin, so checking currency only after the final
placement reported `0.0s`. Task 10 now timestamps from boot, polls after every
placement, and reports `BOOT_TO_FIRST_CREDIT=6.8s` and `POST_BUILD_RAMP=0.0s`
separately.

### Confirmed P1 defects

#### 7.1 REMEDIATED IN TASK 2: offline progress ignored the saved production-chain snapshot

**Reproduction**

A save contained a live extractor → Belt → Depot chain and an explicit saved
Motor chain at `0.1 item/s`. After eight hours, the Welcome Back screen reported:

```text
copperOre × 28,800    11,520 cr
Earned                11,520 cr
lifetimeMotors        0
```

The stored Motor chain was not used. The loader recomputed nominal raw extractor
chains, so a processing factory is paid as raw ore and offline Motor sales do not
advance prestige.

**Root cause**

- `serializeSim()` writes `sim.chains()` into the save:
  `src/sim/save.ts:72`.
- `applySave()` never restores or consumes `productionChains`:
  `src/sim/save.ts:128`.
- `Simulation.chains()` models one nominal raw stream per extractor and ignores
  recipe time, shared bottlenecks, machine level, and prestige speed:
  `src/sim/simulation.ts:609`.
- Scene load and visibility resume add currency directly rather than using the
  normal sale/prestige path: `src/render/SceneView.ts:95`,
  `src/render/SceneView.ts:558`.

**Required outcome**

Offline credit must use persisted last-known sellable output rates, apply the
correct sell multiplier, and route earned Motors through lifetime-Motor accounting.

#### 7.2 REMEDIATED IN TASK 3: the same prestige point can be claimed repeatedly

**Reproduction**

A save with 25 lifetime Motors was prestiged through the real UI. The first reset
left the button enabled as `Prestige +1`; a second confirmed reset succeeded.
The resulting save contained:

```json
{
  "lifetimeMotors": 25,
  "points": 1,
  "totalPrestiges": 2
}
```

**Root cause**

`prestigeState.points` is the cumulative number derived from lifetime Motors.
`Simulation.prestige()` refuses only when that cumulative value is zero; it does
not subtract points already claimed: `src/sim/simulation.ts:256`,
`src/sim/simulation.ts:263`. The view repeats the same cumulative check:
`src/ui/prestigeView.ts:37`.

**Required outcome**

Track claimed/banked points separately, enable prestige only when a fresh point is
available, and report the number of newly claimable points.

#### 7.3 REMEDIATED IN TASK 4: unlocking a recipe did not wake a dormant crafter

**Reproduction**

An assembler loaded with `{ wire: 1, gear: 1 }` while Circuit was locked. It was
idle with both inputs buffered. The Circuit Tech button was enabled and purchased
through the UI. Two seconds later the assembler was still idle with the exact same
buffer.

**Root cause**

A crafter with no allowed recipe returns `false` and is removed from the active
set: `src/sim/simulation.ts:532`, `src/sim/simulation.ts:584`. A successful unlock
only changes unlock state and currency; it does not wake buffered crafters:
`src/sim/simulation.ts:205`, `src/render/SceneView.ts:682`.

**Required outcome**

A recipe unlock must wake crafters holding inputs that the newly unlocked recipe
can consume.

#### 7.4 REMEDIATED IN TASKS 1 AND 8: a structurally malformed save could brick startup

**Reproduction**

A version-1 save containing one empty entity passed current validation. On boot:

```text
canvases                 2
backend                  still loading
goal panel               absent
two Failed to mount scene errors
bad save                still in localStorage
```

**Root cause**

`assertSaveShape()` validates only four top-level properties:
`src/sim/save.ts:102`. `restoreEntity()` then dereferences missing fields:
`src/sim/simulation.ts:273`. The canvas is created before save application, and
the failed mount is only logged: `src/render/SceneView.ts:56`,
`src/render/SceneView.ts:95`, `src/App.tsx:20`.

**Required outcome**

Validate the complete persisted schema before applying it, quarantine invalid
saves, start a recoverable fresh session, and guarantee renderer cleanup on mount
failure.

#### 7.5 REMEDIATED IN TASK 5: the inspector was partially covered by the prestige panel

A selected Smelter that visibly fed a Belt and Depot reported `no depot on route`.
At 1280×720, Info occupied `x1058..1268, y12..261`; Prestige occupied
`x1028..1268, y12..161`. The center hit-test of Info resolved to the Start Over
button. Upgrade and Demolish remained below the overlap, but machine identity,
cell, level, throughput, recipe, buffer, and route status were hidden.

Both components independently use `top: 12; right: 12`:
`src/ui/InfoPanel.tsx:33`, `src/ui/PrestigePanel.tsx:47`. The inspector route is
also extractor-ID-only in `SceneView`: `src/render/SceneView.ts:149`. Its rate
calculation omits the prestige production multiplier: `src/ui/machineInfo.ts:33`.

**Required outcome**

Use one non-overlapping right-side layout, report route health for every machine,
and show the same speed multiplier used by the simulation.

**Current resolution.** `src/ui/machineInfo.ts` now carries prestige-aware
throughput and `grossValuePerSecond`; `src/ui/InfoPanel.tsx` renders the
`info-gross` estimate. `tests/machineInfo.test.ts` covers the estimate and
`e2e/tier-chain.spec.ts` covers live selected-machine refresh and route health.
The remaining limitation is causal/realized per-machine attribution, not a
missing gross current-output value.

#### 7.6 REMEDIATED IN TASKS 6–9: placement refusal and overlays lacked accessible recovery

An Extractor placed on an empty non-node cell was correctly rejected, but the game
had no live region, toast, or reason text. The only feedback was a red ghost.
Tech and the Start Over confirmation both remained open when Escape was pressed;
neither overlay had dialog semantics or managed focus.

Related source locations:

- placement reason is discarded by the ghost: `src/render/GhostPreview.ts:98`
- Tech has no Escape handler: `src/ui/TechTreePanel.tsx`
- confirmation and offline overlays are plain divs:
  `src/ui/PrestigePanel.tsx:107`, `src/ui/OfflineModal.tsx:16`
- the canvas is not focusable or labelled and map actions are pointer-only:
  `src/render/SceneView.ts:56`, `src/render/SceneView.ts:283`

**Required outcome**

Show a concise, actionable placement reason in a live status surface; use a shared
accessible dialog with focus containment/restoration and Escape dismissal; provide
keyboard cell navigation and equivalent inspect/place/demolish actions.

**Current resolution.** `src/render/GhostPreview.ts` and
`src/sim/placement.ts` supply structured placement feedback;
`src/ui/Toasts.tsx` presents the refusal reason; `src/ui/Hud.tsx` publishes the
pause/save lifecycle; and `e2e/phase0.verify.spec.ts`,
`e2e/ui-reliability.spec.ts`, and `e2e/keyboard-map.spec.ts` cover the live
reason, dialog/Escape, pause/save, and keyboard paths.

### Confirmed P2 defects and product gaps

1. **Remediated in Task 8: manual pause and save status.** The original audit found
   no manual pause or visible save state. Both are now shipped and covered by
   browser tests.
2. **Remediated in Task 8: notifications and locked-tool guidance.** The original
   audit found no toast surface and only generic locked-tool labels. Placement,
   save, pause, Tech, and lock feedback now has tested player-facing copy.
   Current locations/tests: `src/ui/BuildPanel.tsx`, `src/ui/Toasts.tsx`, and
   `e2e/phase0.verify.spec.ts` plus `e2e/ui-reliability.spec.ts`.
3. **Partially open: causal/realized per-machine attribution.** The inspector now
   shows a gross current-output cr/s estimate in `src/ui/machineInfo.ts` and
   `src/ui/InfoPanel.tsx`; `tests/machineInfo.test.ts` covers it. What remains open
   is attributing realized sales causally to each machine, rather than reporting
   the current nominal output value.
4. **Remediated in Task 6: the disconnect rule is explicit.** Legal disconnected
   placements are accepted and show the amber warning required by the product
   decision; invalid structure still receives a specific refusal.
5. **Open: crash durability, not delayed edit persistence.** Successful
   placement, demolition, movement/run edits, undo, and other edits force an
   immediate save through `src/sim/autosave.ts` and `src/render/SceneView.ts`.
   The residual risk is a browser/process crash during or after a forced write;
   in-progress item simulation is intentionally not serialized as a completed
   edit, rather than waiting for periodic autosave.
6. **Deferred: Phase 4 VFX is absent.** No ore glow, smelter shimmer, sale burst,
   toggle, or effect tests exist.
7. **Deferred: Phase 4 render performance is absent.** Rendering still creates
   one body and one item mesh per entity. The 500-entity and 60 FPS acceptance
   tests do not exist; the production build also warns about chunks over 500 KB.
8. **Remediated in Task 10: the player-facing Motor metric.** The final browser
   run records `TIME_TO_FIRST_MOTOR=57.1s`; the earlier 197.6-second observation
   is historical.
9. **Remediated in Task 10: obsolete skipped map-scale coverage.** The superseded
   hand-laid `it.skip()` case was deleted; the generated factory plan, raw-line
   coverage, and real-UI Act 3 test remain active.
10. **Remediated in Task 8: player-facing debug copy.** Backend names and raw
    resource IDs are no longer shown in player-facing surfaces.
11. **Remediated in Task 8: normal status contrast.** The measured locked/status
    text now meets the 4.5:1 normal-text target.
12. **Partially remediated in Task 8: UI styling.** Semantic color tokens and
    contrast fixes are in place across the established overlays; a broader visual
    redesign remains outside this stabilization pass.


### Responsive and accessibility observations

The original narrow-layout findings are preserved above, but the desktop and
responsive panel contract is now covered by the final suite at 1280×720,
1024×720, 390×844, and 320×568. The 12 panel-layout tests verify separated panels,
usable controls, modal hit targets, and pointer-transparent overlays.

The original narrow-layout audit recorded these findings, which remain part of
the history:

- at 390×844, the Tech panel clipped 35 px on each side and later unlocks collided
  with the build bar;
- at 320×568, the build bar grew to roughly 304×220 and overlapped the legend and
  modal content;
- all fresh-player buttons were below a 44×44 touch target;
- the legend could intercept map input on narrow screens.

Mobile touch controls and gesture-specific UX remain explicitly deferred by the
product scope. Touch-target sizing and full small-screen ergonomics are not
claimed complete. At the time of the original audit, the independent technical
review scored the interface `7/20` for accessibility, performance, responsiveness,
theming, and implementation integrity; the deterministic detector returned no
findings, while the verified findings came from runtime behavior and source
inspection.

### Prioritized remediation disposition

1. **DONE (Task 1):** save validation and recoverable startup.
2. **DONE (Task 2):** offline production ledger and prestige-safe crediting.
3. **DONE (Task 3):** prestige claimed-point accounting.
4. **DONE (Task 4):** recipe-unlock active-set wake-up.
5. **DONE (Task 5):** inspector correctness and non-overlapping layout.
6. **DONE (Task 6):** placement feedback and the explicit adjacency product rule.
7. **DONE (Task 7):** shared accessible dialog behavior; completed with Task 9's
   keyboard map coverage.
8. **DONE (Task 8):** pause/save status, notifications, and player-facing labels.
9. **DEFERRED:** Phase 4 VFX and rendering/performance work.
10. **DONE (Task 10):** obsolete skipped coverage removed; playtest metrics and
    release documentation rebaselined from fresh output.

## 8. Final fix release gate - 2026-09-24

Commands run in the required order:

```text
npm test
Test Files  44 passed (44)
Tests       449 passed (449)

npm run typecheck
passed with no diagnostics

npm run build
passed; only the existing Vite advisory for chunks over 500 kB

npm run e2e
77 passed (6.7m)
TIME_TO_FIRST_MOTOR=57.1s
```

The full browser run included corrupt-save recovery, offline credit and
visibility replay, prestige, recipe unlock, panel layout at four viewports,
dialog focus/Escape behavior, manual pause/save lifecycle, the keyboard map, and
the 326-cell Act 3 plan. The Act 3 plan remains 29 machines, 281 belts, and 16
crossings. The final playthrough recorded `PLACEMENT_DURATION=4.6s`,
`BOOT_TO_FIRST_CREDIT=6.8s`, and `POST_BUILD_RAMP=0.0s`.

Known open items are the deferred Phase 4 VFX and instancing/60 FPS work,
causal/realized per-machine attribution, crash durability for already-forced
saves, and mobile touch controls. Belt and silo upgrade semantics remain
explicitly deferred. The production chunk-size advisory remains a performance
follow-up, not a gate failure.
