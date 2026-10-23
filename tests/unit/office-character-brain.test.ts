import { describe, expect, it } from "vitest";
import {
  CharacterBrain,
  PRIORITY,
  type Plan,
  type RenderState,
} from "@/lib/office/character-brain";
import type { Vec } from "@/lib/office/sprite-pack";

const CLIPS = {
  idle: { frames: 4, frameDurationMs: 650, loop: true },
  walkRight: { frames: 4, frameDurationMs: 160, loop: true },
  walkLeft: { frames: 4, frameDurationMs: 160, loop: true },
  working: { frames: 4, frameDurationMs: 280, loop: true },
  sitDown: { frames: 3, frameDurationMs: 180, loop: false },
  standUp: { frames: 3, frameDurationMs: 180, loop: false },
  thinking: { frames: 3, frameDurationMs: 420, loop: false },
  presenting: { frames: 3, frameDurationMs: 300, loop: false },
};

const DESK: Vec = { x: 100, y: 100 };

function seededRng(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function brain(extra: Partial<ConstructorParameters<typeof CharacterBrain>[0]> = {}) {
  const ended: Array<[string, boolean]> = [];
  const b = new CharacterBrain({
    clips: CLIPS,
    findPath: (from, to) => [from, to], // open floor
    desk: { stand: DESK },
    start: { x: 300, y: 100 },
    strideWorldPx: 8,
    rng: seededRng(),
    onPlanEnd: (plan, completed) => ended.push([plan.tag ?? plan.id, completed]),
    ...extra,
  });
  return { b, ended };
}

const plan = (tag: string, priority: number, actions: Plan["actions"]): Plan => ({
  id: tag,
  tag,
  priority,
  actions,
});

function run(b: CharacterBrain, ms: number, step = 16) {
  const out: RenderState[] = [];
  for (let t = 0; t < ms; t += step) out.push(b.update(step));
  return out;
}

describe("CharacterBrain", () => {
  it("idles on the neutral frame and occasionally blinks, looks around, or flicks its tail", () => {
    const { b } = brain();
    const frames = run(b, 30_000, 50);
    expect(frames.every((f) => f.scene === "character" && f.clip === "idle")).toBe(true);
    const visuals = new Set(frames.map((f) => f.visual));
    expect(visuals.has("idle")).toBe(true);
    expect(visuals.has("blink")).toBe(true);
    expect([...visuals].some((v) => v === "look_around" || v === "tail_flick")).toBe(true);
    // Mostly neutral — micro-behaviours are occasional.
    expect(frames.filter((f) => f.visual === "idle").length / frames.length).toBeGreaterThan(0.6);
  });

  it("walks with the walk cycle advancing by distance and faces the direction of travel", () => {
    const { b } = brain();
    b.setPlan(plan("walk", PRIORITY.ambient, [{ kind: "walk", to: { x: 100, y: 100 } }]));
    const frames = run(b, 1500);
    const walking = frames.filter((f) => f.visual === "walking_left");
    expect(walking.length).toBeGreaterThan(10);
    expect(new Set(walking.map((f) => f.frame)).size).toBe(4);
    expect(walking.every((f) => f.clip === "walkLeft")).toBe(true);
    // ~52px/s: the cycle advances every 8px, i.e. roughly every 150ms (matches the 160ms art).
    expect(walking[walking.length - 1]!.x).toBeLessThan(300);
    b.setPlan(plan("back", PRIORITY.ambient, [{ kind: "walk", to: { x: 400, y: 100 } }]));
    expect(run(b, 300).some((f) => f.visual === "walking_right" && f.clip === "walkRight")).toBe(
      true,
    );
  });

  it("stops exactly at the destination", () => {
    const { b, ended } = brain();
    b.setPlan(plan("walk", PRIORITY.ambient, [{ kind: "walk", to: { x: 280, y: 130 } }]));
    run(b, 3000);
    expect(b.position.x).toBeCloseTo(280);
    expect(b.position.y).toBeCloseTo(130);
    expect(ended).toContainEqual(["walk", true]);
  });

  it("walks to the desk, plays sit-down once, then loops the work animation", () => {
    const { b } = brain();
    b.setPlan(plan("work", PRIORITY.task, [{ kind: "seated", mode: "work", ms: null }]));
    const frames = run(b, 8000);
    const sit = frames.filter((f) => f.visual === "sitting_down");
    expect(sit.length).toBeGreaterThan(0);
    // One-shot: frames 0 → 2 in order, never wrapping back.
    expect(sit.map((f) => f.frame)).toEqual([...sit.map((f) => f.frame)].sort());
    const firstSit = frames.indexOf(sit[0]!);
    expect(frames.slice(0, firstSit).some((f) => f.visual.startsWith("walking"))).toBe(true);
    const work = frames.filter((f) => f.visual === "working");
    expect(work.length).toBeGreaterThan(100);
    expect(new Set(work.map((f) => f.frame)).size).toBe(4);
    expect(work.every((f) => f.scene === "desk")).toBe(true);
    expect(b.isSeated).toBe(true);
  });

  it("stands up (once) before walking away from the desk", () => {
    const { b } = brain({ startSeated: true });
    expect(b.isSeated).toBe(true);
    b.setPlan(plan("go", PRIORITY.ambient, [{ kind: "walk", to: { x: 250, y: 120 } }]));
    const frames = run(b, 4000);
    const stand = frames.filter((f) => f.visual === "standing_up");
    expect(stand.length).toBeGreaterThan(0);
    const lastStand = frames.lastIndexOf(stand[stand.length - 1]!);
    expect(frames.slice(lastStand + 1).some((f) => f.visual === "standing_up")).toBe(false);
    expect(frames.slice(lastStand + 1).some((f) => f.visual.startsWith("walking"))).toBe(true);
    expect(b.isSeated).toBe(false);
  });

  it("plays thinking and presenting once, holding the last frame, then moves on", () => {
    const { b, ended } = brain();
    b.setPlan(
      plan("emotes", PRIORITY.completion, [
        { kind: "emote", clip: "thinking", holdMs: 400 },
        { kind: "emote", clip: "presenting", holdMs: 200 },
      ]),
    );
    const frames = run(b, 4000);
    const thinking = frames.filter((f) => f.visual === "thinking").map((f) => f.frame);
    const presenting = frames.filter((f) => f.visual === "presenting").map((f) => f.frame);
    expect(thinking).toEqual([...thinking].sort());
    expect(thinking.at(-1)).toBe(2);
    expect(presenting.at(-1)).toBe(2);
    expect(ended).toContainEqual(["emotes", true]);
    expect(frames.at(-1)!.visual).not.toBe("presenting");
  });

  it("higher-priority task plans interrupt ambient behaviour; lower ones cannot interrupt tasks", () => {
    const { b, ended } = brain();
    b.setPlan(plan("ambient:wander", PRIORITY.ambient, [{ kind: "walk", to: { x: 0, y: 100 } }]));
    run(b, 500);
    expect(
      b.setPlan(plan("handoff", PRIORITY.critical, [{ kind: "walk", to: { x: 400, y: 200 } }])),
    ).toBe(true);
    expect(ended).toContainEqual(["ambient:wander", false]);
    expect(b.setPlan(plan("ambient:look", PRIORITY.ambient, [{ kind: "idle", ms: 100 }]))).toBe(
      false,
    );
    expect(b.currentPlan?.tag).toBe("handoff");
    expect(run(b, 200).every((f) => f.visual === "walking_right")).toBe(true);
  });

  it("lets a sit-down finish before honouring an interruption", () => {
    const { b } = brain();
    b.setPlan(
      plan("desk", PRIORITY.ambient, [{ kind: "sit" }, { kind: "seated", mode: "idle", ms: null }]),
    );
    let frames: RenderState[] = [];
    for (let i = 0; i < 400 && !b.inTransition; i++) frames.push(b.update(16));
    expect(b.inTransition).toBe(true);
    b.setPlan(plan("handoff", PRIORITY.critical, [{ kind: "walk", to: { x: 500, y: 100 } }]));
    expect(b.pendingPlan?.tag).toBe("handoff");
    frames = run(b, 3000);
    const firstNonSit = frames.findIndex((f) => f.visual !== "sitting_down");
    // Sit completes, then stand (the brain inserts it), then walk.
    expect(frames.slice(firstNonSit).find((f) => f.visual !== "standing_up")?.visual).toMatch(
      /walking|seated/,
    );
    expect(frames.some((f) => f.visual === "standing_up")).toBe(true);
    expect(b.currentPlan?.tag).toBe("handoff");
  });

  it("cancelling active work leaves the working animation (no stuck typing)", () => {
    const { b } = brain();
    b.setPlan(plan("mode:working", PRIORITY.task, [{ kind: "seated", mode: "work", ms: null }]));
    run(b, 6000);
    expect(b.update(16).visual).toBe("working");
    b.cancel("mode:working");
    expect(run(b, 200).every((f) => f.visual !== "working")).toBe(true);
  });

  it("reduced motion: no walking or frame cycling, the character simply appears at its destination", () => {
    const { b } = brain({ reducedMotion: true });
    b.setPlan(
      plan("work", PRIORITY.task, [
        { kind: "walk", to: { x: 20, y: 40 } },
        { kind: "seated", mode: "work", ms: null },
      ]),
    );
    const frames = run(b, 3000);
    expect(frames.some((f) => f.visual.startsWith("walking"))).toBe(false);
    const work = frames.filter((f) => f.visual === "working");
    expect(work.length).toBeGreaterThan(0);
    expect(new Set(work.map((f) => f.frame))).toEqual(new Set([0]));
  });

  it("degrades gracefully when a clip is missing", () => {
    const { b } = brain({
      clips: { idle: CLIPS.idle, walkLeft: CLIPS.walkLeft, walkRight: CLIPS.walkRight },
    });
    b.setPlan(
      plan("x", PRIORITY.task, [
        { kind: "emote", clip: "thinking" },
        { kind: "seated", mode: "work", ms: 500 },
      ]),
    );
    const frames = run(b, 3000);
    expect(frames.every((f) => f.clip === "idle" || f.clip.startsWith("walk"))).toBe(true);
    expect(frames.some((f) => f.visual === "look_around")).toBe(true);
  });
});
