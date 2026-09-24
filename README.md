# Factor-Y

A 2.5D isometric idle factory game for the browser. Build extraction and processing lines, automate the full ore-to-Motor economy, expand the plot, and prestige for permanent multipliers.

## Features

- Fixed isometric three.js world with bounded pan and zoom
- Extractor, Belt, Crossing, Splitter, Smelter, Assembler, Silo, and Depot machines
- Complete Tier 0-3 production chain from raw resources to Motors
- Tech tree, machine upgrades, backpressure, silos, belt runs, move, and undo
- Versioned localStorage saves with validation, quarantine, and recovery
- Offline production based on persisted sellable-output throughput
- Manual pause, save status, notifications, and player-facing resource labels
- Pointer and keyboard map controls
- Accessible dialogs, live status regions, responsive overlays, and contrast checks
- Prestige progression and grid expansion

## Tech Stack

- React 19
- TypeScript 7
- three.js
- Zustand
- Vite 8
- Vitest
- Playwright

## Quick Start

Requirements: Node.js with npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Commands

```bash
npm run dev        # Start the development server
npm test           # Run the unit suite
npm run typecheck  # Run TypeScript checks
npm run build      # Typecheck and create a production build
npm run preview    # Preview the production build
npm run e2e        # Run the Playwright browser suite
```

## Controls

- `R` rotates the selected machine
- Click places or inspects
- Right-click demolishes
- Drag pans the camera
- Wheel zooms
- `WASD` or arrow keys pan the camera
- Shift-drag moves a placed machine
- `Cmd/Ctrl+Z` undoes an edit
- With the canvas focused, arrow keys move the keyboard cell cursor
- `Enter` or `Space` inspects or places
- `X` demolishes

## Architecture

- `src/sim/` owns game state, production, progression, persistence, and fixed-step simulation.
- `src/render/` owns the three.js scene, camera, meshes, input, and simulation lifecycle.
- `src/ui/` owns React overlays and throttled Zustand projections of simulation state.
- `tests/` contains unit and integration coverage.
- `e2e/` contains real-browser acceptance and playtest coverage.

The simulation runs independently at 10 ticks per second. React snapshots are throttled to 10 Hz, and game logic does not depend on render frame rate.

## Current Status

The Phase 0-3 gameplay and stabilization scope is implemented. The current release gate has 449 unit tests and 77 Playwright tests passing with no skipped tests.

Phase 4 remains intentionally deferred:

- Ore glow, smelter heat shimmer, and depot sale VFX
- Entity/item instancing and the real-hardware 60 FPS target
- Mobile touch controls
- Explicit recipe picker
- Strict FIFO silo behavior
- Belt and silo upgrade progression

## Project Documents

- Product specification: [`factory-idle-game-spec.md`](factory-idle-game-spec.md)
- Current architecture and handoff: [`HANDOFF.md`](HANDOFF.md)
- Playtest history and confirmed bug audit: [`PLAYTEST.md`](PLAYTEST.md)
- Stabilization plan: [`docs/superpowers/plans/2026-09-24-stabilization.md`](docs/superpowers/plans/2026-09-24-stabilization.md)

## Repository

Private development repository: `instax-dutta/FactorYG`
