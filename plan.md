# Factor-Y — TDD Build Plan

**Spec:** `factory-idle-game-spec.md` v1.0
**Plan version:** 3.0 (TDD conversion)
**Status:** Stabilization Tasks 1–10 and final-review fixes complete; Phase 0–3 implemented; Phase 4 VFX/performance deferred

## Locked decisions

- Stack: React + Vite + TypeScript
- Sim-to-React bridge: zustand (throttled ~10Hz push, sim ticks independently at 10tps)
- Camera: true isometric (35.264° elevation, 45° rotation), fixed angle, no orbit
- Offline cap: 8 hours; offline modal threshold 60s
- Prestige: Motor-count based (`MOTOR_THRESHOLD = 25` lifetime motors, tunable)
- Resource node map: fixed hand-designed layout (deterministic)
- Balance: tuned and pinned by the measured playtest contract; future changes must rerun the release gates
- Sound: skipped in v1
- VFX: vgpu.sh as effect layer only (never owns scene/camera)

## Current implementation status — final fix release gate (2026-09-24)

The stabilization sequence and final-review fix wave are complete. The final commands were run in this order:

```text
npm test              44 files, 449 tests passed, 0 skipped
npm run typecheck     passed
npm run build         passed; existing Vite >500 kB chunk warning only
npm run e2e           77 passed (6.7m), 0 failed, 0 skipped
TIME_TO_FIRST_MOTOR   57.1s
```

The full browser gate includes corrupt-save recovery, offline and visibility
credit, prestige, recipe unlock, panel layout at four viewports, dialogs,
pause/save lifecycle, keyboard controls, the clean playthrough, and the 326-cell
Act 3 plan. The Act 3 plan is 29 machines, 281 belts, and 16 crossings.

The playthrough timing is now explicit: placement takes 4.6 seconds,
boot-to-first-credit is 6.8 seconds, and post-build ramp is 0.0 seconds because
the first credit is observed during construction.

Current known gaps are the deferred Phase 4 VFX and instancing/60 FPS work,
causal/realized per-machine attribution, crash durability for already-forced
saves, belt/silo upgrade semantics, and mobile touch UX. The inspector already
shows a gross current-output cr/s estimate, and successful edits persist
immediately; neither is an open gap. The hand-laid map-scale `it.skip()` was
removed in Task 10; it is not a deferred coverage hole.

## TDD Iron Law (applies to every phase)

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

- RED: write one minimal failing test for one behavior.
- Verify RED: run it, watch it fail for the expected reason (feature missing, not typo).
- GREEN: write minimal production code to pass.
- Verify GREEN: test passes, full suite still green, output pristine.
- REFACTOR: clean up only, no new behavior, stay green.
- Repeat for next behavior.

If code was written before its test: delete it, start over. No "reference", no "adapt".

Test runner: `vitest` for unit/sim. `playwright` for e2e. Type gate: `npx tsc --noEmit`.
Each slice below lists: test file + case names (RED) -> minimal prod file (GREEN) -> verify command.

## Architecture rules (apply to all phases)

1. `three.js` owns scene, camera, meshes. `WebGPURenderer` + TSL preferred, `WebGLRenderer` fallback. No game logic in render code.
2. Plain-TS `SimulationStore` owns game logic, fixed timestep 10 ticks/sec decoupled from `requestAnimationFrame`. No React state inside tick.
3. `React` owns HUD/panels/modals only. Reads sim via zustand selectors at ~10Hz.

Additional rules:

- Data-driven tables (`MACHINES`, `RECIPES`, `SELL_VALUES`), not hardcoded per-instance logic.
- Tick uses active-set / dirty-flag iteration, not full 64x64 scan.
- Save schema is versioned and validated before application; the active browser key remains `factoryg.save.v1` for migration compatibility.

## Repo layout

