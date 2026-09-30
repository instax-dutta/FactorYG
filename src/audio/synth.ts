import { SOUND_ASSETS, type SoundKey } from "./assets";

const TWO_PI = Math.PI * 2;
const NOISE_SEED = 2_246_822_519;
const NOISE_SCALE = 0x1_0000_0000;
const PEAK_TARGET = 0.72;
const FULL_SCALE = 32_767;
const HEADER_BYTES = 44;

interface Partial {
  readonly hz: number;
  readonly gain: number;
}

interface Note {
  readonly startMs: number;
  readonly decayPerSecond: number;
  readonly partials: readonly Partial[];
}

export const MACHINE_PARTIALS: readonly Partial[] = Object.freeze([
  { hz: 125, gain: 0.62 },
  { hz: 250, gain: 0.26 },
  { hz: 375, gain: 0.14 },
  { hz: 500, gain: 0.07 },
]);

export const MACHINE_TREMOLO_HZ = 5;
export const MACHINE_TREMOLO_DEPTH = 0.18;

export const BELT_CLICK_HZ = 2200;
export const BELT_CLICK_GAIN = 0.45;
export const BELT_CLICK_DECAY_PER_SECOND = 62;
export const BELT_NOISE_LEVEL = 0.5;
export const BELT_NOISE_SMOOTHING = 0.35;
export const BELT_NOISE_DECAY_PER_SECOND = 70;
export const BELT_ATTACK_MS = 1.5;

export const UNLOCK_NOTES: readonly Note[] = Object.freeze([
  {
    startMs: 0,
    decayPerSecond: 9,
    partials: Object.freeze([
      { hz: 660, gain: 0.7 },
      { hz: 1320, gain: 0.16 },
    ]),
  },
  {
    startMs: 105,
    decayPerSecond: 8,
    partials: Object.freeze([
      { hz: 990, gain: 0.66 },
      { hz: 1980, gain: 0.18 },
    ]),
  },
]);

export const UNLOCK_ATTACK_MS = 4;

export const SALE_NOTES: readonly Note[] = Object.freeze([
  { startMs: 0, decayPerSecond: 13, partials: Object.freeze([{ hz: 784, gain: 0.6 }]) },
  {
    startMs: 45,
    decayPerSecond: 13,
    partials: Object.freeze([{ hz: 1046.5, gain: 0.6 }]),
  },
  {
    startMs: 95,
    decayPerSecond: 13,
    partials: Object.freeze([{ hz: 1568, gain: 0.55 }]),
  },
]);

export const SALE_NOISE_MS = 12;
export const SALE_NOISE_LEVEL = 0.3;

export const BLOCKED_PARTIALS: readonly Partial[] = Object.freeze([
  { hz: 110, gain: 0.55 },
  { hz: 220, gain: 0.28 },
  { hz: 330, gain: 0.16 },
  { hz: 440, gain: 0.09 },
]);

export const BLOCKED_BEND_SEMITONES = -2;
export const BLOCKED_ATTACK_MS = 4;
export const BLOCKED_SUSTAIN_MS = 130;
export const BLOCKED_DECAY_PER_SECOND = 9;

export const FADE_OUT_MS: Readonly<Record<SoundKey, number>> = Object.freeze({
  machine: 0,
  belt: 6,
  unlock: 12,
  sale: 10,
  blocked: 18,
});

export function sampleCountFor(key: SoundKey): number {
  const spec = SOUND_ASSETS[key];
  return Math.round((spec.durationMs / 1000) * spec.sampleRate);
}

export function renderSound(key: SoundKey): Float32Array {
  const spec = SOUND_ASSETS[key];
  const count = sampleCountFor(key);
  const samples = new Float32Array(count);

  switch (key) {
    case "machine":
      renderMachineLoop(samples, spec.sampleRate);
      break;
    case "belt":
      renderBeltTick(samples, spec.sampleRate);
      break;
    case "unlock":
      renderUnlock(samples, spec.sampleRate);
      break;
    case "sale":
      renderSale(samples, spec.sampleRate);
      break;
    case "blocked":
      renderBlocked(samples, spec.sampleRate);
      break;
    default:
      throw new Error(`No synthesis for sound key: ${String(key)}`);
  }

  return normalise(samples);
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLength = samples.length * 2;
  const bytes = new Uint8Array(HEADER_BYTES + dataLength);
  const view = new DataView(bytes.buffer);

  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataLength, true);

  for (let index = 0; index < samples.length; index += 1) {
    const scaled = Math.round(samples[index] * FULL_SCALE);
    const clamped = scaled > FULL_SCALE ? FULL_SCALE : scaled < -32_768 ? -32_768 : scaled;
    view.setInt16(HEADER_BYTES + index * 2, clamped, true);
  }

  return bytes;
}

