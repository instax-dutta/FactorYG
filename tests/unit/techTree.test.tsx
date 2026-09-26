// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MACHINES } from "../../src/content/machines";
import { RECIPES } from "../../src/content/recipes";
import type { MachineType, RecipeId, UnlockRequirement } from "../../src/content/types";
import { UNLOCKS } from "../../src/content/unlocks";
import { STARTING_CURRENCY } from "../../src/sim/constants";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import type { SimulationState } from "../../src/sim/types";
import { TechTree } from "../../src/ui/components/TechTree";

const SILO_COST = UNLOCKS.machineUnlocks.silo?.cost ?? 0;
const SMELTER_COST = UNLOCKS.machineUnlocks.smelter?.cost ?? 0;
const COPPER_INGOT_COST = UNLOCKS.recipeUnlocks.copperIngot?.cost ?? 0;
const FUNDED_CURRENCY = 5_000;

const costFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function formatCost(cost: number): string {
  return costFormatter.format(cost);
}

function openTechTree(store: SimulationStore): RenderResult {
  const view = render(<TechTree store={store} />);
  fireEvent.click(screen.getByRole("button", { name: "Tech tree" }));
  return view;
}

function createState(overrides: {
  currency: number;
  unlocked?: { machines: MachineType[]; recipes: string[] };
}): SimulationState {
  const state = createInitialState();
  state.currency = overrides.currency;
  if (overrides.unlocked !== undefined) {
    state.unlocked.machines = [...overrides.unlocked.machines];
    state.unlocked.recipes = [...overrides.unlocked.recipes];
  }
  return state;
}

function createDrainingStore(state: SimulationState): SimulationStore {
  return new SimulationStore(state, () => 0, (current) => ({ ...current, currency: 0 }));
}

function requirementCosts(
  table: Readonly<Partial<Record<string, UnlockRequirement>>>,
): number[] {
  return Object.values(table).map((requirement) => requirement?.cost ?? 0);
}

function orderedCosts(costs: readonly number[]): number[] {
  return [...costs].sort((left, right) => left - right);
}

