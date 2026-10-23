# AI Office animation (Baxter, Sam, Dexter)

The AI Office (`/ai`) is a small animated workplace. Baxter (voxel cat, executive), Sam (tuxedo
cat, HR/admin/legal), and Dexter (voxel dog, business intelligence) each live in a decorated
office, follow their own idle routine, react to real task state, and can be directed by the
user. Agents without a sprite pack keep their portrait-at-a-desk look. All characters share
one engine; what differs is their sprite pack and its definition.

Two kinds of motion, kept strictly apart:

| Kind                 | Driven by                                                 | Side effects                    |
| -------------------- | --------------------------------------------------------- | ------------------------------- |
| Ambient (decorative) | Client-side planner + RNG                                 | None. No fetch, no DB, no model |
| Task-driven          | `ai_agent_runtime_status`, delegation rows, chat requests | None. Animates recorded events  |

Status badges, hand-off lines, and captions appear only for task-driven activity. Desk typing
during an idle desk visit is decorative and never changes the "Available" status.

## Assets

| Character | Source pack (never modified)            | Normalized output              |
| --------- | --------------------------------------- | ------------------------------ |
| Baxter    | `public/animations/baxter_sprite_pack/` | `public/animations/baxter/v3/` |
| Sam       | `public/animations/sam_sprite_pack/`    | `public/animations/sam/v1/`    |
| Dexter    | `public/animations/dexter_sprite_pack/` | `public/animations/dexter/v1/` |

Regenerate with `node scripts/normalize-sprite-packs.mjs [baxter|sam|dexter]` (uses the `sharp`
that ships with Next). Clip names, order, timing, looping, and aliases come from each source
manifest. The source manifests' `originals/` folders (listed in their checksums) are not in the
repo; nothing uses them.

