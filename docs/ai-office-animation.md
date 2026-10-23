# AI Office animation (Baxter V3 sprites)

Baxter is an animated voxel cat in the AI Office (`/ai`). He wanders, sits at his desk, thinks,
and walks to a specialist's office when he hands off real work. Agents without a sprite pack
keep their portrait-at-a-desk look.

Two kinds of motion, kept strictly apart:

| Kind                 | Driven by                                                 | Side effects                    |
| -------------------- | --------------------------------------------------------- | ------------------------------- |
| Ambient (decorative) | Client-side planner + RNG                                 | None. No fetch, no DB, no model |
| Task-driven          | `ai_agent_runtime_status`, delegation rows, chat requests | None. Animates recorded events  |

Status badges, hand-off lines, and captions appear only for task-driven activity. Desk typing
during an idle desk visit is decorative and never changes the "Available" status.

## Assets

- Source pack (never modified): `public/animations/baxter_sprite_pack/` — 28 PNGs, 8 clips.
  `SHA256SUMS.txt` lists an `originals/` folder that is not in the repo; nothing uses it.
- Normalized frames: `public/animations/baxter/v3/*.webp` + `manifest.json` (≈540 KB total).
- Regenerate: `node scripts/normalize-baxter-sprites.mjs` (uses the `sharp` that ships with Next).

What normalization fixes (the source frames came from AI-generated sheets):

- **Scale**: the 724px sheets (sit/stand/thinking/presenting) draw the cat at a different
  size than the 627px sheets. Each clip gets one scale matched to idle (cat height for
  character clips, coffee-mug height for desk clips). The left-facing walk was ~8% smaller
  than the right-facing walk and is scaled up to match.
- **Ground line**: feet sit on one baseline (the hop frames in walk-left 03/04 and idle 03/04
  no longer float), centred on the paw centroid so the cat doesn't slide sideways.
- **Desk alignment**: desk clips are aligned on the blue mug, the only prop visible in every
  desk frame, so the desk doesn't jump between work/sit/stand frames.
- **Sheet bleed**: stray specks from neighbouring sheet cells were removed (work 03/04,
  walk-right 02/04, a 190px desk-leg sliver in sit-down 02).
- Two fixed canvases: character (feet anchor, bottom-centre) and desk (mug anchor).

Known limitations of the art:

- Sit-down frame 1 draws the desk slightly smaller than frames 2–3 (perspective drift in the
  source sheet). It plays for 180ms; a 140ms crossfade hides most of it.
- Stand-up ends with Baxter behind the desk waving, while walking starts beside the desk;
  the switch is a short crossfade, not a continuous motion.
- Walk frames are clipped at the tail tip in the source; this can't be recovered.
- The presenting clip includes an easel on Baxter's left. It is only used where that side is
  clear (the hand-off spot to the right of a desk, and result delivery).
- There is no desk-only artwork. While Baxter is away from his desk, an SVG desk drawn in the
  same canvas space (`DeskArt`) stands in for it; the sprite desk replaces it while he sits.

## Code map

| Piece                        | File                                               |
| ---------------------------- | -------------------------------------------------- |
| Pack registry + validation   | `src/lib/office/sprite-pack.ts`                    |
| Walkable grid, A*, hotspots  | `src/lib/office/navigation.ts`                     |
| Camera (world ↔ screen)      | `src/lib/office/camera.ts`                         |
| Visual state machine         | `src/lib/office/character-brain.ts`                |
| Ambient planner              | `src/lib/office/ambient.ts`                        |
| Task → animation cues        | `src/lib/office/task-coordinator.ts`               |
| Admin settings schema        | `src/lib/office/animation-settings.ts`             |
| Delegation snapshot (server) | `src/lib/agents/office-activity.ts`                |
| rAF loop + plan scheduling   | `src/components/ai/office/director.ts`             |
| React glue                   | `src/components/ai/office/use-office-animation.ts` |
| Character + desk DOM         | `src/components/ai/office/animated-agent.tsx`      |
| Frame preloading             | `src/components/ai/office/sprite-loader.ts`        |

### Visual states

`idle`, `blink`, `look_around`, `tail_flick` (idle clip frames 1–4), `walking_left`,
`walking_right`, `sitting_down`, `seated_idle` (work frame 1, blinking on frame 4), `working`,
`standing_up`, `thinking`, `presenting`.

