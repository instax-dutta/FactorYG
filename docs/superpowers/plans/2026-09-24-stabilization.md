# Factor-Y Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the confirmed save, offline-economy, prestige, recipe-unlock, inspector, placement-feedback, and accessibility defects documented in `PLAYTEST.md` §7 before starting Phase 4 feature work.

**Architecture:** Keep the plain-TypeScript simulation as the sole owner of economy and progression state. Persist a versioned, fully validated save; derive offline credit from a rolling ledger of actual sellable outputs; make progression gates consume explicit claimed state; and keep UI feedback as throttled projections of simulation facts. Reuse one accessible overlay primitive and one right-side layout rather than adding independent floating panels.

**Tech Stack:** React 19, TypeScript 7, Zustand 5, three.js 0.186, Vitest 5, Playwright 1.63, Vite 8, localStorage.

**Spec:** `factory-idle-game-spec.md`, `PLAYTEST.md` §7, and the progression/UI requirements in `plan.md`.

## Global Constraints

- Simulation code in `src/sim/` must not import React, Zustand, or three.js.
- The simulation remains fixed at 10 ticks/second and React snapshots remain throttled to 10 Hz.
- Persistence remains localStorage-only and versioned.
- Offline progress must not replay belt items; it must use persisted last-known sellable throughput.
- Machine, recipe, prestige, and save validation remains authoritative in simulation/pure modules, not only in React.
- Desktop remains the supported primary surface. Narrow layouts should degrade without overlapping controls, but mobile touch controls remain a non-goal.
- Sound remains excluded from v1.
- VFX and broader Phase 4 content are not part of this stabilization plan; the missing VFX layer remains tracked in `factory-idle-game-spec.md` §10 and `plan.md` Phase 4.
- This directory is not currently a Git repository. Commit steps apply when the project is placed under Git; until then, preserve the listed verification output as each task checkpoint.

---

## File Structure

### Create

- `src/sim/throughputLedger.ts` - rolling actual-sale throughput used by saves and offline credit.
- `src/ui/Dialog.tsx` - shared accessible confirmation/offline overlay behavior.
- `src/ui/Toasts.tsx` - minimal transient notices and placement/save feedback.
- `src/ui/resourceLabels.ts` - one formatter for player-facing resource names.
- `tests/throughputLedger.test.ts` - deterministic rolling-rate contract.
- `tests/corrupt-save.test.ts` - complete save validation and recovery contract.
- `tests/offline.integration.test.ts` - persisted Motor-chain, multiplier, and lifetime-Motor crediting.
- `tests/placementStatus.test.ts` - legal/disconnected/invalid placement presentation contract.
- `tests/resourceLabels.test.ts` - player-facing resource-name contract.
- `e2e/corrupt-save.spec.ts` - real startup recovery and one-canvas guarantee.
- `e2e/progression-regressions.spec.ts` - repeated prestige and recipe-unlock browser regressions.
- `e2e/ui-reliability.spec.ts` - panel layout, Escape/focus behavior, placement status, pause/save state.

### Modify

- `src/config/constants.ts` - save version and production-rate window.
- `src/sim/save.ts` - complete validation, v2 migration, quarantine/recovery result.
- `src/sim/offline.ts` - persisted-chain input and prestige sell multiplier.
- `src/sim/simulation.ts` - ledger ownership, offline crediting, claimed prestige points, unlock wake-up, public route query.
- `src/sim/prestige.ts` - available/claimed point view model.
- `src/sim/connections.ts` - connection-quality classification.
- `src/sim/simulation.ts` - placement presentation fields and machine-route projection.
- `src/ui/machineInfo.ts` - prestige-aware throughput and machine route status.
- `src/ui/store.ts` - pause, save status, toast, placement-status snapshots.
- `src/ui/InfoPanel.tsx`, `src/ui/PrestigePanel.tsx`, `src/ui/TechTreePanel.tsx`, `src/ui/OfflineModal.tsx`, `src/ui/BuildPanel.tsx`, `src/ui/Hud.tsx` - shared layout/states and feedback.
- `src/render/SceneView.ts` - recover-before-render, persisted offline chains, manual pause, save status, route projection, keyboard cursor.
- `src/render/GhostPreview.ts` - three-state placement preview.
- `tests/save.test.ts`, `tests/offline.test.ts`, `tests/prestige.test.ts`, `tests/techTree.test.ts`, `tests/machineInfo.test.ts`, `tests/uiStore.test.ts`, `e2e/panel-layout.spec.ts`, `e2e/playthrough.spec.ts` - regression coverage.
- `factory-idle-game-spec.md` - final v2 save schema and clarified placement contract.
- `PLAYTEST.md`, `HANDOFF.md`, `plan.md` - current counts, resolved states, and execution status.

---

### Task 1: Make Save Loading Total and Recoverable

**Files:**
- Modify: `src/config/constants.ts`
- Modify: `src/sim/save.ts:30-176`
- Modify: `src/ui/store.ts`
- Modify: `src/render/SceneView.ts:56-105`
- Modify: `factory-idle-game-spec.md:112-155`
- Test: `tests/save.test.ts`
- Create: `tests/corrupt-save.test.ts`
- Create: `e2e/corrupt-save.spec.ts`

