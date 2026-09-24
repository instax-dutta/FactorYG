import { OFFLINE_CAP_S, OFFLINE_MODAL_THRESHOLD_S } from '../config/constants';
import { sellValueFor } from './recipes';
import type { ChainInfo } from './throughputLedger';
import type { ResourceId } from './worldgen';

export type OfflineChain = Pick<ChainInfo, 'outputResource' | 'steadyStateThroughput'> & {
  id?: string;
};

export interface OfflineGain {
  chainId: string;
  outputResource: ResourceId;
  /** Items produced while away. */
  amount: number;
  currency: number;
}

export interface OfflineReport {
  /** Real time away, as reported by the clock. */
  elapsedSec: number;
  /** Time actually credited, capped at OFFLINE_CAP_S. */
  creditedSec: number;
  gains: OfflineGain[];
  totalCurrency: number;
}

/**
 * Idle progress is never a replay of belt traffic: each chain is credited at its
 * last-known steady-state throughput, capped, then summed.
 */
export function computeOfflineGains(
  chains: readonly OfflineChain[],
  elapsedSec: number,
  sellMultiplier = 1,
): OfflineReport {
  const creditedSec = Math.max(0, Math.min(elapsedSec, OFFLINE_CAP_S));
  const gains = chains.map((chain) => {
    const amount = chain.steadyStateThroughput * creditedSec;
    return {
      chainId: chain.id ?? `sold-${chain.outputResource}`,
      outputResource: chain.outputResource,
      amount,
      currency: amount * sellValueFor(chain.outputResource) * sellMultiplier,
    };
  });

  return {
    elapsedSec,
    creditedSec,
    gains,
    totalCurrency: gains.reduce((sum, gain) => sum + gain.currency, 0),
  };
}

/** Below the threshold the catch-up is not worth interrupting the player for. */
export function shouldShowModal(elapsedSec: number): boolean {
  return elapsedSec > OFFLINE_MODAL_THRESHOLD_S;
}

export interface PauseTracker {
  /** Records that the tab became hidden. */
  hide(nowMs: number): void;
  /**
   * Records that the tab became visible again; returns the seconds it was
   * hidden, or 0 when there was no matching hide.
   */
  show(nowMs: number): number;
  isHidden(): boolean;
}

/**
 * Tracks how long the tab spent hidden, so a paused factory can be credited the
 * same way an absence is. Pairing matters: a `show` with no matching `hide` must
 * credit nothing, or the whole session would count as idle time.
 */
export function createPauseTracker(): PauseTracker {
  let hiddenAt: number | null = null;

  return {
    hide(nowMs: number): void {
      hiddenAt = nowMs;
    },
    show(nowMs: number): number {
      if (hiddenAt === null) return 0;
      const awaySec = (nowMs - hiddenAt) / 1000;
      hiddenAt = null;
      // A backwards clock is not credit either.
      return awaySec > 0 ? awaySec : 0;
    },
    isHidden(): boolean {
      return hiddenAt !== null;
    },
  };
}

export interface ResumeResult {
  /** Real seconds since the save was written, clamped at zero. */
  elapsedSec: number;
  report: OfflineReport;
  /** Currency to add to the loaded factory. */
  credit: number;
  showModal: boolean;
}

/**
 * Turns a loaded save's timestamp into offline credit and a modal decision.
 * A missing or nonsensical timestamp (a hand-edited or future-version save)
 * counts as no time away rather than poisoning the economy with NaN.
 */
export function resumeFromSave(
  chains: readonly OfflineChain[],
  lastSavedAt: unknown,
  nowMs: number,
  sellMultiplier = 1,
): ResumeResult {
  const savedAt =
    typeof lastSavedAt === 'number' && Number.isFinite(lastSavedAt) ? lastSavedAt : nowMs;
  // A timestamp in the future (clock change, timezone edit) credits nothing.
  const elapsedSec = Math.max(0, (nowMs - savedAt) / 1000);
  const report = computeOfflineGains(chains, elapsedSec, sellMultiplier);

  return {
    elapsedSec,
    report,
    credit: report.totalCurrency,
    showModal: shouldShowModal(elapsedSec),
  };
}
