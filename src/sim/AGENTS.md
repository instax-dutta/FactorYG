## Purpose

Own deterministic Factor-I simulation state and production rules.

## Ownership

- `types.ts` defines the simulation and save-facing contracts.
- `constants.ts` locks tick, grid, tile, and economy constants.
- `grid.ts` and `rotation.ts` own coordinate transforms.
- `placement.ts` and `connections.ts` own validation and port connectivity.
- `machines.ts`, `economy.ts`, `tick.ts`, and `offline.ts` own production and sales, and `tick.ts` sells through the sale terminals the machine table declares.
- `chains.ts` owns production chain discovery and steady-state throughput.
- `prestige.ts` owns the prestige points formula and the single eligibility validator, and the snapshot's `prestigeReady` flag reads that validator instead of repeating the threshold.
- `commands.ts` owns unlock purchases for machines and recipes, the entity level upgrade, and the prestige reset with its `canResetPrestige` preflight and `getPermanentMultipliers` read.
- `store.ts` owns private state, commands, snapshots, the fixed-step driver, and the read-only `getActiveMachineIds` and `getBlockedMachineIds` views a renderer reads instead of simulating.
- `initialState.ts` owns deterministic new-game world creation and `createResetState`, the one constructor for a post-prestige world. Resource nodes are scattered across the whole grid, eight per raw type, rather than banded into quadrants, so a straight belt line can carry any resource to any part of the map. Banded nodes made the deep production chain arithmetically unreachable: a two-raw smelter could only be fed from one band, and no two bands overlapped.

## Local Contracts

