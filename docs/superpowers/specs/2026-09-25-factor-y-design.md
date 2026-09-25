# Factor-Y - Design Specification

**Source spec:** `factor-y-2d-spec.md`
**Design version:** 1.0
**Status:** Approved for implementation planning
**Target:** Desktop browser game built with TypeScript, Phaser 3, React, and Vite
**Public name:** Factor-I
**Short label:** factori

## 1. Product Boundary

Factor-Y is an idle/tycoon factory builder. The factory floor visualizes economic scaling; it is not a physics sandbox, a throughput puzzle, or a menu-only idle game. The player extracts resources, routes them through processors, sells finished goods, unlocks stronger production, expands the plot, and eventually prestiges for permanent multipliers.

There is no win screen. The v1 content ceiling is the six-machine, thirteen-resource, four-tier production chain defined in the source spec. The following remain out of scope: multiplayer, combat, touch controls, responsive layouts, monetization, accounts, cloud sync, power, fluids, splitters, and machine module slots.

## 2. Locked Decisions

- Initial grid: 64 by 64 cells.
- Tile and sprite size: 64 by 64 pixels.
- Simulation rate: fixed 10 ticks per second, with a 100 ms logical tick.
- Offline cap: 12 hours.
- Welcome-back modal threshold: 60 seconds of elapsed real time.
- Persistence key: `factor-y:save`.
- Save schema version: 1, with a migration registry and a no-op migration entry for version 1.
- Platform: desktop browser only.
- Starting currency: 500, enough to build the first raw-resource chain without external grants.
- Art: one custom-authored cohesive asset set, not a mixture of third-party packs.
- Art direction: clean industrial illustration with dark steel, copper, hazard orange, cyan status lights, neutral overhead lighting, and no baked directional shadows.
- Machine footprint: 1 by 1 cell for v1. Ports are defined in machine data and rotate with the entity.
- Initial production tick order is deterministic and independent of Phaser frame rate.
- The simulation store is the only owner of economic state. React and Phaser are read-only consumers plus command callers.

The source spec describes the Phase 1 save as “v2 schema” while its example uses version 1. This design resolves the inconsistency by treating the first shipped format as version 1 and preserving the migration hook for all future versions.

## 3. Runtime Architecture

### 3.1 Dependency direction

The dependency graph is one-way:

```text
content -> sim <- persistence
             |
             v
        render adapter -> phaser
             |
             v
      UI store bridge -> react
```

- `src/content` contains pure data and validation types.
- `src/sim` imports content types but never imports React, Phaser, DOM APIs, or persistence implementation.
- `src/persistence` serializes and validates simulation state.
- `src/phaser` reads simulation snapshots and sends user commands to the simulation store.
- `src/ui` subscribes to immutable snapshots and sends user commands to the simulation store.
- `src/app` composes the Phaser canvas and React overlay.

### 3.2 Simulation lifecycle

`SimulationStore` owns a mutable state internally and exposes an immutable cached snapshot. A browser driver measures monotonic time, accumulates elapsed time, and executes logical ticks independently of `requestAnimationFrame`. It never advances production from Phaser `update()`. `dispatch(command)` returns a `CommandResult`, allowing Phaser and React to show the same precise rejection reason without duplicating validation.

Each logical tick performs these phases:

1. Validate and apply due machine work using the current inventories.
2. Build a new belt occupancy map and move each item at most one cell.
3. Transfer belt items into compatible machine input ports.
4. Process depot deliveries and credit currency.
5. Remove invalid stale references and update throughput samples.
6. Mark the simulation snapshot dirty when observable state changes.

The pure function `advanceSimulation(state, tickCount)` is the authoritative testable implementation. The browser store wraps it with scheduling, command dispatch, subscriptions, persistence hooks, and throttled snapshots. `currencyPerSecond` is calculated from the currency credited over the previous 100 logical ticks, or ten seconds, and returns zero until a full rate window has elapsed. `PRESTIGE_THRESHOLD` is the shared `100_000` lifetime-currency gate; `prestigeReady` is true at or above it, and Phase 3 uses the same constant.

