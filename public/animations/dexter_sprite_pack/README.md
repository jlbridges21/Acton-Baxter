# Dexter Business Intelligence Sprite Pack

This package contains 28 individually cropped transparent PNG frames for Dexter, a voxel dog and Business Intelligence & Analytics AI agent. It covers the same animation states as the Baxter V3 pack while giving Dexter distinct canine movement and analytics-focused behavior.

## Contents

- `sprites/idle/`: 4-frame idle loop (attentive, blink/pant, data-signal head tilt, eager tail-ready stance)
- `sprites/walk-right/`: 4-frame right-facing canine walk loop
- `sprites/walk-left/`: 4-frame left-facing canine walk loop
- `sprites/work/`: 4-frame dashboard, monitor-analysis, report-review, and completion loop
- `sprites/transitions/sit-down/`: 3-frame dog sit transition
- `sprites/transitions/stand-up/`: 3-frame stand-up transition with a canine play-bow stretch
- `sprites/emotes/data-thinking/`: 3-frame signal-sniffing and connected-insight sequence
- `sprites/emotes/analytics-task/`: 3-frame dashboard inspection, data verification, and completed-report sequence
- `originals/sheets/`: all eight generated source sheets
- `originals/reference/Dexter.png`: supplied Dexter reference image
- `manifest.json`: machine-readable animation paths, timing, playback behavior, and Baxter-compatible aliases
- `GENERATION_PROMPTS.md`: production prompt set used for the assets
- `SHA256SUMS.txt`: checksums for every other package file
- `VERIFICATION.txt`: validation summary

## Frame order

All sheets use a 2x2 layout and are read row-major: top-left, top-right, bottom-left, bottom-right. Three-frame transitions and emotes use the first three cells; the fourth cell is transparent.

## Compatibility

All extracted frames are normalized to 627x627 RGBA PNGs. The manifest maps `thinking` to Dexter's `dataThinking` sequence and `presenting` to his `analyticsTask` sequence, allowing Baxter-compatible animation code to use Dexter's role-specific assets.

## Suggested integration

Load `manifest.json`, select an animation, and cycle through its `frames` using `frameDurationMs`. Loop animations repeat; transitions and emotes default to one-shot playback. For reduced-motion mode, display the first frame of the selected state.

Transparent pixels may display as black in viewers that do not show a transparency grid.