Sam and Dexter clips (role emotes are mapped through the packs' own aliases):

| Clip            | Sam                                  | Dexter                                       | Used for                                                           |
| --------------- | ------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------ |
| idle (4)        | neutral, blink, listen, welcome-tail | attentive, blink-pant, head tilt, tail-ready | standing; micro-poses (blink/look/tail)                            |
| walkLeft/Right  | 4-frame cat walk                     | 4-frame dog gait                             | movement, frame per 8–9 world px                                   |
| working (4)     | type, review folder, checklist, type | dashboard, monitor, report, done             | seated work loop (real or decorative)                              |
| sitDown/standUp | floor sit beside the desk            | floor sit / play-bow stretch                 | one-shot transitions at the desk's right                           |
| think emote     | `peopleThinking`                     | `dataThinking`                               | receiving work; idle thinking spots                                |
| task emote      | `hrTask`                             | `analyticsTask`                              | idle routine at the onboarding/report stations; presenting results |

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
- **Sam/Dexter**: desk frames are aligned on the tabletop's top-right corner (Sam has no mug),
  with a ±6% width correction because Dexter's sheet draws the desk at different sizes. Their
  close-up emote sheets are scaled down to match idle (Sam's HR task ×0.8). The script also
  derives a `desk-empty.webp` prop (desk without the character) from explicit keep/clear
  rectangles in a work frame, shown while they're away from their desk.

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
- Sam's and Dexter's sit/stand frames have no desk (they sit on the floor beside it), so
  sitting plays at the desk's right, then crossfades into the seated-at-desk work art.
- Dexter's empty desk is reconstructed where his laptop was (wood stretched from beside it);
  a small step in the desk's back edge is visible next to the plant at high zoom.

## Code map

| Piece                        | File                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| Pack registry + validation   | `src/lib/office/sprite-pack.ts`                                                     |
| Department decorations       | `src/lib/office/decor.ts` (data), `src/components/ai/office/office-decor.tsx` (art) |
| Scene depth                  | `src/lib/office/depth.ts`                                                           |
| Walkable grid, A*, hotspots  | `src/lib/office/navigation.ts`                                                      |
| Camera (world ↔ screen)      | `src/lib/office/camera.ts`                                                          |
| Visual state machine         | `src/lib/office/character-brain.ts`                                                 |
| Ambient planner              | `src/lib/office/ambient.ts`                                                         |
| Task → animation cues        | `src/lib/office/task-coordinator.ts`                                                |
| Admin settings schema        | `src/lib/office/animation-settings.ts`                                              |
| Delegation snapshot (server) | `src/lib/agents/office-activity.ts`                                                 |
| rAF loop + plan scheduling   | `src/components/ai/office/director.ts`                                              |
| React glue                   | `src/components/ai/office/use-office-animation.ts`                                  |
| Character + desk DOM         | `src/components/ai/office/animated-agent.tsx`                                       |
| Frame preloading             | `src/components/ai/office/sprite-loader.ts`                                         |

### Visual states

`idle`, `blink`, `look_around`, `tail_flick` (idle clip frames 1–4), `walking_left`,
`walking_right`, `sitting_down`, `seated_idle` (work frame 1, blinking on frame 4), `working`,
`standing_up`, `thinking`, `presenting`, `emoting` (role emotes; the clip name is exposed as
`data-emote`, e.g. `hrTask`).

Loops: idle (as occasional micro-poses, not a 4-frame twitch), walk (frame advances every 8
world px so paws match ground speed), work. One-shots: sit-down, stand-up, thinking (holds the
light-bulb frame), presenting.

### Priorities

0. Manual — the user is directing this agent (click-to-move, interrupt)
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

Hotspots per room come from its decorations: executive `strategy`, `model`, `bookcase`,
`visitors`; HR `files`, `onboarding`, `policy`, `conversation`, `tree`; analytics `whiteboard`,
`dashboard`, `reports`, `printer`, `datacab`; every room also has `door:`, `hall:`, `center`,
`window`, `corner`. Per agent: `desk:`, `stand:`, `exit:` (right-exit desks), `collab:` (hand-off
spot: right, left, or front of the desk). New agents get these from their seat automatically.

**Desk exit rule (Sam, Dexter):** `deskExit: "right"` in the pack definition puts the sit/stand
point on the desk's right and an exit waypoint 34px further right. Every autonomous route that
starts at the desk walks to the exit first, and returning to sit goes exit → stand point → sit,
so they never leave past the clutter on the desk's left. User-directed moves skip the rule.

## Decorations and depth

`decor.ts` defines each department theme (picked from the department slug/name) as items with an
art rectangle, a layer, and — for furniture — a floor footprint. Items that would overlap a
desk, a desk approach/exit point, a hand-off spot, or the doorway path are dropped, so
decoration never blocks a required route (tested on every layout preset). Footprints become
navigation obstacles; the art is small pixel-style SVG in the office palette, with symbols
instead of text.

Depth (`depth.ts`) has four bands: background (rugs), wall (boards, frames, wall displays —
always behind characters), world (characters, desks, furniture, sorted by floor baseline:
feet for characters, footprint bottom for furniture, front edge for desks; ties go decor <
desk < character), and UI (names, bubbles, captions, click rings, hand-off chips). It's the
same `depthZ()` everywhere: decor sets it once, the animation loop sets it per frame for moving
characters. A seated character sorts with its desk's front edge. Selection rings sit inside the
character's world element, so furniture in front of an agent also covers its ring.

## User control

- **Click an agent**: stops its routine (typing, emotes, walking), stands it up if seated, and
  leaves it idle. The click is consumed by the agent, so it never also creates a destination.
- **Click/tap the floor** with an animated agent selected: an expanding ring appears at the
  clicked world point (650ms, non-blocking), and the agent walks there, facing left/right by
  travel direction (vertical legs keep the last facing), then idles. Points inside furniture,
  walls, desks, or outside the office resolve to the nearest reachable floor
  (flood fill from the agent). A press that moves more than 6px is a pan, not a click.
  Pointer → world uses the viewport rect, its border, pan, and zoom (`clientToWorld`).
- **10-second window**: either action puts the agent in manual mode; each further click resets
  the timer. After 10s without input the agent resumes its routine from where it is (no
  teleport). Timing uses the animation loop's clock, so there are no timers to leak; rapid
  clicks just replace the one manual plan. Real hand-offs that arrive meanwhile wait and play
  once manual mode ends; status badges update immediately.

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
- Per agent: appearance (portrait or a sprite pack; Sam and Dexter default to theirs) and where
  visitors stand

Until 069 is applied the office uses defaults; saving animation settings will fail with a
database error, other office settings keep working.

Viewers (per browser): Office life override, pause idle animation, reduce motion (also follows
`prefers-reduced-motion`: no walking or frame cycling, characters appear at destinations),
Follow Baxter, Locate, Fit (reset camera).

## Adding an animated agent

1. Put the pack in `public/animations/<agent>_sprite_pack/` and add an entry to `PACKS` in
   `scripts/normalize-sprite-packs.mjs` (fur colours for the paw anchor, desk anchor, per-clip
   scale, empty-desk rectangles). Run it.
2. Register the pack in `SPRITE_PACKS` (`sprite-pack.ts`): scale, stride, `emotes` (think /
   present / task clip names), `deskExit`, and ambient weights + preferred hotspots. Map the
   agent's slug in `DEFAULT_PACK_BY_SLUG`, or assign it under Customize office.
3. Optionally add a decoration theme in `decor.ts` and match it in `roomTheme()`.

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
