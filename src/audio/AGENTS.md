# Factor-I Audio

## Purpose

Own the audio asset table, the generator that produces the shipped sounds, the sound director that
turns simulation events into sound calls, and the browser adapter that actually plays them.

## Ownership

- `assets.ts` owns `SoundKey`, the per-key asset table (`fileName`, `loop`, `sampleRate`, `durationMs`)
  and the public URL a key resolves to. It is the one declaration of what audio exists.
- `synth.ts` owns the synthesis maths and the WAV encoder. Pure, deterministic, and read by both the
  runtime and the generator.
- `sound.ts` owns the `SoundPlayer` port, the no-op player, the `SoundDirector` that maps events to
  sound calls, and the trigger and playback telemetry the render seam publishes.
- `browserPlayer.ts` owns the Web Audio adapter: gesture unlocking, buffer loading and decoding, the
  one-shot path and the shared looping source.
- `scripts/generate-audio.ts` writes the committed files. It lives in `scripts/` because it is a
  developer command, not a runtime module, and it imports the same `assets.ts` and `synth.ts` the
  runtime reads.

## Local Contracts

- Sound is event-driven and never enters the simulation dependency graph. `src/sim` must not import
  anything under `src/audio`, and the only runtime importer of this directory is the render seam in
  `src/phaser`. Both halves are proved structurally in `tests/unit/sound.test.ts`, which walks the
  module graph rather than reading a convention, because a rule nobody can violate accidentally is
  worth more than a rule stated in prose. This directory's own imports from `src/sim` are type-only.
- The `SoundPlayer` port is injected, so the simulation, the unit suite, and the browser all drive the
  same director. `sound.ts` never touches Web Audio and is the only file a test needs for the event
  contract; `browserPlayer.ts` takes its `AudioContext` and its byte loader as injected functions, so
  the adapter itself is tested with a fake context and no DOM. `createSceneSoundPlayer` is the one
  function that names the real browser APIs, and it returns the no-op player instead of throwing when
  `AudioContext` is missing or construction fails.
- Two report shapes leave this directory and they are not merged. `SoundTriggerCounts` is what the
  director did, counted per key, and `SoundPlaybackState` is what the player did with it, so the gap
  between a trigger and a play is visible rather than inferred. A caller that reported one number for
  both could not tell a muted game from a silent one, which is the distinction the autoplay gate exists
  to create.
- Sound follows the event's own cardinality. One `saleCompleted` is one sale transient. One
  `machineStateChanged` transition is one loop start or stop per machine, tracked per owner id, so a
  machine that reports active every tick starts one loop and not one per report. One `blockedFull` is
  one transient, and because the simulation emits `blockedFull` once per block, a long blocked run
  makes exactly one sound. The rule is never a debounce in the audio layer: a second trigger arriving
  inside a cooldown is a second event, and hiding it would make the sound count disagree with the
  event stream the tests assert.
- An unlock has no render event, so the director watches the snapshot's `unlockedMachines` and `unlockedRecipes` and sounds once per newly owned id. Watching the delta rather than a command result or a notification key is what makes a rejected unlock silent without the audio layer knowing a rejection reason exists, and it is what keeps the audio layer free of the simulation's notification key format. The first snapshot the director is given is a run's existing unlocks rather than a purchase, so it is recorded and sounds nothing: without that a loaded run would chime once for every machine it already owned.
- `storageFull` and `entityPlaced` are silent by decision. The storage notice keeps the transient it has
  always had, and a placement click is the per-item buzz the sound budget warns against.
- Autoplay policy is a real gate, not a fallback. The browser player creates no `AudioContext` and
  fetches no file until `unlock()`, which the scene calls from a real pointer or key event. Before that
  every call is counted as suppressed and nothing reaches the audio graph. After a suspended context
  that refuses to resume, a call still increments its counter and still throws nothing, because a sound
  that cannot be heard must never be a sound that breaks the frame.
- A decode failure is counted and swallowed for the same reason: a corrupt or unreachable file degrades
  to silence rather than to an exception in the render loop.
- One looping source is shared per key with a gain node per owner, so a factory with eight running
  machines runs one hum through eight gains rather than eight copies of the same file. The gain is a
  fixed per-owner value and the owners sum, so eight machines are louder than one; that is a mixing
  judgement a human has to make with headphones, and it is deliberately not machine-verifiable here.
- A start that arrives before the unlock or before the buffer has decoded is counted and dropped rather
  than queued. Queueing would mean a run that boots muted plays a burst of stale sounds on the first
  gesture, and the loop case cannot be replayed faithfully anyway because the machine is no longer
  necessarily running when the buffer lands.
- The shipped files are original works generated by the committed script, so no third-party licence
  applies to them and no attribution is owed. `public/assets/audio/README.md` claims exactly that and
  keeps the tier lists as the rule for any future replacement.
- The generated set is reproducible: no clock, no random source, and one seeded linear congruential
  generator for the noise, so `npm run audio:generate` reproduces the committed bytes and
  `tests/unit/audioAssets.test.ts` proves it by re-synthesising every file and comparing.

## Work Guidance

- Keep the asset table, the synthesis, the director, and the adapter in separate files. The table is
  data the runtime and the generator share, and a generator that reads its own output parameters cannot
  drift from them.
- Change a sound by changing a parameter and regenerating, never by editing a committed `.wav`.
- Record what a new file is made of in the README's provenance table in the same commit.
- A replacement with a real-world recording keeps the key, the trigger, and the cardinality, so it needs
  no code change. Only the provenance and the generator-output assertions in the asset spec move.

## Verification

- `npm run audio:generate`
- `npm run test -- tests/unit/audioAssets.test.ts tests/unit/sound.test.ts`
- `npm run test:e2e -- tests/e2e/sound.spec.ts --workers=1`
- `npm run lint`
- `npm run typecheck`

## Child DOX Index

- No child boundaries currently exist under `src/audio/`.
