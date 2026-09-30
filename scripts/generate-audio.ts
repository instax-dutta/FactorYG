import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIO_DIRECTORY, SOUND_ASSETS, SOUND_KEYS } from "../src/audio/assets";
import { encodeWav, renderSound } from "../src/audio/synth";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(repositoryRoot, "public", AUDIO_DIRECTORY);

mkdirSync(outputDirectory, { recursive: true });

let totalBytes = 0;
for (const key of SOUND_KEYS) {
  const spec = SOUND_ASSETS[key];
  const bytes = encodeWav(renderSound(key), spec.sampleRate);
  const target = resolve(outputDirectory, spec.fileName);
  writeFileSync(target, bytes);
  totalBytes += bytes.byteLength;
  process.stdout.write(
    `${spec.fileName} ${bytes.byteLength} bytes ${spec.sampleRate}Hz mono ${spec.durationMs}ms ${spec.loop ? "loop" : "one-shot"}\n`,
  );
}

process.stdout.write(`total ${totalBytes} bytes\n`);