function renderMachineLoop(samples: Float32Array, sampleRate: number): void {
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    let value = 0;
    for (const partial of MACHINE_PARTIALS) {
      value += partial.gain * Math.sin(TWO_PI * partial.hz * time);
    }
    const tremolo =
      1 - MACHINE_TREMOLO_DEPTH + MACHINE_TREMOLO_DEPTH * Math.cos(TWO_PI * MACHINE_TREMOLO_HZ * time);
    samples[index] = value * tremolo;
  }
}

function renderBeltTick(samples: Float32Array, sampleRate: number): void {
  const noise = createNoise(NOISE_SEED);
  let smoothed = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const white = noise();
    smoothed += (white - smoothed) * BELT_NOISE_SMOOTHING;
    const click =
      BELT_CLICK_GAIN * Math.sin(TWO_PI * BELT_CLICK_HZ * time) * decay(time, BELT_CLICK_DECAY_PER_SECOND);
    const hiss = BELT_NOISE_LEVEL * smoothed * decay(time, BELT_NOISE_DECAY_PER_SECOND);
    samples[index] = click + hiss;
  }
  applyEdgeFade(samples, sampleRate, BELT_ATTACK_MS, FADE_OUT_MS.belt);
}

function renderUnlock(samples: Float32Array, sampleRate: number): void {
  mixNotes(samples, sampleRate, UNLOCK_NOTES, UNLOCK_ATTACK_MS);
  applyEdgeFade(samples, sampleRate, 0, FADE_OUT_MS.unlock);
}

function renderSale(samples: Float32Array, sampleRate: number): void {
  mixNotes(samples, sampleRate, SALE_NOTES, 2);
  const noise = createNoise(NOISE_SEED);
  const noiseCount = Math.min(samples.length, Math.round((SALE_NOISE_MS / 1000) * sampleRate));
  for (let index = 0; index < noiseCount; index += 1) {
    const time = index / sampleRate;
    samples[index] += SALE_NOISE_LEVEL * noise() * decay(time, 26);
  }
  applyEdgeFade(samples, sampleRate, 1, FADE_OUT_MS.sale);
}

function renderBlocked(samples: Float32Array, sampleRate: number): void {
  const durationSeconds = samples.length / sampleRate;
  const bendRatio = 2 ** (BLOCKED_BEND_SEMITONES / 12);
  const logarithm = Math.log(bendRatio);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    let value = 0;
    for (const partial of BLOCKED_PARTIALS) {
      const startHz = partial.hz;
      const phase =
        TWO_PI * startHz * durationSeconds * ((bendRatio ** (time / durationSeconds) - 1) / logarithm);
      value += partial.gain * Math.sin(phase);
    }
    samples[index] = value * blockedEnvelope(time);
  }
  applyEdgeFade(samples, sampleRate, 0, FADE_OUT_MS.blocked);
}

function mixNotes(samples: Float32Array, sampleRate: number, notes: readonly Note[], attackMs: number): void {
  for (const note of notes) {
    const startIndex = Math.round((note.startMs / 1000) * sampleRate);
    for (let index = startIndex; index < samples.length; index += 1) {
      const time = (index - startIndex) / sampleRate;
      const envelope = attack(time, attackMs) * decay(time, note.decayPerSecond);
      let value = 0;
      for (const partial of note.partials) {
        value += partial.gain * Math.sin(TWO_PI * partial.hz * time);
      }
      samples[index] += value * envelope;
    }
  }
}

function blockedEnvelope(time: number): number {
  if (time * 1000 < BLOCKED_ATTACK_MS) {
    return attack(time, BLOCKED_ATTACK_MS);
  }
  const sustainSeconds = BLOCKED_SUSTAIN_MS / 1000;
  if (time <= sustainSeconds) {
    return 1;
  }
  return decay(time - sustainSeconds, BLOCKED_DECAY_PER_SECOND);
}

function attack(time: number, attackMs: number): number {
  if (attackMs <= 0) {
    return 1;
  }
  const progress = time / (attackMs / 1000);
  return progress >= 1 ? 1 : progress;
}

function decay(time: number, decayPerSecond: number): number {
  return Math.exp(-decayPerSecond * time);
}

function applyEdgeFade(samples: Float32Array, sampleRate: number, attackMs: number, fadeOutMs: number): void {
  const attackCount = Math.round((attackMs / 1000) * sampleRate);
  for (let index = 0; index < Math.min(attackCount, samples.length); index += 1) {
    samples[index] *= index / Math.max(1, attackCount);
  }

  const fadeCount = Math.round((fadeOutMs / 1000) * sampleRate);
  for (let offset = 0; offset < Math.min(fadeCount, samples.length); offset += 1) {
    const index = samples.length - 1 - offset;
    samples[index] *= offset / Math.max(1, fadeCount);
  }
}

function normalise(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak === 0) {
    return samples;
  }
  const scale = PEAK_TARGET / peak;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= scale;
  }
  return samples;
}

function createNoise(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return (state / NOISE_SCALE) * 2 - 1;
  };
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    bytes[offset + index] = text.charCodeAt(index);
  }
}