Loops: idle (as occasional micro-poses, not a 4-frame twitch), walk (frame advances every 8
world px so paws match ground speed), work. One-shots: sit-down, stand-up, thinking (holds the
light-bulb frame), presenting.

### Priorities

1. Critical — hand-off walks, failed results
2. Active task — Baxter's own running task, a chat request in flight
3. Completion — reviewing/presenting a finished result
4. Ambient — idle activities, and passive modes (waiting on a specialist, awaiting approval)
5. Nothing planned

A lower-priority plan never interrupts a higher one. Anything interrupts walking immediately;
sit-down/stand-up finish first (≤540ms). The brain inserts "stand up" before walking and "walk
to desk + sit" before working, so callers only say _what_, not _how_.

### Navigation

World coordinates are the layout's own (`computeOfficeLayout`); pan/zoom is a CSS transform on
top. The grid (8px cells) blocks room walls except a door gap in each room's bottom wall
(also drawn), furniture (bookshelf, plant, meeting table/chairs, every desk), and the
"future departments" area. Paths are A* + string-pulled into straight segments.

Hotspots per room: `door:`, `hall:`, `idle:<room>:{window,shelf,plant,center,corner}`; per
agent: `desk:`, `stand:` (animated desks), `collab:` (hand-off spot: right, left, or front of
the desk — first one that's walkable, or the admin's choice). New agents get these from their
seat automatically.

### Real task wiring

- Mode per agent from `ai_agent_runtime_status.state`: `working` → seated typing;
  `receiving` → think, then type; `awaiting_result` → seated at his desk, waiting;
  `awaiting_approval` / `failed` → standing in his office (badge shows why); `idle` → ambient.
- Events from delegation rows (`/api/ai/status` → `delegations`: ids, status, timestamps only):
  - first seen queued/running → **hand-off**: stand, hurry to `collab:<agent>`, brief, walk home;
  - first seen finished → **result**: think, then present (at most every 3 minutes) or nod;
    failures show a red caption and never leave him typing.
  - If the result arrives mid-walk, the visit is cut short and he reviews where he is.
- Dedupe per task and phase; stale responses (older `serverTime`) and status regressions are
  ignored; events older than 2 minutes are shown as state, not replayed.
- First load seeds everything already visible as handled, so a refresh never replays history;
  an in-flight delegation shows as Baxter waiting at his desk plus the hand-off line.
- The office's existing Realtime subscription and 15s/60s poll deliver updates. Animation
  never delays a request: delegation runs in the backend immediately.
- **Chat in the office** ("Ask Baxter" in his detail panel) reports its own real request:
  start → think + type; end → "Answer ready" or "Couldn't answer". Baxter's own answers create
  no task rows, so outside this panel (Slack, the dashboard launcher) only delegations are
  visible in the office.

## Settings

Admins (Customize office → **Office animation**), stored in
`ai_workspace_settings.animation_settings` (migration `069_ai_office_animation.sql`):

- Idle activity: off / low / normal / high
- Walking speed: relaxed / normal / brisk
- Resting spot: desk / window / middle of the office
- Per agent: appearance (portrait or a sprite pack) and where visitors stand

Until 069 is applied the office uses defaults; saving animation settings will fail with a
database error, other office settings keep working.

Viewers (per browser): Office life override, pause idle animation, reduce motion (also follows
`prefers-reduced-motion`: no walking or frame cycling, characters appear at destinations),
Follow Baxter, Locate, Fit (reset camera).

## Adding an animated agent

1. Put frames in `public/animations/<agent>/…` and normalize them (copy
   `normalize-baxter-sprites.mjs`; the manifest format is `SpritePackManifest`).
2. Register the pack in `SPRITE_PACKS` (`sprite-pack.ts`) with its scale, desk focus/footprint,
   seated-feet point, and stride.
3. Assign it to the agent under Customize office → Office animation.

The agent then gets its own desk, ambient routine in its own room, and modes from its own
runtime status. Hand-off walks happen for whichever agent _delegates_ (today only Baxter).

## Testing

```bash
npx vitest run tests/unit/office-*.test.ts
PLAYWRIGHT_REUSE_SERVER=true npx playwright test tests/e2e/ai-workspace.spec.ts
```

Manual: start the `baxter-ai-sandbox` launch config, open `/ai`, click **Baxter** → **Ask
Baxter**, ask an HR question. In the sandbox Sam has no model key, so the task fails
honestly and Baxter shows "Sam's task failed" without walking (it finished before the office
saw it running). With real keys and a slower task, the walk, hand-off, and result play.
