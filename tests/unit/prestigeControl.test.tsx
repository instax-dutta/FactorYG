// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  GRID_EXPANSION_COST,
  PRESTIGE_PRODUCTION_BONUS_PER_POINT,
  PRESTIGE_SELL_BONUS_PER_POINT,
  PRESTIGE_THRESHOLD,
  STARTING_CURRENCY,
} from "../../src/content/balance";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import type { SimulationState } from "../../src/sim/types";
import { Hud } from "../../src/ui/components/Hud";
import { PrestigeModal } from "../../src/ui/components/PrestigeModal";

const modalSource = readFileSync(
  resolve(process.cwd(), "src", "ui", "components", "PrestigeModal.tsx"),
  "utf8",
);

const TWO_POINT_LIFETIME = 4 * PRESTIGE_THRESHOLD;
const EXPANDED = { width: 96, height: 96 };

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function readyState(points = 0): SimulationState {
  const state = createInitialState();
  state.lifetimeCurrency = TWO_POINT_LIFETIME;
  state.prestige.points = points;
  state.prestige.permanentMultipliers = {
    productionSpeed: 1 + points * PRESTIGE_PRODUCTION_BONUS_PER_POINT,
    sellValue: 1 + points * PRESTIGE_SELL_BONUS_PER_POINT,
  };
  return state;
}

function fundedState(): SimulationState {
  const state = readyState();
  state.currency = GRID_EXPANSION_COST * 2;
  return state;
}

function withPlotRights(state: SimulationState): SimulationState {
  return { ...state, prestige: { ...state.prestige, totalPrestiges: 1 } };
}

function prestigeButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Prestige" });
}

function expandButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Expand plot" });
}

function openPrestigeModal(): void {
  const trigger = prestigeButton();
  trigger.focus();
  fireEvent.click(trigger);
}

