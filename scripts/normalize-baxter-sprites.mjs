#!/usr/bin/env node
/**
 * Builds the normalized Baxter V3 frames used by the AI Office from the original pack.
 *
 *   node scripts/normalize-baxter-sprites.mjs
 *
 * Source (never modified): public/animations/baxter_sprite_pack/
 * Output:                  public/animations/baxter/v3/  (WebP frames + manifest.json)
 *
 * The source frames were cut from AI-generated sheets, so scale, margins, and ground line
 * drift between frames. This script:
 *   - drops stray specks that bled in from neighbouring sheet cells (small, border-touching),
 *   - character frames: one scale per animation (matched to idle), feet on a shared
 *     baseline, body centred on the paw centroid,
 *   - desk frames: one scale per animation (matched by the mug's height), aligned on the
 *     coffee mug, which is the only prop visible in every desk frame,
 *   - writes everything onto two fixed canvases so frames swap without jumping.
 *
 * `sharp` ships with Next.js, so no extra dependency is needed.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "public/animations/baxter_sprite_pack");
const OUT = path.join(ROOT, "public/animations/baxter/v3");
const PUBLIC_BASE = "/animations/baxter/v3";

/** Output pixels per source pixel for the idle frames; everything else is matched to it. */
const BASE_SCALE = 0.36;

/**
 * Per-animation scale relative to idle. Character values compare the cat's standing height;
 * desk values compare the coffee mug's height (work: 62px, sit-down: 62px, stand-up: 68px).
 */
const ANIMATIONS = {
  idle: { kind: "character", relScale: 1 },
  walkRight: { kind: "character", relScale: 1 },
  walkLeft: { kind: "character", relScale: 1.08 },
  thinking: { kind: "character", relScale: 0.88 },
  presenting: { kind: "character", relScale: 0.97 },
  working: { kind: "desk", relScale: 1 },
  sitDown: { kind: "desk", relScale: 1 },
  standUp: { kind: "desk", relScale: 0.91 },
};

const ALPHA_ON = 16;

const isCat = (r, g, b) =>
  // orange fur / cream fur
  (r > 140 && g > 50 && g < 150 && b < 70 && r - b > 100) || (r > 215 && g > 180 && b > 140);
const isMugBlue = (r, g, b) => b > 140 && b - r > 80 && b - g > 30;

async function load(file) {
  const { data, info } = await sharp(path.join(SRC, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Removes small opaque islands at the frame border (sheet-cell bleed). */
function dropBorderSpecks(img) {
  const { data, width: W, height: H } = img;
  const label = new Int32Array(W * H).fill(-1);
  const comps = [];
  let total = 0;
  for (let start = 0; start < W * H; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] <= ALPHA_ON) continue;
    const id = comps.length;
    const stack = [start];
    label[start] = id;
    const pixels = [];
    let touches = false;
    while (stack.length) {
      const p = stack.pop();
      pixels.push(p);
      const x = p % W;
      const y = (p / W) | 0;
      const m = 14; // "near the border" margin, in source pixels
      if (x < m || y < m || x >= W - m || y >= H - m) touches = true;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (label[q] !== -1 || data[q * 4 + 3] <= ALPHA_ON) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    total += pixels.length;
    comps.push({ pixels, touches });
  }
  let removed = 0;
  for (const c of comps) {
    if (c.touches && c.pixels.length < total * 0.02) {
      for (const p of c.pixels) data[p * 4 + 3] = 0;
      removed += c.pixels.length;
    }
  }
  return removed;
}

function bbox(img) {
  const { data, width: W, height: H } = img;
  let minX = W,
    minY = H,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * 4 + 3] > ALPHA_ON) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return { minX, minY, maxX, maxY };
}

/** Ground contact: bottom of the artwork, centred on the cat's paws (lowest 22% of the body). */
function characterAnchor(img) {
  const { data, width: W } = img;
  const b = bbox(img);
  const bandTop = b.maxY - (b.maxY - b.minY) * 0.22;
  let sx = 0;
  let n = 0;
  for (let y = Math.floor(bandTop); y <= b.maxY; y++)
    for (let x = b.minX; x <= b.maxX; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] > ALPHA_ON && isCat(data[i], data[i + 1], data[i + 2])) {
        sx += x;
        n++;
      }
    }
  return { x: n ? sx / n : (b.minX + b.maxX) / 2, y: b.maxY };
}

/** Desk anchor: the coffee mug on the right-hand side of the desk. */
function deskAnchor(img) {
  const { data, width: W, height: H } = img;
  const xs = [];
  const ys = [];
  for (let y = Math.floor(H * 0.53); y < H; y++)
    for (let x = Math.floor(W * 0.6); x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] > 200 && isMugBlue(data[i], data[i + 1], data[i + 2])) {
        xs.push(x);
        ys.push(y);
      }
    }
  if (xs.length < 200) throw new Error("mug not found");
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  // Top edge of the mug (5th percentile) is not affected by the frame clipping its right side.
  return { x: med(xs), y: ys.sort((p, q) => p - q)[Math.floor(ys.length * 0.05)] };
}

