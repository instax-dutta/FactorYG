import { describe, expect, it } from 'vitest';
import { resourceLabel } from '../src/ui/resourceLabels';
import type { ResourceId } from '../src/sim/worldgen';

const cases: ReadonlyArray<readonly [ResourceId, string]> = [
  ['copperOre', 'Copper Ore'],
  ['ironOre', 'Iron Ore'],
  ['coal', 'Coal'],
  ['stone', 'Stone'],
  ['copperIngot', 'Copper Ingot'],
  ['ironIngot', 'Iron Ingot'],
  ['refinedStone', 'Refined Stone'],
  ['wire', 'Wire'],
  ['gear', 'Gear'],
  ['plate', 'Plate'],
  ['circuit', 'Circuit'],
  ['frame', 'Frame'],
  ['motor', 'Motor'],
];

describe('resource labels', () => {
  it.each(cases)('formats %s as %s', (resource, expected) => {
    expect(resourceLabel(resource)).toBe(expected);
  });
});