- Simulation modules are pure TypeScript and never import React, Phaser, DOM, or persistence.
- Production advances on a fixed 10 Hz logical clock, never Phaser render frames.
- Runtime-only fields such as tick samples and offline summaries are not save data; `bufferedResource` and `alreadyNotifiedBlocked` are save data, and the `blockedRefusalTicks` debounce counter is runtime-only and is never projected.
- Extractor progress counts unemitted whole cycles plus the fractional cycle: a full output buffer pauses progress, a partly filled buffer accepts as many whole cycles as fit in that tick and banks the rest, and the bank is capped at the machine's output capacity, so the progress the save stores is always bounded and drains the instant a slot frees. At a per-tick rate of one cycle or more, credit past that cap is discarded rather than banked.
- Processor progress is a discrete recipe-tick counter; inputs are charged once when a run starts, a blocked completion holds the counter only while the recipe remains valid, and an unresolvable recipe discards the run so a later run must pay again.
- A silo is shared storage, not a processor: the first accepted resource locks in `bufferedResource` until the shared pool empties, capacity is enforced exactly at the acceptance boundary, and a refused acceptance consumes nothing.
- A machine-to-belt transfer withdraws only what one belt cell can carry and leaves the remainder buffered, so a push never destroys units.
- A machine-to-machine transfer accepts only the input room the target has left for that resource and leaves the remainder buffered. For `separate` buffers `inputBuffer` is a per-resource limit, not a buffer total, so a mixed buffer may hold several times the table value. A transfer that fits no unit is refused and changes neither machine. Shared storage stays all-or-nothing, so a shared target also refuses a partially fitting transfer even when room remains.
- `storageFull` is emitted on the transition into a full shared pool, never on every tick it stays full.
- A machine that cannot hand off goods to its connected target is a candidate for blocked, and `alreadyNotifiedBlocked` is the save-data record of a confirmed block. A machine is a candidate when it holds at least one unit of a storable resource, has a connected target, and that target accepts none of what it offers, whether the target is a full shared pool, a full input buffer, or an occupied belt cell. A machine with no target at all is buffering, not blocked, and a machine that transfers anything at all is never blocked on that tick, so a mixed buffer that moves one resource while another is refused stays unflagged.
- A refusal alone is not a block, because a saturated but healthy line refuses its producer on most ticks while still delivering every unit it can. The flag is set only after `BLOCKED_REFUSAL_TICKS_REQUIRED` consecutive refused ticks, which is two: in a saturated line refusals interleave with successes so the run never reaches two, and in a genuine jam the refusal is unbounded so the second tick confirms it. The counter is capped at the threshold so a long block cannot grow without bound, and it is cleared the moment the machine moves anything, so demolishing the refusing target clears the block.
- A confirmed block survives a reload through `alreadyNotifiedBlocked`, and a reloaded blocked machine stays flagged without re-announcing itself, so the renderer resumes the blink and never emits a duplicate `blockedFull`.
- `blockedFull` is emitted on the transition into a blocked producer and never again while it stays blocked. It is about the refused producer, not the refusing target: a full silo emits `storageFull` for itself and `blockedFull` for the machine pushing into it, and a blocked producer is not necessarily the machine that is full.
- Blocked feedback needs no belt state. `moveBelts` refuses a cell that is occupied at the start of the tick, so a jam already propagates backward through a line and every item stays where it was. Running the machine handoff before or after `moveBelts` makes no difference to a saturated line: the line settles into one travelling hole, so the head cell is occupied on all but one tick in `N` however the two steps are ordered. The debounce, not the ordering, is what separates a jam from a saturated line.
- An unlock purchase validates identity, prior ownership, prerequisites, and cost before any mutation, then commits the currency debit, the unlocked ID, and one success notification in a single state transition, so a purchase can never debit without unlocking or unlock without debiting.
- Unlock rejection reasons are `unknownUnlock`, `alreadyUnlocked`, `prerequisiteLocked`, and `insufficientCurrency`, and the prerequisite reason is reported before the balance reason. A rejection returns the same state object, so no snapshot and no notification is published.
- An unlock notification is keyed `unlock-machine-<id>` or `unlock-recipe-<id>` and stamps `createdAt` from the logical `tickCount`, keeping notifications deterministic.
- An upgrade prices the level being left as `baseCost * level * level` from the machine cost table, validates identity, machine type, and cost before any mutation, then commits the currency debit, the level increase, and one success notification in a single state transition, so an upgrade can never debit without raising the level or raise the level without debiting.
- Upgrade rejection reasons are `entityNotFound`, `unsupportedMachine`, and `insufficientCurrency`, reported in that order. `unsupportedMachine` covers every machine type a level cannot affect, so a machine that only transports or stores can never be bought for nothing. A rejection returns the same state object, so no snapshot and no notification is published.
- An upgrade notification is keyed `upgrade-<entityId>-l<level>`, names the new level, and stamps `createdAt` from the logical `tickCount`. The level belongs in the key because one entity can be upgraded repeatedly, so a key that is stable per entity would collide as a render key, repeat a `data-testid`, and make one dismiss remove every message for that entity.
- The store routes the `upgradeEntity` command to `upgradeEntity` and exposes `canUpgrade(entityId)`, so the ghost preview and the dispatch share one validator.
- The level scales the extractor rate, the processor effective duration, and the machine output capacity. The extractor rate is uncapped, so a level above the table interval emits more than one unit per tick instead of buying a dead level, while the effective duration still saturates at one tick. The effective duration stays a whole number of recipe ticks, so processor progress remains a discrete counter, inputs are still charged once per run, and an upgrade applied to an in-flight run shortens that run instead of restarting it.
- A sale terminal is declared in the machine table with `saleTerminal`, and both the sales tick and chain analysis read that flag instead of naming a machine type, so a new selling machine needs a content entry and nothing else.
- An extractor is `active` on every tick its output buffer is not full, whether or not a cycle completed, so a machine state event fires once when a full buffer pauses it and once when it resumes; a processor keeps its own per-run meaning.
- A sale sample records the tick, the currency earned, the machine that sold, and the resource it sold, so the rolling window can be read per machine and per resource. The extra fields are runtime-only and are never save data.
- Chain analysis follows only valid directed port connections from `connections.ts` and never grid adjacency: a machine links to the machine standing on its output port only when `arePortsConnected` accepts the pair, and a belt link is validated with the item the belt is carrying, the same argument the deposit step passes, so the analyzer never walks a link the simulation would refuse. A belt holding nothing is linked by port geometry alone, which is what a belt-to-belt move already assumes.
- A chain is a maximal directed path keyed `chain-<firstEntityId>`, and results are ordered by chain id. A path with no producer reports no chain, so a bare belt or depot is not a production chain, and two branches stay separate because each is keyed by its own first entity rather than merged by resource.
- A directed cycle has no root, so every member of a cycle starts its own chain, cut at the machine that closes the loop, and a cycle reports one chain per member rather than collapsing into one and dropping the rest. A machine with more than one successor is walked through its first successor in sorted order, which is exact today because every shipped machine has at most one output port and becomes a documented limit the day one does not.
- A cell that holds two entities belongs to the first entity id in sorted order, so a corrupt or overlapping world analyzes the same way whatever order its entity list uses.
- A chain's output resource is what its last producer emits, which is the resource a terminal sale sells, and a chain that reaches no sale reports zero throughput.
- Each sale terminal belongs to exactly one chain, the claiming chain whose id sorts first, so a terminal several branches reach is measured once and the summed chain throughputs equal the world's real rate. Chains stay distinct and every other claimant reports zero.
- `steadyStateThroughput` is realized output units per second, measured from the rolling window in `economy.ts` as the currency a chain's own claimed sale terminal recorded, divided by the resource sell value, the permanent sell multiplier, and the window length. It is zero before a full window exists and is never a static table rate, and `getSteadyStateThroughput` is the sum of the chain throughputs.
- The store's save view is the live state, because the runtime save path measures chains from the rolling window, while `projectSaveGame` still writes only `SaveGame` fields.
- Level one is the identity for the level model: an unupgraded machine keeps its table rate, its table recipe duration, and its table output capacity. `canRunRecipe`, `consumeRecipeInputs`, and `completeRecipe` take the entity rather than a level, so no caller can read an unleveled capacity by omitting an argument.
- Prestige points are `floor(sqrt(lifetimeCurrency / PRESTIGE_THRESHOLD))`, dividing by the one shared `PRESTIGE_THRESHOLD` in `constants.ts` rather than a private literal, so a second threshold definition cannot drift. The formula floors, so the first point lands exactly at the threshold, each later point needs a whole perfect square of the scaled lifetime, and a value just below a square still earns the lower count rather than a rounded one.
- Points and eligibility are separate rules. `canPrestige` is true from the threshold inclusive, so a state at the threshold and one just above it are both eligible, and it reads lifetime currency while ignoring the spendable balance, because spending currency never lowers lifetime currency.
- A lifetime that is negative or not finite is unusable rather than large. `calculatePrestigePoints` returns zero instead of `NaN` or a negative count, and `canPrestige` is false, so a corrupt save can never be prestige-eligible for a payout worth nothing. Both reject on one finite non-negative check rather than special-casing each bad value.
- Prestige points and eligibility read no clock and no random source, so one lifetime value always produces the same points and the same eligibility answer.
- A prestige reset validates eligibility through `canResetPrestige`, which reads the same `canPrestige` validator the snapshot and the preflight accessor use, and it commits the whole reset in one state transition. A rejection returns the same state object, so no snapshot and no notification is published, and the refusal reason is `insufficientLifetimeCurrency`.
- The reset state is built by `createResetState` from a fresh initial world, so the currency returns to `STARTING_CURRENCY`, the grid entities, machine runtimes, belts, and chain summaries are dropped, the entity sequence, tick count, and sale samples restart, and selection, placement mode, and the offline summary are cleared. The pre-existing state is never mutated, because the reset constructs a new world rather than emptying the old one.
- Only the prestige block survives a reset. Points, the prestige count, and the permanent multipliers are banked into the new world; lifetime currency, spendable currency, paid unlocks, levels, and the built grid are not, so a paid machine must be purchased again and the free starting unlock set is restored.
- A permanent multiplier is derived from the banked point count, `1 + points * PRESTIGE_PRODUCTION_BONUS_PER_POINT` and `1 + points * PRESTIGE_SELL_BONUS_PER_POINT`, and the reset stores that derived value in the state. The getter and the stored field therefore cannot disagree, and the award is applied once per reset rather than on every read or tick, because nothing multiplies the running state.
- The reset world is immediately serializable: every machine and belt record belongs to a surviving entity because the world is rebuilt whole, so a save written straight after a reset validates rather than failing on a dangling reference. The reset carries the new-game `lastSavedAt`, and the autosave projection stamps the current time, so a reset cannot claim offline time.
- The store routes the `prestige` command to `performPrestige` and exposes `canResetPrestige()` and `getPermanentMultipliers()`, so the reset button and the dispatch cannot disagree.
- Content tables and shared types remain the single source of truth.

## Work Guidance

- Write a failing behavior test before changing simulation code.
- Keep command validation shared between UI ghost previews and dispatch.
- Preserve deterministic event ordering for render consumers.

## Verification

- `npm run test -- tests/unit/upgrades.test.ts`
- `npm run test -- tests/unit/chains.test.ts`
- `npm run test -- tests/unit/blockedProducer.test.ts`
- `npm run test -- tests/unit/prestige.test.ts`
- `npm run test -- tests/integration/prestigeReset.test.ts`
- `npm run test`
- `npm run lint`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/sim/`.
