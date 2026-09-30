import { SOUND_KEYS, getSoundAssetUrl, type SoundKey } from "./assets";
import { createNoOpSoundPlayer, type SoundPlaybackState, type SoundPlayer } from "./sound";

export interface AudioGraphSource {
  buffer: object | null;
  loop: boolean;
  connect(target: object): void;
  start(): void;
  stop(): void;
}

export interface AudioGraphGain {
  readonly gain: { value: number };
  connect(target: object): void;
}

export interface AudioGraphPort {
  readonly state: string;
  readonly destination: object;
  createBufferSource(): AudioGraphSource;
  createGain(): AudioGraphGain;
  decodeAudioData(data: ArrayBuffer): Promise<object>;
  resume(): Promise<void>;
}

export interface BrowserSoundPlayerOptions {
  readonly createContext: () => AudioGraphPort;
  readonly loadBytes: (url: string) => Promise<ArrayBuffer>;
}

interface LoopingVoice {
  readonly source: AudioGraphSource;
  readonly gains: Map<string, AudioGraphGain>;
}

export const LOOP_OWNER_GAIN = 0.3;

export function createBrowserSoundPlayer(options: BrowserSoundPlayerOptions): SoundPlayer {
  const buffers = new Map<SoundKey, object>();
  const failed = new Set<SoundKey>();
  const loops = new Map<SoundKey, LoopingVoice>();
  const playedCounts = createCountRecord();
  let context: AudioGraphPort | undefined;
  let unlocked = false;
  let suppressedCount = 0;
  let unavailableCount = 0;
  let decodeFailureCount = 0;

  const load = (key: SoundKey): void => {
    if (buffers.has(key) || failed.has(key)) {
      return;
    }
    const active = context;
    if (active === undefined) {
      return;
    }

    void options
      .loadBytes(getSoundAssetUrl(key))
      .then((bytes) => active.decodeAudioData(bytes))
      .then((buffer) => {
        buffers.set(key, buffer);
      })
      .catch(() => {
        failed.add(key);
        decodeFailureCount += 1;
      });
  };

  const playable = (key: SoundKey): AudioGraphPort | undefined => {
    if (!unlocked || context === undefined) {
      suppressedCount += 1;
      return undefined;
    }
    if (!buffers.has(key)) {
      unavailableCount += 1;
      return undefined;
    }
    return context;
  };

  return {
    unlock: (): void => {
      if (unlocked) {
        return;
      }
      unlocked = true;
      try {
        context = options.createContext();
      } catch {
        context = undefined;
      }

      const active = context;
      if (active === undefined) {
        return;
      }

      void Promise.resolve()
        .then(() => active.resume())
        .catch(() => undefined);

      for (const key of SOUND_KEYS) {
        load(key);
      }
    },
    playOneShot: (key: SoundKey): void => {
      const active = playable(key);
      const buffer = buffers.get(key);
      if (active === undefined || buffer === undefined) {
        return;
      }

      const source = active.createBufferSource();
      source.buffer = buffer;
      source.loop = false;
      source.connect(active.destination);
      source.start();
      playedCounts[key] += 1;
    },
    startLoop: (key: SoundKey, ownerId: string): void => {
      const active = playable(key);
      const buffer = buffers.get(key);
      if (active === undefined || buffer === undefined) {
        return;
      }

      let voice = loops.get(key);
      if (voice === undefined) {
        const source = active.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        voice = { source, gains: new Map() };
        loops.set(key, voice);
      }
      if (voice.gains.has(ownerId)) {
        return;
      }

      const gain = active.createGain();
      gain.gain.value = LOOP_OWNER_GAIN;
      gain.connect(active.destination);
      voice.source.connect(gain);
      voice.gains.set(ownerId, gain);

      if (voice.gains.size === 1) {
        voice.source.start();
      }
    },
    stopLoop: (key: SoundKey, ownerId: string): void => {
      const voice = loops.get(key);
      if (voice === undefined) {
        return;
      }
      if (!voice.gains.delete(ownerId)) {
        return;
      }
      if (voice.gains.size === 0) {
        voice.source.stop();
        loops.delete(key);
      }
    },
    getState: (): SoundPlaybackState => ({
      unlocked,
      contextCreated: context !== undefined,
      bufferCount: SOUND_KEYS.length,
      readyBufferCount: buffers.size,
      decodeFailureCount,
      playedCounts: { ...playedCounts },
      suppressedCount,
      unavailableCount,
      activeLoopCount: countLoopOwners(loops),
    }),
    dispose: (): void => {
      for (const [key, voice] of [...loops]) {
        voice.source.stop();
        loops.delete(key);
      }
      buffers.clear();
      failed.clear();
    },
  };
}

export function createSceneSoundPlayer(): SoundPlayer {
  try {
    if (typeof AudioContext === "undefined") {
      return createNoOpSoundPlayer();
    }
    return createBrowserSoundPlayer({
      createContext: () => new AudioContext(),
      loadBytes: async (url: string): Promise<ArrayBuffer> => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Audio request failed for ${url}: ${response.status}`);
        }
        return response.arrayBuffer();
      },
    });
  } catch {
    return createNoOpSoundPlayer();
  }
}

function countLoopOwners(loops: ReadonlyMap<SoundKey, LoopingVoice>): number {
  let owners = 0;
  for (const voice of loops.values()) {
    owners += voice.gains.size;
  }
  return owners;
}

function createCountRecord(): Record<SoundKey, number> {
  const counts = {} as Record<SoundKey, number>;
  for (const key of SOUND_KEYS) {
    counts[key] = 0;
  }
  return counts;
}
