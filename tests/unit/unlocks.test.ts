import { describe, expect, it, vi } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { RECIPES } from "../../src/content/recipes";
import { applyPlacement, validatePlacement } from "../../src/sim/placement";
import {
  applyUnlock,
  canUnlock,
  unlockMachine,
  unlockRecipe,
  type UnlockTarget,
} from "../../src/sim/commands";
import { createInitialState } from "../../src/sim/initialState";
import type { PlaceEntityCommand } from "../../src/sim/placement";
import { SimulationStore } from "../../src/sim/store";
import type { MachineType, SimulationSnapshot, SimulationState } from "../../src/sim/types";

const SMELTER_CELL = { x: 2, y: 2 };

describe("locked entries", () => {
  it("refuses a locked recipe placement and accepts it only after purchase", () => {
    const state = fundedState();
    const withSmelter = unlockMachine(state, { type: "unlockMachine", machine: "smelter" });

    expect(validatePlacement(withSmelter.state, smelterCommand("copperIngot"))).toEqual({
      ok: false,
      reason: "missingRecipe",
    });

    const withRecipe = unlockRecipe(withSmelter.state, { type: "unlockRecipe", recipeId: "copperIngot" });

    expect(withRecipe.result).toEqual({ ok: true });
    expect(validatePlacement(withRecipe.state, smelterCommand("copperIngot"))).toEqual({ ok: true });
  });

  it("refuses a placement that carries no recipe for a processor", () => {
    const state = fundedState();
    const withSmelter = unlockMachine(state, { type: "unlockMachine", machine: "smelter" });

    expect(validatePlacement(withSmelter.state, smelterCommand())).toEqual({
      ok: false,
      reason: "missingRecipe",
    });
  });

  it("refuses a locked machine placement until the machine is purchased", () => {
    const state = fundedState();

    expect(validatePlacement(state, beltCommand())).toEqual({ ok: true });
    expect(validatePlacement(state, siloCommand())).toEqual({
      ok: false,
      reason: "lockedMachine",
    });

    const purchased = unlockMachine(state, { type: "unlockMachine", machine: "silo" });

    expect(purchased.result).toEqual({ ok: true });
    expect(validatePlacement(purchased.state, siloCommand())).toEqual({ ok: true });
  });

  it("refuses an entry that is already free or unknown", () => {
    const state = fundedState();
    const freeMachine = unlockMachine(state, { type: "unlockMachine", machine: "belt" });
    const unknownRecipe = unlockRecipe(state, { type: "unlockRecipe", recipeId: "not-a-recipe" });

    expect(freeMachine.result).toEqual({ ok: false, reason: "unknownUnlock" });
    expect(freeMachine.changed).toBe(false);
    expect(freeMachine.state).toBe(state);
    expect(freeMachine.notification).toBeUndefined();
    expect(unknownRecipe.result).toEqual({ ok: false, reason: "unknownUnlock" });
    expect(unknownRecipe.changed).toBe(false);
    expect(unknownRecipe.state).toBe(state);
    expect(unknownRecipe.notification).toBeUndefined();
    expect(state.currency).toBe(10_000);
    expect(state.unlocked.machines).toEqual(["extractor", "belt", "depot"]);
    expect(state.unlocked.recipes).toEqual([]);
  });

  it("publishes no snapshot for an unknown unlock", () => {
    const store = new SimulationStore(fundedState());
    const listener = vi.fn();
    const before = store.getSnapshot();
    store.subscribe(listener);

    expect(store.dispatch({ type: "unlockMachine", machine: "extractor" })).toEqual({
      ok: false,
      reason: "unknownUnlock",
    });
    expect(store.dispatch({ type: "unlockRecipe", recipeId: "not-a-recipe" })).toEqual({
      ok: false,
      reason: "unknownUnlock",
    });

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().notifications).toEqual([]);
  });
});