```
src/
  main.tsx, App.tsx
  config/constants.ts
  sim/
    simulation.ts, machines.ts, recipes.ts, balance.ts, worldgen.ts,
    upgrades.ts, techTree.ts, prestige.ts, expansion.ts, save.ts, offline.ts
  render/
    rendererFactory.ts, IsoCamera.ts, GridRenderer.ts, GhostPreview.ts,
    EntityMeshFactory.ts, VfxLayer.ts, effects/oreGlow.wgsl,
    effects/heatShimmer.wgsl, effects/saleBurst.ts
  ui/
    store.ts, Hud.tsx, BuildPanel.tsx, InfoPanel.tsx,
    TechTree.tsx, OfflineModal.tsx, Toasts.tsx
tests/
  constants.test.ts, worldgen.test.ts, machines.test.ts, recipes.test.ts,
  sim.tick.test.ts, offline.test.ts, save.test.ts, chain.test.ts,
  backpressure.test.ts, upgrades.test.ts, techTree.test.ts,
  prestige.test.ts, expansion.test.ts, perf.smoke.ts
e2e/
  mvp-loop.spec.ts, prestige.spec.ts
```

## Config constants (`src/config/constants.ts`)

- `TICK_HZ = 10`, `UI_HZ = 10`
- `GRID_W = 64`, `GRID_H = 64`, `CELL = 1`
- `OFFLINE_CAP_S = 8 * 3600`
- `OFFLINE_MODAL_THRESHOLD_S = 60`
- `MOTOR_THRESHOLD = 25` (tunable)
- Save key `factoryg.save.v1`

---

## Phase 0 — Tech Spike (TDD slices) [COMPLETE]

Goal: prove render/interaction loop. Render code is hard to unit-test, so TDD here means:
test the pure logic (constants, grid math, placement validity, renderer selection)
with failing tests first; verify canvas behavior manually.

### Slice 0.1 — Constants

- RED `tests/constants.test.ts`:
  - `exposes TICK_HZ=10 and UI_HZ=10`
  - `grid is 64x64 with CELL=1`
  - `offline cap is 8h and modal threshold is 60s`
- Verify RED: `npx vitest run tests/constants.test.ts` fails (file missing).
- GREEN `src/config/constants.ts`: minimal consts only.
- Verify GREEN: same command passes + `npx tsc --noEmit`.

### Slice 0.2 — Renderer selection logic (no GPU in test)

- RED `tests/rendererFactory.test.ts` (or fold into constants if renderer needs DOM):
  - `selects webgpu when available`
  - `falls back to webgl2 when webgpu throws/unavailable`
- Extract pure `selectBackend(available: boolean)` so it is testable without canvas.
- GREEN `src/render/rendererFactory.ts`: `createRenderer()` delegates to `selectBackend()`.
- Verify: `npx vitest run tests/rendererFactory.test.ts`.

### Slice 0.3 — IsoCamera math (pure, testable)

- RED `tests/isoCamera.test.ts`:
  - `uses orthographic projection at 35.264° elevation / 45° rotation`
  - `pan clamps to factory bounds + margin (does not pan to infinity)`
  - `zoom clamps to min/max`
- GREEN `src/render/IsoCamera.ts`: minimal pan/zoom/clamp math. No orbit API (assert absence by no `rotate`/`orbit` export).
- Verify: `npx vitest run tests/isoCamera.test.ts`.

### Slice 0.4 — Placement validity (pure grid logic)

- RED `tests/placement.test.ts`:
  - `rejects occupied cell`
  - `rejects out-of-bounds cell`
  - `snaps world coords to grid cell`
- GREEN: placement validator (lives in `src/sim/` or `src/render/GhostPreview.ts` helper, pure function). `GhostPreview.ts` itself is thin view over validator.
- Manual verify: `npm run dev` — ghost green/red, click-to-place one box mesh, WASD/drag pan, wheel zoom, 100 boxes no jank.

### Slice 0.5 — zustand bridge contract

- RED `tests/uiStore.test.ts`:
  - `store exposes currency, cps, selectedTool, backend`
  - `sim push updates subscribers at most ~10Hz (throttleniosk: assert coalescing, not exact timing)`
- GREEN `src/ui/store.ts`.
- Manual: dummy ticker proves React-canvas coexistence (deleted in Phase 1).

Phase 0 accept: all P0 tests green, `npx tsc --noEmit` clean, manual pan/zoom/clamp smooth, no React re-render per frame.

---

## Phase 1 — MVP Core Loop (Extractor -> Belt -> Depot) [COMPLETE]

Scope: 2 raw ores sold directly, no Smelter/Assembler. Strict slice order below. Do not write `simulation.ts` before its tests fail.

