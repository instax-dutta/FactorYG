import { describe, expect, it } from "vitest";
import { MACHINES } from "../../src/content/machines";
import {
  arePortsConnected,
  getWorldPortCells,
  portAcceptsResource,
  rotatePorts,
} from "../../src/sim/connections";
import type { Entity, MachineType, PortDefinition, ResourceId, Rotation } from "../../src/sim/types";

describe("port rotation and connections", () => {
  it("rotates ports without mutating machine definitions", () => {
    const originalPorts = MACHINES.assembler.ports.map((port) => ({
      ...port,
      offset: { ...port.offset },
    }));

    const rotatedPorts = rotatePorts(MACHINES.assembler.ports, 90);

    expect(
      rotatedPorts.map((port) => [port.id, { x: port.offset.x + 0, y: port.offset.y + 0 }]),
    ).toEqual([
      ["input-1", { x: 0, y: -1 }],
      ["input-2", { x: 1, y: 0 }],
      ["output", { x: 0, y: 1 }],
    ]);
    expect(MACHINES.assembler.ports).toEqual(originalPorts);
    expect(rotatedPorts).not.toBe(MACHINES.assembler.ports);
    expect(rotatedPorts[0]).not.toBe(MACHINES.assembler.ports[0]);
  });

  it("returns world cell positions for every rotated port", () => {
    const entity = createEntity("assembler-1", "assembler", 10, 20, 90);

    expect(getWorldPortCells(entity).map(({ port, x, y }) => ({ id: port.id, x, y }))).toEqual([
      { id: "input-1", x: 10, y: 19 },
      { id: "input-2", x: 11, y: 20 },
      { id: "output", x: 10, y: 21 },
    ]);
  });

  it("connects only mutually facing output and input ports", () => {
    const output = createEntity("extractor-1", "extractor", 4, 4, 0, {
      resourceNode: "copperOre",
    });
    const alignedInput = createEntity("belt-1", "belt", 5, 4);
    const sideInput = createEntity("belt-2", "belt", 4, 5);
    const reversedInput = createEntity("belt-3", "belt", 5, 4, 180);

    expect(arePortsConnected(output, alignedInput)).toBe(true);
    expect(arePortsConnected(output, sideInput)).toBe(false);
    expect(arePortsConnected(output, reversedInput)).toBe(false);
  });

  it("keeps connections valid when both ports are rotated toward each other", () => {
    const output = createEntity("extractor-1", "extractor", 4, 4, 90, {
      resourceNode: "copperOre",
    });
    const input = createEntity("belt-1", "belt", 4, 5, 90);

    expect(arePortsConnected(output, input)).toBe(true);
  });

  it("filters a connection by the resource accepted by the input port", () => {
    const rawOutput = createEntity("raw-extractor", "extractor", 4, 4, 0, {
      resourceNode: "copperOre",
    });
    const processedOutput = createEntity("processed-extractor", "extractor", 4, 4, 0, {
      resourceNode: "copperIngot",
    });
    const smelterInput = createEntity("smelter-1", "smelter", 5, 4);

    expect(arePortsConnected(rawOutput, smelterInput)).toBe(true);
    expect(arePortsConnected(processedOutput, smelterInput)).toBe(false);
  });

  it("filters processor connections by the selected recipe output", () => {
    const output = createEntity("smelter-1", "smelter", 4, 4, 0, {
      recipeId: "copperIngot",
    });
    const input = createEntity("smelter-2", "smelter", 5, 4);

    expect(arePortsConnected(output, input)).toBe(false);
  });

  it("does not produce output for a processor without a selected recipe", () => {
    const output = createEntity("smelter-1", "smelter", 4, 4);
    const input = createEntity("assembler-1", "assembler", 5, 4);

    expect(arePortsConnected(output, input)).toBe(false);
  });

  it("does not produce output for a processor with an unknown recipe", () => {
    const output = createEntity("smelter-1", "smelter", 4, 4, 0, {
      recipeId: "not-a-recipe",
    });
    const input = createEntity("assembler-1", "assembler", 5, 4);

    expect(arePortsConnected(output, input)).toBe(false);
  });

  it("does not produce output for a processor with an incompatible recipe", () => {
    const output = createEntity("assembler-1", "assembler", 4, 4, 0, {
      recipeId: "copperIngot",
    });
    const input = createEntity("assembler-2", "assembler", 5, 4);

    expect(arePortsConnected(output, input)).toBe(false);
  });

  it("does not resolve a recipe attached to a belt as its output resource", () => {
    const output = createEntity("belt-1", "belt", 4, 4, 0, {
      recipeId: "copperIngot",
    });
    const input = createEntity("smelter-1", "smelter", 5, 4);

    expect(arePortsConnected(output, input)).toBe(true);
  });

  it("uses an explicit output resource when filtering a port pair", () => {
    const outputPort: PortDefinition = {
      id: "output",
      kind: "output",
      offset: { x: 1, y: 0 },
      produces: "copperIngot",
    };
    const smelterInput = MACHINES.smelter.ports[0];

    expect(portAcceptsResource(outputPort, smelterInput, "copperIngot")).toBe(false);
    expect(portAcceptsResource(outputPort, smelterInput, "copperOre")).toBe(true);
  });

  it("uses the extractor resource when its output port has no static resource", () => {
    const extractor = createEntity("extractor-1", "extractor", 4, 4, 0, {
      resourceNode: "copperOre",
    });
    const smelter = createEntity("smelter-1", "smelter", 5, 4);

    expect(arePortsConnected(extractor, smelter)).toBe(true);
  });

  it("returns false for disconnected entities", () => {
    const output = createEntity("extractor-1", "extractor", 4, 4, 0, {
      resourceNode: "copperOre",
    });
    const distantInput = createEntity("belt-1", "belt", 6, 4);
    const secondOutput = createEntity("extractor-2", "extractor", 5, 4, 0, {
      resourceNode: "copperOre",
    });

    expect(arePortsConnected(output, distantInput)).toBe(false);
    expect(arePortsConnected(output, secondOutput)).toBe(false);
  });
});

function createEntity(
  id: string,
  type: MachineType,
  x: number,
  y: number,
  rotation: Rotation = 0,
  extra: { resourceNode?: ResourceId; recipeId?: string } = {},
): Entity {
  return {
    id,
    type,
    x,
    y,
    rotation,
    level: 1,
    ...extra,
  };
}
