import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/sim/initialState";
import { advanceSimulation } from "../../src/sim/tick";

describe("advanceSimulation", () => {
  it("returns the same state until machine behavior is added", () => {
    const state = createInitialState();

    expect(advanceSimulation(state, 1)).toBe(state);
  });
});
