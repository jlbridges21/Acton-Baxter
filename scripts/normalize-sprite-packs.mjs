#!/usr/bin/env node
/**
 * Builds the normalized AI Office sprite frames from the original packs.
 *
 *   node scripts/normalize-sprite-packs.mjs            # every pack
 *   node scripts/normalize-sprite-packs.mjs sam dexter # just these
 *
 * Sources (never modified): public/animations/<character>_sprite_pack/
 * Output:                   public/animations/<character>/<version>/ (WebP + manifest.json)
 *
 * The source frames were cut from AI-generated sheets, so scale, margins, and ground line
 * drift between frames. For each pack this script:
 *   - drops stray specks that bled in from neighbouring sheet cells (small, border-touching),
 *   - character frames: one scale per animation (matched to idle), feet on a shared
 *     baseline, body centred on the paw centroid (using the character's fur colours),
 *   - desk frames: aligned on a prop visible in every desk frame — Baxter's coffee mug, or
 *     the tabletop's right edge for Sam and Dexter (with a small per-frame width correction,
 *     since Dexter's sheet draws the desk at slightly different sizes),
 *   - writes everything onto two fixed canvases so frames swap without jumping,
 *   - for packs whose sit/stand frames have no desk, derives an "empty desk" prop from a work
 *     frame (everything outside the character's silhouette) for when the agent is away.
 *
 * Source manifests' clip names, timings, and aliases are carried over unchanged.
 * `sharp` ships with Next.js, so no extra dependency is needed.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ALPHA_ON = 16;

/** Output pixels per source pixel for the idle frames; everything else is matched to it. */
const BASE_SCALE = 0.36;

const isMugBlue = (r, g, b) => b > 140 && b - r > 80 && b - g > 30;
const isWood = (r, g, b, a) =>
  a > 200 &&
  r >= 150 &&
  g >= 80 &&
  g <= 195 &&
  b >= 30 &&
  b <= 130 &&
  r - b > 70 &&
  g / r > 0.5 &&
  g / r < 0.8;

