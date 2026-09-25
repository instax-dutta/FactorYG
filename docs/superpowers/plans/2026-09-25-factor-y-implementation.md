# Factor-Y Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Factor-Y desktop browser game from the approved design, with deterministic simulation, custom 64 by 64 art, persistence, React UI, Phaser rendering, prestige, and performance polish delivered in rollback-safe atomic commits.

**Architecture:** The pure simulation store owns game state and advances on a fixed 10 Hz clock. Phaser renders snapshots and sends placement/camera commands through an adapter. React reads immutable snapshots through `useSyncExternalStore` and owns only the DOM overlay. Content and asset manifests are data-driven so machine behavior, recipes, costs, and sprites are not hardcoded into individual instances.

**Tech Stack:** TypeScript, Vite, React, Phaser 3, Vitest, React Testing Library, Playwright, ESLint, localStorage, custom SVG/PNG art assets.

**Spec:** `docs/superpowers/specs/2026-09-25-factor-y-design.md`

## Global Constraints

- Initial grid is 64 by 64 cells.
- Tile and sprite size is 64 by 64 pixels.
- Simulation runs at 10 logical ticks per second with a 100 ms tick.
- Offline production is capped at 12 hours and uses saved steady-state throughput, not item replay.
- The welcome-back modal appears when elapsed real time exceeds 60 seconds.
- Save key is `factor-y:save`; the first shipped schema is version 1 with a migration registry.
- Desktop browser only; no touch controls, responsive breakpoint system, multiplayer, combat, power grid, fluids, backend accounts, cloud sync, monetization, or machine module slots.
- Public product name is Factor-I, with short label factori; internal factor-y IDs and save key remain compatibility names.
- Custom art is one cohesive set with neutral overhead lighting and no baked directional shadows.
- The simulation store must not import React, Phaser, DOM APIs, or persistence implementation.
- Phaser must not advance economic logic from `update()`.
- React and Phaser are read-only consumers plus command callers.
- Every production behavior is implemented test-first: failing test, expected red result, minimal green implementation, focused pass, refactor, and task commit.
- Each task is committed atomically after its focused and phase verification commands pass.
- Do not add comments to source files.
- Do not commit secrets, credentials, dependency folders, temporary downloads, or browser artifacts.

---

## Execution and Commit Rules

- Work on the `feature/factor-y-bootstrap` branch until the user requests integration.
- Initialize DOX after the repository layout exists and before application implementation.
- Use one commit per task. A task may contain multiple files but has one reviewable behavior and one rollback point.
- Before every commit, run the task’s focused test, the complete unit suite, lint, typecheck, and build when the task changes application code.
- Never use `git add .`; stage only the files named by the task.
- If a test fails, fix the implementation or the test only when the test’s expected behavior is demonstrably wrong. Record the reason in the commit message body when needed.
- A commit is not made while its required verification command is failing.

## Planned File Map

```text
src/
  app/App.tsx
  app/GameCanvas.tsx
  content/assetManifest.ts
  content/types.ts
  content/freeze.ts
  content/machines.ts
  content/recipes.ts
  content/resources.ts
  content/unlocks.ts
  content/validation.ts
  persistence/migrate.ts
  persistence/save.ts
  phaser/FactoryScene.ts
  phaser/cameraConfig.ts
  phaser/createGame.ts
  phaser/inputAdapter.ts
  phaser/render/BeltItemRenderer.ts
  phaser/render/EntityRenderer.ts
  phaser/render/VfxRenderer.ts
  sim/clock.ts
  sim/commands.ts
  sim/connections.ts
  sim/constants.ts
  sim/grid.ts
  sim/index.ts
  sim/machines.ts
  sim/placement.ts
  sim/rotation.ts
  sim/snapshot.ts
  sim/store.ts
  sim/tick.ts
  sim/types.ts
  ui/components/BuildDock.tsx
  ui/components/EntityInspector.tsx
  ui/components/Hud.tsx
  ui/components/NotificationStack.tsx
  ui/components/OfflineSummaryModal.tsx
  ui/components/TechTree.tsx
  ui/hooks/useSimulationSnapshot.ts
  ui/hooks/useStoreSubscription.ts
public/assets/
  tiles/
  machines/
  resources/
  vfx/
tests/
  unit/
  integration/
  e2e/
```

---

# Phase 0 - Foundation and Art Spike

## Task 0.1: Bootstrap Git Hygiene and DOX

**Files:**
- Create: `.gitignore`
- Create: `AGENTS.md`
- Create: child `AGENTS.md` files under durable directories after those directories exist
- Modify: `docs/superpowers/specs/2026-09-25-factor-y-design.md` only if the DOX contract requires a project-specific clarification

**Interfaces:**
- Consumes: the approved design document and the official DOX contract.
- Produces: a repository with ignored build/install artifacts, a root DOX index, and local contracts for future source, asset, test, and documentation boundaries.

- [ ] **Step 1: Create the ignore rules**

Write `.gitignore` with these exact entries:

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
.vite/
.DS_Store
*.local
.env
.env.*
!.env.example
.superpowers/
```

- [ ] **Step 2: Run the DOX initializer**

Run the official initializer from the `dox-init` skill against `/Users/saiduttaabhishekdash/factorI`. Preserve any existing DOX customization. The root file must contain the direct-child index, and each durable child file must use the six standard DOX sections.

- [ ] **Step 3: Verify the tree**

Run:

```bash
git status --short
```

Confirm that only `.gitignore`, `AGENTS.md` files, and the approved design/plan documentation are uncommitted. Confirm that `node_modules`, build output, and temporary files are ignored.

- [ ] **Step 4: Commit**

```bash
git add .gitignore AGENTS.md docs/superpowers/specs/2026-09-25-factor-y-design.md docs/superpowers/plans/2026-09-25-factor-y-implementation.md
git commit -m "chore: initialize Factor-Y repository and DOX tree"
```

## Task 0.2: Create the Vite/React/Phaser Toolchain

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `eslint.config.js`
- Create: `playwright.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/GameCanvas.tsx`
- Create: `tests/setup.ts`

**Interfaces:**
- Consumes: Node 26.8.1 and npm 11.19.0.
- Produces: `npm run dev`, `npm run build`, `npm run test`, `npm run test:e2e`, `npm run lint`, and `npm run typecheck` scripts plus a React root that can later mount a Phaser canvas.

- [ ] **Step 1: Add the package manifest and scripts**

Use the following script contract:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  }
}
```

Install runtime dependencies `phaser`, `react`, and `react-dom`. Install development dependencies `vite`, `typescript`, `@vitejs/plugin-react`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@playwright/test`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `@types/node`, and `@types/react`/`@types/react-dom`.

- [ ] **Step 2: Configure TypeScript, Vite, ESLint, and Playwright**

Configure strict TypeScript, `vite/client` types, the React plugin, a Vitest `jsdom` environment, the `tests/setup.ts` setup file, and a Playwright web server using `npm run dev -- --host 127.0.0.1`. The ESLint flat config must cover `src`, `tests`, and config files without ignoring type information.

- [ ] **Step 3: Add the minimal application shell**

`src/main.tsx` mounts `App` into `#root`. `App` renders an empty `GameCanvas` host and a semantic `main` element. `GameCanvas` exposes a stable `canvasRef` and a `data-testid="game-canvas"` wrapper. The shell must not import simulation or Phaser yet.

- [ ] **Step 4: Verify the toolchain**

