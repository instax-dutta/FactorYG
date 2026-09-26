<div align="center">

# Factor-Y

**A 2.5D isometric idle factory game that runs in your browser.**

Build extraction and processing lines, automate the full ore-to-Motor economy,
expand your plot, and prestige for permanent multipliers.

[Play locally](#quick-start) · [Controls](#controls) · [Architecture](#architecture) · [Contributing](#contributing) · [GPL-3.0](LICENSE)

</div>

---

Factor-Y is an open-source factory-automation game. The factory floor is not a
puzzle to solve — it is the visualization of an idle/tycoon economy. You place
extractors, belts, and processors on a grid, resources visibly flow through the
chain, and the output funds upgrades, expansion, and prestige resets.

No accounts, no server, no backend. The game runs entirely in the browser and
saves to `localStorage`.

## Screens

| | |
|---|---|
| Isometric three.js world with bounded pan and zoom | Tier 0-3 production chain ending in Motors |
| Build, inspect, and demolish with mouse or keyboard | Tech tree, machine upgrades, and grid expansion |
| Prestige for permanent multipliers | Versioned saves with validation and recovery |

## Features

**Factory**
- Eight placeable machine types: Extractor, Belt, Crossing, Splitter, Smelter, Assembler, Silo, and Depot
- Complete Tier 0-3 chain across 13 items, from raw ore through Motors
- Belt backpressure, buffered silos, and belt-run drag placement
- Tech tree unlocks, per-machine upgrade levels, and recipe unlocks
- Grid expansion and prestige progression

**Platform**
- Fixed-step simulation at 10 ticks/second, fully decoupled from render frame rate
- Offline production, credited on return from persisted sellable-output throughput
- Versioned `localStorage` saves with validation, quarantine, and corrupt-save recovery
- Autosave, manual pause, and save status reporting
- Mouse, keyboard, and full keyboard cell-cursor play
- Accessible dialogs, live status regions, and contrast-checked UI

## Tech Stack

React 19 · TypeScript · three.js · Zustand · Vite · Vitest · Playwright

## Quick Start

Requires Node.js 20.19+ (or 22.12+).

```bash
git clone https://github.com/instax-dutta/FactorYG.git
cd FactorYG
npm install
npm run dev
```

Then open the local URL printed by Vite (usually `http://localhost:5173`).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm test` | Run the unit and integration suite |
| `npm run test:watch` | Run the unit suite in watch mode |
| `npm run e2e` | Run the Playwright browser suite |
| `npm run typecheck` | Run TypeScript checks |
| `npm run build` | Typecheck and create a production build |
| `npm run preview` | Preview the production build |

`npm run e2e` needs browsers installed once: `npx playwright install chromium`.

## Controls

| Input | Action |
|---|---|
| Click | Place the selected machine, or inspect an existing one |
| Right-click | Demolish |
| Drag | Pan the camera |
| Wheel | Zoom |
| `W` `A` `S` `D` / arrows | Pan the camera |
| `R` | Rotate the selected machine |
| Shift-drag | Move a placed machine |
| `Cmd/Ctrl+Z` | Undo an edit |
| Arrows (canvas focused) | Move the keyboard cell cursor |
| `Enter` / `Space` | Inspect or place at the cursor |
| `X` | Demolish at the cursor |

## Architecture

```
src/sim/     game state, production, progression, persistence, fixed-step simulation
src/render/  three.js scene, isometric camera, meshes, input, simulation lifecycle
src/ui/      React overlays and throttled Zustand projections of simulation state
tests/       unit and integration coverage (449 tests)
e2e/         real-browser acceptance and playtest coverage
docs/SPEC.md the design document the implementation follows
```

Three layers, and the boundaries between them are load-bearing:

- The simulation runs independently at 10 ticks per second and never depends on
  React or on the render frame rate.
- React is an overlay. It receives throttled 10 Hz snapshots of simulation state
  through Zustand selectors, so UI re-renders cannot perturb the factory.
- Persistence is versioned JSON in `localStorage`, with explicit validation and
  a quarantine path so a bad save degrades instead of corrupting.

Because the tick loop is authoritative and deterministic, offline production is
reconstructed rather than faked: throughput is persisted, and returning players
are credited for elapsed time at their last measured sellable rate.

## Testing

The balance contract in `src/sim/balance.ts` is asserted in `tests/balance.test.ts`,
so re-tuning the economy is a deliberate act rather than a silent regression. The
browser suite includes a 326-cell Act 3 playthrough that builds a full motor factory
through the real UI and asserts that it sells its first Motor.

## Project Status

Phase 0-3 of the design in [`docs/SPEC.md`](docs/SPEC.md) are implemented. The current
gate is 449 unit tests and 77 Playwright tests passing, with no skipped tests.

Planned and not yet implemented:

- Ore glow, smelter heat shimmer, and depot sale VFX
- Entity instancing and a 60 FPS target on real hardware
- Mobile touch controls
- Explicit recipe picker
- Strict FIFO silo behavior
- Belt and silo upgrade progression

## Contributing

Issues and pull requests are welcome. Please read [`docs/SPEC.md`](docs/SPEC.md)
first — the design decisions behind the current implementation are documented
there, and a change that contradicts it should change that document too.

Before opening a pull request:

```bash
npm run typecheck
npm test
npm run e2e
```

Keep game logic in `src/sim/` free of React and three.js imports. If you change
the economy, update the balance contract test in the same commit.

## License

Factor-Y is free software, licensed under the **GPL-3.0-or-later**. See
[`LICENSE`](LICENSE) for the full text.

The game is a community project. Contributions are accepted under the same terms.
