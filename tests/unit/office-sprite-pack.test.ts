import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIP_NAMES,
  SPRITE_PACKS,
  allFrameUrls,
  clipDurationMs,
  frameAt,
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