describe("the prestige control in the HUD", () => {
  it("is disabled one unit below the threshold and never dispatches", () => {
    const state = createInitialState();
    state.lifetimeCurrency = PRESTIGE_THRESHOLD - 1;
    const store = new SimulationStore(state);
    const dispatch = vi.spyOn(store, "dispatch");

    render(<Hud store={store} />);

    expect(prestigeButton()).toBeDisabled();
    expect(prestigeButton()).toHaveAttribute("data-prestige-ready", "false");

    fireEvent.click(prestigeButton());

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("prestige-modal")).toBeNull();
  });

  it("is enabled exactly at the threshold", () => {
    const state = createInitialState();
    state.lifetimeCurrency = PRESTIGE_THRESHOLD;
    const store = new SimulationStore(state);

    render(<Hud store={store} />);

    expect(prestigeButton()).toBeEnabled();
    expect(prestigeButton()).toHaveAttribute("data-prestige-ready", "true");
  });

  it("opens the confirmation modal without dispatching a reset", () => {
    const store = new SimulationStore(readyState());
    const dispatch = vi.spyOn(store, "dispatch");

    render(<Hud store={store} />);
    openPrestigeModal();

    expect(screen.getByTestId("prestige-modal")).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("stays disabled again once the run it was ready for has been reset", () => {
    const store = new SimulationStore(readyState());

    render(<Hud store={store} />);
    expect(prestigeButton()).toBeEnabled();

    act(() => {
      store.dispatch({ type: "prestige" });
    });

    expect(prestigeButton()).toBeDisabled();
    expect(prestigeButton()).toHaveAttribute("data-prestige-ready", "false");
  });
});

describe("the prestige confirmation modal", () => {
  it("is a focus-managed dialog that dismisses on Escape without resetting", () => {
    const store = new SimulationStore(readyState());
    const dispatch = vi.spyOn(store, "dispatch");

    render(<Hud store={store} />);
    openPrestigeModal();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("data-testid", "prestige-modal");
    expect(document.activeElement).toBe(screen.getByTestId("prestige-confirm"));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("prestige-modal")).toBeNull();
    expect(document.activeElement).toBe(prestigeButton());
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("previews the awarded points and the resulting multipliers from the store snapshot", () => {
    const store = new SimulationStore(readyState(5));
    const snapshot = store.getSnapshot();

    render(<Hud store={store} />);
    openPrestigeModal();

    const dialog = screen.getByTestId("prestige-modal");
    expect(within(dialog).getByTestId("prestige-preview-award")).toHaveTextContent(
      formatNumber(snapshot.prestigeAwardPoints),
    );
    expect(within(dialog).getByTestId("prestige-preview-points")).toHaveTextContent(
      formatNumber(snapshot.prestigePoints + snapshot.prestigeAwardPoints),
    );
    expect(within(dialog).getByTestId("prestige-preview-production")).toHaveTextContent(
      formatNumber(snapshot.prestigeNextMultipliers.productionSpeed),
    );
    expect(within(dialog).getByTestId("prestige-preview-sell")).toHaveTextContent(
      formatNumber(snapshot.prestigeNextMultipliers.sellValue),
    );
  });

  it("previews the current multipliers beside the ones the reset awards", () => {
    const store = new SimulationStore(readyState(5));
    const snapshot = store.getSnapshot();

    render(<Hud store={store} />);
    openPrestigeModal();

    const dialog = screen.getByTestId("prestige-modal");
    expect(within(dialog).getByTestId("prestige-current-production")).toHaveTextContent(
      formatNumber(snapshot.permanentMultipliers.productionSpeed),
    );
    expect(within(dialog).getByTestId("prestige-current-sell")).toHaveTextContent(
      formatNumber(snapshot.permanentMultipliers.sellValue),
    );
    expect(snapshot.prestigeNextMultipliers.sellValue).toBeGreaterThan(
      snapshot.permanentMultipliers.sellValue,
    );
  });

  it("warns that the run is wiped and that the plot survives", () => {
    const store = new SimulationStore(readyState());

    render(<Hud store={store} />);
    openPrestigeModal();

    const dialog = screen.getByTestId("prestige-modal");
    expect(within(dialog).getByTestId("prestige-warning")).toHaveTextContent(
      /currency, machines, and unlocks/i,
    );
    expect(within(dialog).getByTestId("prestige-plot-survives")).toHaveTextContent(/plot/i);
  });

  it("reports the expansion cost the balance module prices", () => {
    const store = new SimulationStore(readyState());

    render(<Hud store={store} />);
    openPrestigeModal();

    expect(within(screen.getByTestId("prestige-modal")).getByTestId("prestige-expansion-cost"))
      .toHaveTextContent(formatNumber(GRID_EXPANSION_COST));
  });

  it("performs exactly one reset and closes on confirm", () => {
    const store = new SimulationStore(readyState());
    const dispatch = vi.spyOn(store, "dispatch");

    render(<Hud store={store} />);
    openPrestigeModal();
    fireEvent.click(screen.getByTestId("prestige-confirm"));

    expect(
      dispatch.mock.calls.filter(([command]) => command.type === "prestige"),
    ).toHaveLength(1);
    expect(store.getSaveGame().prestige.totalPrestiges).toBe(1);
    expect(screen.queryByTestId("prestige-modal")).toBeNull();
  });

  it("disables the trigger the reset just consumed, so it cannot keep focus", () => {
    const store = new SimulationStore(readyState());

    render(<Hud store={store} />);
    openPrestigeModal();
    fireEvent.click(screen.getByTestId("prestige-confirm"));

    const trigger = screen.getByTestId("prestige-button");
    expect(trigger).toBeDisabled();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("shows the fresh run in the HUD after the reset", () => {
    const store = new SimulationStore(readyState(5));

    render(<Hud store={store} />);
    openPrestigeModal();
    fireEvent.click(screen.getByTestId("prestige-confirm"));

    const snapshot = store.getSnapshot();
    expect(snapshot.prestigePoints).toBe(7);
    expect(snapshot.currency).toBe(STARTING_CURRENCY);
    expect(screen.getByTestId("hud-prestige-points")).toHaveTextContent("7");
    expect(screen.getByTestId("hud-currency")).toHaveTextContent(
      formatNumber(STARTING_CURRENCY),
    );
  });

  it("surfaces the store refusal and resets nothing when the run is no longer eligible", () => {
    const store = new SimulationStore(readyState());

    render(<Hud store={store} />);
    openPrestigeModal();
    expect(screen.getByTestId("prestige-modal")).toBeInTheDocument();

    act(() => {
      store.dispatch({ type: "prestige" });
    });
    const dispatch = vi.spyOn(store, "dispatch");

    fireEvent.click(screen.getByTestId("prestige-confirm"));

    expect(
      dispatch.mock.calls.filter(([command]) => command.type === "prestige"),
    ).toHaveLength(1);
    expect(store.getSaveGame().prestige.totalPrestiges).toBe(1);
    const alert = screen.getByTestId("prestige-error");
    expect(alert).toHaveAttribute("data-reason", "insufficientLifetimeCurrency");
    expect(alert).toHaveTextContent("This run has not earned a prestige yet.");
    expect(alert).not.toHaveTextContent("insufficientLifetimeCurrency");
    expect(screen.getByTestId("prestige-modal")).toBeInTheDocument();
  });

  it("reads the refusal from the store's current answer rather than a remembered one", () => {
    const store = new SimulationStore(readyState());

    render(<Hud store={store} />);
    openPrestigeModal();
    act(() => {
      store.dispatch({ type: "prestige" });
    });
    fireEvent.click(screen.getByTestId("prestige-confirm"));

    const currentAnswer = store.canResetPrestige();
    const alert = screen.getByTestId("prestige-error");

    expect(alert).toHaveAttribute("data-reason", currentAnswer.reason);
    const trigger = screen.getByTestId("prestige-button");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("data-prestige-ready", "false");
  });

  it("renders every number from the snapshot instead of importing simulation math", () => {
    expect(modalSource).not.toMatch(/permanentMultipliersForPoints/);
    expect(modalSource).not.toMatch(/PRESTIGE_(PRODUCTION|SELL)_BONUS_PER_POINT/);
    expect(modalSource).not.toMatch(/from "\.\.\/\.\.\/sim\/(commands|prestige)"/);
  });

  it("can be rendered on its own for a caller that owns the trigger", () => {
    const store = new SimulationStore(readyState());

    render(<PrestigeModal store={store} open onClose={() => undefined} />);

    expect(screen.getByTestId("prestige-modal")).toBeInTheDocument();
  });
});

describe("the plot expansion control in the HUD", () => {
  it("names the cost the balance module prices", () => {
    const store = new SimulationStore(readyState());

    render(<Hud store={store} />);

    const button = expandButton();
    expect(button).toHaveAttribute("data-cost", String(GRID_EXPANSION_COST));
    expect(screen.getByTestId("expand-cost")).toHaveTextContent(
      formatNumber(GRID_EXPANSION_COST),
    );
  });

  it("is disabled for a run that has never prestiged, however rich it is", () => {
    const store = new SimulationStore(fundedState());

    render(<Hud store={store} />);

    expect(expandButton()).toBeDisabled();
    expect(expandButton()).toHaveAttribute("data-reason", "expansionLocked");
  });

  it("is disabled for a run that cannot afford the cost", () => {
    const state = withPlotRights(readyState());
    state.currency = GRID_EXPANSION_COST - 1;
    const store = new SimulationStore(state);

    render(<Hud store={store} />);

    expect(expandButton()).toBeDisabled();
    expect(expandButton()).toHaveAttribute("data-reason", "insufficientExpansionCost");
  });

  it("is enabled for a run that holds both the rights and the currency", () => {
    const store = new SimulationStore(withPlotRights(fundedState()));

    render(<Hud store={store} />);

    expect(expandButton()).toBeEnabled();
    expect(expandButton()).toHaveAttribute("data-reason", "");
  });

  it("debits exactly the cost and grows the plot by one step", () => {
    const store = new SimulationStore(withPlotRights(fundedState()));
    const currencyBefore = store.getSnapshot().currency;

    render(<Hud store={store} />);
    fireEvent.click(expandButton());

    expect(store.getGridDimensions()).toEqual(EXPANDED);
    expect(store.getSnapshot().currency).toBe(currencyBefore - GRID_EXPANSION_COST);
  });

  it("stays disabled at the plot ceiling", () => {
    const state = withPlotRights(fundedState());
    state.grid = { ...state.grid, width: 256, height: 256 };
    const store = new SimulationStore(state);

    render(<Hud store={store} />);

    expect(expandButton()).toBeDisabled();
    expect(expandButton()).toHaveAttribute("data-reason", "gridAlreadyExpanded");
  });

  it("offers no further growth once the plot is at the ceiling", () => {
    const state = withPlotRights(fundedState());
    state.grid = { ...state.grid, width: 256, height: 256 };
    const store = new SimulationStore(state);

    render(<Hud store={store} />);

    expect(screen.getByTestId("expand-plot-size")).toHaveTextContent("256 x 256");
  });
});
