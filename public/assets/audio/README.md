# Factor-I Audio Assets

Factor-I's shipped audio is **original and generated in this repository**. Every committed
`.wav` is synthesised by `scripts/generate-audio.ts` from the parameters in `src/audio/synth.ts`,
and the generator's output is committed alongside the script so a clean checkout reproduces the
exact bytes the game ships. `npm run audio:generate` rewrites the files; `tests/unit/audioAssets.test.ts`
re-synthesises each one and compares it to the committed bytes, so a hand-edited or drifted file fails
the suite rather than shipping.

Nothing in this directory was downloaded. That is a licensing decision as much as a tooling one: a
fetched file arrives with a licence nobody verified per file, and a request that returns an HTML error
page becomes a corrupt asset that only fails when a browser tries to decode it. A committed generator
removes the provenance question, keeps the build reproducible, and makes the sounds original works.

What the generator can and cannot promise is worth stating plainly. It can promise a file decodes, at
the declared sample rate, channel count, bit depth and duration, that it carries signal rather than
silence, and that the machine loop closes without a boundary step. It cannot promise the result is
audible, pleasant, or mixed well against the rest of the game. Perceptual quality is not
machine-verifiable and is left to a human with headphones.

## Regenerating

```bash
npm run audio:generate
```

Deterministic by construction: no clock, no random source, and the only noise is a seeded linear
congruential generator, so the same table always produces identical bytes.

## Shipped Sounds

| Key | File | Kind | Trigger | Rate / length |
| --- | --- | --- | --- | --- |
| `machine` | `machine-loop.wav` | loop | `machineStateChanged` to active, one loop per machine | 22050 Hz, 400 ms |
| `belt` | `belt-tick.wav` | one-shot | `beltItemChanged` carrying an item | 22050 Hz, 55 ms |
| `unlock` | `unlock.wav` | one-shot | one successful unlock purchase | 22050 Hz, 240 ms |
| `sale` | `sale.wav` | one-shot | `saleCompleted`, once per sale | 22050 Hz, 180 ms |
| `blocked` | `blocked.wav` | one-shot | `blockedFull`, once per block | 22050 Hz, 300 ms |

`storageFull` and `entityPlaced` are deliberately silent. The storage notice already has the visual
transient it has always had, and a placement click is exactly the per-item buzz the sound budget below
warns against.

All five are mono 16-bit PCM at 22050 Hz, which is ample for short industrial transients and keeps the
whole shipped set near 51 KB. This is a browser factory game with transient one-shots, not a music
product, so there is no music bed.

## Sound Budget

Factor-I is a factory game, so the mix is mostly loops and short transients. Target a
ceiling, not a quota, and cut anything that fights the click.

| Event | Source of truth | Expectation | Shipped |
| --- | --- | --- | --- |
| Sale | `RenderEvent` sale completion | One transient per sale, not per resource unit. | `sale.wav` |
| Machine active | `machineStateChanged` | Loop start and stop per machine, not per tick. | `machine-loop.wav` |
| Belt item | `beltItemChanged` | A quiet transient. A per-item click at high throughput becomes a buzz. | `belt-tick.wav` |
| Blocked producer | `blockedFull` | One transient on the transition only, never per tick. | `blocked.wav` |
| Unlock purchase | unlock command result | One transient per successful purchase. | `unlock.wav` |
| Storage notice | `storageFull` | Silent: the notice keeps its existing visual. | none |
| Music | none, ambient | Out of scope for v1. | none |

The belt transient follows its event's cardinality exactly: one transient per `beltItemChanged` that
carries an item, and none for the emptying half of the event. A per-item click at high throughput is a
real mixing risk and the honest position is that no rate limiter is applied, because a limiter would
make the sound count depend on wall-clock timing rather than on the event stream, and the sound count
is what the tests assert. If a playtest finds it buzzing, the limiter is the fix and it belongs with the
mixing decision, not with the event contract.

## Generation Parameters

Every file below is the record of what the generator was told to build. The named constants live in
`src/audio/synth.ts` and the file's rate and length live in `src/audio/assets.ts`.

| File | Synthesis |
| --- | --- |
| `machine-loop.wav` | Four partials at 125, 250, 375 and 500 Hz with descending gains, amplitude-tremoloed at 5 Hz by 0.18. Every frequency completes a whole number of cycles across the 400 ms file, so the loop point is phase-aligned and needs no crossfade. Peak normalised to 0.72. |
| `belt-tick.wav` | A 2200 Hz click decaying at 62 per second plus seeded noise smoothed by a 0.35 one-pole filter and decaying at 70 per second. 1.5 ms attack, 6 ms fade-out. |
| `unlock.wav` | Two rising tones: 660 Hz then 990 Hz starting 105 ms later, each with its octave at a quarter gain, 4 ms attack and an 8 to 9 per second decay. 12 ms fade-out. |
| `sale.wav` | Three rising tones at 784, 1046.5 and 1568 Hz starting at 0, 45 and 95 ms, 2 ms attack and a 13 per second decay, with a 12 ms seeded noise transient on the attack. 10 ms fade-out. |
| `blocked.wav` | Four partials at 110, 220, 330 and 440 Hz bent down two semitones across the file on an exponential pitch curve, 4 ms attack, held to 130 ms, then decaying at 9 per second. 18 ms fade-out. |

