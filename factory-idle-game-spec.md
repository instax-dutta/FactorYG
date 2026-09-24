# Factor-Y — 2.5D Isometric Factory-Tycoon (Browser)

**Spec version:** 1.0
**Audience:** Coding agent implementing this from scratch
**Status:** Phase 0–3 implemented; Phase 4 VFX/performance deferred

---

## 1. Vision & Genre Identity

This is an **idle/tycoon-spine factory builder**, not a Factorio clone and not a Hydroneer clone. Read that twice before building anything — it determines every downstream decision in this doc.

- **Core loop identity:** Number-scaling economic progression (idle/tycoon) is the primary reward loop. The factory floor is not a logic puzzle to "solve" — it's the *visualization* of that scaling. Players place extractors, belts, and processors on a grid; resources visibly flow through the chain; output feeds a currency that drives upgrades and prestige.
- **What this is NOT:** Not a manual digging/physics sandbox (Hydroneer). Not a pure automation-optimization puzzle where throughput ratios are the point (Factorio). Not menu-only idle with no spatial layer (that would make "factory" false advertising).
- **Progression shape:** Open-ended sandbox — no win screen, no final boss, no "you beat the game." Long-term engagement comes from prestige resets, not narrative completion.
- **Perspective:** 2.5D — real 3D scene (three.js), rendered through a fixed isometric camera. Not a flat 2D sprite game, not a free-roam 3D game.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Renderer / Scene | **three.js** | Use `WebGPURenderer` with TSL where available; fall back to `WebGLRenderer` for browsers/devices without WebGPU. WebGPU is baseline across Chrome/Edge/Firefox/Safari 26+ as of 2026, but keep the WebGL2 fallback path for older devices/long-tail reach. |
| Custom VFX | **vgpu.sh** | Used *only* for bespoke WGSL effects layered on top of the three.js scene: ore glow, smelting heat-shimmer, particle streams on belts, fluid-ish liquid effects for later-tier processing. It is NOT the primary renderer and does not own the scene graph or camera. Treat it as a post-process/effect layer three.js hands specific render targets to. |
| UI | **React** (or Preact if bundle size matters) | HTML overlay positioned above the three.js `<canvas>`, absolutely positioned, `pointer-events` scoped so canvas drag/pan still works underneath. All HUD, menus, build panels are DOM, not in-scene 3D geometry. |
| State management | React state/context for UI-reactive data (currency, selected tool) + a separate plain-JS simulation store (not React state) for the grid/production simulation, ticked independently of React's render cycle. **Do not drive the per-tick factory simulation through React state updates** — it will cause render thrashing at scale. Push simulation results to React via a subscription/selector pattern (e.g. zustand, or a hand-rolled pub-sub) at a throttled UI-update rate (e.g. 10hz), while the sim itself ticks faster/independently. |
| Persistence | **`localStorage`** only. Single device, no accounts, no backend. Versioned JSON schema (see §8) so future migrations don't corrupt old saves. |
| Build tooling | Vite (fast dev server, ESM-native, plays well with three.js + WGSL imports). |
| Language | TypeScript strongly recommended given the state schema complexity below. |

**Architectural rule for the agent:** three.js owns the scene, camera, and meshes. The simulation store owns game logic and ticks independently of render framerate (fixed timestep, e.g. 10 ticks/sec, decoupled from `requestAnimationFrame`). React owns UI only. Do not let any of these three own another's responsibility.

---

## 3. Camera & World

- **Projection:** Orthographic camera, true isometric angle (~35.264° elevation, 45° rotation) or a Factorio-style 2:1 dimetric look if you prefer better tile readability — pick one and keep it consistent everywhere (icons, UI mockups, etc. should match the chosen angle).
- **Rotation:** None. Fixed angle, no free-orbit. This is a deliberate readability choice — matches Factorio's fixed-view logic clarity, not Hydroneer's free camera.
- **Controls:** Pan (drag or WASD/arrow keys), zoom (scroll wheel / pinch), clamped to a bounding box around the placed factory + some margin, not infinite pan into empty space.
- **Grid:** Discrete cell-based grid, cell size e.g. 1 world unit = 1 cell. Start world size configurable (e.g. 64×64), expandable later via an "expand plot" unlock rather than hard-coded infinite — infinite grids create pathfinding/simulation cost problems, don't build for infinite from day one.

---

## 4. Core Game Loop