### Slice 1.1 — Worldgen (fixed node map)

- RED `tests/worldgen.test.ts`:
  - `generates deterministic fixed copper + iron node positions`
  - `two runs return identical maps (no RNG)`
  - `every node lies inside 64x64 bounds`
- GREEN `src/sim/worldgen.ts`: const array map.
- Verify: `npx vitest run tests/worldgen.test.ts`.

### Slice 1.2 — Machines table P1

- RED `tests/machines.test.ts`:
  - `extractor requires node tile and has 1 output direction`
  - `belt has 1 input and 1 output`
  - `depot accepts N inputs`
  - `rotation is 90° increments (0/90/180/270 only)`
- GREEN `src/sim/machines.ts`: `MACHINES` table only.
- Verify: `npx vitest run tests/machines.test.ts`.

### Slice 1.3 — Recipes P1 (direct-sell stubs)

- RED `tests/recipes.test.ts`:
  - `copperOre has direct-sell value near zero`
  - `ironOre has direct-sell value near zero`
  - `unknown resource throws / returns undefined (no silent sale)`
- GREEN `src/sim/recipes.ts` P1 entries.
- Verify: `npx vitest run tests/recipes.test.ts`.

### Slice 1.4 — Simulation tick (core loop)

RED `tests/sim.tick.test.ts` (one case at a time, in this order):

1. `extractor on copper node produces ore over time`
2. `extractor off node produces nothing`
3. `belt moves item 1 cell per tick toward output direction`
4. `belt auto-connects to adjacent belt/machine facing correct direction`
5. `depot converts delivered ore to currency`
6. `currencyPerSec rolling average increases under steady flow`
7. `invalid placement (occupied / out of bounds) is rejected`

- Verify each RED before GREEN: `npx vitest run tests/sim.tick.test.ts` must fail with "feature missing", not import typo.
- GREEN `src/sim/simulation.ts`: minimal entity map + 10tps tick to pass one test at a time. No smelter/assembler code.
- Verify GREEN after each: full `npx vitest run` stays green.

### Slice 1.5 — Offline progress (pure function)

- RED `tests/offline.test.ts`:
  - `applies throughput x elapsed per chain`
  - `caps elapsed at 8h (e.g. 24h absence credits only 8h)`
  - `zero/negative elapsed yields zero gains`
  - `sums across multiple chains`
- GREEN `src/sim/offline.ts`: pure `computeOfflineGains(chains, elapsedSec)`.
- Verify: `npx vitest run tests/offline.test.ts`.

### Slice 1.6 — Save/load + migration path

- RED `tests/save.test.ts`:
  - `round-trips currency, grid.entities, productionChains per spec §8 schema`
  - `includes version + lastSavedAt`
  - `migrateSave(v1) returns the v2 shape and discards legacy chain estimates`
  - `future-version save does not corrupt (migrate path exists)`
- GREEN `src/sim/save.ts`.
- Verify: `npx vitest run tests/save.test.ts`.

### Slice 1.7 — UI thin layer (test what is testable, manual the rest)

- Throughput display + demolish + offline modal are thin views over sim functions already tested. Add component smoke tests only if cheap (e.g. modal shows when `elapsed > 60s` — test the `shouldShowModal()` predicate, not DOM).
- Manual E2E: `npx playwright test e2e/mvp-loop.spec.ts` — place extractor-belt-depot, currency rises; reload intact; backdate `lastSavedAt` -8h, modal correct.

Phase 1 accept: `npx tsc --noEmit && npx vitest run` green, E2E passes, 200 belts at 10tps stable.

---

## Phase 2 — Production Chain (Tier 0-3) [COMPLETE]

Balance numbers are now tuned and pinned by the measured playtest contract; keep
`TUNE_AFTER_PLAYABLE` attached to any future knob change.

Content set (spec §7):

- T0: Copper Ore, Iron Ore, Coal, Stone
- T1 (smelter): Cu Ore -> Cu Ingot; Fe Ore + Coal -> Fe Ingot; Stone -> Refined Stone
- T2 (assembler): Cu Ingot x2 -> Wire; Fe Ingot x2 -> Gear; Fe Ingot + Refined Stone -> Plate
- T3 (assembler): Wire + Gear -> Circuit; Plate x2 + Gear -> Frame; Circuit + Frame -> Motor