## Replacing These With Third-Party Audio

The generated set is the shipping default, not a permanent constraint. The tier lists below remain the
rule for any future replacement, and a replacement keeps the same key, trigger and cardinality, so it is
a change to the generator output rather than a change to the game.

A replacement is a new commit that adds the file, its provenance row, and nothing else: the manifest key
is the trigger, so a swapped file needs no code change. `tests/unit/audioAssets.test.ts` then fails on
the byte-for-byte regeneration and provenance checks by design, because a third-party file is not the
generator's output. Re-point that spec at the replacement rather than deleting it, and keep the
decoded-header, non-silence and size-budget assertions, which are about the file rather than its
origin.

## Licensing Tiers

Applies to any third-party audio that replaces a generated file. Ordered safest first. Prefer tier 1.
Only move to tier 2 when a tier 1 source genuinely cannot supply the sound.

### Tier 1 - Zero Attribution

| Source | License | Use for |
| --- | --- | --- |
| [Kenney Audio Packs](https://kenney.nl/assets?q=audio) | Public Domain (CC0) | UI clicks, machine loops, belt ticks, sale chimes. Cohesive set, no attribution needed. |
| [Pixabay Music and SFX](https://pixabay.com/music/) | Pixabay Content License | Spot effects. Free for commercial use, no attribution required. |
| [Sonniss GDC Bundles](https://sonniss.com/gameaudiogdc) | Royalty-free | Large professional SFX bundles. Free to use in games, including commercially. |

### Tier 2 - Attribution Required

| Source | License | Use for |
| --- | --- | --- |
| [Freesound](https://freesound.org/) | Per-file CC0 or CC-BY | One-off spot effects. Filter by CC0 first; only take CC-BY when nothing else fits. |
| [Incompetech (Kevin MacLeod)](https://incompetech.com/music/royalty-free/music.html) | CC-BY 4.0 | Music beds. Attribution is mandatory and must be shipped in-game. |
| [OpenGameArt](https://opengart.org/art-search-advanced?field_art_type_tid%5B%5D=12) | Per-file CC0 or CC-BY | Community SFX and music. Same filter-first rule as Freesound. |

## Rules

- **Check the license icon on the individual file, not the site.** A site can host
  CC0, CC-BY, and CC-BY-NC files side by side. The site-wide license is not the file's
  license. This is the single most common way an audio asset becomes un shippable.
- **Never take a NonCommercial file.** NC terms are incompatible with a game intended for
  distribution, and a retrofitted removal is a rewrite, not a patch.
- **Never take ND (NoDerivatives) for anything we will trim, loop, or gain-staged.** An
  audio file almost always needs a fade or a loop point.
- **Record the source URL and the exact license string per file.** The table at the
  bottom of this file is the record. "Found it on Freesound" is not a provenance trail.
- **Attribute in-game, not just in a README,** for any tier 2 asset. An in-game credits
  screen is the only attribution that travels with a build.
- **Keep audio out of the simulation.** `src/sim` never imports audio. `src/audio/sound.ts`
  turns `RenderEvent` and unlock notifications into sound calls through a dependency-injected
  player, and `tests/unit/sound.test.ts` fails if that import direction ever appears or if the
  audio layer becomes reachable from anywhere but the render seam.

## Asset Provenance Table

One row per committed audio file. Add the row in the same commit that adds the file.

| File | Origin | License | Attribution required | Added in |
| --- | --- | --- | --- | --- |
| `machine-loop.wav` | Generated by `scripts/generate-audio.ts`; `MACHINE_PARTIALS`, `MACHINE_TREMOLO_HZ`, `MACHINE_TREMOLO_DEPTH` | Original work, owned by this repository | No | Task 4.3 |
| `belt-tick.wav` | Generated by `scripts/generate-audio.ts`; `BELT_CLICK_HZ`, `BELT_NOISE_LEVEL`, `BELT_NOISE_SMOOTHING`, decay constants | Original work, owned by this repository | No | Task 4.3 |
| `unlock.wav` | Generated by `scripts/generate-audio.ts`; `UNLOCK_NOTES`, `UNLOCK_ATTACK_MS` | Original work, owned by this repository | No | Task 4.3 |
| `sale.wav` | Generated by `scripts/generate-audio.ts`; `SALE_NOTES`, `SALE_NOISE_LEVEL` | Original work, owned by this repository | No | Task 4.3 |
| `blocked.wav` | Generated by `scripts/generate-audio.ts`; `BLOCKED_PARTIALS`, `BLOCKED_BEND_SEMITONES` | Original work, owned by this repository | No | Task 4.3 |

"Original work, owned by this repository" is the licence claim these files actually support, and it is
the only one claimed for them. No third-party licence, and no public-domain dedication, applies to a
file this repository synthesised from arithmetic.