**Interfaces:**
- Produces: `SAVE_VERSION = 2`.
- Produces: v2 `prestige: { lifetimeMotors, points, claimedPoints, totalPrestiges, permanentMultipliers }`; `points` is cumulative and `claimedPoints` is the number already spent.
- Produces: `type SaveLoadResult = { kind: 'empty' } | { kind: 'loaded'; save: SaveData } | { kind: 'recovered'; raw: string | null }`.
- Produces: `loadSave(storage: Storage, now?: number): SaveLoadResult`.
- Produces: `validateSaveData(raw: unknown): SaveData`.
- Adds: UI-store `recoveryPending: boolean`; Task 8 renders the toast once the toast surface exists.

- [ ] **Step 1: Write failing pure validation tests**

Add cases for an empty entity, malformed nested prestige when present, invalid machine/resource/rotation values, negative currency/counts, invalid dimensions, non-finite throughput, future versions, and valid v1 legacy saves with optional `prestige`, `unlocked`, entity `inputs`, or `expansionsBought` blocks absent. Include v1 prestige cases `points=1,totalPrestiges=0 → claimedPoints=0`, `points=1,totalPrestiges=2 → claimedPoints=1`, and `points=2,totalPrestiges=1 → claimedPoints=2`.

```ts
it.each([
  { version: 1, currency: 0, grid: { width: 64, height: 64, entities: [{}] } },
  { version: 1, currency: Number.NaN, grid: { width: 64, height: 64, entities: [] } },
  { version: 99, currency: 0, grid: { width: 64, height: 64, entities: [] } },
])('rejects malformed save %#', (raw) => {
  expect(() => validateSaveData(raw)).toThrow();
});
```

- [ ] **Step 2: Run the validation tests and confirm RED**

Run: `npx vitest run tests/save.test.ts tests/corrupt-save.test.ts`

Expected: FAIL because `validateSaveData` and v2 migration do not exist.

- [ ] **Step 3: Implement complete structural validation**

Validate every persisted field before narrowing to `SaveData`. Require string IDs, allowed `MachineType` and `Rotation`, finite non-negative economy values, non-negative integer buffer counts, valid resource IDs, positive grid dimensions, and valid chain records. During v1→v2 migration, fill optional legacy blocks with the defaults already supported by `applySave()`. Infer legacy claims conservatively: `totalPrestiges=0 → claimedPoints=0`; otherwise `claimedPoints=points`. Legacy fields cannot distinguish one claimed point plus one newly earned point from one prestige that claimed both, so preserving every possible unclaimed point would permit duplicate claims. Update spec §8 with the final v2 schema at the same time.

```ts
export function validateSaveData(raw: unknown): SaveData {
  if (!isRecord(raw)) throw new Error('invalid save data');
  if (raw.version !== 1 && raw.version !== 2) throw new Error('unsupported save version');
  const migrated = raw.version === 1 ? migrateV1ToV2(raw) : raw;
  assertV2Save(migrated);
  return migrated;
}
```

- [ ] **Step 4: Add quarantine/recovery behavior**

Invalid JSON or structurally invalid data must be copied to `` `${SAVE_KEY}.corrupt.${now}` `` and removed from the active key. A valid v1 save must migrate to v2 with `productionChains: {}` so a known-wrong v1 raw-chain estimate cannot mint currency.

```ts
export function loadSave(storage: Storage, now = Date.now()): SaveLoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return { kind: 'recovered', raw: null };
  }
  if (raw === null) return { kind: 'empty' };
  try {
    return { kind: 'loaded', save: validateSaveData(JSON.parse(raw)) };
  } catch {
    try { storage.setItem(`${SAVE_KEY}.corrupt.${now}`, raw); } catch {}
    try { storage.removeItem(SAVE_KEY); } catch {}
    return { kind: 'recovered', raw };
  }
}
```

Add a throwing-storage test. If backup or removal fails, still return `recovered` and continue with a fresh in-memory session; never let recovery itself reject startup.

- [ ] **Step 5: Load and apply the save before renderer creation**

Move safe storage access and `loadSave()` to the beginning of `mountScene()`. Set `recoveryPending` when the result is `recovered`, then create/append the renderer only after successful validation/application. After `saveNow()` is defined, write the fresh recovered session once inside a guarded block before normal play, even if quarantine removal failed. Task 8 consumes the flag and renders the user-facing toast. Wrap remaining mount work so a failure disposes any created renderer/canvas.

- [ ] **Step 6: Add the browser recovery regression**

Seed an invalid entity, reload, and assert one canvas, initialized backend, visible goal, fresh save, and a corrupt backup key.

```ts
await expect(page.locator('canvas')).toHaveCount(1);
await expect(page.getByTestId('backend')).toHaveText(/webgpu|webgl2/);
await expect(page.getByTestId('goal-title')).toBeVisible();
const corruptKeys = await page.evaluate(
  (key) => Object.keys(localStorage).filter((candidate) => candidate.startsWith(`${key}.corrupt.`)),
  SAVE_KEY,
);
expect(corruptKeys).toHaveLength(1);
```