1. Place an **Extractor** on a resource node → it generates raw resource over time.
2. Place **Conveyor Belts** to route resources from extractor → processor → seller/storage.
3. Place **Processors** (Smelter, Assembler, Refiner — see §6) to convert raw → refined → component → product, increasing sell value at each tier.
4. Route finished goods to a **Seller/Shipping Depot** → converts goods to **Currency** on delivery.
5. Spend Currency on: new machines, machine tier upgrades (speed/output multipliers), grid expansion, unlocking new recipes/resource tiers.
6. When growth plateaus, **Prestige**: reset the grid (keep nothing physical) in exchange for **Prestige Points**, which grant permanent global multipliers. Rebuild faster next cycle. Repeat indefinitely — this is the actual endgame loop, since there is no narrative end.

### Idle / Offline Progress
**Explicit design decision (not simulated in real-time when the tab is closed):**
- On save, record: timestamp, and each active production chain's **steady-state throughput rate** (units/sec at last-known state) — not the position of every item on every belt.
- On load, compute `elapsed = now - lastSaveTimestamp`, cap it (e.g. max 8–12 hours of offline credit, tune later), and apply `offlineProduction = throughputRate * cappedElapsed` per chain, then fast-forward currency/resources accordingly.
- Do **not** attempt to replay a belt-item simulation for hours of elapsed time — this is a performance trap and unnecessary since the player wasn't watching. Show a "Welcome back — while you were away" summary screen instead of animating the catch-up.

---

## 5. Grid & Placement System

- **Placement mode:** Click a machine in the build panel → cursor shows a ghost/preview mesh snapped to the grid → click a valid empty cell to place. Structurally invalid placement (occupied, out of bounds, locked, or missing a required resource-node tile) shows a red-tinted ghost and is rejected. Legal but disconnected placements are accepted with an amber preview and a live message explaining that the machine will idle.
- **Rotation:** Belts and directional machines (extractors output direction, assemblers input/output sides) need a rotate control (e.g. `R` key or a rotate button) before placement, 90° increments.
- **Connections:** Belts connect automatically to adjacent belt/machine ports facing the correct direction. Machines have explicit input/output port cells (e.g. a Smelter has 1 input side, 1 output side) — define this per machine type in a data table, not hardcoded per-instance. Placement previews report connected, partial, or disconnected quality without rejecting a legal incremental build.
- **Deletion/move:** Right-click or a "demolish" tool to remove; consider a "move mode" later (v2+, not MVP) rather than forcing full delete+rebuild.

---

## 6. Machines (v1 set — do not exceed this list for MVP)

| Machine | Function | Input | Output |
|---|---|---|---|
| **Extractor** | Placed on a resource node tile; generates raw resource over time | none (node-dependent) | 1 raw resource type |
| **Conveyor Belt** | Moves items along a path, 1 cell/tick at belt speed | 1 item | same item, moved |
| **Smelter** | Converts raw → refined (1:1 or with a byproduct) | 1–2 raw resources | 1 refined resource |
| **Assembler** | Combines refined resources into components/products | 2+ refined/component resources | 1 component or product |
| **Storage Silo** | Buffers overflow, prevents backpressure stalls | any | same, buffered |
| **Shipping Depot (Seller)** | Converts finished goods to Currency on delivery | 1+ product types | Currency |

**Deliberately excluded from v1 (flag as v2+/stretch, do not build now):** power/electricity grid system, multi-recipe machine switching UI, machine module/upgrade slots, belt splitters/mergers with priority logic, pipes/fluids. These are real Factorio-genre depth features but they are scope explosions — only add after the MVP loop is proven fun.

---

## 7. Resource & Production Chain (v1 content — concrete, buildable)

This is a starting content set. Theme is left generic/sci-fi-mining; reskin freely, but keep the tier structure.

**Tier 0 — Raw (from Extractors on resource nodes):**
Copper Ore, Iron Ore, Coal, Stone

**Tier 1 — Refined (from Smelters):**
- Copper Ore → Copper Ingot
- Iron Ore + Coal → Iron Ingot
- Stone → Refined Stone (simple 1:1, used as filler/early content)

**Tier 2 — Components (from Assemblers):**
- Copper Ingot ×2 → Wire
- Iron Ingot ×2 → Gear
- Iron Ingot + Refined Stone → Plate

**Tier 3 — Products (from Assemblers, sold at Depot):**
- Wire + Gear → Circuit
- Plate ×2 + Gear → Frame
- Circuit + Frame → Motor (highest v1 sell value)

Sell values should scale roughly exponentially by tier so the idle-currency curve feels like meaningful progression (e.g. Tier 0 raw sells for near-nothing directly — discourage selling raw, encourage processing).

---

## 8. Data Model / Save Schema