Run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Expected: all commands exit 0. The test command may report zero tests until Task 0.3 adds the first test.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts eslint.config.js playwright.config.ts index.html src/main.tsx src/app/App.tsx src/app/GameCanvas.tsx tests/setup.ts
git commit -m "chore: scaffold Factor-Y browser toolchain"
```

## Task 0.3: Define Core Types and Initial State

**Files:**
- Create: `src/sim/types.ts`
- Create: `src/sim/constants.ts`
- Create: `src/sim/initialState.ts`
- Create: `tests/unit/initialState.test.ts`

**Interfaces:**
- Consumes: the domain model in `docs/superpowers/specs/2026-09-25-factor-y-design.md`.
- Produces: `ResourceId`, `MachineType`, `Rotation`, `GridPoint`, `Entity`, `ResourceNode`, `GridState`, `SaveGame`, `SimulationState`, `SimulationSnapshot`, `Notification`, `RenderEvent`, `CommandResult`, `SimulationCommand` including `unlockMachine`, `createInitialState()`, and the constants `GRID_WIDTH`, `GRID_HEIGHT`, `TILE_SIZE_PX`, `TICKS_PER_SECOND`, `TICK_MS`, `STARTING_CURRENCY`, and `SAVE_KEY`.

- [ ] **Step 1: Write the failing initial-state test**

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { GRID_HEIGHT, GRID_WIDTH, STARTING_CURRENCY, TILE_SIZE_PX } from "../../src/sim/constants";

 describe("createInitialState", () => {
  it("creates a renewable 64 by 64 world with the starting economy", () => {
    const state = createInitialState();

    expect(state.version).toBe(1);
    expect(state.grid.width).toBe(GRID_WIDTH);
    expect(state.grid.height).toBe(GRID_HEIGHT);
    expect(state.grid.tileSizePx).toBe(TILE_SIZE_PX);
    expect(state.currency).toBe(STARTING_CURRENCY);
    expect(state.grid.entities).toHaveLength(0);
    expect(state.unlocked.machines).toEqual(["extractor", "belt", "depot"]);
    expect(state.unlocked.recipes).toEqual([]);
  });

  it("creates resource nodes without overlapping coordinates", () => {
    const state = createInitialState();
    const coordinates = state.grid.nodes.map((node) => `${node.x},${node.y}`);

    expect(new Set(coordinates).size).toBe(coordinates.length);
    expect(state.grid.nodes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify red**

Run:

```bash
npm run test -- tests/unit/initialState.test.ts
```

Expected: FAIL because `src/sim/initialState.ts` and the exported constants do not exist.

- [ ] **Step 3: Implement the minimal types and state**

Copy the exact domain interfaces from the design document. `createInitialState(seed = 1337)` must create 16 non-overlapping nodes in the central 48 by 48 region, with at least one node for each of `copperOre`, `ironOre`, `coal`, and `stone`. Nodes are renewable and do not contain a depletion counter. `SimulationState` includes `nextEntitySequence: 1`, `pendingRotation: 0`, and an empty notification list.

- [ ] **Step 4: Run the focused and full tests**

Run:

```bash
npm run test -- tests/unit/initialState.test.ts
npm run test
```

Expected: the focused test and the full suite pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/types.ts src/sim/constants.ts src/sim/initialState.ts tests/unit/initialState.test.ts
git commit -m "feat: define simulation state and initial world"
```

## Task 0.4: Implement Grid and Rotation Math

**Files:**
- Create: `src/sim/grid.ts`
- Create: `src/sim/rotation.ts`
- Create: `tests/unit/grid.test.ts`
- Create: `tests/unit/rotation.test.ts`

**Interfaces:**
- Consumes: `GridPoint`, `Rotation`, `GRID_WIDTH`, `GRID_HEIGHT`, and `TILE_SIZE_PX`.
- Produces: `isInsideGrid(point, width, height)`, `cellToWorld(point, tileSizePx)`, `worldToCell(worldPoint, tileSizePx)`, `rotatePoint(point, rotation)`, `rotateGridPoint(point, rotation)`, and `nextRotation(rotation)`.

- [ ] **Step 1: Write failing coordinate and rotation tests**

```ts
import { describe, expect, it } from "vitest";
import { cellToWorld, isInsideGrid, worldToCell } from "../../src/sim/grid";
import { nextRotation, rotateGridPoint } from "../../src/sim/rotation";

describe("grid coordinates", () => {
  it("converts between cells and world pixels at 64 pixels per tile", () => {
    expect(cellToWorld({ x: 3, y: 4 }, 64)).toEqual({ x: 192, y: 256 });
    expect(worldToCell({ x: 255, y: 319 }, 64)).toEqual({ x: 3, y: 4 });
  });

  it("rejects coordinates on the outer boundary", () => {
    expect(isInsideGrid({ x: 64, y: 0 }, 64, 64)).toBe(false);
    expect(isInsideGrid({ x: 63, y: 63 }, 64, 64)).toBe(true);
  });
});

describe("rotation", () => {
  it("rotates local grid points clockwise in 90 degree increments", () => {
    expect(rotateGridPoint({ x: 0, y: -1 }, 90)).toEqual({ x: 1, y: 0 });
    expect(rotateGridPoint({ x: 1, y: 0 }, 270)).toEqual({ x: 0, y: -1 });
  });

  it("cycles through all four rotations", () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(270)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify red**

Run:

```bash
npm run test -- tests/unit/grid.test.ts tests/unit/rotation.test.ts
```

Expected: FAIL because the grid and rotation modules are missing.

- [ ] **Step 3: Implement the pure math**

Use `Math.floor(worldPoint.x / tileSizePx)` and `Math.floor(worldPoint.y / tileSizePx)`. Rotate local points with the integer transform `(x, y) -> (-y, x)` for each 90-degree step. Reject non-finite coordinates by returning `false` from `isInsideGrid` and by throwing a `TypeError` from coordinate conversion.

- [ ] **Step 4: Run focused and full tests**

```bash
npm run test -- tests/unit/grid.test.ts tests/unit/rotation.test.ts
npm run test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/grid.ts src/sim/rotation.ts tests/unit/grid.test.ts tests/unit/rotation.test.ts
git commit -m "feat: add grid and rotation math"
```

## Task 0.5: Add the Fixed-Step Clock and Snapshot Store

**Files:**
- Create: `src/sim/clock.ts`
- Create: `src/sim/snapshot.ts`
- Create: `src/sim/store.ts`
- Create: `src/sim/tick.ts`
- Create: `tests/unit/clock.test.ts`
- Create: `tests/unit/tick.test.ts`
- Create: `tests/integration/store.test.ts`

**Interfaces:**
- Consumes: `SimulationState`, `SimulationCommand`, `SimulationSnapshot`, `CommandResult`, `TICK_MS`, and `PRESTIGE_THRESHOLD`.
- Produces: `FixedStepClock`, `createSnapshot(state)`, `advanceSimulation(state, tickCount)`, and `SimulationStore` with `getSnapshot()`, `subscribe(listener)`, `dispatch(command)`, `start()`, `stop()`, and `advanceTicks(count)`.

- [ ] **Step 1: Write failing clock and subscription tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { FixedStepClock } from "../../src/sim/clock";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import { advanceSimulation } from "../../src/sim/tick";

describe("FixedStepClock", () => {
  it("runs no more than one logical tick before 100 ms", () => {
    const tick = vi.fn();
    const now = vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(99);
    const clock = new FixedStepClock(100, tick, now);

    clock.advance();

    expect(tick).not.toHaveBeenCalled();
  });

  it("runs one tick at 100 ms and carries the remainder", () => {
    const tick = vi.fn();
    const now = vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(250);
    const clock = new FixedStepClock(100, tick, now);

    clock.advance();

    expect(tick).toHaveBeenCalledTimes(2);
  });
});

describe("advanceSimulation", () => {
  it("returns the same state until machine behavior is added", () => {
    const state = createInitialState();

    expect(advanceSimulation(state, 1)).toBe(state);
  });
});

describe("SimulationStore", () => {
  it("returns the same immutable snapshot until state changes", () => {
    const store = new SimulationStore(createInitialState());
    const first = store.getSnapshot();
    const second = store.getSnapshot();

    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("notifies subscribers after a successful command", () => {
    const store = new SimulationStore(createInitialState());
    const listener = vi.fn();
    store.subscribe(listener);

    const result = store.dispatch({ type: "setPlacementMode", machine: "extractor" });

    expect(result.ok).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify red**

```bash
npm run test -- tests/unit/clock.test.ts tests/unit/tick.test.ts tests/integration/store.test.ts
```

Expected: FAIL because the clock, tick, and store modules are missing.

- [ ] **Step 3: Implement the clock and store contracts**

`FixedStepClock` accepts `tickMs`, `onTick`, and an injected `now` function. It carries elapsed time and caps catch-up at 120 ticks per call, discarding whole-tick backlog beyond the cap while retaining the sub-tick remainder. `createSnapshot` returns a frozen object containing the fields in `SimulationSnapshot`, with `prestigeReady` derived from `state.lifetimeCurrency >= PRESTIGE_THRESHOLD`. `PRESTIGE_THRESHOLD` is the shared `100_000` lifetime-currency gate used by Phase 3. `advanceSimulation(state, tickCount)` is a pure seam that returns the same state until machine behavior is introduced in Phase 1. `SimulationStore` keeps the current state private, returns a cached frozen snapshot, dispatches commands through a command handler, and publishes only after a successful state mutation. `advanceTicks` is the only method that calls the injected or default pure tick function.

- [ ] **Step 4: Verify red-to-green and full tests**

```bash
npm run test -- tests/unit/clock.test.ts tests/unit/tick.test.ts tests/integration/store.test.ts
npm run test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/clock.ts src/sim/snapshot.ts src/sim/store.ts src/sim/tick.ts tests/unit/clock.test.ts tests/unit/tick.test.ts tests/integration/store.test.ts
git commit -m "feat: add fixed-step simulation store"
```

## Task 0.6: Define Content Tables and Validation

**Files:**
- Create: `src/content/types.ts`
- Create: `src/content/freeze.ts`
- Create: `src/content/resources.ts`
- Create: `src/content/machines.ts`
- Create: `src/content/recipes.ts`
- Create: `src/content/unlocks.ts`
- Create: `src/content/validation.ts`
- Modify: `src/sim/types.ts`
- Modify: `docs/superpowers/specs/2026-09-25-factor-y-design.md`
- Modify: `docs/superpowers/plans/2026-09-25-factor-y-implementation.md`
- Create: `tests/unit/content.test.ts`

**Interfaces:**
- Consumes: the exact resource, machine, recipe, cost, and unlock values in the design document.
- Produces: canonical `ResourceId`, `MachineType`, `RecipeId`, `ResourceTier`, `ResourceDefinition`, `GridPoint`, `PortDefinition`, `MachineDefinition`, `RecipeDefinition`, and `UnlockTable` types, a typed recursive `deepFreeze` helper, deeply frozen `RESOURCES`, `MACHINES`, `RECIPES`, and `UNLOCKS`, `getResource(id)`, `getMachine(type)`, `getRecipe(id)`, and a total `validateContent(input: unknown)` that returns human-readable errors.

- [ ] **Step 1: Write failing content-integrity tests**

```ts
import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { RECIPES } from "../../src/content/recipes";
import { RESOURCES } from "../../src/content/resources";