- [ ] **Step 7: Verify Task 1**

Run: `npx vitest run tests/save.test.ts tests/corrupt-save.test.ts && npm run typecheck && npx playwright test e2e/corrupt-save.spec.ts`

Expected: all targeted tests pass; corrupt save no longer blocks startup.

- [ ] **Step 8: Commit checkpoint when Git is available**

`git add src/config/constants.ts src/sim/save.ts src/ui/store.ts src/render/SceneView.ts factory-idle-game-spec.md tests/save.test.ts tests/corrupt-save.test.ts e2e/corrupt-save.spec.ts && git commit -m "fix: recover safely from invalid saves"`

---

### Task 2: Replace Nominal Offline Chains with Actual Sale Throughput

**Files:**
- Create: `src/sim/throughputLedger.ts`
- Create: `tests/throughputLedger.test.ts`
- Create: `tests/offline.integration.test.ts`
- Modify: `src/config/constants.ts`
- Modify: `src/sim/simulation.ts:57-63,141-177,486-647`
- Modify: `src/sim/offline.ts:6-122`
- Modify: `src/sim/save.ts`
- Modify: `src/render/SceneView.ts:90-101,542-560`
- Test: `tests/offline.test.ts`, `tests/save.test.ts`

**Interfaces:**
- Produces: `ProductionLedger` with `recordSale(resource, tick)`, `snapshot(tick)`, `seed(chains, currentTick)`, and `clear()`.
- Produces: `Simulation.restoreThroughput(chains)` and `Simulation.creditOffline(report: OfflineReport): void`.
- Produces: `ChainInfo[]` representing recently sold output resources rather than raw extractor routes.
- Changes: `computeOfflineGains(chains, elapsedSec, sellMultiplier)` accepts the current prestige sell multiplier.
- Moves `ChainInfo` into `throughputLedger.ts` so `offline.ts` no longer imports `simulation.ts`; `simulation.ts` may import `OfflineReport` with `import type` without a module cycle.

- [ ] **Step 1: Write failing rolling-throughput tests**

Use explicit ticks so the test never depends on wall time.

```ts
const ledger = new ProductionLedger(50);
ledger.recordSale('motor', 0);
ledger.recordSale('motor', 10);
expect(ledger.snapshot(10)).toEqual([]);
ledger.recordSale('motor', 25);
ledger.recordSale('motor', 50);
expect(ledger.snapshot(50)).toEqual([
  { id: 'sold-motor', outputResource: 'motor', steadyStateThroughput: 0.8 },
]);
```

