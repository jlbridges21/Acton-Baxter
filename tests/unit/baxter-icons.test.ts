import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const PNGS = [
  { file: "public/icons/baxter-16.png", size: 16 },
  { file: "public/icons/baxter-32.png", size: 32 },
  { file: "public/icons/baxter-apple-touch.png", size: 180 },
  { file: "public/icons/baxter-192.png", size: 192 },
  { file: "public/icons/baxter-512.png", size: 512 },
  { file: "public/icons/baxter-maskable-512.png", size: 512 },
  { file: "src/app/icon1.png", size: 16 },
  { file: "src/app/icon2.png", size: 32 },
  { file: "src/app/apple-icon.png", size: 180 },
] as const;

describe("Baxter icons", () => {
  it("ships small static variants instead of the 1MB avatar", async () => {
    const source = readFileSync(path.join(root, "public/baxter/avatar.png"));
    expect(source.length).toBeGreaterThan(500_000);

    for (const icon of PNGS) {
      const bytes = readFileSync(path.join(root, icon.file));
      expect(bytes.length).toBeLessThan(80_000);
      const meta = await sharp(bytes).metadata();
      expect(meta.width).toBe(icon.size);
      expect(meta.height).toBe(icon.size);
      expect(meta.format).toBe("png");
    }

    const ico = readFileSync(path.join(root, "src/app/favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[7]).toBe(16);
    expect(ico[22]).toBe(32);
    expect(ico[23]).toBe(32);
    expect(ico.length).toBeLessThan(10_000);
  });

  it("flattens the Apple icon and keeps maskable artwork inside the safe circle", async () => {
    for (const file of ["public/icons/baxter-apple-touch.png", "src/app/apple-icon.png"]) {
      const { data, info } = await sharp(path.join(root, file))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(180);
      let transparent = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) transparent += 1;
      }
      expect(transparent).toBe(0);
    }

    const { data, info } = await sharp(path.join(root, "public/icons/baxter-maskable-512.png"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const radius = info.width * 0.4;
    const cx = (info.width - 1) / 2;
    const cy = (info.height - 1) / 2;
    let outside = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const a = data[i + 3] ?? 0;
        const background = a === 255 && r === 0xf5 && g === 0xf7 && b === 0xfa;
        if (background) continue;
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > radius * radius) outside += 1;
      }
    }
    expect(outside).toBe(0);
  });
});