describe("Factor-Y content tables", () => {
  it("defines all thirteen resources, six machines, and nine recipes", () => {
    expect(Object.keys(RESOURCES)).toHaveLength(13);
    expect(Object.keys(MACHINES)).toHaveLength(6);
    expect(Object.keys(RECIPES)).toHaveLength(9);
  });

  it("defines every recipe input as a declared resource", () => {
    for (const recipe of Object.values(RECIPES)) {
      for (const resource of Object.keys(recipe.inputs)) {
        expect(RESOURCES).toHaveProperty(resource);
      }
      expect(RESOURCES).toHaveProperty(recipe.output.resource);
    }
  });

  it("uses unique machine and recipe identifiers", () => {
    expect(new Set(Object.keys(MACHINES)).size).toBe(6);
    expect(new Set(Object.keys(RECIPES)).size).toBe(9);
  });
});
```

- [ ] **Step 2: Run the test to verify red**

```bash
npm run test -- tests/unit/content.test.ts
```

Expected: FAIL because the content modules are missing.

- [ ] **Step 3: Implement the data tables**

Populate all IDs and values from the design document. Move shared content contracts into `src/content/types.ts` and re-export them from `src/sim/types.ts` so there is one source of truth. `src/content/freeze.ts` recursively freezes tables and nested arrays/objects at module initialization. Smelters use one mixed input buffer and their input port accepts all raw resources needed by their recipes; assemblers use two input ports. Silo definitions declare `bufferMode: "shared"` and `storageCapacity: 100`, while other machines use separate buffers. `defaultProcessTicks` is the machine fallback; a selected recipe's `durationTicks` is authoritative. `validateContent(input: unknown)` checks shape before reading fields, canonical resource/recipe ID sets, all cross-references, exact initial unlock consistency, port compatibility, and nested table immutability without throwing.

- [ ] **Step 4: Verify content and full tests**

```bash
npm run test -- tests/unit/content.test.ts
npm run test
npm run lint
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/types.ts src/content/freeze.ts src/content/resources.ts src/content/machines.ts src/content/recipes.ts src/content/unlocks.ts src/content/validation.ts src/sim/types.ts docs/superpowers/specs/2026-09-25-factor-y-design.md docs/superpowers/plans/2026-09-25-factor-y-implementation.md tests/unit/content.test.ts
git commit -m "feat: define Factor-Y content tables"
```

## Task 0.7: Create the Custom Asset Manifest and First Art Spike

**Files:**
- Create: `public/assets/tiles/floor.svg`
- Create: `public/assets/machines/extractor-idle.svg`
- Create: `public/assets/machines/extractor-active.svg`
- Create: `public/assets/machines/extractor-active-1.svg`
- Create: `public/assets/machines/belt.svg`
- Create: `public/assets/resources/copper-ore.svg`
- Create: `public/assets/resources/iron-ore.svg`
- Create: `public/assets/vfx/spark.svg`
- Create: `src/content/assetManifest.ts`
- Create: `tests/unit/assetManifest.test.ts`

**Interfaces:**
- Consumes: the locked 64 by 64 art direction and machine/resource IDs.
- Produces: `ASSET_MANIFEST`, `getAssetPath(key)`, `getAssetPaths(key)`, and the first valid custom machine, belt, resource, tile, and spark assets with separate static active frames.

- [ ] **Step 1: Write the failing manifest test**

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSET_MANIFEST, getAssetPath, getAssetPaths } from "../../src/content/assetManifest";

describe("asset manifest", () => {
  it("registers real, dimensioned asset files and separate active frames", () => {
    for (const [key, entry] of Object.entries(ASSET_MANIFEST)) {
      for (const path of getAssetPaths(key)) {
        const file = resolve(process.cwd(), "public", path);
        expect(existsSync(file)).toBe(true);
        const svg = readFileSync(file, "utf8");
        expect(svg).toContain(`width="${entry.width}"`);
        expect(svg).toContain(`height="${entry.height}"`);
        expect(svg).toContain(`viewBox="0 0 ${entry.width} ${entry.height}"`);
        expect(svg).not.toContain("<!--");
        expect(svg).not.toMatch(/drop-shadow|feGaussianBlur|<filter/i);
      }
    }

    expect(ASSET_MANIFEST["machine.extractor.active"].frameCount).toBe(2);
    expect(getAssetPaths("machine.extractor.active")).toHaveLength(2);
    expect(getAssetPath("machine.belt.idle")).toMatch(/^assets\/machines\//);
  });
});
```

- [ ] **Step 2: Run the test to verify red**

```bash
npm run test -- tests/unit/assetManifest.test.ts
```

Expected: FAIL because `assetManifest.ts` is missing.

- [ ] **Step 3: Author the first cohesive assets**

Create transparent SVGs with a shared palette of `#101820`, `#263746`, `#4d6875`, `#c98245`, `#e0a458`, `#36c5b5`, and `#f2c14e`. Use top-down geometry, centered anchors, neutral highlights, and no directional drop shadow. The extractor idle/active frames must be separate static SVG files with distinct visible states; the belt must be a readable straight conveyor whose rotation visibly changes its input/output orientation without a baked directional shadow; resource icons must have distinct silhouettes. The manifest must list exact width, height, frame count, and frame path values, and the unit test must read every actual file.

- [ ] **Step 4: Verify assets and full tests**

```bash
npm run test -- tests/unit/assetManifest.test.ts
npm run test
npm run build
```

Expected: PASS and a successful production bundle with the assets copied from `public`.

- [ ] **Step 5: Commit**

```bash
git add public/assets src/content/assetManifest.ts tests/unit/assetManifest.test.ts
git commit -m "feat: add first custom factory art assets"
```

## Task 0.8: Mount the Phaser Scene, Camera, Grid, and Ghost

**Files:**
- Create: `src/phaser/cameraConfig.ts`
- Create: `src/phaser/inputAdapter.ts`
- Create: `public/assets/machines/depot-idle.svg`
- Create: `src/phaser/FactoryScene.ts`
- Create: `src/phaser/createGame.ts`
- Create: `src/phaser/scaleConfig.ts`
- Create: `src/app/runtime.ts`
- Create: `src/sim/placement.ts`
- Create: `src/sim/connections.ts`
- Create: `src/sim/machines.ts`
- Create: `src/sim/economy.ts`
- Modify: `src/app/GameCanvas.tsx`
- Modify: `src/sim/store.ts`
- Modify: `src/sim/tick.ts`
- Create: `tests/unit/cameraConfig.test.ts`
- Create: `tests/unit/scaleConfig.test.ts`
- Create: `tests/unit/phase0Simulation.test.ts`
- Create: `tests/e2e/phase0.spec.ts`

**Interfaces:**
- Consumes: the initial state, grid math, asset manifest, and `SimulationStore`.
- Produces: `createCameraConfig(width, height)`, `createFactoryGame(container, store)`, `FactoryScene`, pointer-to-cell conversion, camera pan/zoom, tilemap rendering, a rotation-aware ghost preview, a stable app runtime/test bridge, and a minimal real Extractor -> Belt -> Depot simulation path.

- [ ] **Step 1: Write failing camera and browser tests**

```ts
import { describe, expect, it } from "vitest";
import { createCameraConfig } from "../../src/phaser/cameraConfig";

describe("camera configuration", () => {
  it("uses a bounded camera with the locked zoom range", () => {
    const config = createCameraConfig(64, 64);

    expect(config.boundsWidth).toBe(64 * 64 + 256);
    expect(config.boundsHeight).toBe(64 * 64 + 256);
    expect(config.minZoom).toBe(0.5);
    expect(config.maxZoom).toBe(2);
  });
});
```

The unit test must build one extractor, one belt, and one depot through the public store command path, advance enough logical ticks for one item to be produced, moved, and sold, assert currency increases, and assert an occupied cell rejects a second entity. The Playwright test must load the app, assert the canvas wrapper, use the stable development/test bridge to dispatch the same commands, verify the currency changes after logical ticks, verify an occupied cell rejects a second placement, exercise camera pan/zoom and rotation, verify the ghost changes validity state, and verify the bridge/runtime is removed after React cleanup.