/** In sit-down-01 Baxter stands left of the desk: his paws are where the walk ends. */
function standingPawPoint(img) {
  const { data, width: W } = img;
  const laptopLeft = W * 0.42;
  let maxY = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < laptopLeft; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] > ALPHA_ON && isCat(data[i], data[i + 1], data[i + 2])) maxY = y;
    }
  let sx = 0;
  let n = 0;
  for (let y = maxY - 40; y <= maxY; y++)
    for (let x = 0; x < laptopLeft; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] > ALPHA_ON && isCat(data[i], data[i + 1], data[i + 2])) {
        sx += x;
        n++;
      }
    }
  return { x: sx / n, y: maxY };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  fs.mkdirSync(OUT, { recursive: true });

  // Pass 1: load, clean, measure.
  const frames = [];
  for (const [name, spec] of Object.entries(ANIMATIONS)) {
    const source = manifest.animations[name];
    if (!source) throw new Error(`manifest is missing ${name}`);
    for (const [index, file] of source.frames.entries()) {
      const img = await load(file);
      const specks = dropBorderSpecks(img);
      const scale = BASE_SCALE * spec.relScale;
      const anchor = spec.kind === "desk" ? deskAnchor(img) : characterAnchor(img);
      const b = bbox(img);
      frames.push({ name, index, file, img, specks, scale, anchor, bbox: b, kind: spec.kind });
    }
  }

  // Pass 2: fit each family on one canvas (union of scaled boxes relative to the anchor).
  const canvases = {};
  for (const kind of ["character", "desk"]) {
    const family = frames.filter((f) => f.kind === kind);
    let left = 0,
      right = 0,
      top = 0,
      bottom = 0;
    for (const f of family) {
      left = Math.min(left, (f.bbox.minX - f.anchor.x) * f.scale);
      right = Math.max(right, (f.bbox.maxX + 1 - f.anchor.x) * f.scale);
      top = Math.min(top, (f.bbox.minY - f.anchor.y) * f.scale);
      bottom = Math.max(bottom, (f.bbox.maxY + 1 - f.anchor.y) * f.scale);
    }
    const pad = 4;
    // Characters keep the anchor horizontally centred so the sprite pivots on its feet.
    const half = Math.ceil(Math.max(-left, right)) + pad;
    const anchorX = kind === "character" ? half : Math.ceil(-left) + pad;
    canvases[kind] = {
      width: kind === "character" ? half * 2 : Math.ceil(right - left) + pad * 2,
      height: Math.ceil(bottom - top) + pad * 2,
      anchorX,
      anchorY: Math.ceil(-top) + pad,
    };
  }

  // Pass 3: render.
  const out = {
    schemaVersion: 1,
    character: "baxter",
    packVersion: manifest.packVersion,
    generatedBy: "scripts/normalize-baxter-sprites.mjs",
    source: "/animations/baxter_sprite_pack/manifest.json",
    canvases: {},
    animations: {},
  };
  for (const [kind, c] of Object.entries(canvases)) {
    out.canvases[kind] = {
      width: c.width,
      height: c.height,
      anchor: { x: c.anchorX, y: c.anchorY },
    };
  }
  let totalBytes = 0;
  for (const f of frames) {
    const c = canvases[f.kind];
    const w = Math.round(f.img.width * f.scale);
    const h = Math.round(f.img.height * f.scale);
    const resized = await sharp(f.img.data, {
      raw: { width: f.img.width, height: f.img.height, channels: 4 },
    })
      .resize(w, h, { kernel: "lanczos3" })
      .png()
      .toBuffer();
    const left = Math.round(c.anchorX - f.anchor.x * f.scale);
    const top = Math.round(c.anchorY - f.anchor.y * f.scale);
    // Crop anything that would fall outside the canvas (sharp composite requires it to fit).
    const cropL = Math.max(0, -left);
    const cropT = Math.max(0, -top);
    const cropW = Math.min(w - cropL, c.width - Math.max(0, left));
    const cropH = Math.min(h - cropT, c.height - Math.max(0, top));
    const piece = await sharp(resized)
      .extract({ left: cropL, top: cropT, width: cropW, height: cropH })
      .toBuffer();
    const fileName = `${kebab(f.name)}-${String(f.index + 1).padStart(2, "0")}.webp`;
    const buffer = await sharp({
      create: {
        width: c.width,
        height: c.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: piece, left: Math.max(0, left), top: Math.max(0, top) }])
      .webp({ quality: 88, alphaQuality: 100, effort: 6 })
      .toBuffer();
    fs.writeFileSync(path.join(OUT, fileName), buffer);
    totalBytes += buffer.length;
    const src = manifest.animations[f.name];
    out.animations[f.name] ??= {
      canvas: f.kind,
      loop: src.loop,
      frameDurationMs: src.frameDurationMs,
      frames: [],
    };
    out.animations[f.name].frames.push(`${PUBLIC_BASE}/${fileName}`);
    if (f.specks) console.log(`  ${f.file}: removed ${f.specks} stray pixels`);
  }

  // Where (in desk-canvas pixels, relative to the anchor) Baxter stands before sitting down.
  const sit = frames.find((f) => f.name === "sitDown" && f.index === 0);
  const paw = standingPawPoint(sit.img);
  out.canvases.desk.standPoint = {
    x: Math.round((paw.x - sit.anchor.x) * sit.scale),
    y: Math.round((paw.y - sit.anchor.y) * sit.scale),
  };

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote ${frames.length} frames (${(totalBytes / 1024).toFixed(0)} KB) to ${path.relative(ROOT, OUT)}`,
  );
  console.log(JSON.stringify(out.canvases, null, 2));
}

function kebab(s) {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