### 3.3 React bridge

React uses `useSyncExternalStore` with a stable `subscribe` function and a cached snapshot. HUD values and notifications are published at 10 Hz. Phaser can request a render refresh for every simulation change, but it does not cause React to render at simulation frequency.

The DOM overlay is positioned above the canvas. Only interactive controls receive pointer events. The canvas remains responsible for world-space pointer input and camera gestures.

## 4. Project Layout

The implementation will use these durable boundaries:

```text
factorI/
  AGENTS.md
  package.json
  tsconfig.json
  vite.config.ts
  playwright.config.ts
  index.html
  public/
    assets/
      tiles/
      machines/
      resources/
      vfx/
  src/
    app/
    content/
    persistence/
    phaser/
      render/
    sim/
    ui/
      components/
      hooks/
  tests/
    unit/
    integration/
    e2e/
  docs/
    superpowers/
      specs/
      plans/
```

Each directory receives a child `AGENTS.md` through the DOX bootstrap after the directory exists. Root rules remain broad; child files own local contracts and verification commands.

## 5. Domain Model

The following types are the public contracts for the first implementation plan. The content contracts are canonical in `src/content/types.ts` and are re-exported from `src/sim/types.ts` for compatibility.

```ts
export type ResourceId =
  | "copperOre"
  | "ironOre"
  | "coal"
  | "stone"
  | "copperIngot"
  | "ironIngot"
  | "refinedStone"
  | "wire"
  | "gear"
  | "plate"
  | "circuit"
  | "frame"
  | "motor";

export type MachineType =
  | "extractor"
  | "belt"
  | "smelter"
  | "assembler"
  | "silo"
  | "depot";

export type RecipeId =
  | "copperIngot"
  | "ironIngot"
  | "refinedStone"
  | "wire"
  | "gear"
  | "plate"
  | "circuit"
  | "frame"
  | "motor";

export type ResourceTier = 0 | 1 | 2 | 3;

export type Rotation = 0 | 90 | 180 | 270;

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface ResourceDefinition {
  readonly id: ResourceId;
  readonly tier: ResourceTier;
  readonly label: string;
  readonly sellValue: number;
  readonly iconKey: string;
  readonly color: string;
}

export interface PortDefinition {
  readonly id: string;
  readonly kind: "input" | "output";
  readonly offset: GridPoint;
  readonly accepts?: readonly ResourceId[];
  readonly produces?: ResourceId;
}

export interface MachineDefinition {
  readonly type: MachineType;
  readonly footprint: { readonly width: 1; readonly height: 1 };
  readonly cost: number;
  readonly unlockCost: number;
  readonly inputBuffer: number;
  readonly outputBuffer: number;
  readonly bufferMode: "separate" | "shared";
  readonly storageCapacity?: number;
  readonly defaultProcessTicks: number;
  readonly ports: readonly PortDefinition[];
  readonly spriteKey: string;
  readonly activeSpriteKey?: string;
}

export interface RecipeDefinition {
  readonly id: RecipeId;
  readonly machine: "smelter" | "assembler";
  readonly inputs: Readonly<Partial<Record<ResourceId, number>>>;
  readonly output: { readonly resource: ResourceId; readonly amount: number };
  readonly durationTicks: number;
  readonly unlockCost: number;
  readonly sellValue: number;
}

export interface UnlockTable {
  readonly machines: readonly MachineType[];
  readonly recipes: readonly RecipeId[];
}

export interface Entity {
  id: string;
  type: MachineType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  resourceNode?: ResourceId;
  recipeId?: string;
}

export interface ResourceNode {
  id: string;
  resource: ResourceId;
  x: number;
  y: number;
}

export interface MachineRuntime {
  entityId: string;
  progressTicks: number;
  input: Partial<Record<ResourceId, number>>;
  output: Partial<Record<ResourceId, number>>;
  active: boolean;
}

export interface BeltCell {
  entityId: string;
  item?: ResourceId;
  progress: number;
}

export interface GridState {
  width: number;
  height: number;
  tileSizePx: 64;
  nodes: ResourceNode[];
  entities: Entity[];
  machines: Record<string, MachineRuntime>;
  belts: Record<string, BeltCell>;
}

export interface PrestigeState {
  points: number;
  totalPrestiges: number;
  permanentMultipliers: {
    productionSpeed: number;
    sellValue: number;
  };
}

export interface ProductionChainSummary {
  id: string;
  outputResource: ResourceId;
  steadyStateThroughput: number;
  sellValue: number;
}

export interface SaveGame {
  version: 1;
  lastSavedAt: number;
  currency: number;
  lifetimeCurrency: number;
  prestige: PrestigeState;
  unlocked: {
    machines: MachineType[];
    recipes: string[];
  };
  grid: GridState;
  productionChains: Record<string, ProductionChainSummary>;
}

export interface SimulationState extends SaveGame {
  nextEntitySequence: number;
  selectedEntityId?: string;
  placementMode?: MachineType;
  pendingRotation: Rotation;
  notifications: Notification[];
}

export interface SimulationSnapshot {
  currency: number;
  currencyPerSecond: number;
  prestigePoints: number;
  prestigeReady: boolean;
  unlockedMachines: MachineType[];
  unlockedRecipes: string[];
  selectedEntity?: Entity;
  selectedThroughput: number;
  placementMode?: MachineType;
  pendingRotation: Rotation;
  notifications: Notification[];
  offlineSummary?: OfflineSummary;
}

export interface OfflineSummary {
  elapsedSeconds: number;
  cappedSeconds: number;
  earnedCurrency: number;
  chainUnits: Partial<Record<ResourceId, number>>;
}

export interface Notification {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  message: string;
  createdAt: number;
}

export type RenderEvent =
  | { type: "entityPlaced"; entity: Entity }
  | { type: "entityRemoved"; entityId: string }
  | { type: "machineStateChanged"; entityId: string; active: boolean }
  | { type: "saleCompleted"; entityId: string; resource: ResourceId; currency: number; worldX: number; worldY: number };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

export type SimulationCommand =
  | { type: "placeEntity"; machine: MachineType; x: number; y: number; rotation: Rotation; resourceNode?: ResourceId; recipeId?: string }
  | { type: "demolishEntity"; entityId: string }
  | { type: "rotatePlacement" }
  | { type: "selectEntity"; entityId?: string }
  | { type: "setPlacementMode"; machine?: MachineType }
  | { type: "upgradeEntity"; entityId: string }
  | { type: "unlockRecipe"; recipeId: string }
  | { type: "unlockMachine"; machine: MachineType }
  | { type: "prestige" }
  | { type: "expandGrid"; width: number; height: number }
  | { type: "dismissOfflineSummary" }
  | { type: "dismissNotification"; id: string };
```