- [ ] **Step 2: Run the tests to verify red**

```bash
npm run test -- tests/unit/cameraConfig.test.ts tests/unit/phase0Simulation.test.ts
npm run test:e2e -- tests/e2e/phase0.spec.ts
```

Expected: FAIL because the Phaser modules and browser behavior do not exist.

- [ ] **Step 3: Implement the scene**

Create an orthogonal `Tilemap`/`TilemapLayer` using a generated 64 by 64 floor data array, load the first custom assets plus the depot asset, create machine and ghost layers, set camera bounds and zoom, convert pointer coordinates through `camera.getWorldPoint`, dispatch placement commands, rotate with `R`, and support drag plus arrow/WASD panning. Use a fixed 1280 by 720 desktop FIT surface with CENTER_BOTH scaling and a 640 by 360 minimum surface floor for transient or undersized parent dimensions. Create a stable `SimulationStore` runtime in `src/app/runtime.ts`, start/stop it from the React canvas lifecycle only after the scene signals readiness, and expose a development/test bridge that calls only public store methods. Implement the minimal data-driven raw path in `placement.ts`, `connections.ts`, `machines.ts`, `economy.ts`, and `tick.ts`: extractors produce on their configured interval, belts move one item per tick, depots sell delivered resources, placement debits cost and rejects occupied/invalid cells, and the store publishes the resulting snapshot. Use a machine texture for the ghost, hide it before pointer movement, handle `pointerupoutside`, set two active pointers, and report missing machine textures as development errors rather than substituting another machine. `FactoryScene` may read the store and render events but may not call `advanceSimulation` from `update()`.

- [ ] **Step 4: Verify the phase-0 browser path**

```bash
npm run test -- tests/unit/cameraConfig.test.ts tests/unit/phase0Simulation.test.ts
npm run test:e2e -- tests/e2e/phase0.spec.ts
npm run lint
npm run typecheck
npm run build
```

Expected: all commands exit 0, the browser reports no uncaught errors, and currency advances from the independent simulation clock.

- [ ] **Step 5: Commit**

```bash
git add src/phaser/cameraConfig.ts src/phaser/inputAdapter.ts src/phaser/FactoryScene.ts src/phaser/createGame.ts src/phaser/scaleConfig.ts public/assets/machines/depot-idle.svg src/app/runtime.ts src/app/GameCanvas.tsx src/sim/placement.ts src/sim/connections.ts src/sim/machines.ts src/sim/economy.ts src/sim/store.ts src/sim/tick.ts tests/unit/cameraConfig.test.ts tests/unit/scaleConfig.test.ts tests/unit/phase0Simulation.test.ts tests/e2e/phase0.spec.ts
git commit -m "feat: mount Phaser factory scene and raw spike loop"
```

## Phase 0 Exit Check

- [ ] `npm run test` passes.
- [ ] `npm run test:e2e -- tests/e2e/phase0.spec.ts` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] The browser can pan, zoom, place a valid entity, reject an invalid entity, rotate the ghost, and show currency changing independently of Phaser render frames.
- [ ] The first art spike has been manually reviewed for neutral lighting and consistent palette.

## Task 0.9: Adopt the Factor-I Public Name

**Files:**
- Create: `src/content/product.ts`
- Create: `src/ui/components/GameHeader.tsx`
- Modify: `src/app/App.tsx`
- Modify: `index.html`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-09-25-factor-y-design.md`
- Create: `tests/unit/gameHeader.test.tsx`

**Interfaces:**
- Consumes: the approved product identity and the existing React shell.
- Produces: `PRODUCT_NAME = "Factor-I"`, `PRODUCT_SHORT_NAME = "factori"`, a visible accessible game header, browser title/metadata, and a package name of `factor-i`.

- [ ] **Step 1: Write the failing header test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GameHeader } from "../../src/ui/components/GameHeader";
import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from "../../src/content/product";

describe("GameHeader", () => {
  it("shows the public Factor-I name and short label", () => {
    render(<GameHeader />);

    expect(screen.getByRole("heading", { name: PRODUCT_NAME })).toBeVisible();
    expect(screen.getByText(PRODUCT_SHORT_NAME)).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/gameHeader.test.tsx
```

Expected: FAIL because the product constants and header component are missing.

- [ ] **Step 3: Implement the public identity**

Create the exact constants, render a non-interactive header overlay above the canvas, set `index.html` title and description to Factor-I, set the package name to `factor-i`, and update the root DOX user preference plus the design document’s product identity. Keep `factor-y-2d-spec.md`, existing internal IDs, and `factor-y:save` unchanged for compatibility.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/gameHeader.test.tsx
npm run test
npm run test:e2e -- tests/e2e/phase0.spec.ts --workers=1
npm run lint
npm run typecheck
npm run build
```

Expected: all commands pass and the browser visibly renders Factor-I.

- [ ] **Step 5: Commit**

```bash
git add src/content/product.ts src/ui/components/GameHeader.tsx src/app/App.tsx index.html package.json package-lock.json AGENTS.md docs/superpowers/specs/2026-09-25-factor-y-design.md tests/unit/gameHeader.test.tsx
git commit -m "feat: adopt Factor-I public name"
```

---

# Phase 1 - Raw-Resource MVP

## Task 1.1: Implement Placement Validation and Port Rotation

**Files:**
- Modify: `src/sim/placement.ts`
- Modify: `src/sim/connections.ts`
- Create: `tests/unit/placement.test.ts`
- Create: `tests/unit/connections.test.ts`

**Interfaces:**
- Consumes: `Entity`, `MachineDefinition`, `GridState`, `ResourceNode`, `Rotation`, and content tables.
- Produces: `validatePlacement(state, command)`, `rotatePorts(ports, rotation)`, `getWorldPortCells(entity)`, and `arePortsConnected(outputEntity, inputEntity)`.

- [ ] **Step 1: Write failing tests**

Test that an empty cell accepts a belt, an occupied cell rejects a belt, an extractor rejects a non-node cell, an extractor accepts its matching node, a smelter rejects a missing recipe, and only facing output/input ports connect after rotation.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/placement.test.ts tests/unit/connections.test.ts
```

Expected: FAIL because the placement and connection modules are missing.

- [ ] **Step 3: Implement minimal behavior**

Use the same `validatePlacement` function for ghost validity and command dispatch. Return `CommandResult` with stable reason codes `occupied`, `outOfBounds`, `insufficientCurrency`, `missingRecipe`, `missingResourceNode`, and `lockedMachine`.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/placement.test.ts tests/unit/connections.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/placement.ts src/sim/connections.ts tests/unit/placement.test.ts tests/unit/connections.test.ts
git commit -m "feat: validate machine placement and port connections"
```

## Task 1.2: Implement Extractor Production

**Files:**
- Modify: `src/sim/machines.ts`
- Modify: `src/sim/tick.ts`
- Create: `tests/unit/extractor.test.ts`

**Interfaces:**
- Consumes: `advanceSimulation`, `MachineRuntime`, `Entity`, and the extractor definition.
- Produces: `createMachineRuntime(entity)`, `tickExtractor(runtime, entity, state)`, and extractor output in the next belt or machine input buffer.

- [ ] **Step 1: Write failing tests**

Assert that an extractor produces no item before 20 ticks, produces one `copperOre` at tick 20, respects the resource node, and does not mutate unrelated entities.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/extractor.test.ts
```

- [ ] **Step 3: Implement**

Store extractor progress as normalized completed cycles in `MachineRuntime.progressTicks`. Add `effectiveMultiplier / extractor.defaultProcessTicks` on each logical tick, where the effective multiplier combines level and prestige production speed without integer truncation. At 1, produce one unit, subtract one cycle, retain the fractional remainder, reject a full output buffer without advancing progress, preserve runtime identity while already blocked, and emit a machine-state render event when active state changes.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/extractor.test.ts
npm run test
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/machines.ts src/sim/tick.ts tests/unit/extractor.test.ts
git commit -m "feat: add extractor production"
```

## Task 1.3: Implement Belt Movement and Port Transfer

**Files:**
- Modify: `src/sim/tick.ts`
- Modify: `src/sim/connections.ts`
- Create: `tests/unit/belts.test.ts`

**Interfaces:**
- Consumes: `BeltCell`, `Entity`, `getWorldPortCells`, and `arePortsConnected`.
- Produces: `moveBelts(state)`, `depositBeltItems(state)`, and deterministic one-cell-per-tick movement.

- [ ] **Step 1: Write failing tests**

Assert that an item advances one cell per tick, an occupied destination blocks movement, two items cannot cross in one tick, a belt transfers to a compatible input port, and a disconnected belt keeps the item.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/belts.test.ts
```

- [ ] **Step 3: Implement**