const PACKS = {
  baxter: {
    src: "public/animations/baxter_sprite_pack",
    out: "public/animations/baxter/v3",
    // orange fur / cream fur
    isBody: (r, g, b) =>
      (r > 140 && g > 50 && g < 150 && b < 70 && r - b > 100) || (r > 215 && g > 180 && b > 140),
    desk: "mug",
    // Character values compare standing height; desk values compare the mug's height.
    clips: {
      idle: { kind: "character", relScale: 1 },
      walkRight: { kind: "character", relScale: 1 },
      walkLeft: { kind: "character", relScale: 1.08 },
      thinking: { kind: "character", relScale: 0.88 },
      presenting: { kind: "character", relScale: 0.97 },
      working: { kind: "desk", relScale: 1 },
      sitDown: { kind: "desk", relScale: 1 },
      standUp: { kind: "desk", relScale: 0.91 },
    },
  },
  sam: {
    src: "public/animations/sam_sprite_pack",
    out: "public/animations/sam/v1",
    // black fur / white fur
    isBody: (r, g, b) =>
      Math.max(r, g, b) < 70 ||
      (Math.min(r, g, b) > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 30),
    desk: "tabletop",
    // Source-pixel rectangles [x, y, w, h] for the "empty desk" prop, from work-03: the plant,
    // closed laptop, pen cup, and desk are kept; Sam's legs under the open desk are cleared.
    emptyDesk: {
      frame: 2,
      keep: [
        [50, 320, 90, 125],
        [120, 378, 185, 70],
        [472, 355, 80, 95],
        [35, 412, 555, 215],
      ],
      clear: [[212, 488, 236, 139]],
    },
    clips: {
      idle: { kind: "character", relScale: 1 },
      walkRight: { kind: "character", relScale: 1 },
      walkLeft: { kind: "character", relScale: 1 },
      sitDown: { kind: "character", relScale: 1 },
      standUp: { kind: "character", relScale: 1 },
      // The emote sheets are drawn closer to the camera than the idle sheet.
      peopleThinking: { kind: "character", relScale: 0.92 },
      hrTask: { kind: "character", relScale: 0.8 },
      working: { kind: "desk", relScale: 1.08 },
    },
  },
  dexter: {
    src: "public/animations/dexter_sprite_pack",
    out: "public/animations/dexter/v1",
    // brown fur / cream fur
    isBody: (r, g, b) =>
      (r > 110 && r - b > 60 && g < 140 && b < 90) || (r > 210 && g > 180 && b > 140),
    desk: "tabletop",
    // From work-01: plant, monitor, mug, and desk (the laptop overlaps Dexter's paws).
    emptyDesk: {
      frame: 0,
      keep: [
        [75, 398, 140, 112],
        [475, 165, 150, 215],
        [566, 362, 18, 58],
        [500, 415, 105, 95],
        [40, 488, 580, 139],
        [40, 455, 205, 35],
        [500, 455, 120, 35],
      ],
      clear: [],
      // Fill the bare desk under the laptop by stretching a clean wood column from beside it:
      // [srcX, srcY, w, h, dstX, dstY].
      patch: Array.from({ length: 258 }, (_, i) => [236, 446, 1, 44, 243 + i, 446]),
    },
    clips: {
      idle: { kind: "character", relScale: 1 },
      walkRight: { kind: "character", relScale: 1 },
      walkLeft: { kind: "character", relScale: 1 },
      sitDown: { kind: "character", relScale: 1 },
      standUp: { kind: "character", relScale: 1 },
      dataThinking: { kind: "character", relScale: 0.95 },
      analyticsTask: { kind: "character", relScale: 0.9 },
      working: { kind: "desk", relScale: 0.95 },
    },
  },
};

async function load(src, file) {
  const { data, info } = await sharp(path.join(ROOT, src, file))
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

/** Ground contact: bottom of the artwork, centred on the paws (lowest 22% of the body). */
function characterAnchor(img, isBody) {
  const { data, width: W } = img;
  const b = bbox(img);
  const bandTop = b.maxY - (b.maxY - b.minY) * 0.22;
  let sx = 0;
  let n = 0;
  for (let y = Math.floor(bandTop); y <= b.maxY; y++)
    for (let x = b.minX; x <= b.maxX; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] > ALPHA_ON && isBody(data[i], data[i + 1], data[i + 2])) {
        sx += x;
        n++;
      }
    }
  return { x: n ? sx / n : (b.minX + b.maxX) / 2, y: b.maxY };
}

/** Desk anchor: the coffee mug on the right-hand side of Baxter's desk. */
function mugAnchor(img) {
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

/** Tabletop: the rows with long runs of wood colour; anchor on its top-right corner. */
function tabletop(img) {
  const { data, width: W, height: H } = img;
  const runs = [];
  for (let y = 0; y < H; y++) {
    let best = 0,
      bestStart = 0,
      cur = 0,
      curStart = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (isWood(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        if (!cur) curStart = x;
        cur++;
        if (cur > best) {
          best = cur;
          bestStart = curStart;
        }
      } else cur = 0;
    }
    runs.push({ y, len: best, start: bestStart });
  }
  const max = Math.max(...runs.map((r) => r.len));
  const rows = runs.filter((r) => r.len > max * 0.7);
  if (!rows.length) throw new Error("tabletop not found");
  return {
    top: rows[0].y,
    right: Math.max(...rows.map((r) => r.start + r.len)),
    width: max,
  };
}

/** In Baxter's sit-down-01 he stands left of the desk: his paws are where the walk ends. */
function standingPawPoint(img, isBody) {
  const { data, width: W } = img;
  const laptopLeft = W * 0.42;
  let maxY = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < laptopLeft; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] > ALPHA_ON && isBody(data[i], data[i + 1], data[i + 2])) maxY = y;
    }
  let sx = 0;
  let n = 0;
  for (let y = maxY - 40; y <= maxY; y++)
    for (let x = 0; x < laptopLeft; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] > ALPHA_ON && isBody(data[i], data[i + 1], data[i + 2])) {
        sx += x;
        n++;
      }
    }
  return { x: sx / n, y: maxY };
}

