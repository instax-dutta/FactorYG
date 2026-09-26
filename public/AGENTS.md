## Purpose

Own static Factor-I art and build-time asset metadata.

## Ownership

- `assets/` contains floor, machine, resource, VFX, and audio files.
- The asset manifest is the source of truth for texture keys, dimensions, and frame order.

## Local Contracts

- Art uses the locked industrial palette, 64 by 64 machine tiles, transparent SVG/PNG output, neutral overhead lighting, and no baked directional shadows.
- Rotatable machine art must remain valid under 90-degree sprite rotation.
- A machine draws one `#36c5b5` input dot per input port and one `#f2c14e` output dot per output port, on the tile edge nearest that port cell, with the dots in a radius band of 2 to 3.5 so the port-marker test can find them. A port marker must not move or change colour between animation frames, or the player loses track of which way a machine faces. A second input port at `(0, -1)` is drawn as a stub on the top edge, as the assembler does.
- New asset files require a manifest entry and an actual-file validation test.
- Port markers are fixed art, not animation state. A ported face carries a `#4d6875` block, an input block holds a `#36c5b5` dot, and an output block holds a `#f2c14e` dot. Those colors are the machine's facing read and must be identical in the idle frame and in every active frame.
- A machine with ports on both sides may not swap its port colors between frames. A swapped pair claims the machine turned around while the rest of the tile stayed put, so a tile contradicts itself for one frame in two. The silo is the sharpest case, because with no directional arrow the dots are its only facing cue and a swap inverts it outright.
- The port blocks are the only facing cue a tile has, so they are also the only thing that makes the rotation contract satisfiable: a rotated tile is read by which side carries the gold output block. A new machine must therefore state which face outputs before its art is drawn, and a machine with no output port has no facing read and cannot carry the rotation contract.
- Any blinking or pulsing indicator belongs away from the port blocks, such as a small centred status lamp on the body or cap. The light ladder is `#4d6875` at 0.44 opacity when idle and `#4d6875` at 0.5 when active. Animation may change rim colors, fills, glows, and that lamp; it may never change a port dot.

## Work Guidance

- Keep frame paths ordered and names stable once referenced by the renderer.
- Add assets in the same visual language; do not mix third-party art styles.

## Verification

- `npm run test -- tests/unit/assetManifest.test.ts`
- `npm run build`
- `npm run art:sheet`

## Child DOX Index

- `assets/AGENTS.md` - art file and manifest conventions.