The shipped `RESOURCES`, `MACHINES`, `RECIPES`, and `UNLOCKS` tables are recursively frozen at module initialization. The frozen tables and the total `validateContent(input: unknown)` validator are the content boundary consumed by simulation and presentation layers.

The exact runtime state may contain private indexes, but the serialized `SaveGame` shape remains explicit and validated. Private derived indexes are rebuilt after load. `BeltCell.progress` is a normalized value from 0 to 1 and is reset when an item enters or leaves a belt cell.

## 6. Content Definition

### 6.1 Resources

| Tier | Resources | Initial sell value |
|---|---|---:|
| 0 | Copper Ore, Iron Ore, Coal, Stone | 1, 1, 2, 1 |
| 1 | Copper Ingot, Iron Ingot, Refined Stone | 6, 10, 5 |
| 2 | Wire, Gear, Plate | 24, 30, 36 |
| 3 | Circuit, Frame, Motor | 120, 180, 600 |

Raw resources remain sellable for recovery value, but the higher-tier values make processing economically preferable. Sell values are data, not hardcoded logic, so the Phase 3 balance pass can tune them without changing the simulation API.

### 6.2 Machines

| Machine | Initial cost | Ports | Behavior |
|---|---:|---|---|
| Extractor | 50 | one output | Produces its node resource every 20 ticks, modified by level and prestige |
| Belt | 10 | one input, one output | Holds one item and advances it one cell every 10 ticks |
| Smelter | 250 | one input, one output | Runs an unlocked Tier 1 recipe |
| Assembler | 500 | two inputs, one output | Runs an unlocked Tier 2 or Tier 3 recipe |
| Storage Silo | 150 | one input, one output | Buffers up to 100 units of one resource type |
| Shipping Depot | 100 | one input | Sells received resources at the current sell multiplier |

