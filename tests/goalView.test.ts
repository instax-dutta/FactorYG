import { describe, it, expect } from 'vitest';
import { goalView } from '../src/ui/goalView';

/**
 * The goal line.
 *
 * A fresh player is handed 0 credits, six tool buttons (two of them locked) and
 * no statement of what the game is. Nothing anywhere says a Motor is the win
 * condition, so the first thing the factory should do is say so. The other half
 * of the problem is the first minute: the player has no idea that an extractor
 * on a node wired to a depot is what makes the credits start.
 */

describe('goalView', () => {
  it('tells a player with nothing built what to do first', () => {
    const view = goalView({ lifetimeMotors: 0, extractors: 0, motorRecipeUnlocked: false });
    expect(view.title).toBe('Goal: sell a Motor');
    expect(view.detail).toMatch(/extractor/i);
    expect(view.detail).toMatch(/depot/i);
  });

  it('moves on to the real goal once ore is flowing', () => {
    const view = goalView({ lifetimeMotors: 0, extractors: 1, motorRecipeUnlocked: false });
    expect(view.title).toBe('Goal: sell a Motor');
    // What a Motor needs, since nothing else in the UI says it.
    expect(view.detail).toMatch(/copper/i);
    expect(view.detail).toMatch(/iron/i);
    expect(view.detail).toMatch(/coal/i);
    expect(view.detail).toMatch(/stone/i);
  });

  it('names the next thing to buy when only the recipe is missing', () => {
    const view = goalView({ lifetimeMotors: 0, extractors: 4, motorRecipeUnlocked: true });
    // The recipe is bought but no motor has been sold: the tool is the missing
    // piece, and saying so is the difference between a goal and a hint.
    expect(view.title).toBe('Goal: sell a Motor');
    expect(view.detail).toMatch(/build/i);
  });

  it('stops nagging once a Motor is sold', () => {
    const view = goalView({ lifetimeMotors: 1, extractors: 8, motorRecipeUnlocked: true });
    expect(view.title).toBe('Motor sold');
    // The next goal is the prestige threshold, which is otherwise invisible.
    expect(view.detail).toMatch(/prestige/i);
  });

  it('counts motors once there are several', () => {
    const view = goalView({ lifetimeMotors: 7, extractors: 8, motorRecipeUnlocked: true });
    expect(view.title).toBe('Motor sold ×7');
  });

  it('says the same thing for the same state, so the HUD cannot flicker', () => {
    const input = { lifetimeMotors: 0, extractors: 2, motorRecipeUnlocked: false };
    expect(goalView(input)).toEqual(goalView({ ...input }));
  });
});