### Slice 2.1 — Full recipe table

- RED `tests/recipes.test.ts` (extend):
  - `each §7 recipe exists with correct inputs/outputs`
  - `sell values scale exponentially by tier (T3 > T2 > T1 > T0)`
  - `raw direct-sell stays near zero`
- GREEN `src/sim/recipes.ts` extension + `src/sim/balance.ts` stub (`SELL_VALUES`, `timeToFirstMotor` estimator).
- Verify: `npx vitest run tests/recipes.test.ts`.

### Slice 2.2 — Smelter/Assembler/Silo machine defs

- RED extend `tests/machines.test.ts`:
  - `smelter has 1-2 inputs, 1 output side from table`
  - `assembler has 2+ inputs, 1 output`
  - `silo buffers any resource`
- GREEN `src/sim/machines.ts` extension.
- Verify: `npx vitest run tests/machines.test.ts`.

### Slice 2.3 — Chain simulation

RED `tests/chain.test.ts` in order:

1. `smelter converts Cu Ore -> Cu Ingot 1:1`
2. `smelter requires both inputs for Fe Ingot (Fe Ore + Coal)`
3. `assembler combines 2x Cu Ingot -> Wire`
4. `full raw -> Motor chain yields Motor at depot input`
5. `motor sells for highest v1 value`

- GREEN `src/sim/simulation.ts` extension: input buffers, recipe match. One test at a time.
- Verify: `npx vitest run tests/chain.test.ts`.

### Slice 2.4 — Backpressure + silo

- RED `tests/backpressure.test.ts`:
  - `blocked output stalls upstream (no item loss/duplication)`
  - `silo absorbs overflow then releases when downstream frees`
  - `idle machines are skipped by dirty-flag tick (assert tick skips clean set — e.g. via tick counter or dirty-set size)`
- GREEN simulation extension.
- Verify: `npx vitest run tests/backpressure.test.ts`.

### Slice 2.5 — Upgrades

- RED `tests/upgrades.test.ts`:
  - `level up increases speed/output multiplier`
  - `upgrade cost follows curve and deducts currency`
  - `insufficient currency rejects upgrade`
- GREEN `src/sim/upgrades.ts`.
- Verify: `npx vitest run tests/upgrades.test.ts`.

### Slice 2.6 — Tech tree unlocks

- RED `tests/techTree.test.ts`:
  - `starts with extractor,belt,smelter + copperIngot,ironIngot`
  - `spending currency unlocks next-tier recipe`
  - `locked recipe cannot run in sim`
- GREEN `src/sim/techTree.ts`.
- Verify: `npx vitest run tests/techTree.test.ts`.

### Slice 2.7 — UI (TechTree modal, BuildPanel, rotation)

- Test predicates (`canUnlock()`, `upgradeCost()`), not DOM. Manual: unlock flow, `R`/button 90° rotation, red-ghost invalid adjacency.
- PLAYTEST GATE: `npm run dev`, reach Motor, record time-to-first-motor, then tune `balance.ts`. No tuning before this gate.

Phase 2 accept: motor chain E2E works, backpressure/silo correct, unlock/upgrade persist, balance-tune scheduled.

---

## Phase 3 — Prestige (Motor-count) + Expansion [COMPLETE]

Formula (tunable): `points = floor(lifetimeMotors / 25)`; `productionSpeed = 1 + 0.25 x points`; `sellValue = 1 + 0.5 x points`. Reset clears grid/entities/chains, keeps prestige fields.

### Slice 3.1 — Prestige math

- RED `tests/prestige.test.ts`:
  - `0-24 motors -> 0 points, mults stay 1.0`
  - `25 motors -> 1 point (1.25x speed, 1.5x sell)`
  - `50 motors -> 2 points`
  - `reset clears grid but keeps points/totalPrestiges/multipliers`
  - `second cycle completes faster (sim-time assertion with mults applied)`
- GREEN `src/sim/prestige.ts` + sim integration (track `lifetimeMotors`, apply mults at tick + sale).
- Verify: `npx vitest run tests/prestige.test.ts`.

### Slice 3.2 — Expansion

