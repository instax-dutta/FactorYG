import { motorsToNextPoint, prestigeState } from '../sim/prestige';

/**
 * Slice 3.3: the prestige control's whole presentation, decided by one tested
 * function rather than inline JSX.
 *
 * The rule it must never break: it cannot offer a reset the sim would refuse.
 * `Simulation.prestige()` refuses at zero points, and the button is enabled
 * exactly when a reset would actually pay — so the panel can never be a
 * one-click no-op.
 */

export interface PrestigeInput {
  lifetimeMotors: number;
  totalPrestiges: number;
  claimedPoints: number;
}

export interface PrestigeView {
  /** True only when pressing it would actually grant points. */
  enabled: boolean;
  /** Points a prestige right now would grant. */
  points: number;
  /** Motors still to sell for the *next* point. */
  motorsToNext: number;
  label: string;
  detail: string;
  cost: string;
  bonus: string;
  cycles: string;
}

/** 1.25 -> "1.25x", 2 -> "2x": no trailing zeros. */
function trim(value: number): string {
  return `${Number(value.toFixed(2))}x`;
}

export function prestigeView(input: PrestigeInput): PrestigeView {
  const lifetimeMotors = Number.isFinite(input.lifetimeMotors)
    ? Math.max(0, input.lifetimeMotors)
    : 0;
  const resets = Number.isFinite(input.totalPrestiges) ? Math.max(0, input.totalPrestiges) : 0;
  const state = prestigeState(lifetimeMotors, resets, input.claimedPoints);
  const points = state.points;
  const availablePoints = state.availablePoints;
  const multipliers = state.permanentMultipliers;
  const enabled = availablePoints > 0;
  const motorsToNext = motorsToNextPoint(state.lifetimeMotors);

  return {
    enabled,
    points: availablePoints,
    motorsToNext,
    label: `Prestige +${availablePoints}`,
    detail: enabled
      ? `${trim(multipliers.productionSpeed)} speed, ${trim(multipliers.sellValue)} sales after the reset`
      : `sell ${motorsToNext} more motors`,
    cost: 'clears the factory and its currency, keeps points and the tech tree',
    bonus:
      points === 0
        ? 'no bonuses yet'
        : `${points} point${points === 1 ? '' : 's'} · ${trim(multipliers.productionSpeed)} speed · ${trim(multipliers.sellValue)} sales`,
    cycles: resets === 0 ? 'first run' : `cycle ${resets + 1}`,
  };
}