All machines occupy one cell. A port is a rotated cell offset from the entity origin. A connection exists only when an output port faces a compatible input port on the adjacent cell. The Smelter has one mixed input port and buffer that accepts Copper Ore, Iron Ore, Coal, and Stone, so recipes such as Iron Ingot can consume two raw resources on the same port. The Assembler keeps two separate input ports and buffers. The Storage Silo accepts any resource on its input port and preserves the first resource type it receives until that buffer is emptied. Its `bufferMode` is `shared`, and `inputBuffer`, `outputBuffer`, and `storageCapacity` all reference one 100-unit pool; every other machine uses `bufferMode: "separate"` and omits `storageCapacity`. `defaultProcessTicks` is the fallback timing for machines without a selected recipe, while a selected recipe's `durationTicks` is always authoritative. The v1 graph has no splitter or priority behavior.

### 6.3 Recipes

```text
copperOre -> copperIngot
ironOre + coal -> ironIngot
stone -> refinedStone
copperIngot x2 -> wire
ironIngot x2 -> gear
ironIngot + refinedStone -> plate
wire + gear -> circuit
plate x2 + gear -> frame
circuit + frame -> motor
```

The initial unlocks are Extractor, Belt, and Shipping Depot. Copper Ore and Iron Ore are the two resource-node types available in the Phase 1 loop. The remaining machine and recipe unlock costs are:

| Unlock | Cost |
|---|---:|
| Smelter | 250 |
| Assembler | 500 |
| Storage Silo | 150 |
| Copper Ingot recipe | 300 |
| Iron Ingot recipe | 450 |
| Refined Stone recipe | 600 |
| Wire recipe | 900 |
| Gear recipe | 1,200 |
| Plate recipe | 1,600 |
| Circuit recipe | 4,000 |
| Frame recipe | 6,000 |
| Motor recipe | 12,000 |

`createInitialWorld(seed = 1337)` creates deterministic resource-node clusters for all four raw resources inside the central 48 by 48 area, with no overlapping nodes. The generator is pure and is tested for determinism, bounds, and resource coverage.

## 7. Grid, Placement, and Connections

- Cell coordinates are integer coordinates in `[0, width)` and `[0, height)`.
- Placement is valid only when the cell is empty, the machine definition exists, the player has sufficient currency, and extractor placement has a compatible resource node. Smelter and Assembler placement requires an unlocked `recipeId`; the inspector cannot place a processor without a recipe.
- Rotation is restricted to `0`, `90`, `180`, and `270`; `R` and the inspector button dispatch `rotatePlacement`.
- The ghost preview uses the same machine definition and rotation state as the command validator.
- Belt movement uses a two-phase occupancy update so an item cannot cross multiple cells in one tick.
- A belt deposits into a machine only when the destination port is facing the belt and accepts the carried resource.
- A depot sale emits a typed `saleCompleted` render event containing the world position, resource, and currency amount.
- Deleting an entity removes its runtime state and all derived connections. It does not silently refund resources.

## 8. Persistence and Offline Progress

