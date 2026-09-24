import { MOTOR_THRESHOLD } from '../config/constants';

export interface GoalInput {
  /** Motors sold across every prestige cycle. */
  lifetimeMotors: number;
  /** Extractors on the map: the signal that ore is actually moving. */
  extractors: number;
  /** Whether the Motor recipe has been bought from the tech tree. */
  motorRecipeUnlocked: boolean;
}

export interface GoalView {
  title: string;
  detail: string;
}

/**
 * What the factory is for, in two lines.
 *
 * The playtest found a fresh player is handed 0 cr, six buttons and no statement
 * of the goal — and that a Motor, the win condition, is one more 1,000 cr row in
 * the tech panel with nothing marking it. This is the smallest fix that makes the
 * first session self-explanatory: always name the goal, and name the next action,
 * which changes as the factory does.
 *
 * Kept as a pure function so the HUD cannot drift from what is tested, and so the
 * copy is testable at all.
 */
export function goalView(input: GoalInput): GoalView {
  if (input.lifetimeMotors > 0) {
    const suffix = input.lifetimeMotors === 1 ? '' : ` ×${input.lifetimeMotors}`;
    const remaining = MOTOR_THRESHOLD - (input.lifetimeMotors % MOTOR_THRESHOLD);
    return {
      title: `Motor sold${suffix}`,
      detail:
        input.lifetimeMotors < MOTOR_THRESHOLD
          ? `Prestige after ${MOTOR_THRESHOLD} motors — ${remaining} to go`
          : 'Prestige at 25 motors for a permanent bonus',
    };
  }

  if (input.extractors === 0) {
    return {
      title: 'Goal: sell a Motor',
      detail: 'Start here: an Extractor on a resource node, belts to a Depot',
    };
  }

  if (input.motorRecipeUnlocked) {
    return {
      title: 'Goal: sell a Motor',
      detail: 'Build the chain: smelters, assemblers, and a Depot at the end',
    };
  }

  return {
    title: 'Goal: sell a Motor',
    detail: 'It needs copper, iron, coal and stone — buy the rest in Tech',
  };
}