Build a `nextOccupancy` map, snapshot all current items, clear occupied source cells, and write each item only when its destination is empty or accepts it. Reset progress on transfer and preserve item type at every hop.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/belts.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/tick.ts src/sim/connections.ts tests/unit/belts.test.ts
git commit -m "feat: move resources along connected belts"
```

## Task 1.4: Implement Shipping and Currency Accounting

**Files:**
- Modify: `src/sim/machines.ts`
- Modify: `src/sim/tick.ts`
- Modify: `src/sim/economy.ts`
- Modify: `src/sim/types.ts`
- Modify: `src/sim/initialState.ts`
- Modify: `src/sim/snapshot.ts`
- Modify: `src/sim/store.ts`
- Create: `tests/unit/economy.test.ts`

**Interfaces:**
- Consumes: `RESOURCES`, depot entities, machine output, and `prestige.permanentMultipliers.sellValue`.
- Produces: `sellResource(resource, amount, state)`, `getCurrencyPerSecond(state)`, a runtime-only 100-tick currency sample window, and `saleCompleted` render events.

- [ ] **Step 1: Write failing tests**

Assert that a depot sells one unit at the base sell value, applies the sell multiplier, adds to lifetime currency, does not sell disconnected raw items, and reports a ten-second rolling currency rate.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/economy.test.ts
```

- [ ] **Step 3: Implement**

Debit the depot input exactly once, compute finite currency using the resource table, update `lifetimeCurrency`, record each sale in a runtime-only sample list keyed by logical tick, prune samples older than the latest 100 ticks, and compute `getCurrencyPerSecond` only after a full ten-second window. Emit the typed sale event with world coordinates. Runtime rate samples must be excluded from the serialized save shape.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/economy.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/machines.ts src/sim/tick.ts src/sim/economy.ts src/sim/types.ts src/sim/initialState.ts src/sim/snapshot.ts src/sim/store.ts tests/unit/economy.test.ts
git commit -m "feat: sell delivered resources for currency"
```

## Task 1.5: Add Save, Load, and Migration Stub

**Files:**
- Create: `src/persistence/save.ts`
- Create: `src/persistence/migrate.ts`
- Create: `tests/unit/persistence.test.ts`

**Interfaces:**
- Consumes: `SaveGame`, `SimulationState`, `SAVE_KEY`, and `createInitialState`.
- Produces: `serializeSave(state)`, `parseSave(raw)`, `loadSave(storage)`, `saveToStorage(storage, state)`, and `migrateSave(raw)`.

- [ ] **Step 1: Write failing tests**

Test JSON round-trip, preservation of entity coordinates and rotation, rejection of unknown versions, recovery from malformed JSON, and the version-1 no-op migration entry.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/persistence.test.ts
```

- [ ] **Step 3: Implement**

Use a storage interface with `getItem` and `setItem` so tests use a fake storage. Validate finite numbers, known IDs, legal rotations, and grid bounds. `migrateSave` dispatches by version and returns the version-1 save unchanged.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/persistence.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/persistence/save.ts src/persistence/migrate.ts tests/unit/persistence.test.ts
git commit -m "feat: add versioned local save and migration"
```

## Task 1.6: Add Offline Throughput and Welcome-Back Summary

**Files:**
- Create: `src/sim/offline.ts`
- Modify: `src/persistence/save.ts`
- Modify: `src/app/runtime.ts`
- Modify: `src/app/GameCanvas.tsx`
- Modify: `src/sim/types.ts`
- Modify: `src/sim/initialState.ts`
- Modify: `src/sim/snapshot.ts`
- Modify: `src/sim/store.ts`
- Create: `tests/unit/offline.test.ts`
- Create: `tests/unit/runtime.test.ts`

**Interfaces:**
- Consumes: `productionChains`, `lastSavedAt`, current time, sell multipliers, and the 12-hour cap.
- Produces: `calculateOfflineProgress(save, now)`, `applyOfflineProgress(state, summary)`, `shouldShowOfflineSummary(summary)`, an explicit `loadSaveWithOfflineResult(storage, now)`, a browser-runtime loader that anchors persisted state, and a runtime-only offline summary in the simulation snapshot.

- [ ] **Step 1: Write failing tests**

Assert zero elapsed time produces no modal, 59 seconds does not show the modal, exactly 60 seconds follows the strict `> 60` contract, 61 seconds does, elapsed time is capped at 43,200 seconds, each chain contributes throughput multiplied by sell value, the result is deterministic, repeated offline loads with unchanged storage do not double-credit, and the browser runtime loads an anchored persisted state.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/offline.test.ts
```

- [ ] **Step 3: Implement**

Compute `elapsedSeconds`, `cappedSeconds`, `earnedCurrency`, and per-resource `chainUnits` without simulating belt items. Treat `NEW_GAME_TIMESTAMP` as zero elapsed, cap at 43,200 seconds, apply currency/lifetime earnings exactly once through the explicit offline-load path, anchor `lastSavedAt` monotonically to the maximum of the saved timestamp and valid current time, persist the anchored state through the injected storage, and retain the summary in runtime state/snapshot until `dismissOfflineSummary`. Wire the browser runtime to this loader, and keep offline summary fields out of the serialized SaveGame projection.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/offline.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/offline.ts src/persistence/save.ts src/app/runtime.ts src/app/GameCanvas.tsx src/sim/types.ts src/sim/initialState.ts src/sim/snapshot.ts src/sim/store.ts tests/unit/offline.test.ts tests/unit/runtime.test.ts
git commit -m "feat: calculate capped offline production"
```

## Task 1.7: Build HUD, Build Dock, Inspector, and Notifications

**Files:**
- Create: `src/ui/hooks/useSimulationSnapshot.ts`
- Create: `src/ui/components/Hud.tsx`
- Create: `src/ui/components/BuildDock.tsx`
- Create: `src/ui/components/EntityInspector.tsx`
- Create: `src/ui/components/NotificationStack.tsx`
- Create: `src/ui/components/OfflineSummaryModal.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/GameCanvas.tsx`
- Modify: `src/app/runtime.ts`
- Create: `tests/unit/hud.test.tsx`
- Create: `tests/unit/buildDock.test.tsx`

**Interfaces:**
- Consumes: `SimulationStore`, `SimulationSnapshot`, and UI command types.
- Produces: a React overlay with currency, rate, prestige status, machine selection, selection details, rotate/demolish/upgrade controls, notification display, and offline modal, all subscribed to the same `SimulationStore` instance as Phaser.

- [ ] **Step 1: Write failing component tests**

Render a store snapshot and assert the HUD displays currency and rate, the build dock disables locked machines, selecting a machine dispatches `setPlacementMode`, rotate dispatches `rotatePlacement`, demolish dispatches `demolishEntity`, and the offline modal renders the summary.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/hud.test.tsx tests/unit/buildDock.test.tsx
```

- [ ] **Step 3: Implement**

Use `useSyncExternalStore` with a stable store subscription. Keep all simulation math outside React. Use `data-testid` attributes for stable browser and unit selectors. Scope overlay `pointer-events` so the canvas remains draggable outside controls.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/hud.test.tsx tests/unit/buildDock.test.tsx
npm run test
npm run lint
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useSimulationSnapshot.ts src/ui/components/BuildDock.tsx src/ui/components/EntityInspector.tsx src/ui/components/Hud.tsx src/ui/components/NotificationStack.tsx src/ui/components/OfflineSummaryModal.tsx src/app/App.tsx src/app/GameCanvas.tsx src/app/runtime.ts tests/unit/hud.test.tsx tests/unit/buildDock.test.tsx
git commit -m "feat: add core React HUD and build controls"
```

## Task 1.8: Add Raw MVP Art and Browser Flow

**Files:**
**Files:**
- Create/modify: `public/assets/machines/extractor-*.svg`
- Create/modify: `public/assets/machines/belt-*.svg`
- Create/modify: `public/assets/machines/depot-*.svg`
- Create/modify: `public/assets/resources/copper-ore.svg`
- Create/modify: `public/assets/resources/iron-ore.svg`
- Modify: `src/content/assetManifest.ts`
- Modify: `src/sim/types.ts`
- Modify: `src/sim/tick.ts`
- Modify: `src/sim/store.ts`
- Modify: `src/app/runtime.ts`
- Modify: `src/app/GameCanvas.tsx`
- Modify: `src/phaser/FactoryScene.ts`
- Create: `src/phaser/render/BeltItemRenderer.ts`
- Create: `tests/e2e/raw-loop.spec.ts`

**Interfaces:**
- Consumes: the machine/resource manifest, Phaser renderer, and the raw simulation loop.
- Produces: distinct idle/active sprites for all three raw machines, resource item glow rendering, autosaved browser state, and a browser flow that builds Extractor -> Belt -> Depot, reloads, and observes currency.

- [ ] **Step 1: Write the failing browser test**

Start with a cleared save, place a copper extractor on a deterministic copper node, place a right-facing belt, place a depot at the belt output, advance the simulation clock, assert the HUD currency is greater than the starting value, reload, and assert the chain and currency persist. Repeat for iron ore. Assert active machine frame keys and belt item glow render events through the browser flow.

- [ ] **Step 2: Verify red**

```bash
npm run test:e2e -- tests/e2e/raw-loop.spec.ts
```

- [ ] **Step 3: Implement art and renderer wiring**

Add all required raw-loop machine idle/active frames and two raw resource icons using the existing palette and neutral lighting. Register every key, load active frames, emit a typed belt-item-changed render event from the simulation tick, render resource icons with additive glow, and connect the simulation command path to the scene. Add a browser-runtime autosave that projects the store to SaveGame, updates `lastSavedAt`, and writes through the injected storage on state changes. Keep production simulation ownership in the store.

- [ ] **Step 4: Verify green**

```bash
npm run test:e2e -- tests/e2e/raw-loop.spec.ts
npm run test
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add public/assets src/content/assetManifest.ts src/sim/types.ts src/sim/tick.ts src/sim/store.ts src/app/runtime.ts src/app/GameCanvas.tsx src/phaser tests/e2e/raw-loop.spec.ts
git commit -m "feat: deliver raw resource MVP loop"
```

## Phase 1 Exit Check

- [ ] A fresh player can place Extractor, Belt, and Shipping Depot with the starting currency.
- [ ] Copper and Iron Ore can be extracted, routed, sold, and observed in the HUD.
- [ ] Save/reload preserves entities and currency.
- [ ] Offline progress is capped and shown only after 60 seconds.
- [ ] All raw-loop machine and resource art is registered, animated, and visually reviewed.
- [ ] Phase 1 unit, component, browser, lint, typecheck, and build checks pass.

---

# Phase 2 - Full Production Chain

## Task 2.1: Implement Recipe-Aware Smelters

**Files:**
- Modify: `src/sim/machines.ts`
- Modify: `src/sim/tick.ts`
- Create: `tests/unit/smelter.test.ts`

**Interfaces:**
- Consumes: `RECIPES`, `Entity.recipeId`, machine input/output buffers, and recipe durations.
- Produces: `canRunRecipe(runtime, recipe)`, `consumeRecipeInputs(runtime, recipe)`, and `completeRecipe(runtime, recipe)`.

- [ ] **Step 1: Write failing tests**

Test all three recipes, insufficient inputs, full output buffers, exact input consumption, exact output amount, and recipe duration.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/smelter.test.ts
```