describe("successful purchases", () => {
  it("debits the machine unlock cost exactly once from the table", () => {
    const state = fundedState();

    const application = unlockMachine(state, { type: "unlockMachine", machine: "silo" });

    expect(application.result).toEqual({ ok: true });
    expect(application.changed).toBe(true);
    expect(application.state.currency).toBe(state.currency - MACHINES.silo.unlockCost);
    expect(application.state.currency).toBe(state.currency - 150);
    expect(state.currency).toBe(10_000);
  });

  it("debits the recipe unlock cost exactly once from the table", () => {
    const state = withMachine("smelter");

    const application = unlockRecipe(state, { type: "unlockRecipe", recipeId: "copperIngot" });

    expect(application.result).toEqual({ ok: true });
    expect(application.state.currency).toBe(state.currency - RECIPES.copperIngot.unlockCost);
    expect(application.state.currency).toBe(state.currency - 300);
    expect(state.currency).toBe(10_000);
  });

  it("adds the exact machine ID once and leaves the initial unlocks intact", () => {
    const state = fundedState();

    const application = unlockMachine(state, { type: "unlockMachine", machine: "silo" });

    expect(application.state.unlocked.machines).toEqual(["extractor", "belt", "depot", "silo"]);
    expect(countOf(application.state.unlocked.machines, "silo")).toBe(1);
    expect(application.state.unlocked.recipes).toEqual([]);
  });

  it("adds the exact recipe ID once", () => {
    const state = withMachine("smelter");

    const application = unlockRecipe(state, { type: "unlockRecipe", recipeId: "copperIngot" });

    expect(application.state.unlocked.recipes).toEqual(["copperIngot"]);
    expect(countOf(application.state.unlocked.recipes, "copperIngot")).toBe(1);
  });

  it("rejects a second purchase of the same machine without a second debit", () => {
    const state = fundedState();
    const first = unlockMachine(state, { type: "unlockMachine", machine: "silo" });

    const second = unlockMachine(first.state, { type: "unlockMachine", machine: "silo" });

    expect(second.result).toEqual({ ok: false, reason: "alreadyUnlocked" });
    expect(second.changed).toBe(false);
    expect(second.state).toBe(first.state);
    expect(second.state.currency).toBe(first.state.currency);
    expect(second.state.unlocked.machines).toEqual(first.state.unlocked.machines);
    expect(countOf(second.state.unlocked.machines, "silo")).toBe(1);
  });

  it("rejects a second purchase of the same recipe without a second debit", () => {
    const state = withMachine("smelter");
    const first = unlockRecipe(state, { type: "unlockRecipe", recipeId: "copperIngot" });

    const second = unlockRecipe(first.state, { type: "unlockRecipe", recipeId: "copperIngot" });

    expect(second.result).toEqual({ ok: false, reason: "alreadyUnlocked" });
    expect(second.changed).toBe(false);
    expect(second.state).toBe(first.state);
    expect(countOf(second.state.unlocked.recipes, "copperIngot")).toBe(1);
  });
});

