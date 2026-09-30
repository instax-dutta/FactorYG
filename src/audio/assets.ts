export type SoundKey = "machine" | "belt" | "unlock" | "sale" | "blocked";

export interface SoundAssetSpec {
  readonly fileName: string;
  readonly loop: boolean;
  readonly sampleRate: number;
  readonly durationMs: number;
}

export const AUDIO_DIRECTORY = "assets/audio";

export const SOUND_ASSETS: Readonly<Record<SoundKey, SoundAssetSpec>> = Object.freeze({
  machine: {
    fileName: "machine-loop.wav",
    loop: true,
    sampleRate: 22050,
    durationMs: 400,
  },
  belt: {
    fileName: "belt-tick.wav",
    loop: false,
    sampleRate: 22050,
    durationMs: 55,
  },
  unlock: {
    fileName: "unlock.wav",
    loop: false,
    sampleRate: 22050,
    durationMs: 240,
  },
  sale: {
    fileName: "sale.wav",
    loop: false,
    sampleRate: 22050,
    durationMs: 180,
  },
  blocked: {
    fileName: "blocked.wav",
    loop: false,
    sampleRate: 22050,
    durationMs: 300,
  },
});

export const SOUND_KEYS: readonly SoundKey[] = Object.freeze([
  "machine",
  "belt",
  "unlock",
  "sale",
  "blocked",
]);

export function getSoundAssetUrl(key: SoundKey): string {
  return `/${AUDIO_DIRECTORY}/${SOUND_ASSETS[key].fileName}`;
}

export function isSoundKey(value: string): value is SoundKey {
  return Object.hasOwn(SOUND_ASSETS, value);
}

export const LOOPING_SOUND_KEYS: readonly SoundKey[] = Object.freeze(
  SOUND_KEYS.filter((key) => SOUND_ASSETS[key].loop),
);
