import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { createSnapshot } from "../../src/sim/snapshot";
import { SimulationStore } from "../../src/sim/store";
import type { Notification, SimulationState } from "../../src/sim/types";
import { EntityInspector } from "../../src/ui/components/EntityInspector";
import { Hud } from "../../src/ui/components/Hud";
import { NotificationStack } from "../../src/ui/components/NotificationStack";
import { OfflineSummaryModal } from "../../src/ui/components/OfflineSummaryModal";
import { useSimulationSnapshot } from "../../src/ui/hooks/useSimulationSnapshot";

describe("useSimulationSnapshot", () => {
  it("subscribes to one store and exposes each immutable published snapshot", () => {
    const store = new SimulationStore(createInitialState());
    const subscribe = vi.spyOn(store, "subscribe");
    const { result, rerender, unmount } = renderHook(
      ({ simulationStore }) => useSimulationSnapshot(simulationStore),
      { initialProps: { simulationStore: store } },
    );
    const firstSnapshot = result.current;

    expect(firstSnapshot).toBe(store.getSnapshot());
    expect(Object.isFrozen(firstSnapshot)).toBe(true);
    expect(subscribe).toHaveBeenCalledTimes(1);

    act(() => {
      store.dispatch({ type: "setPlacementMode", machine: "belt" });
    });
    rerender({ simulationStore: store });

    expect(result.current).not.toBe(firstSnapshot);
    expect(result.current.placementMode).toBe("belt");
    expect(Object.isFrozen(result.current)).toBe(true);

    unmount();
    act(() => {
      store.dispatch({ type: "setPlacementMode", machine: "depot" });
    });
    expect(result.current.placementMode).toBe("belt");
  });
});

