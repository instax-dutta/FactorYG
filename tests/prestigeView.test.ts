import { describe, it, expect } from 'vitest';
import { prestigeView } from '../src/ui/prestigeView';

/**
 * Slice 3.3's predicate, kept pure so the button, its disabled state and its
 * wording are all decided by one tested function rather than inline JSX.
 *
 * The rule the panel must never break: it cannot offer a prestige the sim would
 * refuse. `Simulation.prestige()` refuses at zero points, so the button is
 * enabled exactly when a reset would actually pay.
 */

describe('prestige panel model', () => {
  it('is disabled below the threshold and says how many motors are still needed', () => {
    const view = prestigeView({ lifetimeMotors: 10, totalPrestiges: 0, claimedPoints: 0 });

    expect(view.enabled).toBe(false);
    expect(view.points).toBe(0);
    expect(view.motorsToNext).toBe(15);
    expect(view.label).toBe('Prestige +0');
    expect(view.detail).toContain('15 more motors');
  });

  it('is enabled exactly at the threshold, offering the point it would pay', () => {
    const view = prestigeView({ lifetimeMotors: 25, totalPrestiges: 0, claimedPoints: 0 });

    expect(view.enabled).toBe(true);
    expect(view.points).toBe(1);
    expect(view.label).toBe('Prestige +1');
    expect(view.detail).toContain('1.25');
  });

  it('offers only points that have not already been claimed', () => {
    expect(prestigeView({ lifetimeMotors: 50, totalPrestiges: 1, claimedPoints: 1 }).points).toBe(1);
    expect(prestigeView({ lifetimeMotors: 51, totalPrestiges: 1, claimedPoints: 1 }).points).toBe(1);
    expect(prestigeView({ lifetimeMotors: 49, totalPrestiges: 1, claimedPoints: 0 }).points).toBe(1);
  });

  it('shows zero and the next threshold after every point is claimed', () => {
    const view = prestigeView({ lifetimeMotors: 25, totalPrestiges: 1, claimedPoints: 1 });

    expect(view.enabled).toBe(false);
    expect(view.points).toBe(0);
    expect(view.label).toBe('Prestige +0');
    expect(view.detail).toContain('sell 25 more motors');
  });

  it('never offers a reset a run has not earned', () => {
    const view = prestigeView({ lifetimeMotors: 24, totalPrestiges: 0, claimedPoints: 0 });
    expect(view.points).toBe(0);
    expect(view.enabled).toBe(false);
  });

  it('reports the bonuses already being held', () => {
    expect(prestigeView({ lifetimeMotors: 0, totalPrestiges: 0, claimedPoints: 0 }).bonus).toBe('no bonuses yet');
    // One point is "1 point", not "1 points".
    expect(prestigeView({ lifetimeMotors: 25, totalPrestiges: 0, claimedPoints: 0 }).bonus).toBe(
      '1 point · 1.25x speed · 1.5x sales',
    );
    expect(prestigeView({ lifetimeMotors: 50, totalPrestiges: 2, claimedPoints: 1 }).bonus).toBe(
      '2 points · 1.5x speed · 2x sales',
    );
  });

  it('says which cycle the player is on', () => {
    expect(prestigeView({ lifetimeMotors: 0, totalPrestiges: 0, claimedPoints: 0 }).cycles).toBe('first run');
    expect(prestigeView({ lifetimeMotors: 25, totalPrestiges: 2, claimedPoints: 0 }).cycles).toBe('cycle 3');
  });

  it('says what the reset costs the player', () => {
    expect(prestigeView({ lifetimeMotors: 25, totalPrestiges: 0, claimedPoints: 0 }).cost).toBe(
      'clears the factory and its currency, keeps points and the tech tree',
    );
  });
});