Also cover empty ledgers, mixed resources, window expiry, and deterministic tie ordering.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run tests/throughputLedger.test.ts`

Expected: FAIL because the ledger module does not exist.

- [ ] **Step 3: Implement the pure ledger**

Store `{ tick, resource }` sale samples in a 50-tick rolling window. Derive units/second as `count / 5`, because 50 ticks at the fixed 10 Hz simulation rate is exactly five seconds. Snapshot IDs as `sold-${resource}`. `seed(chains, currentTick)` stores loaded rates for 50 ticks. A measured rate supersedes its seed only after that resource has a complete 50-tick measured window; until then, retain the seed. With no seed, omit a resource until its first complete measured window. Offline credit never records a live sale sample. `clear()` removes samples and seeds.

- [ ] **Step 4: Write failing simulation integration tests**

Prove that actual Motor sales become persisted Motor throughput and that offline credit uses the stored Motor chain rather than recomputing raw extractors.

```ts
expect(sim.chains()).toEqual([
  { id: 'sold-motor', outputResource: 'motor', steadyStateThroughput: 0.5 },
]);
```

Add a test that `creditOffline()` increases currency and lifetime Motors for a Motor gain.

- [ ] **Step 5: Integrate ledger ownership into `Simulation`**

Increment a tick counter in `tick()`, call `ledger.recordSale()` from `sell()`, and make `chains()` return the ledger snapshot, including the bounded loaded seed. Call `ledger.clear()` from `Simulation.reset()` before prestige or Start Over so old factory throughput cannot survive into an empty factory. Add `Simulation.restoreThroughput()` and call it from `applySave()` with the persisted `productionChains`. Remove graph walking from the hot snapshot/offline path.

- [ ] **Step 6: Consume persisted chains on load**

Initial load alone consumes `storedSave`:

```ts
const resume = resumeFromSave(
  Object.values(storedSave.productionChains),
  storedSave.lastSavedAt,
  Date.now(),
  sim.prestigeState().permanentMultipliers.sellValue,
);
sim.creditOffline(resume.report);
saveNow();
```

Visibility resume must use the exact paired hide timestamp and the current `sim.chains()`, credit once, then call `saveNow()` immediately. It must never reuse `storedSave.lastSavedAt`. Hoist `saveNow()` above the initial load block so the post-credit save is available. Do not add directly to `sim.currency` in `SceneView`.

- [ ] **Step 7: Apply sell value and prestige progression in one credit path**

`Simulation.creditOffline()` must add report currency and add fractional Motor quantity to `lifetimeMotors`. The v2 report must show the prestige-adjusted value used for the credit. Add a load → immediate save → reload test proving the seeded rate survives the save, a one-sale-after-load test proving the seed is not replaced early, and a 50-tick test proving a complete measured window supersedes it. Add prestige and Start Over tests proving `reset()` clears old samples/seeds before the immediate save.

- [ ] **Step 8: Add browser regression for the reproduced bug**

Seed a v2 save whose stored chain is Motor at `0.1 item/s`, backdate eight hours, and assert the modal reports Motor rather than `copperOre`; assert lifetime Motors increases. Add a second browser case with two hide/show cycles followed by reload: the same away period must not be credited again, and the post-credit timestamp must be persisted immediately.

- [ ] **Step 9: Verify Task 2**

Run: `npx vitest run tests/throughputLedger.test.ts tests/offline.test.ts tests/offline.integration.test.ts tests/save.test.ts && npm run typecheck && npx playwright test e2e/progression-regressions.spec.ts --grep "offline"`

Expected: stored sellable output is used, multipliers apply, and offline Motors count toward prestige.

- [ ] **Step 10: Commit checkpoint when Git is available**

`git add src/config/constants.ts src/sim/throughputLedger.ts src/sim/simulation.ts src/sim/offline.ts src/sim/save.ts src/render/SceneView.ts tests/throughputLedger.test.ts tests/offline.integration.test.ts e2e/progression-regressions.spec.ts && git commit -m "fix: credit offline sellable production"`

---

### Task 3: Track Claimed Prestige Points

**Files:**
- Modify: `src/sim/prestige.ts:17-56`
- Modify: `src/sim/simulation.ts:87-89,141-270`
- Modify: `src/sim/save.ts`
- Modify: `src/ui/prestigeView.ts`
- Modify: `src/ui/store.ts`
- Test: `tests/prestige.test.ts`, `tests/prestigeView.test.ts`, `tests/save.test.ts`, `tests/uiStore.test.ts`

**Interfaces:**
- Extends: `PrestigeState` with `claimedPoints` and `availablePoints`.
- Preserves: `prestige.points` in v2 save data as cumulative lifetime-derived points.
- Persists: `prestige.claimedPoints` as points already spent.
- Changes: `PrestigeResult.points` means newly claimed points.
- Changes: `PrestigeResult` failure union includes `'no-fresh-point'`.

- [ ] **Step 1: Write the repeated-prestige failing test**

```ts
sellMotors(sim, 25);
expect(sim.prestige().ok).toBe(true);
expect(sim.prestige()).toEqual({ ok: false, reason: 'no-fresh-point' });
expect(sim.entities()).toHaveLength(0);
```

- [ ] **Step 2: Add UI/view failing cases**

Assert `Prestige +0`, disabled state, and `sell 25 more Motors` after the first claim.

- [ ] **Step 3: Confirm RED**

Run: `npx vitest run tests/prestige.test.ts tests/prestigeView.test.ts`

Expected: FAIL because repeated prestige still succeeds and shows `+1`.

- [ ] **Step 4: Add claimed-point state and persistence**

Initialize `claimedPoints = 0`; restore it from `save.prestige.claimedPoints`; write both cumulative `points` and `claimedPoints` on save. Compute `availablePoints = points - claimedPoints`. Task 1's v1 migration already infers safe legacy values.

- [ ] **Step 5: Gate and claim points atomically**

Before reset, require `availablePoints > 0`. After reset, set `claimedPoints = points`, increment `totalPrestiges`, and return the newly claimed amount. Update the failure union to accept `'no-fresh-point'`.

- [ ] **Step 6: Update the view model**

`prestigeView.enabled` must use `availablePoints > 0`, and the label must use the available amount. Motors-to-next remains derived from lifetime Motors modulo 25.

- [ ] **Step 7: Verify migration and browser behavior**

Add v1/v2 save cases, update typed `PrestigeState` fixtures in `tests/uiStore.test.ts`, and run a Playwright flow that confirms prestige twice; the second button must be disabled and `totalPrestiges` must remain 1.

- [ ] **Step 8: Verify Task 3**

Run: `npx vitest run tests/prestige.test.ts tests/prestigeView.test.ts tests/save.test.ts tests/uiStore.test.ts && npm run typecheck && npx playwright test e2e/progression-regressions.spec.ts --grep "prestige"`

- [ ] **Step 9: Commit checkpoint when Git is available**

`git add src/sim/prestige.ts src/sim/simulation.ts src/sim/save.ts src/ui/prestigeView.ts src/ui/store.ts tests/prestige.test.ts tests/prestigeView.test.ts tests/save.test.ts tests/uiStore.test.ts e2e/progression-regressions.spec.ts && git commit -m "fix: claim each prestige point once"`

---

### Task 4: Wake Buffered Crafters After Recipe Unlocks

**Files:**
- Modify: `src/sim/simulation.ts:204-211,486-607`
- Test: `tests/techTree.test.ts`, `tests/sim.tick.test.ts`
- Test: `e2e/progression-regressions.spec.ts`

**Interfaces:**
- Uses: existing `matchRecipe()` and `isRecipeUnlocked()`.
- Produces: no new public API.

- [ ] **Step 1: Write the failing dormant-crafter test**

Restore an assembler with `{ wire: 1, gear: 1 }`, tick until it sleeps, unlock Circuit, tick once, and assert `entity.recipe === 'circuit'` and inputs are consumed.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run tests/techTree.test.ts tests/sim.tick.test.ts`