describe("prerequisites", () => {
  it("refuses a machine whose prerequisite machine is locked", () => {
    const state = fundedState();

    const application = unlockMachine(state, { type: "unlockMachine", machine: "assembler" });

    expect(application.result).toEqual({ ok: false, reason: "prerequisiteLocked" });
    expect(application.changed).toBe(false);
    expect(application.state).toBe(state);
    expect(state.currency).toBe(10_000);
    expect(state.unlocked.machines).toEqual(["extractor", "belt", "depot"]);
  });

  it("allows a machine once its prerequisite machine is unlocked", () => {
    const state = fundedState();
    const withSmelter = unlockMachine(state, { type: "unlockMachine", machine: "smelter" });

    const application = unlockMachine(withSmelter.state, {
      type: "unlockMachine",
      machine: "assembler",
    });

    expect(application.result).toEqual({ ok: true });
    expect(application.state.unlocked.machines).toEqual([
      "extractor",
      "belt",
      "depot",
      "smelter",
      "assembler",
    ]);
  });

  it("refuses a recipe whose prerequisite machine is locked", () => {
    const state = fundedState();

    const application = unlockRecipe(state, { type: "unlockRecipe", recipeId: "wire" });

    expect(application.result).toEqual({ ok: false, reason: "prerequisiteLocked" });
    expect(application.state).toBe(state);
    expect(state.currency).toBe(10_000);
    expect(state.unlocked.recipes).toEqual([]);
  });

  it("refuses a recipe whose prerequisite recipe is locked", () => {
    const state = withMachine("assembler", ["gear"]);

    const application = unlockRecipe(state, { type: "unlockRecipe", recipeId: "frame" });

    expect(application.result).toEqual({ ok: false, reason: "prerequisiteLocked" });
    expect(application.state).toBe(state);
    expect(state.currency).toBe(10_000);
    expect(state.unlocked.recipes).toEqual(["gear"]);
  });

  it("keeps every paid entry reachable from a new game", () => {
    let state = fundedState(1_000_000);
    const targets: UnlockTarget[] = [
      machineTarget("silo"),
      machineTarget("smelter"),
      machineTarget("assembler"),
      recipeTarget("copperIngot"),
      recipeTarget("ironIngot"),
      recipeTarget("refinedStone"),
      recipeTarget("wire"),
      recipeTarget("gear"),
      recipeTarget("plate"),
      recipeTarget("circuit"),
      recipeTarget("frame"),
      recipeTarget("motor"),
    ];
    let purchased = 0;

    for (let pass = 0; pass < targets.length && purchased < targets.length; pass += 1) {
      for (const target of targets) {
        const application = applyUnlock(state, target);
        if (!application.changed) {
          continue;
        }
        state = application.state;
        purchased += 1;
      }
    }

    expect(purchased).toBe(targets.length);
    expect(state.unlocked.machines.sort()).toEqual([
      "assembler",
      "belt",
      "depot",
      "extractor",
      "silo",
      "smelter",
    ]);
    expect(state.unlocked.recipes.sort()).toEqual([
      "circuit",
      "copperIngot",
      "frame",
      "gear",
      "ironIngot",
      "motor",
      "plate",
      "refinedStone",
      "wire",
    ]);
    expect(state.notifications).toHaveLength(targets.length);
  });

  it("allows a recipe once every prerequisite is unlocked", () => {
    const state = withMachine("assembler", ["copperIngot"]);

    const application = unlockRecipe(state, { type: "unlockRecipe", recipeId: "wire" });

    expect(application.result).toEqual({ ok: true });
    expect(application.state.unlocked.recipes).toEqual(["copperIngot", "wire"]);
  });

  it("refuses the final recipe until its whole prerequisite chain is unlocked", () => {
    const state = withMachine("assembler", ["wire", "gear", "plate"], 50_000);

    const refused = unlockRecipe(state, { type: "unlockRecipe", recipeId: "motor" });
    expect(refused.result).toEqual({ ok: false, reason: "prerequisiteLocked" });
    expect(refused.state).toBe(state);

    const withCircuit = unlockRecipe(refused.state, { type: "unlockRecipe", recipeId: "circuit" });
    expect(withCircuit.result).toEqual({ ok: true });

    const stillRefused = unlockRecipe(withCircuit.state, { type: "unlockRecipe", recipeId: "motor" });
    expect(stillRefused.result).toEqual({ ok: false, reason: "prerequisiteLocked" });

    const withFrame = unlockRecipe(stillRefused.state, { type: "unlockRecipe", recipeId: "frame" });
    expect(withFrame.result).toEqual({ ok: true });

    const motor = unlockRecipe(withFrame.state, { type: "unlockRecipe", recipeId: "motor" });
    expect(motor.result).toEqual({ ok: true });
    expect(motor.state.unlocked.recipes).toEqual([
      "wire",
      "gear",
      "plate",
      "circuit",
      "frame",
      "motor",
    ]);
  });
});

describe("affordability", () => {
  it("refuses a purchase the player cannot afford and changes nothing", () => {
    const state = fundedState(149);

    const application = unlockMachine(state, { type: "unlockMachine", machine: "silo" });

    expect(application.result).toEqual({ ok: false, reason: "insufficientCurrency" });
    expect(application.changed).toBe(false);
    expect(application.state).toBe(state);
    expect(state.currency).toBe(149);
    expect(state.unlocked.machines).toEqual(["extractor", "belt", "depot"]);
  });

  it("accepts a purchase at the exact cost", () => {
    const state = fundedState(150);

    const application = unlockMachine(state, { type: "unlockMachine", machine: "silo" });

    expect(application.result).toEqual({ ok: true });
    expect(application.state.currency).toBe(0);
  });

  it("reports the prerequisite before the balance so the blocking reason is actionable", () => {
    const state = fundedState(0);

    expect(canUnlock(state, machineTarget("assembler"))).toEqual({
      ok: false,
      reason: "prerequisiteLocked",
    });
    expect(canUnlock(state, machineTarget("silo"))).toEqual({
      ok: false,
      reason: "insufficientCurrency",
    });
  });
});

