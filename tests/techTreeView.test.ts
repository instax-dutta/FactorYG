import { describe, it, expect } from 'vitest';
import {
  ALL_UNLOCKED,
  TECH_NODES,
  startingUnlocks,
  type UnlockState,
} from '../src/sim/techTree';
import { MACHINES } from '../src/sim/machines';
import { RECIPES } from '../src/sim/recipes';
import { statusFor, techEntries, toolLocks } from '../src/ui/techTreeView';

const entryFor = (entries: ReturnType<typeof techEntries>, id: string) => {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`no entry for ${id}`);
  return entry;
};

describe('tech tree view model', () => {
  it('lists every node in the tree, so nothing is unreachable from the panel', () => {
    const entries = techEntries(startingUnlocks(), 0);

    expect(entries.map((entry) => entry.id)).toEqual(TECH_NODES.map((node) => node.id));
    expect(entryFor(entries, 'motor').label).toBe('Motor');
    expect(entryFor(entries, 'motor').cost).toBe(1000);
  });

  it('marks a node available once its prerequisites are met and it is affordable', () => {
    const entries = techEntries(startingUnlocks(), 75);

    expect(entryFor(entries, 'assembler').status).toBe('available');
    expect(entryFor(entries, 'assembler').missing).toEqual([]);
  });

  it('accepts exactly the asking price, and not a credit less', () => {
    expect(entryFor(techEntries(startingUnlocks(), 75), 'assembler').status).toBe('available');
    expect(entryFor(techEntries(startingUnlocks(), 74), 'assembler').status).toBe('unaffordable');
  });

  it('reports a missing prerequisite as locked even when the player is rich', () => {
    // Affordability must not disguise a node that cannot legally be bought:
    // `wire` needs the assembler, and no amount of currency changes that.
    const entry = entryFor(techEntries(startingUnlocks(), 1_000_000), 'wire');

    expect(entry.status).toBe('locked');
    expect(entry.missing).toEqual(['Assembler']);
  });

  it('reports every unmet prerequisite, not just the first', () => {
    const entry = entryFor(techEntries(startingUnlocks(), 1_000_000), 'plate');

    expect(entry.missing).toEqual(['Assembler', 'Refined Stone']);
  });

  it('reports an owned node as unlocked, and only an owned one', () => {
    expect(statusFor(ALL_UNLOCKED, 'assembler', 0)).toBe('unlocked');
    expect(statusFor(ALL_UNLOCKED, 'motor', 0)).toBe('unlocked');
    expect(statusFor(startingUnlocks(), 'assembler', 0)).toBe('unaffordable');

    // What the player already starts with is not for sale, so it is not an
    // entry at all: the panel lists the tree, not the inventory.
    const entries = techEntries(startingUnlocks(), 0);
    expect(entries.some((entry) => entry.id === 'smelter')).toBe(false);
    expect(entries.some((entry) => entry.id === 'copperIngot')).toBe(false);
  });

  it('opens a node as soon as the prerequisite is bought, without needing the panel to reload', () => {
    const bought: UnlockState = {
      machines: [...startingUnlocks().machines, 'assembler'],
      recipes: [...startingUnlocks().recipes],
    };

    const entry = entryFor(techEntries(bought, 0), 'wire');
    expect(entry.status).toBe('unaffordable');
    expect(entry.missing).toEqual([]);
  });

  it('reports unknown ids rather than guessing a status', () => {
    expect(() => statusFor(startingUnlocks(), 'warpDrive', 100)).toThrow(/unknown tech node/);
  });

  it('locks exactly the tools a fresh player cannot build', () => {
    // The crossing and the splitter ship unlocked with the belt: they are
    // road, not a tier, and act 3 is only buildable if a new player can
    // already overpass — and split a line without duplicating machines.
    expect(toolLocks(startingUnlocks())).toEqual({
      extractor: false,
      belt: false,
      crossing: false,
      splitter: false,
      smelter: false,
      depot: false,
      assembler: true,
      silo: true,
    });
  });

  it('locks nothing once the tree is wide open', () => {
    const locks = toolLocks(ALL_UNLOCKED);

    expect(Object.values(locks).every((locked) => locked === false)).toBe(true);
    expect(Object.keys(locks).sort()).toEqual(Object.keys(MACHINES).sort());
  });

  it('leaves no machine locked forever and no recipe out of the tree', () => {
    // A locked machine with no node would be unbuildable, and a locked recipe
    // outside the tree would be uncraftable — both are dead content.
    const reachable = new Set([
      ...TECH_NODES.map((node) => node.id),
      ...startingUnlocks().machines,
      ...startingUnlocks().recipes,
    ]);

    for (const type of Object.keys(MACHINES)) {
      expect(reachable.has(type), `machine ${type} is not in the tech tree`).toBe(true);
    }
    // Raw resources are extracted, not crafted, so they need no unlock; every
    // recipe a machine actually makes does.
    for (const [id, recipe] of Object.entries(RECIPES)) {
      if (recipe.machine === null) continue;
      expect(reachable.has(id), `recipe ${id} is not in the tech tree`).toBe(true);
    }
  });
});
