import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIO_DIRECTORY,
  SOUND_ASSETS,
  SOUND_KEYS,
  getSoundAssetUrl,
  type SoundKey,
} from "../../src/audio/assets";
import { encodeWav, renderSound } from "../../src/audio/synth";

const AUDIO_ROOT = resolve(process.cwd(), "public", AUDIO_DIRECTORY);
const README_PATH = resolve(process.cwd(), "public", AUDIO_DIRECTORY, "README.md");
const MAX_TOTAL_AUDIO_BYTES = 256 * 1024;

interface WavFormat {
  readonly riff: string;
  readonly wave: string;
  readonly audioFormat: number;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bitsPerSample: number;
  readonly dataLength: number;
  readonly samples: Int16Array;
}

function parseWav(bytes: Uint8Array): WavFormat {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number): string =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  expect(bytes.byteLength).toBeGreaterThanOrEqual(44);

  const audioFormat = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataLength = view.getUint32(40, true);

  const samples = new Int16Array(dataLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(44 + index * 2, true);
  }

  return {
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    audioFormat,
    channels,
    sampleRate,
    bitsPerSample,
    dataLength,
    samples,
  };
}

function readCommitted(key: SoundKey): Uint8Array {
  return readFileSync(resolve(AUDIO_ROOT, SOUND_ASSETS[key].fileName));
}

function peakOf(samples: Int16Array): number {
  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
  }
  return peak / 32768;
}

function rmsOf(samples: Int16Array): number {
  let total = 0;
  for (const sample of samples) {
    total += sample * sample;
  }
  return Math.sqrt(total / samples.length) / 32768;
}

describe("committed audio assets", () => {
  it("ships exactly one committed file per sound key and no file without a key", () => {
    const committed = readdirSync(AUDIO_ROOT)
      .filter((name) => name.endsWith(".wav"))
      .sort();

    expect(committed).toEqual(SOUND_KEYS.map((key) => SOUND_ASSETS[key].fileName).sort());
  });

  it("declares a mono sixteen bit PCM wave at the rate and duration the generator renders", () => {
    for (const key of SOUND_KEYS) {
      const spec = SOUND_ASSETS[key];
      const wav = parseWav(readCommitted(key));

      expect(wav.riff).toBe("RIFF");
      expect(wav.wave).toBe("WAVE");
      expect(wav.audioFormat).toBe(1);
      expect(wav.channels).toBe(1);
      expect(wav.bitsPerSample).toBe(16);
      expect(wav.sampleRate).toBe(spec.sampleRate);
      expect(wav.dataLength).toBe(
        Math.round((spec.durationMs / 1000) * spec.sampleRate) * 2,
      );
    }
  });

  it("reproduces every committed file byte for byte from the committed generator", () => {
    for (const key of SOUND_KEYS) {
      const spec = SOUND_ASSETS[key];
      const rendered = renderSound(key);
      const encoded = encodeWav(rendered, spec.sampleRate);

      expect(Array.from(encoded)).toEqual(Array.from(readCommitted(key)));
    }
  });

  it("carries signal rather than silence in every file", () => {
    for (const key of SOUND_KEYS) {
      const samples = parseWav(readCommitted(key)).samples;

      expect(peakOf(samples)).toBeGreaterThan(0.3);
      expect(peakOf(samples)).toBeLessThanOrEqual(1);
      expect(rmsOf(samples)).toBeGreaterThan(0.02);
    }
  });

  it("closes the looping machine hum on a half period shift, so the loop point adds no step or dip", () => {
    const normalised = Array.from(
      parseWav(readCommitted("machine")).samples,
      (sample) => sample / 32768,
    );
    const half = normalised.length / 2;

    let maxHalfPeriodError = 0;
    for (let index = 0; index < half; index += 1) {
      maxHalfPeriodError = Math.max(
        maxHalfPeriodError,
        Math.abs(normalised[index] - normalised[index + half]),
      );
    }

    expect(maxHalfPeriodError).toBeLessThan(1 / 32768);

    let maxInteriorStep = 0;
    for (let index = 1; index < normalised.length; index += 1) {
      maxInteriorStep = Math.max(
        maxInteriorStep,
        Math.abs(normalised[index] - normalised[index - 1]),
      );
    }
    const boundaryStep = Math.abs(normalised[normalised.length - 1] - normalised[0]);

    expect(boundaryStep).toBeLessThanOrEqual(maxInteriorStep);
  });

  it("keeps the whole shipped set inside the small audio budget", () => {
    const total = SOUND_KEYS.reduce(
      (sum, key) => sum + readCommitted(key).byteLength,
      0,
    );

    expect(total).toBeLessThanOrEqual(MAX_TOTAL_AUDIO_BYTES);
  });

  it("serves every sound from the public audio directory the game ships", () => {
    for (const key of SOUND_KEYS) {
      expect(getSoundAssetUrl(key)).toBe(`/${AUDIO_DIRECTORY}/${SOUND_ASSETS[key].fileName}`);
    }
  });

  it("records every committed file in the provenance table before it is referenced", () => {
    const readme = readFileSync(README_PATH, "utf8");

    for (const key of SOUND_KEYS) {
      expect(readme).toContain(SOUND_ASSETS[key].fileName);
    }
  });
});