describe("TechTree", () => {
  it("renders every machine and recipe from the content tables, cheapest first", () => {
    const store = new SimulationStore(createInitialState());

    openTechTree(store);

    const machines = within(screen.getByRole("region", { name: "Machines" }));
    const recipes = within(screen.getByRole("region", { name: "Recipes" }));

    for (const type of Object.keys(MACHINES) as MachineType[]) {
      expect(machines.getByTestId(`tech-tree-entry-machine-${type}`)).toBeInTheDocument();
    }
    for (const id of Object.keys(RECIPES) as RecipeId[]) {
      expect(recipes.getByTestId(`tech-tree-entry-recipe-${id}`)).toBeInTheDocument();
    }

    expect(
      within(screen.getByRole("region", { name: "Machines" }))
        .getAllByRole("listitem")
        .map((row) => Number(row.getAttribute("data-cost"))),
    ).toEqual(
      orderedCosts([
        ...requirementCosts(UNLOCKS.machineUnlocks),
        ...UNLOCKS.machines.map((type) => MACHINES[type].unlockCost),
      ]),
    );
    expect(
      within(screen.getByRole("region", { name: "Recipes" }))
        .getAllByRole("listitem")
        .map((row) => Number(row.getAttribute("data-cost"))),
    ).toEqual(
      orderedCosts([
        ...requirementCosts(UNLOCKS.recipeUnlocks),
        ...UNLOCKS.recipes.map((id) => RECIPES[id as RecipeId].unlockCost),
      ]),
    );
  });

  it("shows the cost of a locked entry", () => {
    const store = new SimulationStore(createInitialState());

    openTechTree(store);

    const smelter = screen.getByTestId("tech-tree-entry-machine-smelter");
    expect(smelter).toHaveAttribute("data-state", "available");
    expect(screen.getByTestId("tech-tree-cost-machine-smelter")).toHaveTextContent(
      formatCost(SMELTER_COST),
    );
    expect(screen.getByTestId("tech-tree-cost-recipe-copperIngot")).toHaveTextContent(
      formatCost(COPPER_INGOT_COST),
    );
    expect(screen.getByTestId("tech-tree-cost-machine-silo")).toHaveTextContent(
      formatCost(SILO_COST),
    );
    expect(screen.getByTestId("tech-tree-cost-machine-extractor")).toHaveTextContent("Included");
  });

  it("dispatches the exact unlock command for an affordable machine entry", () => {
    const store = new SimulationStore(createState({ currency: FUNDED_CURRENCY }));
    const dispatch = vi.spyOn(store, "dispatch");

    openTechTree(store);
    fireEvent.click(screen.getByRole("button", { name: "Unlock Smelter" }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "unlockMachine", machine: "smelter" });
    expect(store.getSnapshot().unlockedMachines).toContain("smelter");
    expect(store.getSnapshot().currency).toBe(FUNDED_CURRENCY - SMELTER_COST);
    expect(screen.getByTestId("tech-tree-entry-machine-smelter")).toHaveAttribute(
      "data-state",
      "unlocked",
    );
  });

  it("dispatches the exact unlock command for an affordable recipe entry", () => {
    const store = new SimulationStore(
      createState({
        currency: FUNDED_CURRENCY,
        unlocked: { machines: ["extractor", "belt", "depot", "smelter"], recipes: [] },
      }),
    );
    const dispatch = vi.spyOn(store, "dispatch");

    openTechTree(store);
    fireEvent.click(screen.getByRole("button", { name: "Unlock Copper Ingot" }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "unlockRecipe", recipeId: "copperIngot" });
    expect(store.getSnapshot().unlockedRecipes).toEqual(["copperIngot"]);
    expect(store.getSnapshot().currency).toBe(FUNDED_CURRENCY - COPPER_INGOT_COST);
    expect(screen.getByTestId("tech-tree-entry-recipe-copperIngot")).toHaveAttribute(
      "data-state",
      "unlocked",
    );
  });

  it("disables an unaffordable entry and dispatches nothing for it", () => {
    const store = new SimulationStore(
      createState({
        currency: 0,
        unlocked: { machines: ["extractor", "belt", "depot", "smelter"], recipes: [] },
      }),
    );
    const dispatch = vi.spyOn(store, "dispatch");

    openTechTree(store);
    const row = screen.getByTestId("tech-tree-entry-recipe-copperIngot");
    const button = screen.getByRole("button", { name: "Unlock Copper Ingot" });

    expect(row).toHaveAttribute("data-state", "unaffordable");
    expect(row).toHaveAttribute("data-reason", "insufficientCurrency");
    expect(screen.getByTestId("tech-tree-cost-recipe-copperIngot")).toHaveTextContent(
      formatCost(COPPER_INGOT_COST),
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Not enough currency.");
    fireEvent.click(button);

    expect(dispatch).not.toHaveBeenCalled();
    expect(store.getSnapshot().unlockedRecipes).toEqual([]);
  });

  it("never offers an unlocked entry for purchase again", () => {
    const store = new SimulationStore(createInitialState());
    const dispatch = vi.spyOn(store, "dispatch");

    openTechTree(store);

    for (const type of UNLOCKS.machines) {
      const row = screen.getByTestId(`tech-tree-entry-machine-${type}`);
      const button = screen.getByTestId(`tech-tree-unlock-machine-${type}`);

      expect(row).toHaveAttribute("data-state", "unlocked");
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }

    expect(dispatch).not.toHaveBeenCalled();
    expect(store.getSnapshot().unlockedMachines).toEqual(["extractor", "belt", "depot"]);
    expect(store.getSnapshot().currency).toBe(STARTING_CURRENCY);
  });

  it("shows a locked entry with unmet prerequisites as such", () => {
    const store = new SimulationStore(createState({ currency: FUNDED_CURRENCY }));

    openTechTree(store);

    const assembler = screen.getByTestId("tech-tree-entry-machine-assembler");
    expect(assembler).toHaveAttribute("data-state", "prerequisite-locked");
    expect(assembler).toHaveAttribute("data-reason", "prerequisiteLocked");
    expect(assembler).toHaveAttribute("data-missing", "smelter");
    expect(screen.getByTestId("tech-tree-requires-machine-assembler")).toHaveTextContent(
      "Requires Smelter",
    );
    expect(screen.getByRole("button", { name: "Unlock Assembler" })).toBeDisabled();

    const wire = screen.getByTestId("tech-tree-entry-recipe-wire");
    expect(wire).toHaveAttribute("data-state", "prerequisite-locked");
    expect(wire).toHaveAttribute("data-missing", "assembler,copperIngot");
    expect(screen.getByTestId("tech-tree-requires-recipe-wire")).toHaveTextContent(
      "Requires Assembler, Copper Ingot",
    );

    const smelter = screen.getByTestId("tech-tree-entry-machine-smelter");
    expect(smelter).toHaveAttribute("data-missing", "");
    expect(screen.getByTestId("tech-tree-requires-machine-smelter")).toHaveTextContent(
      "No prerequisites",
    );
  });

  it("surfaces the store's insufficientCurrency rejection reason", () => {
    const store = createDrainingStore(createState({ currency: FUNDED_CURRENCY }));
    const dispatch = vi.spyOn(store, "dispatch");
    vi.spyOn(store, "subscribe").mockReturnValue(() => {});

    openTechTree(store);
    expect(screen.getByRole("button", { name: "Unlock Smelter" })).toBeEnabled();

    act(() => {
      store.advanceTicks(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Unlock Smelter" }));

    expect(dispatch).toHaveBeenCalledWith({ type: "unlockMachine", machine: "smelter" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "insufficientCurrency");
    expect(alert).toHaveTextContent("Not enough currency.");
    expect(store.getSnapshot().unlockedMachines).not.toContain("smelter");
    expect(store.getSnapshot().currency).toBe(0);
  });

  it("surfaces the store's alreadyUnlocked rejection reason when the entry changed underneath", () => {
    const store = new SimulationStore(createState({ currency: FUNDED_CURRENCY }));
    const dispatch = vi.spyOn(store, "dispatch");
    vi.spyOn(store, "subscribe").mockReturnValue(() => {});

    openTechTree(store);
    act(() => {
      store.dispatch({ type: "unlockMachine", machine: "smelter" });
    });

    fireEvent.click(screen.getByRole("button", { name: "Unlock Smelter" }));

    expect(dispatch).toHaveBeenCalledTimes(2);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "alreadyUnlocked");
    expect(alert).toHaveTextContent("Already unlocked.");
    expect(store.getSnapshot().unlockedMachines).toEqual([
      "extractor",
      "belt",
      "depot",
      "smelter",
    ]);
    expect(store.getSnapshot().currency).toBe(FUNDED_CURRENCY - SMELTER_COST);
  });

  it("opens as a focus-managed dialog with an inert background and dismisses on Escape", () => {
    const store = new SimulationStore(createInitialState());
    const background = appendBackground();
    const view = render(<TechTree store={store} />);

    try {
      const toggle = screen.getByRole("button", { name: "Tech tree" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      background.button.focus();
      fireEvent.click(toggle);

      const dialog = screen.getByRole("dialog");
      const closeButton = screen.getByRole("button", { name: "Close tech tree" });
      const lastFocusable = screen.getByRole("button", { name: "Unlock Smelter" });

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(getComputedStyle(dialog).pointerEvents).toBe("auto");
      expect(closeButton).toHaveFocus();
      expect(background.wrapper).toHaveAttribute("inert", "");
      expect(background.wrapper).toHaveAttribute("aria-hidden", "true");

      lastFocusable.focus();
      fireEvent.keyDown(lastFocusable, { key: "Tab" });
      expect(closeButton).toHaveFocus();
      fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
      expect(lastFocusable).toHaveFocus();

      fireEvent.keyDown(dialog, { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(background.button).toHaveFocus();
      expect(background.wrapper).not.toHaveAttribute("inert");
      expect(background.wrapper).not.toHaveAttribute("aria-hidden");
      view.unmount();
    } finally {
      background.wrapper.remove();
    }
  });

  it("clears the rejection reason when the tree is closed and reopened", () => {
    const store = createDrainingStore(createState({ currency: FUNDED_CURRENCY }));
    const dispatch = vi.spyOn(store, "dispatch");
    vi.spyOn(store, "subscribe").mockReturnValue(() => {});

    openTechTree(store);
    act(() => {
      store.advanceTicks(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Smelter" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close tech tree" }));
    fireEvent.click(screen.getByRole("button", { name: "Tech tree" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

interface BackgroundElements {
  wrapper: HTMLDivElement;
  button: HTMLButtonElement;
}

function appendBackground(): BackgroundElements {
  const wrapper = document.createElement("div");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Background action";
  wrapper.append(button);
  document.body.append(wrapper);
  return { wrapper, button };
}