Expected: FAIL because unlock does not wake the assembler.

- [ ] **Step 3: Wake affected crafters after successful unlock**

Determine whether the unlocked node is a recipe. If so, iterate crafters with non-empty inputs and call `wakeAt()` for each. Machine unlocks require no special wake-up.

- [ ] **Step 4: Add the browser regression**

Use the exact reproduced save and Tech click. Assert the inspector changes from `idle / 1× wire, 1× gear` to `crafting circuit` and then produces a Circuit item.

- [ ] **Step 5: Verify Task 4**

Run: `npx vitest run tests/techTree.test.ts tests/sim.tick.test.ts && npm run typecheck && npx playwright test e2e/progression-regressions.spec.ts --grep "recipe unlock"`

- [ ] **Step 6: Commit checkpoint when Git is available**

`git add src/sim/simulation.ts tests/techTree.test.ts tests/sim.tick.test.ts e2e/progression-regressions.spec.ts && git commit -m "fix: wake crafters after recipe unlocks"`

---

### Task 5: Correct Inspector Data and Replace the Overlapping Layout

**Files:**
- Modify: `src/sim/simulation.ts:784-827`
- Modify: `src/ui/machineInfo.ts`
- Modify: `src/App.tsx:35-44`
- Modify: `src/ui/InfoPanel.tsx`
- Modify: `src/ui/PrestigePanel.tsx`
- Test: `tests/machineInfo.test.ts`, `tests/sim.load.test.ts`, `tests/uiStore.test.ts`
- Modify: `e2e/panel-layout.spec.ts`

**Interfaces:**
- Produces: `Simulation.topologyVersion: number` and `Simulation.entityReachesDepot(cell: Cell): boolean`.
- Changes: `machineInfoFor(entity, reachesDepot, permanentProductionSpeed, permanentSellValue)`.
- Extends: `MachineInfo` with `grossValuePerSecond`, an estimate from current output throughput and sell value, not a claim of causal machine revenue.

- [ ] **Step 1: Write failing route, multiplier, and value tests**

For a Smelter feeding a Depot, assert `reachesDepot === true`. With one prestige point, assert extractor throughput includes `1.25`. A running Motor assembler at `0.5 item/s` with base sell value `1500` must report `grossValuePerSecond: 750` before the sell multiplier. Add cache-invalidation cases for place, remove, move, reset, and restore.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run tests/machineInfo.test.ts tests/sim.load.test.ts`

Expected: FAIL because non-extractor route status is false and prestige speed is omitted.

- [ ] **Step 3: Expose a graph query for any machine**

Move/reuse the existing reachability walk behind a public cell-based method. Increment `topologyVersion` on place, run placement, move, demolition, reset, and save restore. Cache route results by `${topologyVersion}:${x},${y}`; do not run a full graph walk from every 10 Hz snapshot.

- [ ] **Step 4: Pass authoritative speed into the UI mapper**

`SceneView` reads both permanent multipliers and supplies them to `machineInfoFor()`. Calculate `grossValuePerSecond` from the machine's current throughput and current output resource sell value. `InfoPanel` labels this honestly as `gross at current output` and renders `—` for a Depot sink, avoiding false causal attribution.

- [ ] **Step 5: Create one right-side layout container**

Render Prestige first and Info second in a flex column at `top:12; right:12`. Remove absolute positioning from both panel roots. Hide the empty Info panel unless a cell is selected so a fresh player sees one coherent right rail.

- [ ] **Step 6: Expand panel-layout coverage**

Include Info, HUD, right rail, legend, both modals, Build, and Tech at 1280×720, 1024×720, 390×844, and 320×568. Assert panel intersections are zero and controls are hit-testable. At narrow widths, constrain the Tech panel to `calc(100vw - 16px)`, allow the build bar to wrap within the viewport, and set the informational legend to `pointer-events: none` so it cannot intercept map input.

- [ ] **Step 7: Verify Task 5**

Run: `npx vitest run tests/machineInfo.test.ts tests/sim.load.test.ts tests/uiStore.test.ts && npm run typecheck && npx playwright test e2e/panel-layout.spec.ts`

- [ ] **Step 8: Commit checkpoint when Git is available**

`git add src/sim/simulation.ts src/ui/machineInfo.ts src/App.tsx src/ui/InfoPanel.tsx src/ui/PrestigePanel.tsx tests/machineInfo.test.ts tests/sim.load.test.ts tests/uiStore.test.ts e2e/panel-layout.spec.ts && git commit -m "fix: make machine inspection accurate and visible"`

---

### Task 6: Add Actionable Placement Feedback and Define Connection Quality

**Files:**
- Create: `src/sim/connections.ts`
- Create: `tests/placementStatus.test.ts`
- Modify: `src/sim/placement.ts`
- Modify: `src/sim/simulation.ts:64-67,347-364`
- Modify: `src/render/GhostPreview.ts`
- Modify: `src/render/SceneView.ts`
- Modify: `src/ui/store.ts`
- Create: `src/ui/Toasts.tsx`
- Modify: `src/App.tsx`
- Modify: `e2e/phase0.verify.spec.ts`

**Interfaces:**
- Produces: `type ConnectionQuality = 'connected' | 'partial' | 'disconnected'`.
- Produces: `type PlacementPreview = { check: PlaceCheck; connection: ConnectionQuality; message: string | null }`.
- Produces: `classifyConnection(candidate, neighbors)` and `classifyRun(cells, existingEntities)` as pure functions.
- Preserves existing `PlaceCheck` result shapes; placement presentation remains a separate projection.
- Preserves: build-any-order freedom; disconnected placement is legal but visibly warned.

- [ ] **Step 1: Lock the product rule in tests**

Assert occupied, locked, and no-node are red/rejected; an isolated legal machine is amber/accepted; a connected machine is green/accepted. Belt-run quality must be computed against the whole proposed batch. Assert a locked tool exposes its Tech price and unlock location.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run tests/placementStatus.test.ts`

