// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { FirstRunHint } from "../../src/ui/components/FirstRunHint";
import { firstRunHintSteps } from "../../src/ui/presentation";
import { createInitialState } from "../../src/sim/initialState";
import { SimulationStore } from "../../src/sim/store";
import type { MachineType } from "../../src/content/types";

function render(store: SimulationStore): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(FirstRunHint, { store }));
  });
  return host;
}

describe("the first-run hint", () => {
  it("tells a new player how to place their first machine when the world is empty", () => {
    const store = new SimulationStore(createInitialState(1));
    const host = render(store);

    const hint = host.querySelector('[data-testid="first-run-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("Start by mining");
    for (const step of firstRunHintSteps) {
      expect(hint?.textContent).toContain(step);
    }
  });

  it("names both halves of the action, because either alone leaves the player stuck", () => {
    const store = new SimulationStore(createInitialState(1));
    const host = render(store);
    const text = host.textContent ?? "";

    expect(text).toMatch(/dock/i);
    expect(text).toMatch(/node/i);
  });

  it("disappears once the run has placed anything, so it never nags a returning player", () => {
    const state = createInitialState(1);
    const node = state.grid.nodes[0];
    const store = new SimulationStore(state);
    const host = render(store);
    expect(host.querySelector('[data-testid="first-run-hint"]')).not.toBeNull();

    act(() => {
      store.dispatch({
        type: "placeEntity",
        machine: "extractor" as MachineType,
        x: node.x,
        y: node.y,
        rotation: 0,
        resourceNode: node.resource,
      });
    });

    expect(store.getSnapshot().entityCount).toBe(1);
    expect(host.querySelector('[data-testid="first-run-hint"]')).toBeNull();
  });

  it("never intercepts a click, because the player has to reach the world through it", () => {
    const store = new SimulationStore(createInitialState(1));
    const host = render(store);
    const hint = host.querySelector('[data-testid="first-run-hint"]') as HTMLElement;

    expect(getComputedStyle(hint).pointerEvents).toBe("none");
  });
});