describe("canUnlock", () => {
  it("shares one validator between the store preflight and dispatch", () => {
    const store = new SimulationStore(fundedState());

    expect(store.canUnlock(machineTarget("silo"))).toEqual({ ok: true });
    expect(store.canUnlock(machineTarget("assembler"))).toEqual({
      ok: false,
      reason: "prerequisiteLocked",
    });
    expect(store.dispatch({ type: "unlockMachine", machine: "silo" })).toEqual({ ok: true });

    expect(store.canUnlock(machineTarget("silo"))).toEqual({ ok: false, reason: "alreadyUnlocked" });
    expect(store.getSnapshot().unlockedMachines).toEqual(["extractor", "belt", "depot", "silo"]);
    expect(store.getSnapshot().currency).toBe(9_850);

    store.dispatch({ type: "unlockMachine", machine: "silo" });
    expect(store.getSnapshot().currency).toBe(9_850);
  });

  it("agrees with dispatch for every rejection reason", () => {
    const empty = fundedState(0);
    const owned = unlockMachine(fundedState(), { type: "unlockMachine", machine: "silo" }).state;

    expect(canUnlock(empty, machineTarget("belt"))).toEqual({ ok: false, reason: "unknownUnlock" });
    expect(canUnlock(owned, machineTarget("silo"))).toEqual({ ok: false, reason: "alreadyUnlocked" });
    expect(canUnlock(empty, machineTarget("assembler"))).toEqual({
      ok: false,
      reason: "prerequisiteLocked",
    });
    expect(canUnlock(owned, recipeTarget("copperIngot"))).toEqual({
      ok: false,
      reason: "prerequisiteLocked",
    });
  });
});