/** Keeps only the listed source rectangles of a work frame (minus `clear`): the empty desk. */
function emptyDesk(img, keep, clear, patch = []) {
  const { data, width: W, height: H } = img;
  const inAny = (rects, x, y) =>
    rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
  const copy = Buffer.from(data);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inAny(keep, x, y) || inAny(clear, x, y)) copy[(y * W + x) * 4 + 3] = 0;
    }
  for (const [sx, sy, w, h, dx, dy] of patch)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        data.copy(
          copy,
          ((dy + y) * W + dx + x) * 4,
          ((sy + y) * W + sx + x) * 4,
          ((sy + y) * W + sx + x) * 4 + 4,
        );
  return { ...img, data: copy };
}

async function writeFrame(img, scale, anchor, canvas, file) {
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const resized = await sharp(img.data, {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .resize(w, h, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  const left = Math.round(canvas.anchorX - anchor.x * scale);
  const top = Math.round(canvas.anchorY - anchor.y * scale);
  // Crop anything that would fall outside the canvas (sharp composite requires it to fit).
  const cropL = Math.max(0, -left);
  const cropT = Math.max(0, -top);
  const cropW = Math.min(w - cropL, canvas.width - Math.max(0, left));
  const cropH = Math.min(h - cropT, canvas.height - Math.max(0, top));
  const piece = await sharp(resized)
    .extract({ left: cropL, top: cropT, width: cropW, height: cropH })
    .toBuffer();
  const buffer = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: piece, left: Math.max(0, left), top: Math.max(0, top) }])
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toBuffer();
  fs.writeFileSync(file, buffer);
  return buffer.length;
}

