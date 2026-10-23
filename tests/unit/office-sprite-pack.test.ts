import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CLIP_NAMES,
  SPRITE_PACKS,
  allFrameUrls,
  clipDurationMs,
  deskMetrics,
  frameAt,
  resolveClip,
  parseSpritePackManifest,
  resolvePackId,
  withoutBrokenFrames,
  type SpritePackManifest,
} from "@/lib/office/sprite-pack";
import { normalizeAnimationSettings } from "@/lib/office/animation-settings";

const PUBLIC = path.resolve(__dirname, "../../public");
const SOURCE = path.join(PUBLIC, "animations/baxter_sprite_pack");
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));

function baxterManifest(): SpritePackManifest {
  return parseSpritePackManifest(readJson(path.join(PUBLIC, "animations/baxter/v3/manifest.json")))
    .manifest;
}

describe("Baxter V3 sprite assets", () => {
  it("source pack: every manifest frame exists (originals are untouched inputs)", () => {
    const source = readJson(path.join(SOURCE, "manifest.json"));
    const frames = Object.values(source.animations).flatMap(
      (a) => (a as { frames: string[] }).frames,
    );
    expect(frames).toHaveLength(28);
    for (const f of frames) expect(fs.existsSync(path.join(SOURCE, f)), f).toBe(true);
  });

  it("normalized pack: every clip is present, ordered, and every frame resolves on disk", () => {
    const source = readJson(path.join(SOURCE, "manifest.json"));
    const m = baxterManifest();
    for (const name of CLIP_NAMES) {
      const clip = m.animations[name];
      expect(clip, name).toBeDefined();
      // Same frame count and order as the source sheets.
      expect(clip!.frames).toHaveLength(source.animations[name].frames.length);
      clip!.frames.forEach((f, i) =>
        expect(f).toMatch(new RegExp(`-${String(i + 1).padStart(2, "0")}\\.webp$`)),
      );
    }
    for (const url of allFrameUrls(m)) {
      expect(fs.existsSync(path.join(PUBLIC, url)), url).toBe(true);
    }
  });

  it("loops idle, walk, and work; plays transitions and emotes once", () => {
    const m = baxterManifest();
    expect(m.animations.idle!.loop).toBe(true);
    expect(m.animations.walkLeft!.loop).toBe(true);
    expect(m.animations.walkRight!.loop).toBe(true);
    expect(m.animations.working!.loop).toBe(true);
    for (const once of ["sitDown", "standUp", "thinking", "presenting"] as const) {
      expect(m.animations[once]!.loop, once).toBe(false);
    }
  });

  it("desk clips share the desk canvas and know where Baxter stands to sit", () => {
    const m = baxterManifest();
    for (const name of ["working", "sitDown", "standUp"] as const) {
      expect(m.animations[name]!.canvas).toBe("desk");
    }
    for (const name of ["idle", "walkLeft", "walkRight", "thinking", "presenting"] as const) {
      expect(m.animations[name]!.canvas).toBe("character");
    }
    expect(m.canvases.desk.standPoint).toBeDefined();
    // Feet anchor sits at the bottom of the character canvas.
    expect(m.canvases.character.anchor.y).toBeGreaterThan(m.canvases.character.height * 0.9);
  });

  it("registers a pack definition pointing at the normalized manifest", () => {
    const def = SPRITE_PACKS["baxter-v3"]!;
    expect(fs.existsSync(path.join(PUBLIC, def.manifestUrl))).toBe(true);
  });
});

describe("sprite pack parsing and fallbacks", () => {
  it("frameAt loops or holds the last frame", () => {
    const loop = { frames: ["a", "b", "c"], frameDurationMs: 100, loop: true };
    const once = { ...loop, loop: false };
    expect([0, 99, 100, 250, 300, 450].map((t) => frameAt(loop, t))).toEqual([0, 0, 1, 2, 0, 1]);
    expect([0, 150, 250, 1000].map((t) => frameAt(once, t))).toEqual([0, 1, 2, 2]);
    expect(clipDurationMs(once)).toBe(300);
  });

  it("drops malformed clips but rejects packs missing required clips", () => {
    const raw = readJson(path.join(PUBLIC, "animations/baxter/v3/manifest.json"));
    const broken = structuredClone(raw);
    broken.animations.presenting.frames = [42];
    const { manifest, dropped } = parseSpritePackManifest(broken);
    expect(dropped).toEqual(["presenting"]);
    expect(manifest.animations.presenting).toBeUndefined();

    const missingWalk = structuredClone(raw);
    delete missingWalk.animations.walkLeft;
    expect(() => parseSpritePackManifest(missingWalk)).toThrow(/walkLeft/);
    expect(() => parseSpritePackManifest({ schemaVersion: 2 })).toThrow();
  });

  it("removes clips whose frames failed to load, and gives up only if a required clip broke", () => {
    const m = baxterManifest();
    const thinkingFrame = m.animations.thinking!.frames[1]!;
    const partial = withoutBrokenFrames(m, new Set([thinkingFrame]));
    expect(partial?.animations.thinking).toBeUndefined();
    expect(partial?.animations.idle).toBeDefined();
    expect(withoutBrokenFrames(m, new Set([m.animations.idle!.frames[0]!]))).toBeNull();
  });

  it("Baxter gets his pack by default; admins can assign or remove packs per agent", () => {
    const baxter = { id: "b", kind: "orchestrator" as const };
    const sam = { id: "s", kind: "specialist" as const };
    expect(resolvePackId(baxter, {})).toBe("baxter-v3");
    expect(resolvePackId(sam, {})).toBeNull();
    expect(resolvePackId(sam, { s: { sprite_pack: "baxter-v3" } })).toBe("baxter-v3");
    expect(resolvePackId(baxter, { b: { sprite_pack: "none" } })).toBeNull();
    expect(resolvePackId(sam, { s: { sprite_pack: "does-not-exist" } })).toBeNull();
  });

  it("normalizes stored animation settings (missing column, junk, partial)", () => {
    expect(normalizeAnimationSettings(undefined)).toMatchObject({
      ambient_intensity: "normal",
      speed: "normal",
    });
    expect(normalizeAnimationSettings({ ambient_intensity: "wild" }).ambient_intensity).toBe(
      "normal",
    );
    expect(
      normalizeAnimationSettings({
        ambient_intensity: "low",
        agents: { abc: { handoff_side: "left" } },
      }),
    ).toMatchObject({ ambient_intensity: "low", agents: { abc: { handoff_side: "left" } } });
  });
});

