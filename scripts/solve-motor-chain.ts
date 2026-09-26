import { writeFileSync } from "node:fs";
import { createInitialState } from "../src/sim/initialState";
import { MACHINES } from "../src/content/machines";
import { RECIPES } from "../src/content/recipes";
import { rotatePoint } from "../src/sim/rotation";
import type { GridPoint, ResourceId, Rotation } from "../src/sim/types";

const GRID = 64;
const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const key = (x: number, y: number) => `${x},${y}`;

type Occupancy = Set<string>;

interface MachineSpec {
  id: string;
  type: "smelter" | "assembler";
  recipe: string;
  cell: GridPoint;
  rotation: Rotation;
  inputPorts: GridPoint[];
  outputCell: GridPoint | null;
  supplies: ResourceId | null;
}

interface Placed {
  machine: MachineSpec;
  legs: Array<{ from: GridPoint; to: GridPoint }>;
}

function ports(type: "smelter" | "assembler", cell: GridPoint, rotation: Rotation) {
  const all = MACHINES[type].ports.map((p) => {
    const offset = rotatePoint(p.offset as GridPoint, rotation) as GridPoint;
    return { kind: p.kind, cell: { x: cell.x + offset.x, y: cell.y + offset.y } };
  });
  return {
    inputPorts: all.filter((p) => p.kind === "input").map((p) => p.cell),
    outputCell: all.find((p) => p.kind === "output")?.cell ?? null,
  };
}

function runCells(from: GridPoint, to: GridPoint): GridPoint[] {
  if (from.x !== to.x && from.y !== to.y) return [];
  if (from.x === to.x && from.y === to.y) return [];
  const cells: GridPoint[] = [];
  if (from.y === to.y) {
    for (let x = Math.min(from.x, to.x) + 1; x < Math.max(from.x, to.x); x += 1) cells.push({ x, y: from.y });
  } else {
    for (let y = Math.min(from.y, to.y) + 1; y < Math.max(from.y, to.y); y += 1) cells.push({ x: from.x, y });
  }
  return cells;
}

/** Belt rotation whose output points from `from` toward `to`. */
function beltRotation(from: GridPoint, to: GridPoint): Rotation {
  if (to.x > from.x) return 0;
  if (to.y > from.y) return 90;
  if (to.x < from.x) return 180;
  return 270;
}

/** Rotation whose output port lands on `target` from `origin`. */
function facingRotation(origin: GridPoint, target: GridPoint): Rotation | null {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  for (const rotation of ROTATIONS) {
    const offset = rotatePoint({ x: 1, y: 0 }, rotation) as GridPoint;
    if (offset.x === dx && offset.y === dy) return rotation;
  }
  return null;
}

function inputsOf(recipeId: string): ResourceId[] {
  return Object.keys(RECIPES[recipeId as keyof typeof RECIPES].inputs) as ResourceId[];
}