- RED `tests/expansion.test.ts`:
  - `purchasing expansion grows bounds (e.g. +16/axis)`
  - `insufficient currency rejects`
  - `new cells are placeable and persist through save`
- GREEN `src/sim/expansion.ts` + clamp update.
- Verify: `npx vitest run tests/expansion.test.ts`.

### Slice 3.3 — HUD prestige button predicate

- RED: `prestigeButtonEnabled(lifetimeMotors)` false below 25, true at/above; preview text shows motors-to-next.
- GREEN `src/ui/Hud.tsx` predicate + view.
- E2E: `npx playwright test e2e/prestige.spec.ts`.

Phase 3 accept: reset keeps mults, rebuild measurably faster, expansion purchasable.

---

## Phase 4 — VFX & Polish (no sound in v1) [DEFERRED]

Only three effects. vgpu.sh never owns scene/camera. Test the contracts, not pixels.

### Slice 4.1 — VfxLayer contract

- RED `tests/vfxLayer.test.ts`:
  - `layer initializes from three render targets (no own scene/camera creation)`
  - `effects are toggleable on/off`
  - `disabling effects leaves sim state untouched (no sim regression)`
- GREEN `src/render/VfxLayer.ts`.
- Verify: `npx vitest run tests/vfxLayer.test.ts`.

### Slice 4.2 — Effect triggers (predicate tests)

- RED:
  - `ore on belt exposes glow color per resource type`
  - `smelter exposes heat-shimmer active flag only while processing`
  - `depot sale emits single particle burst event`
- GREEN `src/render/effects/oreGlow.wgsl`, `heatShimmer.wgsl`, `saleBurst.ts` trigger logic (shaders themselves verified visually).
- Manual: `npm run build && npm run preview`, confirm three effects, fallback renderer path.

### Slice 4.3 — Perf smoke

- RED `tests/perf.smoke.ts`:
  - `500+ entities hold 10tps sim tick budget`
  - `instanced rendering path used for belts/items (assert InstancedMesh / pooled path, not per-item mesh creation)`
- GREEN `src/render/EntityMeshFactory.ts` (instancing + pooling).
- Manual FPS check on baseline laptop, 60fps target.

Phase 4 accept: effects toggleable, no sim regression, perf targets met.

---

## Non-goals

Multiplayer/co-op, combat/enemies, mobile touch, monetization/IAP, backend accounts, power grid, fluid/pipe systems, cloud sync, sound (skipped v1).

## Risks (per spec §12)

- Sim performance at scale: mitigated by dirty-flag/chunked tick from Phase 2, instancing + pooling in Phase 4.
- Balance risk: the current Tier 0-3 curve is pinned, but any future tuning change must rerun the complete release gates and update the player-facing metric.
- Scope boundary is Phase 0-4; past Phase 4 is backlog, not v1.

## TDD verification checklist (reusable slice template; Task 10 evidence is recorded above and in the Task 10 report)

- [ ] Failing test written first, watched fail for expected reason (not typo)
- [ ] Minimal GREEN code, one behavior at a time
- [ ] Full suite green (`npx vitest run`), output pristine
- [ ] Type gate clean (`npx tsc --noEmit`)
- [ ] Real behavior asserted (no mock-the-system-under-test)
- [ ] Edge cases covered (empty/zero/negative/cap/bounds/insufficient-funds)
- [ ] E2E updated where user-visible flow changed

## Global test commands

```
npm test                 # 44 files, 449 tests, 0 skipped
npm run typecheck        # TypeScript gate
npm run build            # production build; existing chunk warning only
npm run e2e              # 77 browser tests, including 326-cell Act 3
```

Per-slice TDD remains documented above; the final release gate is the four
commands above, run in that order after the final fix wave.

## TODOs for build mode

- [ ] Revisit `MOTOR_THRESHOLD` final value if balance changes (currently 25)
- [x] Concrete recipe and sell-value tables are implemented and covered by the balance contract
- [x] Fixed node-map coordinates are implemented in `worldgen.ts`
- [ ] Phase 4 VFX and instancing/performance gates
- [ ] Causal/realized per-machine attribution and crash durability for forced writes
- [ ] Belt/silo upgrade semantics, explicitly deferred until a level has defined behavior
- [ ] Mobile touch controls and gesture-specific UX