describe("store integration", () => {
  it("commits the debit and the unlock together before notifying subscribers", () => {
    const store = new SimulationStore(fundedState());
    const listener = vi.fn();
    const before = store.getSnapshot();
    store.subscribe(listener);

    const result = store.dispatch({ type: "unlockMachine", machine: "silo" });

    expect(result).toEqual({ ok: true });
    expect(listener).toHaveBeenCalledTimes(1);

    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect(after.currency).toBe(9_850);
    expect(after.unlockedMachines).toEqual(["extractor", "belt", "depot", "silo"]);
    expect(after.notifications).toHaveLength(1);
    expect(after.notifications[0]).toMatchObject({ kind: "success" });
    expect(after.notifications[0]?.message).toContain("silo");
    expect(before.currency).toBe(10_000);
    expect(before.unlockedMachines).toEqual(["extractor", "belt", "depot"]);
  });

  it("never exposes a debit without the unlock or an unlock without the debit", () => {
    const store = new SimulationStore(fundedState());
    const observed: SimulationSnapshot[] = [];
    store.subscribe((snapshot) => observed.push(snapshot));

    store.dispatch({ type: "unlockMachine", machine: "silo" });
    store.dispatch({ type: "unlockMachine", machine: "silo" });
    store.dispatch({ type: "unlockMachine", machine: "smelter" });
    store.dispatch({ type: "unlockMachine", machine: "assembler" });

    expect(observed.length).toBeGreaterThan(0);
    for (const snapshot of observed) {
      const spendsSilo = snapshot.unlockedMachines.includes("silo") ? MACHINES.silo.unlockCost : 0;
      const spendsSmelter = snapshot.unlockedMachines.includes("smelter") ? MACHINES.smelter.unlockCost : 0;
      const spendsAssembler = snapshot.unlockedMachines.includes("assembler") ? MACHINES.assembler.unlockCost : 0;

      expect(snapshot.currency).toBe(10_000 - spendsSilo - spendsSmelter - spendsAssembler);
    }
  });

  it("does not publish or notify for a rejected purchase", () => {
    const store = new SimulationStore(fundedState(0));
    const listener = vi.fn();
    const before = store.getSnapshot();
    store.subscribe(listener);

    expect(store.dispatch({ type: "unlockMachine", machine: "silo" })).toEqual({
      ok: false,
      reason: "insufficientCurrency",
    });
    expect(store.dispatch({ type: "unlockMachine", machine: "assembler" })).toEqual({
      ok: false,
      reason: "prerequisiteLocked",
    });

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().currency).toBe(0);
    expect(store.getSnapshot().unlockedMachines).toEqual(["extractor", "belt", "depot"]);
    expect(store.getSnapshot().notifications).toEqual([]);
  });

  it("keeps an earlier snapshot stable after a later purchase", () => {
    const store = new SimulationStore(fundedState());
    const first = store.getSnapshot();
    store.dispatch({ type: "unlockMachine", machine: "silo" });

    expect(first.currency).toBe(10_000);
    expect(first.unlockedMachines).toEqual(["extractor", "belt", "depot"]);
    expect(Object.isFrozen(first.unlockedMachines)).toBe(true);
  });

  it("persists a purchased entry through the save projection", () => {
    const store = new SimulationStore(fundedState());
    store.dispatch({ type: "unlockMachine", machine: "silo" });
    store.dispatch({ type: "unlockMachine", machine: "smelter" });
    store.dispatch({ type: "unlockRecipe", recipeId: "copperIngot" });

    const save = store.getSaveGame();

    expect(save.unlocked.machines).toEqual(["extractor", "belt", "depot", "silo", "smelter"]);
    expect(save.unlocked.recipes).toEqual(["copperIngot"]);
    expect(save.currency).toBe(9_300);
  });

  it("applies an unlock through the shared applyUnlock entry point", () => {
    const state = fundedState();

    const application = applyUnlock(state, machineTarget("silo"));

    expect(application.result).toEqual({ ok: true });
    expect(application.notification).toMatchObject({ kind: "success" });
    expect(application.state.currency).toBe(9_850);
    expect(application.state.unlocked.machines).toContain("silo");
    expect(application.state.notifications).toEqual([application.notification]);
  });

  it("places a purchased smelter with its purchased recipe", () => {
    const state = fundedState();
    const withSmelter = unlockMachine(state, { type: "unlockMachine", machine: "smelter" });
    const withRecipe = unlockRecipe(withSmelter.state, { type: "unlockRecipe", recipeId: "copperIngot" });

    const application = applyPlacement(withRecipe.state, smelterCommand("copperIngot"));

    expect(application.result).toEqual({ ok: true });
    expect(application.entity?.recipeId).toBe("copperIngot");
    expect(application.state.currency).toBe(withRecipe.state.currency - MACHINES.smelter.cost);
  });
});

function fundedState(currency = 10_000): SimulationState {
  const state = createInitialState();
  state.currency = currency;
  return state;
}

function withMachine(machine: MachineType, recipes: string[] = [], currency = 10_000): SimulationState {
  const state = fundedState(currency);
  state.unlocked.machines = [...state.unlocked.machines, machine];
  state.unlocked.recipes = [...state.unlocked.recipes, ...recipes];
  return state;
}

function machineTarget(machine: string): UnlockTarget {
  return { kind: "machine", machine };
}

function recipeTarget(recipeId: string): UnlockTarget {
  return { kind: "recipe", recipeId };
}

function smelterCommand(recipeId?: string): PlaceEntityCommand {
  return {
    type: "placeEntity",
    machine: "smelter",
    x: SMELTER_CELL.x,
    y: SMELTER_CELL.y,
    rotation: 0,
    ...(recipeId === undefined ? {} : { recipeId }),
  };
}

function beltCommand(): PlaceEntityCommand {
  return {
    type: "placeEntity",
    machine: "belt",
    x: SMELTER_CELL.x,
    y: SMELTER_CELL.y,
    rotation: 0,
  };
}

function siloCommand(): PlaceEntityCommand {
  return {
    type: "placeEntity",
    machine: "silo",
    x: SMELTER_CELL.x,
    y: SMELTER_CELL.y,
    rotation: 0,
  };
}

function countOf(values: readonly string[], id: string): number {
  return values.filter((value) => value === id).length;
}
