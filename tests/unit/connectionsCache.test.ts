import { beforeEach, describe, expect, it, vi } from "vitest";
import { arePortsConnected, getWorldPortCells } from "../../src/sim/connections";
import type { Entity, MachineDefinition } from "../../src/sim/types";

const OVERRIDES = vi.hoisted((): { machines: Record<string, unknown> } => ({ machines: {} }));

vi.mock("../../src/content/machines", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/content/machines")>();
  return {
    ...actual,
    getMachine: (type: string) => OVERRIDES.machines[type] ?? actual.getMachine(type),
  };
});

beforeEach(() => {
  for (const key of Object.keys(OVERRIDES.machines)) {
    delete OVERRIDES.machines[key];
  }
});

function asEntity(type: string, x: number, y: number, rotation: 0 | 90 | 180 | 270): Entity {
  return { id: `${type}-${x}-${y}`, type, x, y, rotation, level: 1 } as Entity;
}

function withPorts(ports: MachineDefinition["ports"]): MachineDefinition {
  return { ports } as unknown as MachineDefinition;
}

describe("port geometry honours a content override", () => {
  it("reads the override before the cache is warm", () => {
    OVERRIDES.machines.belt = withPorts([{ id: "output", kind: "output", offset: { x: 0, y: 1 } }]);

    const cells = getWorldPortCells(asEntity("belt", 4, 4, 0));

    expect(cells).toHaveLength(1);
    expect(cells[0]?.port.offset).toEqual({ x: 0, y: 1 });
  });

  it("reads the override again after the cache is warm", () => {
    expect(getWorldPortCells(asEntity("belt", 4, 4, 0))).toHaveLength(2);

    OVERRIDES.machines.belt = withPorts([{ id: "output", kind: "output", offset: { x: 0, y: 1 } }]);

    const cells = getWorldPortCells(asEntity("belt", 4, 4, 0));

    expect(cells).toHaveLength(1);
    expect(cells[0]?.port.offset).toEqual({ x: 0, y: 1 });
  });

  it("drops the override again and returns to the shipped geometry", () => {
    expect(getWorldPortCells(asEntity("belt", 4, 4, 0))).toHaveLength(2);
    OVERRIDES.machines.belt = withPorts([]);
    expect(getWorldPortCells(asEntity("belt", 4, 4, 0))).toHaveLength(0);
    delete OVERRIDES.machines.belt;

    expect(getWorldPortCells(asEntity("belt", 4, 4, 0))).toHaveLength(2);
  });

  it("changes the connection verdict when a port offset is overridden", () => {
    const belt = asEntity("belt", 4, 4, 0);
    const east = asEntity("depot", 5, 4, 0);
    const south = asEntity("depot", 4, 5, 0);
    expect(arePortsConnected(belt, east)).toBe(true);
    expect(arePortsConnected(belt, south)).toBe(false);

    OVERRIDES.machines.belt = withPorts([
      { id: "input", kind: "input", offset: { x: -1, y: 0 }, accepts: ["ironOre"] },
      { id: "output", kind: "output", offset: { x: 0, y: 1 } },
    ]);
    OVERRIDES.machines.depot = withPorts([
      { id: "input", kind: "input", offset: { x: 0, y: -1 }, accepts: ["ironOre"] },
    ]);

    expect(arePortsConnected(belt, south)).toBe(true);
    expect(arePortsConnected(belt, east)).toBe(false);
  });
});
