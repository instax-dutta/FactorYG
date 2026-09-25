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

  it("disables prestige below the snapshot threshold and dispatches it when enabled", () => {
    const unavailableState = createInitialState();
    unavailableState.lifetimeCurrency = 99_999;
    const unavailableStore = new SimulationStore(unavailableState);
    const unavailableDispatch = vi.spyOn(unavailableStore, "dispatch");
    const { unmount } = render(<Hud store={unavailableStore} />);
    const unavailableButton = screen.getByRole("button", { name: "Prestige" });

    expect(unavailableButton).toBeDisabled();
    fireEvent.click(unavailableButton);
    expect(unavailableDispatch).not.toHaveBeenCalled();
    unmount();

    const availableState = createInitialState();
    availableState.lifetimeCurrency = 100_000;
    const availableStore = new SimulationStore(availableState);
    const availableDispatch = vi.spyOn(availableStore, "dispatch");
    render(<Hud store={availableStore} />);
    const availableButton = screen.getByRole("button", { name: "Prestige" });

    expect(availableButton).toBeEnabled();
    fireEvent.click(availableButton);
    expect(availableDispatch).toHaveBeenCalledWith({ type: "prestige" });
  });
});

describe("EntityInspector", () => {
  it("shows the selected entity details and dispatches rotate, demolish, and upgrade", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(screen.getByRole("button", { name: "Demolish" }));
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "rotatePlacement" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "demolishEntity", entityId: "entity-1" });
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "upgradeEntity", entityId: "entity-1" });
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
  it("renders elapsed, capped, earned, and chain values and dismisses the summary", () => {
    const state = createInitialState();
    state.offlineSummary = {
      elapsedSeconds: 61,
      cappedSeconds: 60,
      earnedCurrency: 610,
      chainUnits: { copperIngot: 61 },
    };
    const store = new SimulationStore(state);
    const dispatch = vi.spyOn(store, "dispatch");

    render(<OfflineSummaryModal store={store} />);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByTestId("offline-elapsed")).toHaveTextContent("61s");
    expect(screen.getByTestId("offline-capped")).toHaveTextContent("60s");
    expect(screen.getByTestId("offline-earned")).toHaveTextContent("610");
    expect(screen.getByTestId("offline-chain-copperIngot")).toHaveTextContent("61");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss offline summary" }));

    expect(dispatch).toHaveBeenCalledWith({ type: "dismissOfflineSummary" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

function createNotification(id: string, message: string, kind: Notification["kind"]): Notification {
  return { id, kind, message, createdAt: 0 };
}