- [ ] **Step 3: Implement**

Require a valid unlocked recipe, consume inputs atomically at recipe start, increment progress once per tick, and emit output only when the output buffer has capacity.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/smelter.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/machines.ts src/sim/tick.ts tests/unit/smelter.test.ts
git commit -m "feat: add recipe-aware smelters"
```

## Task 2.2: Implement Assembler Multi-Input Production

**Files:**
- Modify: `src/sim/machines.ts`
- Modify: `src/sim/tick.ts`
- Create: `tests/unit/assembler.test.ts`

**Interfaces:**
- Consumes: two input ports, assembler recipes, and buffer capacity.
- Produces: multi-input recipe execution for Wire, Gear, Plate, Circuit, Frame, and Motor.

- [ ] **Step 1: Write failing tests**

Assert each assembler recipe consumes exact quantities, produces one output unit, waits for all inputs, and does not partially consume a recipe when one input is missing.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/assembler.test.ts
```

- [ ] **Step 3: Implement**

Validate all recipe inputs before consumption, support two input offsets rotated with the entity, and use the same progress/output pipeline as smelters.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/assembler.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/machines.ts src/sim/tick.ts tests/unit/assembler.test.ts
git commit -m "feat: add multi-input assemblers"
```

## Task 2.3: Add Storage Silo and Backpressure

**Files:**
- Modify: `src/sim/machines.ts`
- Modify: `src/sim/tick.ts`
- Create: `tests/unit/silo.test.ts`

**Interfaces:**
- Consumes: any-resource input port, one buffered resource type, and 100-unit capacity.
- Produces: `SiloRuntime` behavior, storage-full notifications, and deterministic downstream stalls.

- [ ] **Step 1: Write failing tests**

Test acceptance of any resource, first-type locking, capacity 100, rejection of a different resource while occupied, preservation of buffered output, and a storage-full notification.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/silo.test.ts
```

- [ ] **Step 3: Implement**

Track `bufferedResource` in machine runtime, reject incompatible input, block production when full, and retain the item at the upstream belt when the silo cannot accept it.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/silo.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/machines.ts src/sim/tick.ts tests/unit/silo.test.ts
git commit -m "feat: add storage buffering and backpressure"
```

## Task 2.4: Add Recipe and Machine Unlock Purchases

**Files:**
- Create: `src/content/unlocks.ts`
- Create: `src/sim/commands.ts`
- Modify: `src/sim/store.ts`
- Create: `tests/unit/unlocks.test.ts`

**Interfaces:**
- Consumes: `UNLOCKS`, `currency`, `unlocked.machines`, and `unlocked.recipes`.
- Produces: `unlockRecipe`, `unlockMachine`, and `canUnlock` command handlers with insufficient-currency and prerequisite errors.

- [ ] **Step 1: Write failing tests**

Assert a locked recipe cannot be placed, a successful purchase debits currency once, a second purchase is rejected, prerequisites are enforced, and a machine unlock adds the exact machine ID once.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/unlocks.test.ts
```

- [ ] **Step 3: Implement**

Validate cost and prerequisites before mutation. Emit a success notification and a fresh immutable snapshot only after the debit and unlock are committed together.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/unlocks.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/content/unlocks.ts src/sim/commands.ts src/sim/store.ts tests/unit/unlocks.test.ts
git commit -m "feat: add machine and recipe unlocks"
```

## Task 2.5: Add Machine Speed and Output Upgrades

**Files:**
- Modify: `src/sim/machines.ts`
- Modify: `src/sim/commands.ts`
- Modify: `src/content/machines.ts`
- Create: `tests/unit/upgrades.test.ts`

**Interfaces:**
- Consumes: selected `Entity`, level, upgrade cost table, and permanent production multiplier.
- Produces: `getUpgradeCost(entity)`, `upgradeEntity(state, entityId)`, and level-adjusted extraction/process/output rates.

- [ ] **Step 1: Write failing tests**

Assert upgrade cost increases by level, insufficient currency does not mutate state, level two increases extractor rate, processor duration decreases, and output capacity increases.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/upgrades.test.ts
```

- [ ] **Step 3: Implement**

Use the table-driven formula `baseCost * level * level`. Keep the old rate and capacity in regression tests so the upgrade path is explicit.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/upgrades.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/machines.ts src/sim/commands.ts src/content/machines.ts tests/unit/upgrades.test.ts
git commit -m "feat: add machine speed and output upgrades"
```

## Task 2.6: Compute Production Chains and Throughput

**Files:**
- Create: `src/sim/chains.ts`
- Modify: `src/persistence/save.ts`
- Create: `tests/unit/chains.test.ts`

**Interfaces:**
- Consumes: the connected machine graph and recent output samples.
- Produces: `analyzeProductionChains(state)`, `getSteadyStateThroughput(state)`, and serialized `productionChains` entries.

- [ ] **Step 1: Write failing tests**

Test an unconnected chain has zero throughput, an extractor-belt-depot chain reports a positive rate, two branches remain distinct, and repeated analysis of the same state returns the same values.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/chains.test.ts
```

- [ ] **Step 3: Implement**

Traverse only valid directed port connections, identify terminal sale outputs, and calculate throughput from the rolling ten-second production window. Store only chain summaries in saves, not item positions.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/chains.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/chains.ts src/persistence/save.ts tests/unit/chains.test.ts
git commit -m "feat: analyze production chain throughput"
```

## Task 2.7: Build the Tech Tree UI

**Files:**
- Create: `src/ui/components/TechTree.tsx`
- Modify: `src/app/App.tsx`
- Create: `tests/unit/techTree.test.tsx`

**Interfaces:**
- Consumes: `UNLOCKS`, snapshot unlock lists, and unlock commands.
- Produces: a modal/panel showing machine/recipe costs, prerequisites, locked/unlocked states, and purchase buttons.

- [ ] **Step 1: Write failing component tests**

Assert locked entries show their cost, affordable entries dispatch the exact unlock command, unaffordable entries are disabled, and unlocked entries cannot be purchased again.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/techTree.test.tsx
```

- [ ] **Step 3: Implement**