`serializeSave` produces a JSON-compatible `SaveGame`. `parseSave` validates the version, required fields, entity coordinates, machine types, resource IDs, rotation values, and finite numeric values. Invalid or unknown versions are migrated through the registry. If migration fails, the game starts from a new save and emits a recoverable notification.

`migrateSave` begins with a no-op version-1 migration. Later versions add explicit migration functions rather than mutating saves in multiple locations.

The save driver writes on meaningful player actions and periodically while the tab is active. On load:

```text
elapsed = max(0, now - lastSavedAt)
cappedElapsed = min(elapsed, 12 hours)
offlineCurrency = sum(chain.throughput * cappedElapsed.seconds * chain.sellValue * sellMultiplier)
```

The simulation credits the computed currency and lifetime earnings, records chain units in the welcome-back summary, and resumes the live fixed-step simulation. It never replays individual belt items for the elapsed period.

## 9. Phaser Rendering

`FactoryScene` creates the grid, background, machine layer, belt-item layer, ghost layer, and VFX layer. It reads simulation snapshots and render events. It does not mutate economic state.

- Camera bounds equal grid dimensions multiplied by 64 plus a 256-pixel margin.
- The desktop renderer uses a fixed 1280 by 720 surface with Phaser FIT and CENTER_BOTH scaling; transient or undersized parent dimensions use a 640 by 360 minimum surface floor.
- Initial zoom is 1.0, with a minimum of 0.5 and maximum of 2.0.
- Drag and WASD/arrow keys pan the camera; wheel and pinch zoom use Phaser camera APIs.
- Right-click on an entity dispatches the demolish command, while the inspector provides the same action as an accessible button.
- Pointer world coordinates are converted through the active camera, then floored to grid cells.
- Sprites use `setAngle(rotation)` for machines and belts. Art is authored with neutral lighting so rotation does not invalidate shadows.
- Active machine sprites switch to animation frames or tint states based on simulation render events.
- Belt items use a resource icon plus a resource-colored additive glow sprite.
- Smelters use a short tint/alpha pulse while processing. The same event can also drive faint upward heat particles.
- Depots emit a short coin/spark burst on each completed sale.

The renderer has a small adapter interface so Phaser-specific code can be replaced in unit tests with a deterministic fake scene.

## 10. React UI

The overlay contains:

- `Hud`: currency, currency per second, prestige points, and prestige button.
- `BuildDock`: unlocked machine buttons and active placement state.
- `EntityInspector`: selected entity, throughput, upgrade, rotate, and demolish actions.
- `TechTree`: recipe and machine unlock purchases.
- `OfflineSummaryModal`: elapsed time, capped time, earned currency, and chain units.
- `NotificationStack`: transient local events such as invalid placement, storage pressure, and unlocks.

The UI never computes simulation results. It dispatches commands and renders the latest snapshot. Buttons disable when the snapshot says the action is unavailable.

## 11. Custom Art Pipeline

Art lives under `public/assets` and is registered in `src/content/assetManifest.ts`. The initial art set contains:

- One floor tile and one placement overlay.
- Idle and active frames for all six machine types.
- Distinct icons for all thirteen resources.
- Belt tile frames and item glow textures.
- Coin/spark and heat particle textures.

The first art spike validates the extractor, belt, and one raw resource at 64 by 64 before additional assets are produced. Asset validation checks manifest presence, dimensions, frame counts, and unique resource keys. A manual art review checks neutral lighting, readability at 1x zoom, and consistent palette.

## 12. TDD Execution Policy

Every implementation slice follows this order:

