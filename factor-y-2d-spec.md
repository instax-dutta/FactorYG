# Factor-Y — Flat Top-Down 2D Factory-Tycoon (Browser)

**Spec version:** 1.0
**Audience:** Coding agent implementing this from scratch
**Status:** Ready for Phase 0 implementation

---

## 1. Vision & Genre Identity

This is an **idle/tycoon-spine factory builder**: number-scaling economic progression is the primary reward loop, the factory floor is the *visualization* of that scaling, not a logic puzzle to solve. No win screen. Long-term engagement comes from prestige resets.

- **What this is NOT:** Not a manual digging/physics sandbox. Not a throughput-optimization puzzle where ratios are the point. Not menu-only idle with no spatial layer.
- **Perspective:** Flat top-down 2D. Straight overhead view, no perspective skew, no diagonal grid — chosen for lower art/implementation cost and simpler grid math, not a downgrade of the genre identity above.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Renderer / Scene | **Phaser 3** | Use Phaser's `Tilemap` + `TilemapLayer` for the grid, `Sprite`/`Container` for placed entities. Phaser's built-in `Camera` handles pan/zoom natively — no custom camera math needed. |
| VFX | **Phaser Particle Emitter** (built-in) | No external shader layer. Glow = additive-blend sprite or emitter; heat-shimmer = tinted color-pulse animation on the smelter output sprite, not a real shader effect; sale burst = simple particle emitter burst on the Depot. See §10. |
| UI | **React**, HTML overlay above the Phaser canvas | Absolutely positioned DOM overlay, `pointer-events` scoped so canvas drag/pan still works underneath. All HUD, menus, build panels are DOM, not Phaser UI objects (avoid Phaser's own UI/text objects for anything complex — React is easier to maintain for panels/modals). |
| State management | React state/context for UI-reactive data (currency, selected tool) + a separate plain-JS/TS simulation store (not React state, not Phaser scene state) for the grid/production simulation. | **Do not drive the per-tick factory simulation through React state, and do not put simulation logic inside Phaser's `update()` loop tied to render framerate.** Simulation ticks on its own fixed timestep (e.g. 10 ticks/sec via `setInterval` or a manual accumulator, decoupled from `requestAnimationFrame`). Phaser reads from the sim store to update sprite positions/states; React reads from it via a subscription/selector (zustand or hand-rolled pub-sub) at a throttled rate (e.g. 10hz) for HUD numbers. |
| Persistence | **`localStorage`** only. Single device, no accounts, no backend. Versioned JSON schema (see §8). |
| Build tooling | Vite. |
| Language | TypeScript. |

**Architectural rule for the agent:** Phaser owns the scene, camera, and sprites/animations. The simulation store owns game logic and ticks independently of render framerate. React owns UI only. Do not let any of these three own another's responsibility — this is a common failure mode for the genre, not a hypothetical.

---

## 3. Camera & World

- **Projection:** None needed — straight top-down 2D. Use Phaser's default `Camera2D`.
- **Rotation:** None — trivially true with a straight top-down view, since there's no perspective angle to keep consistent.
- **Controls:** Pan (drag or WASD/arrow keys), zoom (scroll wheel / pinch via Phaser's camera zoom), clamped to a bounding box around the placed factory + margin — use Phaser's `camera.setBounds()`.
- **Grid:** Discrete cell-based grid, cell size = one tile (recommend 32px or 64px sprite tiles — pick one and lock it before sourcing art, see §10). Start world size configurable (e.g. 64×64), expandable later via an "expand plot" unlock, not infinite from day one — infinite grids create simulation cost problems.

---

## 4. Core Game Loop

1. Place an **Extractor** on a resource node → generates raw resource over time.
2. Place **Conveyor Belts** to route resources extractor → processor → seller/storage.
3. Place **Processors** (Smelter, Assembler, Refiner) to convert raw → refined → component → product, increasing sell value per tier.
4. Route finished goods to a **Shipping Depot** → converts goods to **Currency** on delivery.
5. Spend Currency on: new machines, tier upgrades (speed/output multipliers), grid expansion, recipe/resource-tier unlocks.
6. **Prestige** when growth plateaus: reset the grid for **Prestige Points**, granting permanent global multipliers. This is the actual endgame loop — no narrative end.

### Idle / Offline Progress
- On save: record timestamp + each active chain's steady-state throughput rate (units/sec), not item positions.
- On load: `elapsed = now - lastSaveTimestamp`, cap it (e.g. 8–12 hours, tune later), `offlineProduction = throughputRate * cappedElapsed` per chain, fast-forward currency/resources.
- Do **not** replay a belt-item simulation for elapsed hours. Show a "Welcome back" summary screen instead.

---

## 5. Grid & Placement System

- **Placement mode:** Click a machine in the build panel → cursor shows a ghost/preview sprite snapped to the grid (Phaser: a semi-transparent sprite following pointer position, snapped via `Math.floor(pointer.worldX / tileSize)`) → click a valid empty cell to place. Invalid placement shows a red-tinted ghost (Phaser `sprite.setTint(0xff0000)`) and is rejected.
- **Rotation:** Belts and directional machines need a rotate control (`R` key or button), 90° increments. **Implementation win from going flat top-down:** you can rotate the *same* sprite via `sprite.setAngle(90 * rotationState)` instead of drawing 4 separate directional sprite variants — but only if the art has neutral top-down lighting (see §10 art constraint). Don't undermine this by sourcing/commissioning art with baked-in directional shadow.
- **Connections:** Belts connect automatically to adjacent belt/machine ports facing the correct direction. Machines have explicit input/output port cells (e.g. Smelter: 1 input side, 1 output side), defined per machine type in a data table, not hardcoded per-instance.
- **Deletion/move:** Right-click or a "demolish" tool to remove. "Move mode" is v2+, not MVP.

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

**Deliberately excluded from v1 (flag as v2+/stretch):** power/electricity grid, multi-recipe machine switching UI, machine module/upgrade slots, belt splitters/mergers with priority logic, pipes/fluids.

---

## 7. Resource & Production Chain (v1 content)

**Tier 0 — Raw (Extractors):** Copper Ore, Iron Ore, Coal, Stone

**Tier 1 — Refined (Smelters):**
- Copper Ore → Copper Ingot
- Iron Ore + Coal → Iron Ingot
- Stone → Refined Stone

**Tier 2 — Components (Assemblers):**
- Copper Ingot ×2 → Wire
- Iron Ingot ×2 → Gear
- Iron Ingot + Refined Stone → Plate

**Tier 3 — Products (Assemblers, sold at Depot):**
- Wire + Gear → Circuit
- Plate ×2 + Gear → Frame
- Circuit + Frame → Motor (highest v1 sell value)

Sell values scale roughly exponentially by tier. Tier 0 raw sells for near-nothing directly to discourage selling raw.

---

## 8. Data Model / Save Schema

```json
{
  "version": 1,
  "lastSavedAt": 1234567890,
  "currency": 0,
  "prestige": {
    "points": 0,
    "totalPrestiges": 0,
    "permanentMultipliers": {
      "productionSpeed": 1.0,
      "sellValue": 1.0
    }
  },
  "unlocked": {
    "machines": ["extractor", "belt", "smelter"],
    "recipes": ["copperIngot", "ironIngot"]
  },
  "grid": {
    "width": 64,
    "height": 64,
    "tileSizePx": 64,
    "entities": [
      {
        "id": "uuid",
        "type": "extractor",
        "x": 10,
        "y": 12,
        "rotation": 0,
        "level": 1,
        "resourceNode": "copperOre"
      }
    ]
  },
  "productionChains": {
    "chainId": {
      "steadyStateThroughput": 2.5,
      "outputResource": "copperIngot"
    }
  }
}
```

Version the schema now, even at v1 — write a migration stub function even if it's currently a no-op, so a future format change doesn't wipe player saves. `rotation` on an entity is a 2D sprite angle (0/90/180/270), and `tileSizePx` is a concrete rendering constant tied to the sprite dimensions locked in §10 — don't leave it implicit.

---

## 9. UI/UX Spec (React overlay)

- **HUD (always visible):** Currency total, currency/sec rate, prestige points, a "Prestige" button (disabled until threshold hit).
- **Build panel:** Bottom or side dock, icons for each unlocked machine, click to enter placement mode.
- **Info panel on hover/select:** Click a placed machine → side panel shows current throughput, upgrade button, demolish button.
- **Tech/Unlock tree:** Separate modal/panel — spend currency to unlock next-tier recipes and machines.
- **Offline summary modal:** Shown once on load if `elapsed > threshold` (e.g. 1 minute).
- **Notifications/toasts:** Minimal — "New recipe unlocked," "Storage full," etc.

**No responsive/mobile layout work for this version** — PC only. Don't add touch-event handling, don't build a responsive breakpoint system for the HUD. If mobile is ever wanted later, treat it as a separate pass, not a "should also work on phones" constraint on this build.

---

## 10. Art & VFX Spec

### Art requirement (non-negotiable per your brief)
Proper sprite artwork is a hard requirement for v1 — **this is not a "boxes and grid squares" prototype.** Concretely this means:
- Every machine type (Extractor, Belt, Smelter, Assembler, Storage Silo, Depot) needs a distinct, readable top-down sprite, at minimum in an idle/active state (active = subtly animated, e.g. a 2–4 frame loop, not just a static image).
- Every resource type (raw/refined/component/product, ~13 items across all tiers per §7) needs a distinct small icon sprite, both for the belt-item visual and for UI icons (build panel, info panel).
- **Art source decision — flag before Phase 0 art work starts, don't default silently:** either (a) commission/create custom art in one consistent style, or (b) source a single cohesive free/paid asset pack (e.g. from itch.io or Kenney.nl) and stick to *one* pack rather than mixing several — mixing packs from different artists is the single most common way a 2D tycoon game ends up looking inconsistent despite each individual asset being "proper art." Pick one path and lock it before building placement/rotation logic against real sprite dimensions.
- **Hard art constraint, tied to §5's rotation approach:** sprites must be drawn with neutral, top-down (non-directional) lighting. No baked-in drop shadows implying a light source from one side. If the sourced/commissioned art has directional shadow, the 90°-rotation trick in §5 will look visibly broken (shadows pointing the wrong way after rotation), and you'd be forced into drawing 4 sprite variants per rotatable machine instead of 1 — budget for this explicitly if you can't get neutral-lit art.
- Lock a tile/sprite pixel size (recommend 64×64px for readability with room for detail, 32×32 if going for a denser/smaller-scale look) before sourcing — resizing a whole pack after the fact is wasted work.

### VFX (must-have per your brief, Phaser-native — no shaders)
- **Belt-item glow:** additive-blend sprite tint or a small looping glow-sprite behind/under the item sprite, colored per resource type, so resource types are distinguishable at a glance while moving.
- **Smelter heat-shimmer:** not a real shader effect (no shader layer in this stack) — approximate with a color-pulse animation (alternating tint/alpha) on the smelter's active-state sprite while processing, or a small Phaser particle emitter emitting faint upward "heat" particles from the output port.
- **Depot sale burst:** Phaser particle emitter, short burst (coin/spark particles) triggered on each completed sale.
- Keep this list short for v1 — VFX is polish on top of a working loop, not the other way around. Don't add particle effects to machines/events not listed here without checking it against the actual gameplay-clarity value first.

---

## 11. Build Phases (mandatory — do not build all systems in parallel)

**Phase 0 — Tech Spike**
Phaser scene setup, top-down camera + pan/zoom, tilemap grid rendering, one placeable placeholder sprite, click-to-place on grid, currency number ticking up on a timer. **Also in this phase: lock the art source/pack decision and the tile pixel size** (§10) — don't let Phase 1+ proceed on a placeholder-art assumption that then has to be retrofitted.

**Phase 1 — MVP Core Loop**
Extractor → Belt → Depot with 2 raw resource types sold directly (skip processing this phase). Real sprites for these 3 machine types + 2 resource icons (not placeholders — per §10, this is where "proper art" starts, not a later polish pass). React HUD showing currency + rate. `localStorage` save/load with the v2 schema. Offline progress calculation (bare-bones summary UI acceptable).

**Phase 2 — Production Chain**
Smelter + Assembler, full Tier 0→3 resource chain (§7), recipe unlock tree, machine upgrade (speed/output) system, remaining machine/resource sprites, build panel UI polish.

**Phase 3 — Prestige & Depth**
Prestige reset + permanent multiplier system, currency-curve balance pass, grid expansion unlock.

**Phase 4 — VFX & Polish**
Particle emitters and animation states from §10, sound effects, animation polish, performance pass on the simulation store for larger grids (dirty-flagging/spatial partitioning so idle machines aren't recomputed every tick).

**Explicit non-goals — do not build unless separately requested:** multiplayer/co-op, combat/enemies, mobile/touch controls, responsive layout, monetization/IAP, backend accounts/cloud sync, power grid system, fluid/pipe systems.

---

## 12. Open Risks (advisory, not implementation tasks)

- **Art consistency is the highest-risk item here** — sprite packs from different sources mismatch stylistically far more easily than most people expect going in. Lock the source in Phase 0 as stated in §11 — revisiting this mid-Phase-2 after 20 sprites exist in two different styles is expensive.
- **Directional-lighting-in-art risk** (§10/§5): if this constraint gets missed when sourcing/commissioning art, you lose the single-sprite-rotation efficiency and it becomes a late-discovered scope increase (4x sprite variants for every rotatable machine). Check this on the first sprite delivered, not after all of them are.
- **Grid simulation performance at scale:** once players have hundreds of belts/machines, naive per-tick iteration over every entity will get slow — recommend dirty-flag/spatial chunking in the sim store from Phase 2 onward.
- **Balance is unproven:** the Tier 0→3 sell-value curve is a starting hypothesis; expect iteration once Phase 2 is playable.
- **"Open-ended, no defined end" still needs a v1 content ceiling.** The phase plan above is the scope boundary — anything past Phase 4 is backlog.
