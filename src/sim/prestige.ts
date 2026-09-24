import { MOTOR_THRESHOLD } from '../config/constants';

/**
 * Phase 3, slice 3.1: the prestige formula, kept pure so the HUD, the sim and
 * the save all read the same numbers.
 *
 * Points are derived from *lifetime* motors rather than banked per reset, so
 * the multiplier always reflects everything the player has ever produced: a
 * second reset at 50 motors is worth two points, not one point twice.
 */

export interface PermanentMultipliers {
  productionSpeed: number;
  sellValue: number;
}

export interface PrestigeState {
  /**
   * Motors sold across every cycle. Points and multipliers are derived from it,
   * so it travels with them — the panel previews "motors to the next point"
   * from it, and the saved prestige block stores it under the same name.
   */
  lifetimeMotors: number;
  points: number;
  claimedPoints: number;
  availablePoints: number;
  totalPrestiges: number;
  permanentMultipliers: PermanentMultipliers;
}

/** Motors per prestige point. TUNE_AFTER_PLAYABLE. */
export function pointsFor(lifetimeMotors: number): number {
  if (!Number.isFinite(lifetimeMotors) || lifetimeMotors < MOTOR_THRESHOLD) return 0;
  return Math.floor(lifetimeMotors / MOTOR_THRESHOLD);
}

/** +25% production and +50% sale value per point, compounding over the tree. */
export function multipliersFor(points: number): PermanentMultipliers {
  const safe = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  return { productionSpeed: 1 + 0.25 * safe, sellValue: 1 + 0.5 * safe };
}

export function prestigeState(
  lifetimeMotors: number,
  totalPrestiges: number,
  claimedPoints = 0,
): PrestigeState {
  const motors = Number.isFinite(lifetimeMotors) ? Math.max(0, lifetimeMotors) : 0;
  const points = pointsFor(motors);
  const claimed = Number.isFinite(claimedPoints)
    ? Math.min(points, Math.max(0, Math.floor(claimedPoints)))
    : 0;
  return {
    lifetimeMotors: motors,
    points,
    claimedPoints: claimed,
    availablePoints: points - claimed,
    totalPrestiges,
    permanentMultipliers: multipliersFor(points),
  };
}

/** Motors still to sell before the next point, for the HUD's preview text. */
export function motorsToNextPoint(lifetimeMotors: number): number {
  const safe = Number.isFinite(lifetimeMotors) ? Math.max(0, lifetimeMotors) : 0;
  return MOTOR_THRESHOLD - (safe % MOTOR_THRESHOLD);
}
