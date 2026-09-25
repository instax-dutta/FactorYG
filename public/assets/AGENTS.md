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

## Work Guidance

- Preserve locked palette and silhouette readability across the whole set.
- Use separate static frame files for Phaser animation rather than embedded SMIL.

## Verification

- `npm run test -- tests/unit/assetManifest.test.ts`
- `npm run build`

## Child DOX Index

- No child boundaries currently exist under `public/assets/`.
