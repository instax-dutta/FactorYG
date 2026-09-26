// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import { BuildDock } from "../../src/ui/components/BuildDock";

describe("BuildDock", () => {
  it("renders all six machine buttons and disables locked machines", () => {
    const store = new SimulationStore(createInitialState());
    const dispatch = vi.spyOn(store, "dispatch");

    render(<BuildDock store={store} />);

    const buttons = [
      ["Extractor", "extractor"],
      ["Conveyor Belt", "belt"],
      ["Smelter", "smelter"],
      ["Assembler", "assembler"],
      ["Storage Silo", "silo"],
      ["Shipping Depot", "depot"],
    ] as const;

    for (const [label, machine] of buttons) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("data-testid", `build-${machine}`);
      if (machine === "extractor" || machine === "belt" || machine === "depot") {
        expect(button).toBeEnabled();
      } else {
        expect(button).toBeDisabled();
        fireEvent.click(button);
      }
    }

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches setPlacementMode for an unlocked machine and marks it active", () => {
    const store = new SimulationStore(createInitialState());
    const dispatch = vi.spyOn(store, "dispatch");

    render(<BuildDock store={store} />);
    const beltButton = screen.getByRole("button", { name: "Conveyor Belt" });

    expect(beltButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(beltButton);

    expect(dispatch).toHaveBeenCalledWith({ type: "setPlacementMode", machine: "belt" });
    expect(beltButton).toHaveAttribute("aria-pressed", "true");
  });

  it("dispatches rotatePlacement from the dock control", () => {
    const store = new SimulationStore(createInitialState());
    const dispatch = vi.spyOn(store, "dispatch");

    render(<BuildDock store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate placement" }));

    expect(dispatch).toHaveBeenCalledWith({ type: "rotatePlacement" });
  });
});