Expected: FAIL because only legal/illegal booleans exist.

- [ ] **Step 3: Implement pure connection classification**

Use machine port tables and neighboring rotations. `classifyConnection()` accepts one candidate plus the four typed neighbor views. `classifyRun()` accepts the proposed cells/rotations plus an entity map, so it can classify the whole batch without mutating the simulation. Classify required sides explicitly: Extractor requires output; Smelter, Assembler, and Silo require input and output; Depot requires input; Belt, Splitter, and Crossing require at least one compatible neighbor. A machine is `connected` when every required side is satisfied, `partial` when one required side is satisfied, and `disconnected` when none is. Do not reject a machine merely because future belts have not been placed.

- [ ] **Step 4: Render green/amber/red ghost states**

Extend the ghost material palette with an amber disconnected color. Keep the existing valid and invalid colors.

- [ ] **Step 5: Publish concise placement status**

Add `placementStatus` to the UI store. Show one `aria-live="polite"` message near the build bar: `Cell occupied`, `Extractor needs a resource node`, `Unlock Assembler in Tech`, or `Disconnected - this machine will idle`. Locked tool labels must include their Tech price, such as `Assembler · 75 cr`, and identify Tech as the unlock location.

- [ ] **Step 6: Update the product spec wording**

Change the placement requirement from unconditional invalid-adjacency rejection to: structurally invalid placements are rejected; legal but disconnected placements are accepted with an amber preview. This preserves incremental construction while making the state explicit.

- [ ] **Step 7: Verify Task 6**

Run: `npx vitest run tests/placementStatus.test.ts tests/placement.test.ts && npm run typecheck && npx playwright test e2e/phase0.verify.spec.ts`

- [ ] **Step 8: Commit checkpoint when Git is available**

`git add src/sim/connections.ts src/sim/placement.ts src/render/GhostPreview.ts src/render/SceneView.ts src/ui/store.ts src/ui/Toasts.tsx src/App.tsx tests/placementStatus.test.ts e2e/phase0.verify.spec.ts factory-idle-game-spec.md && git commit -m "fix: explain placement and connection state"`

---

### Task 7: Introduce One Accessible Dialog Primitive

**Files:**
- Create: `src/ui/Dialog.tsx`
- Modify: `src/ui/PrestigePanel.tsx`
- Modify: `src/ui/OfflineModal.tsx`
- Modify: `src/ui/TechTreePanel.tsx`
- Create: `e2e/ui-reliability.spec.ts`

**Interfaces:**
- Produces: `Dialog({ open, title, children, onClose })`.
- Guarantees: labelled dialog semantics, focus containment/restoration, Escape dismissal, explicit high z-index, viewport-safe width.

- [ ] **Step 1: Write failing Playwright focus tests**

Open Start Over and assert focus enters the title/confirm action, Tab remains inside, Escape closes, and focus returns to Start Over. Repeat for Offline.

- [ ] **Step 2: Confirm RED**

Run: `npx playwright test e2e/ui-reliability.spec.ts --grep "dialog"`

Expected: FAIL because overlays have no semantics or focus management.

- [ ] **Step 3: Implement the shared dialog**

Use a labelled `role="dialog"`, `aria-modal="true"`, explicit overlay/panel layers, focus trap, Escape handler, and focus restoration. Constrain panel width with `min(360px, calc(100vw - 24px))`.

- [ ] **Step 4: Replace both custom overlays**

Prestige confirmation and Offline must use the same primitive so keyboard behavior cannot diverge.

- [ ] **Step 5: Add Tech Escape behavior**

