export const BLOCKED_MACHINE_TINT = 0xd85b3f;
export const BLOCKED_MACHINE_TWEEN_DURATION_MS = 400;
export const BLOCKED_MACHINE_BLINK_HOLD = 0.35;

export interface MachineBlinkView {
  alpha: number;
  setTint(color: number): void;
}

export interface MachineBlinkPulseConfig {
  readonly duration: number;
  readonly yoyo: boolean;
  readonly repeat: number;
  readonly hold: number;
}

export interface MachineBlinkPulse {
  stop(): void;
}

export interface MachineBlinkHost {
  createPulseTween(view: MachineBlinkView, config: MachineBlinkPulseConfig): MachineBlinkPulse;
}

export interface MachineBlinker {
  start(entityId: string, view: MachineBlinkView | undefined, baseTint: number): void;
  stop(entityId: string): void;
  isBlinking(entityId: string): boolean;
  getBlinkingEntityIds(): readonly string[];
  destroy(): void;
}

interface ActiveBlink {
  readonly view: MachineBlinkView;
  readonly baseTint: number;
  readonly pulse: MachineBlinkPulse;
}

export function createMachineBlinker(host: MachineBlinkHost): MachineBlinker {
  const blinks = new Map<string, ActiveBlink>();

  const stop = (entityId: string): void => {
    const active = blinks.get(entityId);
    if (active === undefined) {
      return;
    }

    blinks.delete(entityId);
    active.pulse.stop();
    active.view.setTint(active.baseTint);
  };

  return {
    start: (entityId, view, baseTint): void => {
      if (view === undefined || blinks.has(entityId)) {
        return;
      }

      view.setTint(BLOCKED_MACHINE_TINT);
      blinks.set(entityId, {
        view,
        baseTint,
        pulse: host.createPulseTween(view, {
          duration: BLOCKED_MACHINE_TWEEN_DURATION_MS,
          yoyo: true,
          repeat: -1,
          hold: BLOCKED_MACHINE_BLINK_HOLD,
        }),
      });
    },
    stop,
    isBlinking: (entityId: string): boolean => blinks.has(entityId),
    getBlinkingEntityIds: (): readonly string[] => [...blinks.keys()].sort(compareEntityIds),
    destroy: (): void => {
      for (const entityId of [...blinks.keys()]) {
        stop(entityId);
      }
    },
  };
}

function compareEntityIds(first: string, second: string): number {
  return first < second ? -1 : 1;
}