async function normalize(character, pack) {
  const SRC = path.join(ROOT, pack.src);
  const OUT = path.join(ROOT, pack.out);
  const PUBLIC_BASE = "/" + path.relative(path.join(ROOT, "public"), OUT);
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  fs.mkdirSync(OUT, { recursive: true });

  // Pass 1: load, clean, measure.
  const frames = [];
  for (const [name, spec] of Object.entries(pack.clips)) {
    const source = manifest.animations[name];
    if (!source) throw new Error(`${character}: manifest is missing ${name}`);
    for (const [index, file] of source.frames.entries()) {
      const img = await load(pack.src, file);
      const specks = dropBorderSpecks(img);
      let scale = BASE_SCALE * spec.relScale;
      let anchor;
      let table = null;
      if (spec.kind === "character") anchor = characterAnchor(img, pack.isBody);
      else if (pack.desk === "mug") anchor = mugAnchor(img);
      else {
        table = tabletop(img);
        anchor = { x: table.right, y: table.top };
      }
      frames.push({
        name,
        index,
        file,
        img,
        specks,
        scale,
        anchor,
        table,
        bbox: bbox(img),
        kind: spec.kind,
      });
    }
  }

  // Desk width correction: frames whose tabletop is fully visible are scaled to the median.
  const tables = frames.filter((f) => f.table);
  if (tables.length) {
    const widest = Math.max(...tables.map((f) => f.table.width));
    const reliable = tables.filter((f) => f.table.width > widest * 0.85).map((f) => f.table.width);
    const ref = reliable.sort((a, b) => a - b)[reliable.length >> 1];
    for (const f of tables) {
      if (f.table.width > widest * 0.85)
        f.scale *= Math.min(1.06, Math.max(0.94, ref / f.table.width));
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
    canvases[kind] = {
      width: kind === "character" ? half * 2 : Math.ceil(right - left) + pad * 2,
      height: Math.ceil(bottom - top) + pad * 2,
      anchorX: kind === "character" ? half : Math.ceil(-left) + pad,
      anchorY: Math.ceil(-top) + pad,
    };
  }

  // Pass 3: render.
  const out = {
    schemaVersion: 1,
    character,
    ...(manifest.role ? { role: manifest.role } : {}),
    packVersion: manifest.packVersion,
    generatedBy: "scripts/normalize-sprite-packs.mjs",
    source: `/${path.relative(path.join(ROOT, "public"), SRC)}/manifest.json`,
    ...(manifest.aliases ? { aliases: manifest.aliases } : {}),
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
    const fileName = `${kebab(f.name)}-${String(f.index + 1).padStart(2, "0")}.webp`;
    totalBytes += await writeFrame(
      f.img,
      f.scale,
      f.anchor,
      canvases[f.kind],
      path.join(OUT, fileName),
    );
    const src = manifest.animations[f.name];
    out.animations[f.name] ??= {
      canvas: f.kind,
      loop: src.loop,
      frameDurationMs: src.frameDurationMs,
      frames: [],
    };
    out.animations[f.name].frames.push(`${PUBLIC_BASE}/${fileName}`);
    if (f.specks) console.log(`  ${character} ${f.file}: removed ${f.specks} stray pixels`);
  }

  if (pack.desk === "mug") {
    // Where (desk-canvas px, relative to the anchor) Baxter stands before sitting down.
    const sit = frames.find((f) => f.name === "sitDown" && f.index === 0);
    const paw = standingPawPoint(sit.img, pack.isBody);
    out.canvases.desk.standPoint = {
      x: Math.round((paw.x - sit.anchor.x) * sit.scale),
      y: Math.round((paw.y - sit.anchor.y) * sit.scale),
    };
  } else {
    // Sit/stand happen on the floor beside the desk; stand just right of the desk, level with
    // the bottom of its legs (the left side is where the chair and props crowd the art).
    const work = frames.find((f) => f.name === "working" && f.index === 0);
    out.canvases.desk.standPoint = {
      x: 70,
      y: Math.round((work.bbox.maxY - work.anchor.y) * work.scale) - 4,
    };
    // Desk metrics in desk-canvas pixels: tabletop centre, floor footprint, seated point.
    const ax = canvases.desk.anchorX;
    const ay = canvases.desk.anchorY;
    const left = ax - work.table.width * work.scale;
    const bottom = ay + (work.bbox.maxY - work.anchor.y) * work.scale;
    out.desk = {
      focus: { x: Math.round((left + ax) / 2), y: ay + 6 },
      footprint: {
        x: Math.round(left + 6),
        y: ay - 4,
        w: Math.round(ax - left - 12),
        h: Math.round(bottom - ay + 4),
      },
      seatedFeet: { x: Math.round((left + ax) / 2 - 6), y: ay + 24 },
    };
    const empty = frames.find((f) => f.name === "working" && f.index === pack.emptyDesk.frame);
    const stripped = emptyDesk(
      empty.img,
      pack.emptyDesk.keep,
      pack.emptyDesk.clear,
      pack.emptyDesk.patch,
    );
    totalBytes += await writeFrame(
      stripped,
      empty.scale,
      empty.anchor,
      canvases.desk,
      path.join(OUT, "desk-empty.webp"),
    );
    out.deskProp = `${PUBLIC_BASE}/desk-empty.webp`;
  }

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(
    `${character}: wrote ${frames.length} frames (${(totalBytes / 1024).toFixed(0)} KB) to ${pack.out}`,
  );
}

function kebab(s) {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

const wanted = process.argv.slice(2);
for (const [character, pack] of Object.entries(PACKS)) {
  if (wanted.length && !wanted.includes(character)) continue;
  await normalize(character, pack);
}
