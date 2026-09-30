## Purpose

Own static asset files and their manifest relationship.

## Ownership

- `tiles/` contains floor and grid artwork.
- `machines/` contains machine idle and active frames.
- `resources/` contains resource icons.
- `vfx/` contains the glow, heat, and sale-burst textures. `spark` is the belt glow and the storage notice, `heat` is the smelter heat overlay, and `coin` is the depot sale burst; those three are the only v1 VFX families, so a fourth file here is a new family rather than a variant.
- `audio/` holds committed audio files plus `README.md`, the sourcing and licensing reference for them.

## Local Contracts

- Machine frames are 64 by 64 with transparent backgrounds and neutral overhead lighting.
- Resource icons are 32 by 32 and VFX textures are 16 by 16 unless the manifest states otherwise.
- New files must be registered with ordered frame paths and validated as real files.
- No baked directional shadows, filters, animation elements, or source comments in SVG art.
- A port marker is a circle of radius 2 to 3.5 sitting inside a port block; a status lamp is a smaller circle set apart from the port blocks. The asset manifest test reads that radius band to prove port markers never change colour between frames, so art outside the band is art the test cannot check.
- Audio licensing is tiered, and the rule is per file rather than per site. Zero-attribution sources are preferred; a site that hosts CC0, CC-BY, and CC-BY-NC side by side means the file's own icon decides. Never commit a NonCommercial or NoDerivatives audio file, and never commit an audio file without a row in the `audio/README.md` provenance table naming its source URL and exact license.

## Work Guidance

- Preserve locked palette and silhouette readability across the whole set.
- Use separate static frame files for Phaser animation rather than embedded SMIL.
- Run `npm run art:sheet` and look at the sheets after touching any machine art. Reading the source does not catch a wrong colour or an ambiguous silhouette; a contact sheet with a machine's idle, active, and active-1 frames side by side does. `machines-animation.png` is the sheet that exposes port or indicator drift, and `machines-rotated-90.png` is the sheet that exposes a broken facing read. The script needs `rsvg-convert` and ImageMagick `magick` on PATH, and it fails loudly if either is missing.

## Verification

- `npm run test -- tests/unit/assetManifest.test.ts`
- `npm run build`
- `npm run art:sheet`

## Child DOX Index

- No child boundaries currently exist under `public/assets/`.
