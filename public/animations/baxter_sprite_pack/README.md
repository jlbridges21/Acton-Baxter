# Baxter V3 Sprite Pack

This package contains 28 individually cropped transparent PNG frames derived from the Baxter V2 sprite sheets. No frame was resized or regenerated.

## Contents

- `sprites/idle/`: 4-frame idle loop (neutral, blink, look-around, tail-flick)
- `sprites/walk-right/`: 4-frame right-facing walk loop
- `sprites/walk-left/`: 4-frame left-facing walk loop
- `sprites/work/`: 4-frame desk-working loop
- `sprites/transitions/sit-down/`: 3-frame sit-down transition
- `sprites/transitions/stand-up/`: 3-frame stand-up transition
- `sprites/emotes/thinking/`: 3-frame thinking sequence
- `sprites/emotes/presenting/`: 3-frame talking/presenting sequence
- `originals/`: the complete original V2 package, including every source sheet and its README
- `manifest.json`: machine-readable animation paths, frame sizes, timing, and playback behavior
- `SHA256SUMS.txt`: checksums for every other file in the package
- `VERIFICATION.txt`: build verification summary

## Frame order

Frames are numbered in playback order. The 2x2 sheets were read row-major: top-left, top-right, bottom-left, bottom-right. The 3x1 sheets were read left-to-right.

## Suggested web integration

Load `manifest.json`, choose an animation, and cycle through its `frames` at the specified `frameDurationMs`. Loop animations repeat; transition and emote sequences default to one-shot playback. All frame paths in the manifest are relative to the package root.

For crisp voxel artwork, use `image-rendering: pixelated` when scaling is appropriate for the surrounding design. Respect reduced-motion preferences by showing the first frame of the selected state.

## Notes

- Each extracted PNG retains an RGBA color model and transparent alpha channel.
- All 2x2-derived frames are 627x627 pixels.
- All 3x1-derived frames are 724x724 pixels.
- Transparent pixels may display as black in viewers that do not show a transparency grid.
