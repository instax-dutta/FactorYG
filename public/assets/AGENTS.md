## Purpose

Own static asset files and their manifest relationship.

## Ownership

- `tiles/` contains floor and grid artwork.
- `machines/` contains machine idle and active frames.
- `resources/` contains resource icons.
- `vfx/` contains particle and glow textures.

## Local Contracts

- Machine frames are 64 by 64 with transparent backgrounds and neutral overhead lighting.
- Resource icons are 32 by 32 and VFX textures are 16 by 16 unless the manifest states otherwise.
- New files must be registered with ordered frame paths and validated as real files.
- No baked directional shadows, filters, animation elements, or source comments in SVG art.
- A port marker is a circle of radius 2 to 3.5 sitting inside a port block; a status lamp is a smaller circle set apart from the port blocks. The asset manifest test reads that radius band to prove port markers never change colour between frames, so art outside the band is art the test cannot check.

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