Tech is a non-modal panel: when open, Escape closes it and returns focus to Tech. It must not trap focus.

- [ ] **Step 6: Verify Task 7**

Run: `npm run typecheck && npx playwright test e2e/ui-reliability.spec.ts --grep "dialog|Tech"`

- [ ] **Step 7: Commit checkpoint when Git is available**

`git add src/ui/Dialog.tsx src/ui/PrestigePanel.tsx src/ui/OfflineModal.tsx src/ui/TechTreePanel.tsx e2e/ui-reliability.spec.ts && git commit -m "fix: make overlays keyboard accessible"`

---

### Task 8: Add Manual Pause, Save Status, and Player-Facing Notifications

**Files:**
- Create: `src/ui/resourceLabels.ts`
- Create: `tests/resourceLabels.test.ts`
- Modify: `src/index.css`
- Modify: `src/ui/store.ts`
- Modify: `src/ui/Hud.tsx`
- Modify: `src/ui/BuildPanel.tsx`
- Modify: `src/ui/Toasts.tsx`
- Modify: `src/ui/InfoPanel.tsx`
- Modify: `src/ui/OfflineModal.tsx`
- Modify: `src/ui/NodeLegendPanel.tsx`
- Modify: `src/ui/machineInfo.ts`
- Modify: `src/render/SceneView.ts`
- Test: `tests/uiStore.test.ts`, `tests/machineInfo.test.ts`
- Test: `e2e/ui-reliability.spec.ts`

**Interfaces:**
- Adds UI state: `paused`, `saveStatus: 'idle' | 'saving' | 'saved' | 'error'`, `lastSavedAt`, and transient `toast` messages.
- Adds action: `togglePause()`.

- [ ] **Step 1: Write failing store, formatter, and browser tests**