export function solve(seed = 1337) {
  const nodeList = createInitialState(seed).grid.nodes;
  const occupancy: Occupancy = new Set(nodeList.map((n) => key(n.x, n.y)));
  const supplies = new Map<ResourceId, GridPoint[]>();
  for (const node of nodeList) {
    const list = supplies.get(node.resource) ?? [];
    list.push({ x: node.x, y: node.y });
    supplies.set(node.resource, list);
  }
  const placed: Placed[] = [];

  const legOptions = (target: GridPoint, resource: ResourceId): Array<{ cells: GridPoint[]; from: GridPoint }> => {
    const options: Array<{ cells: GridPoint[]; from: GridPoint }> = [];
    for (const from of supplies.get(resource) ?? []) {
      if (from.x === target.x && from.y === target.y) {
        options.push({ cells: [], from });
        continue;
      }
      const cells = runCells(from, target);
      if (cells.length > 0) options.push({ cells, from });
    }
    return options;
  };

  const candidatesFor = (id: string, type: "smelter" | "assembler", recipe: string, suppliesResource: ResourceId | null) => {
    const needed = inputsOf(recipe);
    const found: Array<{ machine: MachineSpec; legs: Array<{ from: GridPoint; to: GridPoint }>; score: number }> = [];
    for (const rotation of ROTATIONS) {
      for (let x = 1; x < GRID - 1; x += 1) {
        for (let y = 1; y < GRID - 1; y += 1) {
          if (occupancy.has(key(x, y))) continue;
          const cell = { x, y };
          const { inputPorts, outputCell } = ports(type, cell, rotation);
          if (inputPorts.length < needed.length) continue;
          const reach = inputPorts.map((port) => needed.map((resource) => legOptions(port, resource)));
          const used = new Set<number>();
          const assign = (resourceIndex: number, runs: GridPoint[][], legs: Array<{ from: GridPoint; to: GridPoint }>): boolean => {
            if (resourceIndex === needed.length) {
              const all = runs.flat();
              const seen = new Set<string>();
              for (const c of all) {
                const k = key(c.x, c.y);
                if (seen.has(k) || occupancy.has(k)) return false;
                seen.add(k);
              }
              const spread = placed.reduce(
                (total, other) => total + Math.abs(other.machine.cell.x - x) + Math.abs(other.machine.cell.y - y),
                0,
              );
              found.push({
                machine: { id, type, recipe, cell, rotation, inputPorts, outputCell, supplies: suppliesResource },
                legs,
                score: all.length * 4 + spread,
              });
              return true;
            }
            for (let portIndex = 0; portIndex < reach.length; portIndex += 1) {
              if (used.has(portIndex)) continue;
              for (const option of reach[portIndex][resourceIndex]) {
                used.add(portIndex);
                if (assign(resourceIndex + 1, [...runs, option.cells], [...legs, { from: option.from, to: inputPorts[portIndex] }])) {
                  used.delete(portIndex);
                  return true;
                }
                used.delete(portIndex);
              }
            }
            return false;
          };
          used.clear();
          assign(0, [], []);
        }
      }
    }
    found.sort((left, right) => left.score - right.score);
    return found;
  };

  const plan: Array<[string, "smelter" | "assembler", string, ResourceId | null]> = [
    ["sm-copper", "smelter", "copperIngot", "copperIngot"],
    ["sm-iron-1", "smelter", "ironIngot", "ironIngot"],
    ["asm-gear-1", "assembler", "gear", "gear"],
    ["sm-iron-2", "smelter", "ironIngot", "ironIngot"],
    ["asm-gear-2", "assembler", "gear", "gear"],
    ["sm-iron-3", "smelter", "ironIngot", "ironIngot"],
    ["sm-stone", "smelter", "refinedStone", "refinedStone"],
    ["asm-plate-1", "assembler", "plate", "plate"],
    ["sm-iron-4", "smelter", "ironIngot", "ironIngot"],
    ["asm-plate-2", "assembler", "plate", "plate"],
    ["sm-wire", "assembler", "wire", "wire"],
    ["asm-circuit", "assembler", "circuit", "circuit"],
    ["asm-frame", "assembler", "frame", "frame"],
    ["asm-motor", "assembler", "motor", "motor"],
  ];

  const BRANCH_LIMIT = Number(process.env.BRANCH_LIMIT ?? 400);
  const BUDGET_LIMIT = Number(process.env.BUDGET_LIMIT ?? 3_000_000);

  const search = (index: number, budget: { left: number }): boolean => {
    if (index === plan.length) return true;
    if (budget.left <= 0) return false;
    const [id, type, recipe, suppliesResource] = plan[index];
    const candidates = candidatesFor(id, type, recipe, suppliesResource);
    const branch = Math.min(candidates.length, BRANCH_LIMIT);
    for (let i = 0; i < branch; i += 1) {
      budget.left -= 1;
      if (budget.left <= 0) return false;
      const entry = candidates[i];
      const added = [key(entry.machine.cell.x, entry.machine.cell.y)];
      for (const leg of entry.legs) for (const c of runCells(leg.from, leg.to)) added.push(key(c.x, c.y));
      for (const k of added) occupancy.add(k);
      placed.push({ machine: entry.machine, legs: entry.legs });
      if (entry.machine.supplies !== null && entry.machine.outputCell !== null) {
        const list = supplies.get(entry.machine.supplies) ?? [];
        list.push(entry.machine.outputCell);
        supplies.set(entry.machine.supplies, list);
      }
      if (search(index + 1, budget)) return true;
      placed.pop();
      for (const k of added) occupancy.delete(k);
      if (entry.machine.supplies !== null && entry.machine.outputCell !== null) {
        const list = supplies.get(entry.machine.supplies) ?? [];
        const at = list.lastIndexOf(entry.machine.outputCell);
        if (at >= 0) list.splice(at, 1);
      }
    }
    return false;
  };

  const ok = search(0, { left: BUDGET_LIMIT });
  if (!ok) return { ok, entities: [] };

  const entities: Array<Record<string, unknown>> = [];
  for (const { machine, legs } of placed) {
    entities.push({
      id: machine.id,
      type: machine.type,
      x: machine.cell.x,
      y: machine.cell.y,
      rotation: machine.rotation,
      recipeId: machine.recipe,
    });
  }

  const usedNodes = new Set<string>();
  for (const { legs } of placed) {
    for (const leg of legs) {
      const cells = runCells(leg.from, leg.to);
      cells.forEach((cell, index) => {
        const previous = cells[index - 1] ?? leg.from;
        entities.push({
          id: `belt-${entities.length}`,
          type: "belt",
          x: cell.x,
          y: cell.y,
          rotation: beltRotation(previous, cell),
        });
      });
      if (!usedNodes.has(key(leg.from.x, leg.from.y))) {
        usedNodes.add(key(leg.from.x, leg.from.y));
        const next = cells[0];
        const rotation = next === undefined ? beltRotation(leg.from, leg.to) : beltRotation(leg.from, next);
        entities.push({
          id: `extractor-${entities.length}`,
          type: "extractor",
          x: leg.from.x,
          y: leg.from.y,
          rotation,
        });
      }
    }
  }

  const motor = placed.find((p) => p.machine.id === "asm-motor");
  if (motor === undefined || motor.machine.outputCell === null) return { ok: false, entities: [] };
  const depotCell: GridPoint = { x: motor.machine.outputCell.x, y: motor.machine.outputCell.y + 1 };
  entities.push({ id: "depot-motor", type: "depot", x: depotCell.x, y: depotCell.y, rotation: 270 });

  return { ok: true, entities };
}

const result = solve();
if (!result.ok) {
  console.log("no solution found");
  process.exitCode = 1;
} else {
  console.log(`MOTOR CHAIN SOLVED with ${result.entities.length} entities`);
  writeFileSync("scripts/motor-chain-layout.json", `${JSON.stringify(result.entities, null, 2)}\n`);
  console.log("wrote scripts/motor-chain-layout.json");
}