```json
{
  "version": 2,
  "lastSavedAt": 1234567890,
  "currency": 0,
  "prestige": {
    "lifetimeMotors": 0,
    "points": 0,
    "claimedPoints": 0,
    "totalPrestiges": 0,
    "permanentMultipliers": {
      "productionSpeed": 1.0,
      "sellValue": 1.0
    }
  },
  "unlocked": {
    "machines": ["extractor", "belt", "crossing", "splitter", "depot", "smelter"],
    "recipes": ["copperIngot", "ironIngot"]
  },
  "grid": {
    "width": 64,
    "height": 64,
    "entities": [
      {
        "id": "uuid",
        "type": "extractor",
        "x": 22,
        "y": 24,
        "rotation": 90,
        "level": 1,
        "resourceNode": "copperOre",
        "item": null,
        "inputs": {}
      }
    ],
    "expansionsBought": 0
  },
  "productionChains": {
    "chainId": {
      "steadyStateThroughput": 2.5,
      "outputResource": "copperIngot"
    }
  }
}
```

`points` is cumulative and `claimedPoints` is the number already spent. V1 saves are validated before migration. Missing prestige, unlock, entity input, and expansion blocks receive their supported defaults; v1 `claimedPoints` is `0` when `totalPrestiges` is `0`, otherwise it is `points`. V1 production-chain estimates are replaced with `{}` so a known-wrong estimate cannot mint currency. Invalid JSON and structurally or semantically invalid saves are quarantined under the active save key instead of being loaded.

---

## 9. UI/UX Spec (React overlay)

- **HUD (always visible):** Currency total, currency/sec rate, prestige points, a "Prestige" button (disabled/greyed until a minimum threshold is hit).
- **Build panel:** Bottom or side dock, icons for each unlocked machine, click to enter placement mode.
- **Info panel on hover/select:** Click a placed machine → side panel shows its current throughput, upgrade button, demolish button.
- **Tech/Unlock tree:** Separate modal or panel — spend currency to unlock next-tier recipes and machines.
- **Offline summary modal:** Shown once on load if `elapsed > some threshold` (e.g. 1 minute), summarizing offline gains.
- **Notifications/toasts:** Minimal — "New recipe unlocked," "Storage full" warnings, etc.

---

## 10. VFX Spec (vgpu.sh layer)

Keep this list short for v1 — VFX is polish, not core loop:
- Subtle glow/emissive shader on ore items while on belts (differentiate resource types by color/glow, aiding readability at a glance).
- Heat-shimmer effect on Smelter output port while actively processing.
- Simple particle burst on Depot when a sale completes.

Do not build fluid/ocean-style effects (those exist in vgpu's example gallery) unless a later tier genuinely introduces liquids — don't add visual complexity the game doesn't have mechanics for yet.

---

## 11. Build Phases (mandatory — do not let the agent build all systems in parallel)

**Phase 0 — Tech Spike**
Isometric orthographic camera + pan/zoom, grid rendering, one placeable box mesh, click-to-place on grid, currency number ticking up on a timer. Prove the render/interaction loop works before anything else.

**Phase 1 — MVP Core Loop**
Extractor → Belt → Depot with 2 raw resource types sold directly (skip processing for this phase). React HUD showing currency + rate. `localStorage` save/load with the schema above. Offline progress calculation (even if the offline cap/summary UI is bare-bones).

**Phase 2 — Production Chain**
Smelter + Assembler, full Tier 0→3 resource chain from §7, recipe unlock tree, machine upgrade (speed/output) system, build panel UI polish.

**Phase 3 — Prestige & Depth**
Prestige reset + permanent multiplier system, balance pass on currency curve, grid expansion unlock.

**Phase 4 — VFX & Polish**
vgpu.sh VFX layer (§10), sound effects, animation polish, performance pass on the simulation store for larger grids (spatial partitioning / dirty-flagging so idle machines aren't recomputed every tick).

**Explicit non-goals — do not build unless separately requested:** multiplayer/co-op, combat or enemies/threats, mobile touch controls, monetization/IAP, backend accounts, power grid system, fluid/pipe systems, save-file cloud sync.

---

## 12. Open Risks (advisory notes, not implementation tasks)

- **Grid simulation performance at scale:** once players have hundreds of belts/machines, naive per-tick iteration over every entity will get slow. Recommend the simulation store use a tick-based dirty-flag system or spatial chunking from Phase 2 onward, not bolted on later.
- **Balance is unproven:** the Tier 0→3 sell-value curve in §7 is a starting hypothesis, not tested numbers. Expect to iterate on currency/sec targets once Phase 2 is playable — don't treat the numbers as final.
- **"Open-ended, no defined end" still needs a content ceiling for v1.** Sandbox doesn't mean infinite systems — it means no win screen. The phase plan above is the actual scope boundary; treat anything past Phase 4 as backlog, not v1.
