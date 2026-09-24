import { describe, it, expect } from 'vitest';
import {
  computeOfflineGains,
  createPauseTracker,
  resumeFromSave,
  shouldShowModal,
} from '../src/sim/offline';
import { OFFLINE_CAP_S, OFFLINE_MODAL_THRESHOLD_S } from '../src/config/constants';
import type { ChainInfo } from '../src/sim/throughputLedger';

const copper: ChainInfo = { id: 'chain-1', outputResource: 'copperOre', steadyStateThroughput: 1 };
const iron: ChainInfo = { id: 'chain-2', outputResource: 'ironOre', steadyStateThroughput: 2 };

describe('offline progress', () => {
  it('applies throughput x elapsed per chain', () => {
    const report = computeOfflineGains([copper], 600, 1);

    expect(report.creditedSec).toBe(600);
    expect(report.gains).toHaveLength(1);
    expect(report.gains[0]).toEqual({
      chainId: 'chain-1',
      outputResource: 'copperOre',
      amount: 600, // 1 item/sec * 600s
      currency: 240, // 600 * 0.4 per ore
    });
    expect(report.totalCurrency).toBe(240);
  });

  it('caps elapsed at 8h (e.g. 24h absence credits only 8h)', () => {
    const report = computeOfflineGains([copper], 24 * 3600, 1);

    expect(report.elapsedSec).toBe(24 * 3600);
    expect(report.creditedSec).toBe(OFFLINE_CAP_S);
    expect(report.gains[0].amount).toBe(OFFLINE_CAP_S);
  });

  it('zero/negative elapsed yields zero gains', () => {
    for (const elapsed of [0, -1, -9999]) {
      const report = computeOfflineGains([copper, iron], elapsed, 1);
      expect(report.creditedSec).toBe(0);
      expect(report.totalCurrency).toBe(0);
      expect(report.gains.every((gain) => gain.amount === 0 && gain.currency === 0)).toBe(true);
    }
  });

  it('sums across multiple chains', () => {
    const report = computeOfflineGains([copper, iron], 60, 1);

    expect(report.gains.map((gain) => gain.chainId)).toEqual(['chain-1', 'chain-2']);
    // 60 * 0.4 + 120 * 0.5
    expect(report.totalCurrency).toBeCloseTo(24 + 60, 6);
  });

  it('applies the current prestige sell multiplier', () => {
    const report = computeOfflineGains([copper], 10, 2.5);

    expect(report.gains[0].currency).toBe(10);
    expect(report.totalCurrency).toBe(10);
  });
  it('pairs each hide with the next show', () => {
    const tracker = createPauseTracker();

    // A show with no matching hide is not a pause: crediting it would hand the
    // player the entire session as offline progress.
    expect(tracker.show(900_000)).toBe(0);

    tracker.hide(1_000);
    expect(tracker.show(6_000)).toBe(5);

    tracker.hide(10_000);
    expect(tracker.show(11_500)).toBe(1.5);
  });

  it('treats a backwards clock as no time away', () => {
    const tracker = createPauseTracker();
    tracker.hide(5_000);
    expect(tracker.show(4_000)).toBe(0);
  });

  it('reports whether the tab is currently hidden', () => {
    const tracker = createPauseTracker();
    expect(tracker.isHidden()).toBe(false);

    tracker.hide(0);
    expect(tracker.isHidden()).toBe(true);

    tracker.show(1_000);
    expect(tracker.isHidden()).toBe(false);
  });

  it('only shows the welcome-back modal past the threshold', () => {
    expect(shouldShowModal(0)).toBe(false);
    expect(shouldShowModal(OFFLINE_MODAL_THRESHOLD_S)).toBe(false);
    expect(shouldShowModal(OFFLINE_MODAL_THRESHOLD_S + 1)).toBe(true);
    expect(shouldShowModal(24 * 3600)).toBe(true);
  });
});

/**
 * Resume wiring: turning a loaded save's timestamp into credit plus a modal
 * decision. This used to be inline in the view layer, where a malformed
 * timestamp could poison the economy with NaN.
 */
describe('resume from save', () => {
  const NOW = 1_700_000_000_000;

  it('credits the time away and reports it', () => {
    const result = resumeFromSave([copper], NOW - 3600 * 1000, NOW, 1);

    expect(result.elapsedSec).toBe(3600);
    expect(result.credit).toBe(result.report.totalCurrency);
    expect(result.credit).toBeCloseTo(1440, 6); // 3600 ore * 0.4
    expect(result.showModal).toBe(true);
  });

  it('caps a long absence', () => {
    const result = resumeFromSave([copper], NOW - 24 * 3600 * 1000, NOW, 1);

    expect(result.elapsedSec).toBe(24 * 3600);
    expect(result.report.creditedSec).toBe(OFFLINE_CAP_S);
    expect(result.credit).toBeCloseTo(OFFLINE_CAP_S * 0.4, 6);
  });

  it('credits nothing for a timestamp in the future', () => {
    const result = resumeFromSave([copper], NOW + 60_000, NOW, 1);

    expect(result.elapsedSec).toBe(0);
    expect(result.credit).toBe(0);
    expect(result.showModal).toBe(false);
  });

  it('credits nothing when the timestamp is missing or not a number', () => {
    for (const lastSavedAt of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 'yesterday']) {
      const result = resumeFromSave([copper], lastSavedAt as never, NOW, 1);
      expect(result.elapsedSec).toBe(0);
      expect(result.credit).toBe(0);
      expect(Number.isNaN(result.credit)).toBe(false);
      expect(result.showModal).toBe(false);
    }
  });

  it('stays under the modal threshold for a short absence', () => {
    const result = resumeFromSave([copper], NOW - 30_000, NOW, 1);

    expect(result.elapsedSec).toBe(30);
    expect(result.credit).toBeGreaterThan(0);
    expect(result.showModal).toBe(false);
  });

  it('turns a hidden tab into the same credit as an absence', () => {
    const tracker = createPauseTracker();
    const hiddenAt = 1_700_000_000_000;
    tracker.hide(hiddenAt);

    // Half an hour in a background tab is credited exactly like being away.
    const awaySec = tracker.show(hiddenAt + 1800_000);
    const resume = resumeFromSave([copper], hiddenAt, hiddenAt + awaySec * 1000, 1);

    expect(awaySec).toBe(1800);
    expect(resume.credit).toBeCloseTo(1800 * 0.4, 6);
    expect(resume.showModal).toBe(true);
  });

  it('credits nothing when no chain reached a depot before saving', () => {
    const result = resumeFromSave([], NOW - 24 * 3600 * 1000, NOW, 1);

    expect(result.credit).toBe(0);
    expect(result.report.gains).toEqual([]);
    // Still worth telling the player they were away for a day.
    expect(result.showModal).toBe(true);
  });
});