Render from content data, not a hardcoded JSX list. Keep modal focus and keyboard dismissal behavior local to the React component.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/techTree.test.tsx
npm run test
npm run lint
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/TechTree.tsx src/app/App.tsx tests/unit/techTree.test.tsx
git commit -m "feat: add recipe and machine tech tree"
```

## Task 2.8: Deliver Full Chain Art and Browser Tests

**Files:**
- Create/modify: all remaining files under `public/assets/machines`, `public/assets/resources`, and `public/assets/vfx`
- Modify: `src/content/assetManifest.ts`
- Create: `tests/e2e/production-chain.spec.ts`

**Interfaces:**
- Consumes: all machine and resource IDs, animation manifest, and Phase 2 simulation commands.
- Produces: distinct idle/active art for six machines, all thirteen resource icons, and a browser test that builds a Motor chain.

- [ ] **Step 1: Write the failing browser test**

Build the complete `Copper Ore -> Copper Ingot -> Wire` and `Iron Ore + Coal -> Iron Ingot -> Gear -> Circuit` paths, connect Plate/Frame/Motor production, rotate each processor, and assert the final depot receives the expected resource.

- [ ] **Step 2: Verify red**

```bash
npm run test:e2e -- tests/e2e/production-chain.spec.ts
```

- [ ] **Step 3: Implement art and renderer states**

Use the same palette and geometry language as Phase 0/1. Every machine gets idle and active frames, every resource gets a distinct icon, and all keys are registered with exact dimensions and frame counts. Add manual art review notes to the task report.

- [ ] **Step 4: Verify green**

```bash
npm run test:e2e -- tests/e2e/production-chain.spec.ts
npm run test
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add public/assets src/content/assetManifest.ts src/phaser tests/e2e/production-chain.spec.ts
git commit -m "feat: deliver full production chain content"
```

## Phase 2 Exit Check

- [ ] All nine recipes run through data-defined machine definitions.
- [ ] Every required machine and resource has registered, readable, animated art.
- [ ] Storage and belt backpressure are deterministic and tested.
- [ ] Unlock costs, prerequisites, and upgrades are enforced through commands.
- [ ] The Motor chain is playable in a browser flow.
- [ ] Chain throughput is computed and serialized for offline progress.
- [ ] Phase 2 unit, component, browser, lint, typecheck, and build checks pass.

---

# Phase 3 - Prestige and Expansion

## Task 3.1: Implement Prestige Eligibility and Points

**Files:**
- Create: `src/sim/prestige.ts`
- Create: `tests/unit/prestige.test.ts`

**Interfaces:**
- Consumes: `lifetimeCurrency`, `prestige.points`, the balance configuration, and the shared `PRESTIGE_THRESHOLD = 100_000`.
- Produces: `calculatePrestigePoints(lifetimeCurrency)` and `canPrestige(state)`, using the shared threshold.

- [ ] **Step 1: Write failing tests**

Assert zero lifetime currency is ineligible, the exact threshold is eligible, points are monotonic, and the same lifetime value always produces the same points.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/prestige.test.ts
```

- [ ] **Step 3: Implement**

Use `floor(sqrt(lifetimeCurrency / 100000))` for the first points curve, with the shared `PRESTIGE_THRESHOLD` constant set to 100,000 lifetime currency. Reject negative or non-finite values.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/prestige.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/prestige.ts tests/unit/prestige.test.ts
git commit -m "feat: add prestige eligibility and points"
```

## Task 3.2: Implement Prestige Reset and Permanent Multipliers

**Files:**
- Modify: `src/sim/commands.ts`
- Modify: `src/sim/store.ts`
- Modify: `src/sim/initialState.ts`
- Create: `tests/integration/prestigeReset.test.ts`

**Interfaces:**
- Consumes: `prestige.points`, `totalPrestiges`, permanent multipliers, entities, unlocks, and currency.
- Produces: `performPrestige(state)` and `getPermanentMultipliers(state)`.

- [ ] **Step 1: Write failing tests**

Assert an ineligible reset is rejected, currency/grid entities are cleared, permanent points and total prestige count increase, base unlocks are restored, and production/sell multipliers increase by the configured amount.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/integration/prestigeReset.test.ts
```

- [ ] **Step 3: Implement**

Construct the reset state from a fresh initial world, copy only permanent prestige fields, apply the point reward once, and serialize the reset state immediately.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/integration/prestigeReset.test.ts
npm run test
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/commands.ts src/sim/store.ts src/sim/initialState.ts tests/integration/prestigeReset.test.ts
git commit -m "feat: implement prestige reset loop"
```

## Task 3.3: Add Grid Expansion and Camera Bounds

**Files:**
- Modify: `src/sim/commands.ts`
- Modify: `src/sim/grid.ts`
- Modify: `src/phaser/cameraConfig.ts`
- Modify: `src/phaser/FactoryScene.ts`
- Create: `tests/unit/expansion.test.ts`

**Interfaces:**
- Consumes: `expandGrid(width, height)`, the current grid, the expansion unlock, and camera bounds.
- Produces: validated larger-grid state, updated tilemap dimensions, and updated camera bounds without deleting existing entities.

- [ ] **Step 1: Write failing tests**

Assert expansion rejects shrinking, non-multiples of the tile grid, locked expansion, and out-of-range dimensions. Assert valid expansion preserves existing entities and updates width/height.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/expansion.test.ts
```

- [ ] **Step 3: Implement**

Expand only upward/rightward from the current origin, validate every existing entity against the new bounds, rebuild the tilemap, and call `camera.setBounds` with the new dimensions.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/expansion.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/commands.ts src/sim/grid.ts src/phaser/cameraConfig.ts src/phaser/FactoryScene.ts tests/unit/expansion.test.ts
git commit -m "feat: add grid expansion"
```

## Task 3.4: Add Prestige UI and Balance Scenarios

**Files:**
- Modify: `src/ui/components/Hud.tsx`
- Create: `src/ui/components/PrestigeModal.tsx`
- Create: `src/content/balance.ts`
- Create: `tests/unit/balance.test.ts`
- Create: `tests/e2e/prestige.spec.ts`

**Interfaces:**
- Consumes: `prestigeReady`, points, current multipliers, and balance scenario fixtures.
- Produces: a prestige confirmation modal, disabled/enabled button state, and repeatable economic scenario assertions.

- [ ] **Step 1: Write failing tests**

Assert the button is disabled below threshold, opens confirmation at threshold, previews the new permanent multipliers, performs one reset, and shows a new-run HUD. Balance tests assert Tier 3 value is greater than Tier 2 and raw values remain low.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/balance.test.ts
npm run test:e2e -- tests/e2e/prestige.spec.ts
```

- [ ] **Step 3: Implement**

Move numeric balance values into `balance.ts`, keep sell values in resource data linked to the balance module, and render the modal from the store snapshot.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/balance.test.ts
npm run test:e2e -- tests/e2e/prestige.spec.ts
npm run test
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Hud.tsx src/ui/components/PrestigeModal.tsx src/content/balance.ts tests/unit/balance.test.ts tests/e2e/prestige.spec.ts
git commit -m "feat: add prestige UI and balance scenarios"
```

## Task 3.5: Verify Save Migration Across Prestige and Expansion

**Files:**
- Modify: `src/persistence/migrate.ts`
- Modify: `src/persistence/save.ts`
- Create: `tests/unit/migration.test.ts`

**Interfaces:**
- Consumes: versioned save fixtures for base, post-prestige, and expanded-grid states.
- Produces: explicit migration functions that preserve permanent fields and expand bounds.

- [ ] **Step 1: Write failing migration fixtures**

Create valid fixture objects representing version 1 and test that a future version 2 migration adds the expanded grid field, preserves prestige multipliers, and rejects unsupported version 3.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/migration.test.ts
```

- [ ] **Step 3: Implement migration steps**

Use a registry keyed by source version. Each migration receives a validated unknown-shape input and returns a `SaveGame`; no migration mutates the original object.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/migration.test.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/persistence/migrate.ts src/persistence/save.ts tests/unit/migration.test.ts
git commit -m "feat: preserve saves across progression migrations"
```

## Phase 3 Exit Check

- [ ] Prestige threshold, points, reset, and permanent multipliers work end to end.
- [ ] Grid expansion preserves existing entities and updates camera bounds.
- [ ] Save migration preserves permanent progression.
- [ ] Balance scenarios cover all resource tiers.
- [ ] Prestige browser flow passes.
- [ ] Phase 3 unit, integration, browser, lint, typecheck, and build checks pass.

---

# Phase 4 - VFX, Performance, and Release Polish

## Task 4.1: Add Render Events and Machine Animations

**Files:**
- Create: `src/phaser/render/EntityRenderer.ts`
- Create: `src/phaser/render/BeltItemRenderer.ts`
- Modify: `src/phaser/FactoryScene.ts`
- Create: `tests/unit/renderEvents.test.ts`
- Create: `tests/e2e/animation-state.spec.ts`

**Interfaces:**
- Consumes: `RenderEvent`, asset manifest, machine runtime active flags, and resource item positions.
- Produces: placement/removal sync, idle/active animation switching, item icon placement, and resource-colored glow sprites.

- [ ] **Step 1: Write failing tests**

Assert an extractor switches to active frames only while producing, a belt item follows its cell, a resource icon changes when item type changes, and an entity removal disposes its sprite without affecting neighbors.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/renderEvents.test.ts
npm run test:e2e -- tests/e2e/animation-state.spec.ts
```

- [ ] **Step 3: Implement**