describe.each([
  {
    who: "sam",
    packId: "sam-v1",
    src: "animations/sam_sprite_pack",
    out: "animations/sam/v1",
    think: "peopleThinking",
    task: "hrTask",
  },
  {
    who: "dexter",
    packId: "dexter-v1",
    src: "animations/dexter_sprite_pack",
    out: "animations/dexter/v1",
    think: "dataThinking",
    task: "analyticsTask",
  },
])("$who sprite pack", ({ who, packId, src, out, think, task }) => {
  const source = readJson(path.join(PUBLIC, src, "manifest.json"));
  const { manifest } = parseSpritePackManifest(readJson(path.join(PUBLIC, out, "manifest.json")));

  it("loads from the supplied pack: every source frame exists, untouched", () => {
    expect(source.character).toBe(who);
    const frames = Object.values(source.animations).flatMap(
      (a) => (a as { frames: string[] }).frames,
    );
    expect(frames).toHaveLength(28);
    for (const f of frames) expect(fs.existsSync(path.join(PUBLIC, src, f)), f).toBe(true);
  });

  it("normalized clips mirror the source manifest's names, order, timing, and looping", () => {
    expect(Object.keys(manifest.animations).sort()).toEqual(Object.keys(source.animations).sort());
    for (const [name, clip] of Object.entries(manifest.animations)) {
      const s = source.animations[name];
      expect(clip.frames, name).toHaveLength(s.frames.length);
      expect(clip.loop, name).toBe(s.loop);
      expect(clip.frameDurationMs, name).toBe(s.frameDurationMs);
      for (const url of clip.frames) expect(fs.existsSync(path.join(PUBLIC, url)), url).toBe(true);
    }
    // Sit/stand happen on the floor beside the desk; only the work loop includes the desk.
    expect(manifest.animations.working!.canvas).toBe("desk");
    expect(manifest.animations.sitDown!.canvas).toBe("character");
    expect(manifest.animations.standUp!.canvas).toBe("character");
  });

  it("keeps the pack's Baxter-compatible aliases and role emotes", () => {
    expect(manifest.aliases).toEqual(source.aliases);
    expect(resolveClip(manifest, "thinking")?.name).toBe(think);
    expect(resolveClip(manifest, "presenting")?.name).toBe(task);
    const def = SPRITE_PACKS[packId]!;
    expect(def.emotes.think).toBe(think);
    expect(def.emotes.task).toBe(task);
    expect(def.deskExit).toBe("right");
  });

  it("has an empty-desk prop and desk metrics for when the character is away", () => {
    expect(manifest.deskProp).toBeDefined();
    expect(fs.existsSync(path.join(PUBLIC, manifest.deskProp!))).toBe(true);
    const metrics = deskMetrics(SPRITE_PACKS[packId]!, manifest)!;
    expect(metrics.footprint.w).toBeGreaterThan(100);
    // The stand point is to the right of the desk.
    expect(manifest.canvases.desk.standPoint!.x).toBeGreaterThan(0);
  });

  it("is the default appearance for the agent with that slug", () => {
    expect(resolvePackId({ id: "x", kind: "specialist", slug: who }, {})).toBe(packId);
    expect(
      resolvePackId({ id: "x", kind: "specialist", slug: who }, { x: { sprite_pack: "none" } }),
    ).toBeNull();
  });
});

describe("sprite loader", () => {
  it("warns clearly when frames are missing, and drops only the affected clip", async () => {
    const raw = readJson(path.join(PUBLIC, "animations/sam/v1/manifest.json"));
    raw.animations.hrTask.frames[1] = "/animations/sam/v1/does-not-exist.webp";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(raw), { status: 200 }));
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = "";
      set src(url: string) {
        queueMicrotask(() => (url.includes("does-not-exist") ? this.onerror?.() : this.onload?.()));
      }
      decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Image", FakeImage);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadSpritePack } = await import("@/components/ai/office/sprite-loader");
    const manifest = await loadSpritePack({ ...SPRITE_PACKS["sam-v1"]!, id: "sam-missing-test" });
    expect(manifest.animations.hrTask).toBeUndefined();
    expect(manifest.animations.idle).toBeDefined();
    expect(warn).toHaveBeenCalledWith("[ai-office] sprite frames missing", "sam-missing-test", [
      "/animations/sam/v1/does-not-exist.webp",
    ]);
    vi.unstubAllGlobals();
    warn.mockRestore();
  });
});
