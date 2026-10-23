# Sam HR Sprite Pack

This package contains 28 individually cropped transparent PNG frames for Sam, a black-and-white voxel cat and HR AI bot. It covers the same animation states as the Baxter V3 pack while giving Sam distinct HR-focused behaviors and personality.

## Contents

- `sprites/idle/`: 4-frame idle loop (neutral, blink, attentive look, welcoming tail/paw gesture)
- `sprites/walk-right/`: 4-frame right-facing walk loop
- `sprites/walk-left/`: 4-frame left-facing walk loop with alert ear movement
- `sprites/work/`: 4-frame HR desk-work loop (typing, personnel-folder review, checklist, typing)
- `sprites/transitions/sit-down/`: 3-frame sit-down transition
- `sprites/transitions/stand-up/`: 3-frame stand-up transition with a subtle stretch
- `sprites/emotes/people-thinking/`: 3-frame empathetic listening and people-first reflection sequence
- `sprites/emotes/hr-task/`: 3-frame onboarding and employee-support sequence
- `originals/sheets/`: all eight generated source sheets
- `originals/reference/sam.png`: the supplied Sam reference image
- `manifest.json`: machine-readable animation paths, frame size, timing, playback behavior, and Baxter-compatible aliases
- `SHA256SUMS.txt`: checksums for every other package file
- `VERIFICATION.txt`: validation summary

## Frame order

All sheets use a 2x2 layout and are read row-major: top-left, top-right, bottom-left, bottom-right. The three-frame transitions and emotes intentionally use only the first three cells; the fourth cell is transparent.

## Compatibility

All extracted frames are normalized to 627x627 RGBA PNGs. The manifest includes aliases so an animation system written for Baxter can map `thinking` to Sam's `peopleThinking` sequence and `presenting` to Sam's `hrTask` sequence without losing Sam's unique HR behavior.

## Suggested integration

Load `manifest.json`, select an animation, and cycle through its `frames` using `frameDurationMs`. Loop animations repeat; transitions and emotes default to one-shot playback. For reduced-motion mode, display the first frame of the selected state.

Transparent pixels may display as black in viewers that do not show a transparency grid.