Keep a `Map<entityId, Phaser.GameObjects.Sprite>` in the scene. Consume render events from the store, reuse sprite objects for unchanged entities, and use `setAngle` for rotations.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/renderEvents.test.ts
npm run test:e2e -- tests/e2e/animation-state.spec.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/phaser/render/EntityRenderer.ts src/phaser/render/BeltItemRenderer.ts src/phaser/FactoryScene.ts tests/unit/renderEvents.test.ts tests/e2e/animation-state.spec.ts
git commit -m "feat: synchronize machine and belt animations"
```

## Task 4.2: Add Belt Glow, Smelter Heat, and Depot Sale Bursts

**Files:**
- Create: `src/phaser/render/VfxRenderer.ts`
- Create: `public/assets/vfx/heat.svg`
- Create: `public/assets/vfx/coin.svg`
- Modify: `src/content/assetManifest.ts`
- Modify: `src/phaser/FactoryScene.ts`
- Create: `tests/unit/vfx.test.ts`
- Create: `tests/e2e/vfx.spec.ts`

**Interfaces:**
- Consumes: `saleCompleted`, `machineStateChanged`, belt item resource IDs, and particle textures.
- Produces: additive belt glows, smelter tint/alpha pulse plus optional heat particles, and one short depot burst per sale.

- [ ] **Step 1: Write failing tests**

Assert each sale emits exactly one burst event, an active smelter schedules a heat effect, an inactive smelter stops it, and resource colors map to the content palette.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/vfx.test.ts
npm run test:e2e -- tests/e2e/vfx.spec.ts
```

- [ ] **Step 3: Implement**

Use Phaser particle emitters and tweened tint/alpha values. Do not add VFX to unspecified machines or events. Dispose emitters when their target entity is removed.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/vfx.test.ts
npm run test:e2e -- tests/e2e/vfx.spec.ts
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/phaser/render/VfxRenderer.ts public/assets/vfx src/content/assetManifest.ts src/phaser/FactoryScene.ts tests/unit/vfx.test.ts tests/e2e/vfx.spec.ts
git commit -m "feat: add required factory VFX"
```

## Task 4.3: Add Sound Without Coupling Sound to Simulation

**Files:**
- Create: `src/audio/sound.ts`
- Create: `public/assets/audio/README.md`
- Create: `tests/unit/sound.test.ts`

**Interfaces:**
- Consumes: `RenderEvent` types and a browser audio adapter.
- Produces: optional machine, belt, unlock, and sale sound triggers with a no-op adapter for tests and muted browser state.

- [ ] **Step 1: Write failing tests**

Assert sale events map to one sale sound, machine state changes map to one active loop start/stop, unlock events map to one unlock sound, and a muted adapter performs no audio calls.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/sound.test.ts
```

- [ ] **Step 3: Implement**

Keep audio keys and lifecycle in `src/audio/sound.ts`; accept a dependency-injected player so simulation code does not import audio.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/sound.test.ts
npm run test
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/audio/sound.ts public/assets/audio/README.md tests/unit/sound.test.ts
git commit -m "feat: add event-driven sound adapter"
```

## Task 4.4: Add Dirty-Flag Scheduling and Spatial Partitioning

**Files:**
- Create: `src/sim/activeIndex.ts`
- Modify: `src/sim/tick.ts`
- Modify: `src/sim/store.ts`
- Create: `tests/unit/performance.test.ts`

**Interfaces:**
- Consumes: entities, machine/belt activity, grid dimensions, and tick count.
- Produces: `ActiveEntityIndex`, dirty-entity registration, spatial chunk buckets, and a tick loop that skips inactive chunks.

- [ ] **Step 1: Write failing behavior tests**

Assert a newly placed entity becomes active, an idle machine becomes dirty when its neighbor changes, a completed entity leaves the active set, and a 64 by 64 grid with no active entities skips the production scan.

- [ ] **Step 2: Verify red**

```bash
npm run test -- tests/unit/performance.test.ts
```

- [ ] **Step 3: Implement**

Partition active entities into 8 by 8-cell chunks, maintain a dirty set per tick, and retain a correctness fallback that processes all entities when an index is incomplete.

- [ ] **Step 4: Verify green**

```bash
npm run test -- tests/unit/performance.test.ts
npm run test
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/sim/activeIndex.ts src/sim/tick.ts src/sim/store.ts tests/unit/performance.test.ts
git commit -m "perf: schedule active simulation entities"
```

## Task 4.5: Run Large-Grid Performance Scenarios

**Files:**
- Create: `tests/e2e/performance.spec.ts`
- Create: `scripts/benchmark-grid.ts`
- Create: `docs/performance-baseline.md`

**Interfaces:**
- Consumes: a deterministic large-grid fixture, fixed-step simulation, and performance thresholds.
- Produces: a reproducible benchmark command and a committed baseline for 100, 500, and 1,000 entities.

- [ ] **Step 1: Write the failing performance test**

Measure 600 logical ticks for 100, 500, and 1,000 entities and assert p95 tick duration stays below 8 ms in the local benchmark environment. Fail with a clear message when the baseline is absent.

- [ ] **Step 2: Verify red**

```bash
npm run test:e2e -- tests/e2e/performance.spec.ts
```

- [ ] **Step 3: Implement the benchmark**

Use deterministic fixtures, `performance.now`, no network calls, and no rendering. Record environment, entity count, tick count, mean, p95, and maximum duration.

- [ ] **Step 4: Verify green**

```bash
npm run test:e2e -- tests/e2e/performance.spec.ts
npm run test
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/performance.spec.ts scripts/benchmark-grid.ts docs/performance-baseline.md
git commit -m "test: add large-grid performance baseline"
```

## Task 4.6: Final Asset, Browser, and Release Verification

**Files:**
- Modify: `src/content/assetManifest.ts`
- Modify: `tests/unit/assetManifest.test.ts`
- Modify: `tests/e2e/phase0.spec.ts`
- Modify: `tests/e2e/raw-loop.spec.ts`
- Modify: `tests/e2e/production-chain.spec.ts`
- Modify: `tests/e2e/prestige.spec.ts`
- Modify: `playwright.config.ts`
- Create: `docs/release-checklist.md`

**Interfaces:**
- Consumes: all content, art, simulation, UI, persistence, VFX, and performance deliverables.
- Produces: a final browser smoke suite and explicit release checklist.

- [ ] **Step 1: Write the final failing smoke assertions**

Add assertions for no uncaught browser errors, all manifest assets loading, camera bounds after expansion, offline modal after a controlled timestamp, prestige reset, and a production build served by `vite preview`.

- [ ] **Step 2: Verify red**

```bash
npm run test:e2e
```

- [ ] **Step 3: Complete the release checklist**

Document the commands for clean install, unit tests, component tests, browser tests, lint, typecheck, build, preview, save reset, and art review. Confirm no prohibited non-goal appears in the application.

- [ ] **Step 4: Run the complete verification set**

```bash
npm run test
npm run test:e2e
npm run lint
npm run typecheck
npm run build
```

Expected: every command exits 0 with no unhandled browser errors.

- [ ] **Step 5: Commit**

```bash
git add src/content/assetManifest.ts tests/unit/assetManifest.test.ts tests/e2e/phase0.spec.ts tests/e2e/raw-loop.spec.ts tests/e2e/production-chain.spec.ts tests/e2e/prestige.spec.ts playwright.config.ts docs/release-checklist.md
git commit -m "chore: complete Factor-Y release verification"
```

## Phase 4 Exit Check

- [ ] All required machine/resource art is present, animated, and manually reviewed.
- [ ] Belt glow, smelter heat, and depot sale burst are the only v1 VFX families.
- [ ] Sound is event-driven and does not enter the simulation dependency graph.
- [ ] Dirty flags and spatial partitioning pass the large-grid benchmark.
- [ ] Full unit, component, browser, lint, typecheck, and production-build checks pass.
- [ ] The working tree is clean and every task has a corresponding atomic commit.

---

## Plan Self-Review

- **Spec coverage:** Vision and non-goals are covered in the global constraints and Phase 0-4 boundaries. Camera, grid, placement, rotation, connections, machines, resources, recipes, save schema, offline progress, React UI, custom art, VFX, prestige, expansion, and performance each have explicit tasks.
- **Type consistency:** Task 0.3 introduces the simulation state contracts, while Task 0.6 makes `ResourceId`, `MachineType`, `RecipeId`, `ResourceTier`, the content definition interfaces, and `UnlockTable` canonical in `src/content/types.ts` and re-exports them through `src/sim/types.ts`. `Rotation`, `Entity`, `SimulationState`, `SimulationSnapshot`, `SimulationCommand`, `RenderEvent`, and `CommandResult` remain simulation-owned. Content names and costs match the design document.
- **Unresolved-marker scan:** The plan contains no unresolved markers or unspecified implementation shortcuts. Every task names files, behavior, tests, commands, and a commit boundary.
- **Execution order:** DOX and toolchain precede application code. Pure simulation precedes Phaser and React. Persistence precedes offline progress. Production chains precede prestige. VFX and performance follow the playable loop.
- **Verification:** Every phase has unit/integration or component coverage, browser coverage where behavior changes, and the required lint, typecheck, test, and build commands.