1. Write one focused failing test.
2. Run the exact test and confirm it fails for the missing behavior.
3. Implement the smallest code that makes the test pass.
4. Run the focused test and the relevant suite.
5. Refactor only while the suite remains green.
6. Run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` at phase checkpoints.
7. Review the diff and update the local DOX verification section when a new durable rule appears.

The initial scripts are:

```json
{
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
```

Vitest covers pure content, grid, simulation, persistence, store, and React component behavior. Playwright covers browser startup, canvas mount, placement through pointer events, React overlay interaction, save/reload behavior, and a production build smoke path.

## 13. Phase Deliverables and Exit Criteria

### Phase 0 - Foundation and art spike

Deliverables are the Vite/React/Phaser scaffold, test tooling, DOX tree, content manifest, pure grid math, fixed-step driver, snapshot contract, Phaser scene, camera controls, tilemap, ghost placement, and the first custom art assets.

Exit criteria are a passing unit suite, a passing typecheck, a browser smoke test that places and rejects entities, independent currency ticking, and a documented art decision with no unapproved temporary production assets.

### Phase 1 - Raw-resource MVP

Deliverables are Extractor, Belt, and Shipping Depot simulation behavior, two raw resources, HUD, build dock, inspector, demolish/rotate controls, save/load, offline progress, and matching art.

Exit criteria are a playable `Extractor -> Belt -> Depot` loop, a stable currency rate, a successful reload, and a welcome-back summary after the threshold.

### Phase 2 - Full production chain

Deliverables are Smelter, Assembler, Storage Silo, all thirteen resources, all nine recipes, recipe unlocks, upgrades, full build-panel/tech-tree polish, and all remaining art.

Exit criteria are every specified recipe buildable, every machine buffer and port behavior tested, throughput deterministic across repeated runs, and no invalid recipe accepted by placement or command validation.

### Phase 3 - Prestige and expansion

Deliverables are prestige threshold and point calculation, reset semantics, permanent speed/value multipliers, grid expansion, camera-bound updates, balance tables, and migration coverage.

Exit criteria are a complete prestige loop, preservation of permanent progression only, correct multiplier application, safe reset serialization, and no state duplication or loss.

### Phase 4 - VFX, performance, and release polish

Deliverables are active animations, belt glow, smelter heat effects, depot sale bursts, sound, dirty-flag scheduling, spatial partitioning, final art QA, and final browser verification.

Exit criteria are the full automated suite, lint, typecheck, production build, and Playwright smoke suite passing with no unhandled browser errors.

## 14. DOX Initialization Contract

After the approved design and implementation plan are written, the DOX bootstrap runs before any application implementation. It installs the root `AGENTS.md`, scans the real directory structure, and creates child contracts at these durable boundaries when present:

```text
AGENTS.md
public/AGENTS.md
src/AGENTS.md
src/app/AGENTS.md
src/content/AGENTS.md
src/persistence/AGENTS.md
src/phaser/AGENTS.md
src/sim/AGENTS.md
src/ui/AGENTS.md
tests/AGENTS.md
docs/AGENTS.md
```

Each child file uses the sections `Purpose`, `Ownership`, `Local Contracts`, `Work Guidance`, `Verification`, and `Child DOX Index`. The root file indexes direct children and keeps project-wide constraints broad. DOX files are not a substitute for tests; they document local ownership and commands.

## 15. Verification Checklist

Before any phase is called complete:

- Every changed behavior has a test that was observed failing before implementation.
- The focused test and complete unit suite pass.
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.
- Relevant Playwright browser flows pass when the phase changes browser behavior.
- The save round-trip and migration tests pass for persistence changes.
- Art manifest validation passes for art changes.
- The implementation plan’s phase exit criteria are checked explicitly.
- No secrets, generated dependency folders, or temporary research files are added to the project.

## 16. Risks and Mitigations

- Art consistency is controlled by one custom palette, one manifest, and an early extractor review.
- Directional lighting is controlled by neutral-lighting review before the first machine is integrated.
- Simulation performance is controlled by pure tick functions, derived indexes, and Phase 4 dirty scheduling.
- Save evolution is controlled by explicit version validation and migration functions.
- UI/render coupling is prevented by dependency-direction tests and module boundaries.
- Balance uncertainty is isolated in content tables and validated through scenario tests.
