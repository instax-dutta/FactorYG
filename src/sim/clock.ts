const MAX_CATCH_UP_TICKS = 120;

function defaultNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export class FixedStepClock {
  private accumulator = 0;
  private lastTime: number;

  public constructor(
    private readonly tickMs: number,
    private readonly onTick: () => void,
    private readonly now: () => number = defaultNow,
  ) {
    if (!Number.isFinite(tickMs) || tickMs <= 0) {
      throw new RangeError("tickMs must be a positive finite number");
    }

    this.lastTime = now();
  }

  public advance(): number {
    const currentTime = this.now();
    const elapsed = Math.max(0, currentTime - this.lastTime);
    this.lastTime = currentTime;
    this.accumulator += elapsed;

    const availableTicks = Math.floor(this.accumulator / this.tickMs);
    const tickCount = Math.min(availableTicks, MAX_CATCH_UP_TICKS);
    this.accumulator %= this.tickMs;

    for (let tickIndex = 0; tickIndex < tickCount; tickIndex += 1) {
      this.onTick();
    }

    return tickCount;
  }

  public reset(): void {
    this.accumulator = 0;
    this.lastTime = this.now();
  }
}