Assert manual pause prevents clock advancement, save status transitions are coalesced, and one toast replaces another rather than stacking duplicates. Add formatter cases for every resource ID, update `stateLabel('extractor', 'copperOre')` to `Copper Ore`, and assert locked-tool copy contains price, affordability, and prerequisites. Add computed-style contrast assertions for normal muted/status text. Add an E2E case that places and right-click demolishes a machine, then verifies the active save contains the edit before the five-second autosave interval.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run tests/uiStore.test.ts tests/machineInfo.test.ts tests/resourceLabels.test.ts`

Expected: FAIL because pause/save/toast state does not exist.

- [ ] **Step 3: Implement manual pause in the scene clock**

Combine manual pause with document-hidden pause. On pause, flush snapshot and save immediately. On resume, reset the clock baseline so no catch-up burst occurs.

- [ ] **Step 4: Publish real save status**

`saveNow()` sets `saving`, writes storage, then sets `saved` and `lastSavedAt`. Storage exceptions set `error`; startup quarantine shows a recovery toast. Call `saveNow()` after ordinary placement, right-click demolition, inspector demolition, and undo; belt runs and moves already save immediately and must keep doing so.

- [ ] **Step 5: Add minimal controls and messages**

HUD shows a compact Pause/Resume button and `Saved`/timestamp or `Save failed`. Tech purchase, recovered save, placement refusal, and manual pause emit concise toasts. When mounted, `Toasts` consumes and clears `recoveryPending` from Task 1.

- [ ] **Step 6: Replace debug/raw copy**

Move `webgl2` out of the primary HUD. Add `resourceLabel(resourceId)` and apply it in `InfoPanel`, `OfflineModal`, `NodeLegendPanel`, `machineInfo.stateLabel()`, and machine-info buffer/recipe text. Locked-tool copy must show price, current funds, and missing prerequisite, for example `Assembler · 75 cr · needs 35 cr` or `Assembler · 75 cr · needs Refined Stone`. Define semantic CSS custom properties for canvas, panel, text, muted text, accent, success, warning, danger, border, and focus; replace repeated hard-coded overlay colors with those tokens. Raise locked/backend text contrast to at least 4.5:1.

- [ ] **Step 7: Verify Task 8**

Run: `npx vitest run tests/uiStore.test.ts tests/machineInfo.test.ts tests/resourceLabels.test.ts && npm run typecheck && npx playwright test e2e/ui-reliability.spec.ts --grep "pause|save|toast|immediate edit save|resource label|locked tool|contrast"`

- [ ] **Step 8: Commit checkpoint when Git is available**

`git add src/index.css src/ui/resourceLabels.ts src/ui/store.ts src/ui/Hud.tsx src/ui/BuildPanel.tsx src/ui/Toasts.tsx src/ui/InfoPanel.tsx src/ui/OfflineModal.tsx src/ui/NodeLegendPanel.tsx src/ui/machineInfo.ts src/render/SceneView.ts tests/resourceLabels.test.ts tests/uiStore.test.ts tests/machineInfo.test.ts e2e/ui-reliability.spec.ts && git commit -m "fix: expose reliable game state and labels"`

---

### Task 9: Add Keyboard Cell Navigation and Accessible Status

**Files:**
- Modify: `src/render/SceneView.ts`
- Modify: `src/render/GhostPreview.ts`
- Modify: `src/ui/store.ts`
- Modify: `src/ui/BuildPanel.tsx`
- Create: `e2e/keyboard-map.spec.ts`

**Interfaces:**
- Adds UI state: `keyboardCursor: Cell | null`.
- Keyboard map: Arrow keys move cursor; Enter/Space places the armed tool or inspects; `X` demolishes; `R` rotates; `Escape` clears tool.

- [ ] **Step 1: Write failing keyboard-flow tests**

Tab to the canvas, move with arrows, inspect with Enter, arm a tool, place with Enter, rotate with R, and demolish with X. Assert an `aria-live` region names the current cell and placement result.

- [ ] **Step 2: Confirm RED**

Run: `npx playwright test e2e/keyboard-map.spec.ts`

Expected: FAIL because the canvas is not focusable and the cursor does not exist.

- [ ] **Step 3: Add a visible keyboard cursor**

Render one reusable cursor mesh at the current cell. Keep WASD for camera pan and reserve arrows for cell movement so both input models remain usable.

- [ ] **Step 4: Add canvas semantics and key routing**

Set `tabIndex=0`, an accessible label, and focus/keydown handlers on the canvas. Do not duplicate global shortcuts when focus is inside a dialog or button.

- [ ] **Step 5: Announce state changes**

A polite live region should report `Cell 22, 24`, selected machine type, placement success/refusal, and demolition result.

- [ ] **Step 6: Verify Task 9**

Run: `npm run typecheck && npx playwright test e2e/keyboard-map.spec.ts e2e/ui-reliability.spec.ts`

- [ ] **Step 7: Commit checkpoint when Git is available**

`git add src/render/SceneView.ts src/render/GhostPreview.ts src/ui/store.ts src/ui/BuildPanel.tsx e2e/keyboard-map.spec.ts && git commit -m "feat: add keyboard map controls"`

---

### Task 10: Remove Stale Coverage and Re-Baseline Playtest Metrics

**Files:**
- Modify: `tests/chain.test.ts:156-315`
- Modify: `e2e/playthrough.spec.ts`
- Modify: `e2e/act3.spec.ts`
- Modify: `e2e/panel-layout.spec.ts`
- Modify: `PLAYTEST.md`
- Modify: `HANDOFF.md`
- Modify: `plan.md`

**Interfaces:**
- Produces: current test counts and a boot-to-first-credit metric measured during construction.

- [ ] **Step 1: Remove the obsolete skipped factory test**

Delete the hand-laid `it.skip()` case now superseded by `factoryPlan.test.ts` and `act3.spec.ts`. Do not replace it with another skipped test.

- [ ] **Step 2: Fix first-credit timing**

In `playthrough.spec.ts`, record boot time before the first placement and poll currency after every placement. Report both boot-to-first-credit and post-build ramp time. Keep placement time separate from sale ramp time.

- [ ] **Step 3: Expand final release gates**

Run unit, typecheck, build, and full Playwright after Tasks 1-9. Include corrupt save, offline, prestige, unlock, panel layout, dialogs, pause/save, keyboard map, and the 326-cell `act3.spec.ts` in the final suite. Capture the fresh `TIME_TO_FIRST_MOTOR` value from that run before editing documentation.

- [ ] **Step 4: Update documentation from actual output**

Refresh status headers, phase names, test counts, known gaps, and current screenshots/metrics using the completed command output. Remove claims that map routing, Tech wake-up, offline Motor crediting, or fresh prestige points are already complete.

- [ ] **Step 5: Verify Task 10**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run e2e
```

Expected: zero failures, zero skipped tests, clean typecheck/build, and all documented counts match command output.

- [ ] **Step 6: Commit checkpoint when Git is available**

`git add tests/chain.test.ts e2e/playthrough.spec.ts e2e/act3.spec.ts e2e/panel-layout.spec.ts PLAYTEST.md HANDOFF.md plan.md && git commit -m "docs: record verified stabilization status"`

---

## Final Acceptance Criteria

- A malformed/future save is quarantined and the game starts once in a recoverable fresh session.
- Offline credit uses persisted sellable output, applies prestige sell value, and advances lifetime Motors.
- One prestige point can be claimed exactly once.
- Unlocking a recipe wakes crafters holding its inputs.
- A connected machine reports a depot route, prestige-aware throughput, and an honestly labeled gross-value estimate.
- Info and Prestige never overlap at supported desktop widths.
- Invalid placement gives a specific text reason; disconnected legal placement gives an amber warning.
- Confirmation and Offline dialogs trap/restore focus and close with Escape; Tech closes with Escape.
- Manual pause, save state, and concise notifications are visible.
- The complete primary loop is keyboard-operable.
- The final unit and browser suites have no skipped tests, and documentation matches fresh command output.

## Explicitly Deferred

- Ore glow, heat shimmer, and sale-burst VFX.
- Entity/item instancing and the 60 FPS real-hardware gate beyond the existing dirty-set simulation work.
- Recipe picker/multi-recipe switching, strict FIFO silo behavior, and belt/silo upgrades.
- Mobile touch controls and gesture-specific UX.
