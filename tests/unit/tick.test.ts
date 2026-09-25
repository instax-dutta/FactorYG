import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { advanceSimulation } from "../../src/sim/tick";

describe("advanceSimulation", () => {
  it("advances runtime tick bookkeeping without mutating the input state", () => {
    const state = createInitialState();

    const next = advanceSimulation(state, 1);

    expect(next).not.toBe(state);
    expect(next.tickCount).toBe(1);
    expect(state.tickCount).toBe(0);
  });
});
