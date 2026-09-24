import { MACHINES, type MachineType } from '../sim/machines';
import { TECH_NODES, canUnlock, type UnlockState } from '../sim/techTree';

/** How a tech node should read in the panel. */
export type NodeStatus = 'unlocked' | 'available' | 'unaffordable' | 'locked';

export interface TechEntry {
  id: string;
  kind: 'machine' | 'recipe';
  label: string;
  cost: number;
  status: NodeStatus;
  /** Labels of the prerequisites still missing. Empty unless `locked`. */
  missing: string[];
}

/**
 * A node's panel status. Prerequisites win over affordability: a node that
 * cannot legally be bought must not look buyable just because the player is
 * rich, or the panel would offer a click that always refuses.
 */
export function statusFor(unlocks: UnlockState, id: string, currency: number): NodeStatus {
  const check = canUnlock(unlocks, id, currency);
  if (check.ok) return 'available';
  switch (check.reason) {
    case 'already-unlocked':
      return 'unlocked';
    case 'insufficient-currency':
      return 'unaffordable';
    case 'missing-prerequisite':
      return 'locked';
    default:
      // An id no node matches is a programming error, not a game state.
      throw new Error(`unknown tech node: ${id}`);
  }
}

/** The prerequisites a node is still waiting on, by label, for the panel to show. */
function missingLabels(unlocks: UnlockState, id: string): string[] {
  const node = TECH_NODES.find((entry) => entry.id === id);
  if (!node) return [];
  if (statusFor(unlocks, id, Number.POSITIVE_INFINITY) !== 'locked') return [];

  return node.requires
    .filter(
      (required) =>
        !unlocks.machines.includes(required as MachineType) &&
        !unlocks.recipes.includes(required as never),
    )
    .map((required) => TECH_NODES.find((entry) => entry.id === required)?.label ?? required);
}

/** The whole tree, in declaration order, ready to render. */
export function techEntries(unlocks: UnlockState, currency: number): TechEntry[] {
  return TECH_NODES.map((node) => ({
    id: node.id,
    kind: node.kind,
    label: node.label,
    cost: node.cost,
    status: statusFor(unlocks, node.id, currency),
    missing: missingLabels(unlocks, node.id),
  }));
}

/**
 * Which build tools are locked. The panel uses this to disable a button before
 * the player can click it; the sim enforces the same rule independently, so a
 * stale panel cannot place a locked machine.
 */
export function toolLocks(unlocks: UnlockState): Record<MachineType, boolean> {
  const locks = {} as Record<MachineType, boolean>;
  for (const type of Object.keys(MACHINES) as MachineType[]) {
    locks[type] = !unlocks.machines.includes(type);
  }
  return locks;
}
