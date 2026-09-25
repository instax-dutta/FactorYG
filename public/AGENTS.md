## Purpose

Own static Factor-I art and build-time asset metadata.

## Ownership

- `assets/` contains floor, machine, resource, and VFX files.
- The asset manifest is the source of truth for texture keys, dimensions, and frame order.

## Local Contracts

- Art uses the locked industrial palette, 64 by 64 machine tiles, transparent SVG/PNG output, neutral overhead lighting, and no baked directional shadows.
- Rotatable machine art must remain valid under 90-degree sprite rotation.
- New asset files require a manifest entry and an actual-file validation test.

## Work Guidance

- Keep frame paths ordered and names stable once referenced by the renderer.
- Add assets in the same visual language; do not mix third-party art styles.

## Verification

- `npm run test -- tests/unit/assetManifest.test.ts`
- `npm run build`

## Child DOX Index

- `assets/AGENTS.md` - art file and manifest conventions.
