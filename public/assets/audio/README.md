# Factor-I Audio Assets

Sources for free audio used by Factor-I, and the licensing discipline that applies to
each one. This file is the reference for *where audio may come from*; the key manifest
and playback lifecycle land with plan Task 4.3 (`src/audio/sound.ts`).

No audio files are committed yet. This directory stays empty until Task 4.3 adds the
first sound, and every file that arrives must be recorded in the table below before it
is referenced by the game.

## Licensing Tiers

Ordered safest first. Prefer tier 1. Only move to tier 2 when a tier 1 source genuinely
cannot supply the sound.

### Tier 1 - Zero Attribution

| Source | License | Use for |
| --- | --- | --- |
| [Kenney Audio Packs](https://kenney.nl/assets?q=audio) | Public Domain (CC0) | UI clicks, machine loops, belt ticks, sale chimes. Cohesive set, no attribution needed. |
| [Pixabay Music and SFX](https://pixabay.com/music/) | Pixabay Content License | Music beds and spot effects. Free for commercial use, no attribution required. |
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
- **Keep audio out of the simulation.** `src/sim` never imports audio. Task 4.3 wires
  sound to `RenderEvent` through a dependency-injected player so simulation stays pure
  and the suite stays headless.

## Sound Budget

Factor-I is a factory game, so the mix is mostly loops and short transients. Target a
ceiling, not a quota, and cut anything that fights the click.

| Event | Source of truth | Expectation |
| --- | --- | --- |
| Sale | `RenderEvent` sale completion | One transient per sale, not per resource unit. |
| Machine active | `machineStateChanged` | Loop start and stop per machine, not per tick. |
| Belt item | `beltItemChanged` | A quiet transient. A per-item click at high throughput becomes a buzz. |
| Blocked producer | `blockedFull` | One transient on the transition only, never per tick. |
| Unlock purchase | unlock command result | One transient per successful purchase. |
| Music | none, ambient | One loop at a time, muted by default until the player opts in. |

## Asset Provenance Table

One row per committed audio file. Add the row in the same commit that adds the file.

| File | Source URL | License | Attribution required | Added in |
| --- | --- | --- | --- | --- |
| _(none yet)_ | | | | |
