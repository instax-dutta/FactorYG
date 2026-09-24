import { describe, expect, it } from 'vitest';
import { ProductionLedger, type ChainInfo } from '../src/sim/throughputLedger';

const motorChain = (throughput: number): ChainInfo => ({
  id: 'sold-motor',
  outputResource: 'motor',
  steadyStateThroughput: throughput,
});

describe('ProductionLedger', () => {
  it('returns no chains for an empty ledger', () => {
    const ledger = new ProductionLedger(50);

    expect(ledger.snapshot(0)).toEqual([]);
  });

  it('publishes a resource only after a complete measured window', () => {
    const ledger = new ProductionLedger(50);
    ledger.recordSale('motor', 0);
    ledger.recordSale('motor', 10);

    expect(ledger.snapshot(10)).toEqual([]);

    ledger.recordSale('motor', 25);
    ledger.recordSale('motor', 50);

    expect(ledger.snapshot(50)).toEqual([
      { id: 'sold-motor', outputResource: 'motor', steadyStateThroughput: 0.8 },
    ]);
  });

  it('keeps mixed resources separate and orders equal rates deterministically', () => {
    const ledger = new ProductionLedger(50);
    ledger.recordSale('motor', 0);
    ledger.recordSale('copperOre', 0);
    ledger.recordSale('motor', 50);
    ledger.recordSale('copperOre', 50);

    expect(ledger.snapshot(50)).toEqual([
      { id: 'sold-copperOre', outputResource: 'copperOre', steadyStateThroughput: 0.4 },
      { id: 'sold-motor', outputResource: 'motor', steadyStateThroughput: 0.4 },
    ]);
  });

  it('expires samples outside the rolling window', () => {
    const ledger = new ProductionLedger(50);
    ledger.recordSale('motor', 0);

    expect(ledger.snapshot(50)).toEqual([
      { id: 'sold-motor', outputResource: 'motor', steadyStateThroughput: 0.2 },
    ]);
    expect(ledger.snapshot(51)).toEqual([]);
  });

  it('keeps a loaded seed until a complete measured window replaces it', () => {
    const ledger = new ProductionLedger(50);
    ledger.seed([motorChain(0.5)], 100);
    ledger.recordSale('motor', 100);

    expect(ledger.snapshot(100)).toEqual([motorChain(0.5)]);
    expect(ledger.snapshot(149)).toEqual([motorChain(0.5)]);
    expect(ledger.snapshot(150)).toEqual([
      { id: 'sold-motor', outputResource: 'motor', steadyStateThroughput: 0.2 },
    ]);
  });

  it('aggregates duplicate persisted entries for the same output resource', () => {
    const ledger = new ProductionLedger(50);
    ledger.seed(
      [
        { id: 'sold-motor-a', outputResource: 'motor', steadyStateThroughput: 0.25 },
        { id: 'sold-motor-b', outputResource: 'motor', steadyStateThroughput: 0.5 },
      ],
      100,
    );

    expect(ledger.snapshot(100)).toEqual([
      { id: 'sold-motor', outputResource: 'motor', steadyStateThroughput: 0.75 },
    ]);
  });  it('clears measured samples and loaded seeds', () => {
    const ledger = new ProductionLedger(50);
    ledger.seed([motorChain(0.5)], 0);
    ledger.recordSale('motor', 0);
    ledger.recordSale('motor', 50);

    ledger.clear();

    expect(ledger.snapshot(50)).toEqual([]);
  });
});