describe("Hud", () => {
  it("renders literal currency, rate, and prestige values from the store snapshot", () => {
    const state = createInitialState();
    state.currency = 1234;
    state.currencySamples = [{ tick: 1, amount: 20 }];
    state.tickCount = 100;
    state.prestige.points = 7;
    const store = new SimulationStore(state);

    render(<Hud store={store} />);

    expect(screen.getByTestId("hud-currency")).toHaveTextContent("1,234");
    expect(screen.getByTestId("hud-currency-rate")).toHaveTextContent("2");
    expect(screen.getByTestId("hud-prestige-points")).toHaveTextContent("7");
  });

  it("updates the displayed rate when the store publishes a new snapshot", () => {
    const state = createInitialState();
    state.currencySamples = [{ tick: 2, amount: 20 }];
    state.tickCount = 100;
    const store = new SimulationStore(state, () => 0, (currentState) => ({
      ...currentState,
      tickCount: currentState.tickCount + 1,
      currencySamples: [
        ...currentState.currencySamples,
        { tick: currentState.tickCount + 1, amount: 20 },
      ],
    }));

    render(<Hud store={store} />);
    expect(screen.getByTestId("hud-currency-rate")).toHaveTextContent("2");

    act(() => {
      store.advanceTicks(1);
    });

    expect(screen.getByTestId("hud-currency-rate")).toHaveTextContent("4");
  });

  it("keeps prestige visibly unavailable without dispatching at the threshold", () => {
    const state = createInitialState();
    state.lifetimeCurrency = 100_000;
    const store = new SimulationStore(state);
    const dispatch = vi.spyOn(store, "dispatch");

    render(<Hud store={store} />);
    const prestigeButton = screen.getByRole("button", { name: "Prestige" });

    expect(prestigeButton).toBeDisabled();
    expect(prestigeButton).toHaveAttribute("title", "Prestige will be available in a later phase");
    expect(prestigeButton).toHaveAttribute("data-prestige-ready", "true");
    expect(screen.getByTestId("prestige-unavailable")).toHaveTextContent(
      "Prestige is not available yet.",
    );

    fireEvent.click(prestigeButton);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("EntityInspector", () => {
  it("shows selected details, keeps upgrade unavailable, and dispatches available actions", () => {
    const state = createStateWithSelectedEntity();
    const store = new SimulationStore(state);
    const snapshot = {
      ...createSnapshot(state),
      selectedThroughput: 4.5,
    };
    vi.spyOn(store, "getSnapshot").mockReturnValue(Object.freeze(snapshot));
    const dispatch = vi.spyOn(store, "dispatch");

    render(<EntityInspector store={store} />);

    expect(screen.getByTestId("inspector-type")).toHaveTextContent("Extractor");
    expect(screen.getByTestId("inspector-id")).toHaveTextContent("entity-1");
    expect(screen.getByTestId("inspector-level")).toHaveTextContent("3");
    expect(screen.getByTestId("inspector-throughput")).toHaveTextContent("4.5");

    const upgradeButton = screen.getByRole("button", { name: "Upgrade" });
    expect(upgradeButton).toBeDisabled();
    expect(upgradeButton).toHaveAttribute("title", "Upgrades will be available in a later phase");
    expect(screen.getByTestId("inspector-upgrade-unavailable")).toHaveTextContent(
      "Upgrade is not available yet.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(screen.getByRole("button", { name: "Demolish" }));
    fireEvent.click(upgradeButton);

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "rotatePlacement" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "demolishEntity", entityId: "entity-1" });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("shows pending throughput instead of presenting the snapshot zero as real data", () => {
    const store = new SimulationStore(createStateWithSelectedEntity());

    render(<EntityInspector store={store} />);

    expect(screen.getByTestId("inspector-throughput")).toHaveTextContent("Pending");
    expect(screen.getByTestId("inspector-throughput")).not.toHaveTextContent("0");
  });
});

describe("NotificationStack", () => {
  it("renders notifications and dismisses the selected notification by id", () => {
    const state = createInitialState();
    state.notifications = [
      createNotification("notice-1", "Storage is full", "warning"),
      createNotification("notice-2", "New recipe unlocked", "success"),
    ];
    const store = new SimulationStore(state);
    const dispatch = vi.spyOn(store, "dispatch");

    render(<NotificationStack store={store} />);

    expect(screen.getByText("Storage is full")).toBeVisible();
    expect(screen.getByText("New recipe unlocked")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Storage is full" }));

    expect(dispatch).toHaveBeenCalledWith({ type: "dismissNotification", id: "notice-1" });
    expect(screen.queryByText("Storage is full")).not.toBeInTheDocument();
    expect(screen.getByText("New recipe unlocked")).toBeVisible();
  });
});

describe("OfflineSummaryModal", () => {
  it("renders a blocking dialog with canonical resource labels and inert background", () => {
    const state = createOfflineState();
    const store = new SimulationStore(state);
    const background = appendBackground();

    try {
      render(<OfflineSummaryModal store={store} />);
      const dialog = screen.getByRole("dialog");

      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(getComputedStyle(dialog).pointerEvents).toBe("auto");
      expect(screen.getByTestId("offline-elapsed")).toHaveTextContent("61s");
      expect(screen.getByTestId("offline-capped")).toHaveTextContent("60s");
      expect(screen.getByTestId("offline-earned")).toHaveTextContent("610");
      expect(screen.getByTestId("offline-chain-copperIngot")).toHaveTextContent("Copper Ingot: 61");
      expect(screen.getByTestId("offline-chain-copperIngot")).not.toHaveTextContent("copperIngot");
      expect(background.wrapper).toHaveAttribute("inert", "");
      expect(background.wrapper).toHaveAttribute("aria-hidden", "true");
      expect(background.canvas.closest("[inert]")).toBe(background.wrapper);
    } finally {
      background.wrapper.remove();
    }
  });

  it("focuses Continue, traps focus, dismisses on Escape, and restores focus and background", () => {
    const state = createOfflineState();
    const store = new SimulationStore(state);
    const background = appendBackground();
    background.button.focus();

    try {
      const view = render(<OfflineSummaryModal store={store} />);
      const continueButton = screen.getByRole("button", { name: "Dismiss offline summary" });
      const closeButton = screen.getByTestId("offline-close");

      expect(continueButton).toHaveFocus();

      closeButton.focus();
      fireEvent.keyDown(closeButton, { key: "Tab" });
      expect(continueButton).toHaveFocus();

      fireEvent.keyDown(continueButton, { key: "Tab", shiftKey: true });
      expect(closeButton).toHaveFocus();

      fireEvent.keyDown(closeButton, { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(background.button).toHaveFocus();
      expect(background.wrapper).not.toHaveAttribute("inert");
      expect(background.wrapper).not.toHaveAttribute("aria-hidden");
      view.unmount();
    } finally {
      background.wrapper.remove();
    }
  });

  it("dismisses through the Continue button", () => {
    const store = new SimulationStore(createOfflineState());
    const dispatch = vi.spyOn(store, "dispatch");
    const view = render(<OfflineSummaryModal store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss offline summary" }));

    expect(dispatch).toHaveBeenCalledWith({ type: "dismissOfflineSummary" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.unmount();
  });
});

function createStateWithSelectedEntity(): SimulationState {
  const state = createInitialState();
  state.grid.entities = [
    {
      id: "entity-1",
      type: "extractor",
      x: 4,
      y: 5,
      rotation: 0,
      level: 3,
      resourceNode: "copperOre",
    },
  ];
  state.selectedEntityId = "entity-1";
  return state;
}

function createOfflineState(): SimulationState {
  const state = createInitialState();
  state.offlineSummary = {
    elapsedSeconds: 61,
    cappedSeconds: 60,
    earnedCurrency: 610,
    chainUnits: { copperIngot: 61 },
  };
  return state;
}

function createNotification(id: string, message: string, kind: Notification["kind"]): Notification {
  return { id, kind, message, createdAt: 0 };
}

interface BackgroundElements {
  wrapper: HTMLDivElement;
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
}

function appendBackground(): BackgroundElements {
  const wrapper = document.createElement("div");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Background action";
  const canvas = document.createElement("canvas");
  wrapper.append(button, canvas);
  document.body.append(wrapper);
  return { wrapper, button, canvas };
}
