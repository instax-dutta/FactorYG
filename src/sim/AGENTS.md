## Purpose

Own deterministic Factor-I simulation state and production rules.

## Ownership

- `types.ts` defines the simulation and save-facing contracts.
- `constants.ts` locks tick, grid, tile, and economy constants.
- `grid.ts` and `rotation.ts` own coordinate transforms.
- `placement.ts` and `connections.ts` own validation and port connectivity.
- `machines.ts`, `economy.ts`, `tick.ts`, and `offline.ts` own production and sales.
- `chains.ts` owns production chain discovery and steady-state throughput.
- `commands.ts` owns unlock purchases for machines and recipes and the entity level upgrade.
- `store.ts` owns private state, commands, snapshots, and the fixed-step driver.
- `initialState.ts` owns deterministic new-game world creation.

## Local Contracts

- Simulation modules are pure TypeScript and never import React, Phaser, DOM, or persistence.
- Production advances on a fixed 10 Hz logical clock, never Phaser render frames.
- Runtime-only fields such as tick samples and offline summaries are not save data; `bufferedResource` is save data.
- Extractor progress is a normalized fractional cycle accumulator below one: a full output buffer pauses progress, and a partly filled buffer accepts as many whole cycles as fit in that tick and drops the credit for the rest, so a level above the table interval cannot inflate the progress accumulator the save stores.
- Processor progress is a discrete recipe-tick counter; inputs are charged once when a run starts, a blocked completion holds the counter only while the recipe remains valid, and an unresolvable recipe discards the run so a later run must pay again.
- A silo is shared storage, not a processor: the first accepted resource locks in `bufferedResource` until the shared pool empties, capacity is enforced exactly at the acceptance boundary, and a refused acceptance consumes nothing.
- A machine-to-belt transfer withdraws only what one belt cell can carry and leaves the remainder buffered, so a push never destroys units.
- A machine-to-machine transfer accepts only the input room the target has left for that resource and leaves the remainder buffered. For `separate` buffers `inputBuffer` is a per-resource limit, not a buffer total, so a mixed buffer may hold several times the table value. A transfer that fits no unit is refused and changes neither machine. Shared storage stays all-or-nothing, so a shared target also refuses a partially fitting transfer even when room remains.
- `storageFull` is emitted on the transition into a full shared pool, never on every tick it stays full.
- An unlock purchase validates identity, prior ownership, prerequisites, and cost before any mutation, then commits the currency debit, the unlocked ID, and one success notification in a single state transition, so a purchase can never debit without unlocking or unlock without debiting.
- Unlock rejection reasons are `unknownUnlock`, `alreadyUnlocked`, `prerequisiteLocked`, and `insufficientCurrency`, and the prerequisite reason is reported before the balance reason. A rejection returns the same state object, so no snapshot and no notification is published.
- An unlock notification is keyed `unlock-machine-<id>` or `unlock-recipe-<id>` and stamps `createdAt` from the logical `tickCount`, keeping notifications deterministic.
- An upgrade prices the level being left as `baseCost * level * level` from the machine cost table, validates identity, machine type, and cost before any mutation, then commits the currency debit, the level increase, and one success notification in a single state transition, so an upgrade can never debit without raising the level or raise the level without debiting.
- Upgrade rejection reasons are `entityNotFound`, `unsupportedMachine`, and `insufficientCurrency`, reported in that order. `unsupportedMachine` covers every machine type a level cannot affect, so a machine that only transports or stores can never be bought for nothing. A rejection returns the same state object, so no snapshot and no notification is published.
- An upgrade notification is keyed `upgrade-<entityId>`, names the new level, and stamps `createdAt` from the logical `tickCount`.
- The store routes the `upgradeEntity` command to `upgradeEntity` and exposes `canUpgrade(entityId)`, so the ghost preview and the dispatch share one validator.
- The level scales the extractor rate, the processor effective duration, and the machine output capacity. The extractor rate is uncapped, so a level above the table interval emits more than one unit per tick instead of buying a dead level, while the effective duration still saturates at one tick. The effective duration stays a whole number of recipe ticks, so processor progress remains a discrete counter, inputs are still charged once per run, and an upgrade applied to an in-flight run shortens that run instead of restarting it.
- An extractor is `active` on every tick its output buffer is not full, whether or not a cycle completed, so a machine state event fires once when a full buffer pauses it and once when it resumes; a processor keeps its own per-run meaning.
- A sale sample records the tick, the currency earned, the machine that sold, and the resource it sold, so the rolling window can be read per machine and per resource. The extra fields are runtime-only and are never save data.
- Chain analysis follows only valid directed port connections from `connections.ts` and never grid adjacency: a machine links to the machine standing on its output port only when `arePortsConnected` accepts the pair, so a rotated machine or an input port that refuses the resource breaks the chain.
- A chain is a maximal directed path keyed `chain-<firstEntityId>`, and results are ordered by chain id. A path with no producer reports no chain, so a bare belt or depot is not a production chain, and two branches stay separate because each is keyed by its own first entity rather than merged by resource.
- A chain's output resource is what its last producer emits, which is the resource a terminal sale sells, and a chain that reaches no sale reports zero throughput.
- `steadyStateThroughput` is realized output units per second, measured from the rolling window in `economy.ts` as the currency the chain's own terminal sale recorded, divided by the resource sell value, the permanent sell multiplier, and the window length. It is zero before a full window exists and is never a static table rate, and `getSteadyStateThroughput` is the sum of the chain throughputs.
- Level one is the identity for the level model: an unupgraded machine keeps its table rate, its table recipe duration, and its table output capacity. `canRunRecipe`, `consumeRecipeInputs`, and `completeRecipe` take the entity rather than a level, so no caller can read an unleveled capacity by omitting an argument.
- Content tables and shared types remain the single source of truth.

## Work Guidance

- Write a failing behavior test before changing simulation code.
- Keep command validation shared between UI ghost previews and dispatch.
- Preserve deterministic event ordering for render consumers.

## Verification

- `npm run test -- tests/unit/upgrades.test.ts`
- `npm run test -- tests/unit/chains.test.ts`
- `npm run test`
- `npm run lint`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/sim/`.
