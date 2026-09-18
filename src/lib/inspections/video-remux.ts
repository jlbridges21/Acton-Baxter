/**
 * Remux QuickTime (.mov) → MP4 (isom) without re-encoding.
 *
 * iPhone H.264 often lands in a classic QuickTime `qt  ` brand container that
 * Safari plays but Chrome on desktop refuses (grey player, 0:00, disabled play).
 * Stream-copy remux keeps quality and fixes Chrome.
 */

import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function looksLikeQuickTimeContainer(input: {
  storagePath?: string | null;
  mimeType?: string | null;
}): boolean {
  const path = (input.storagePath ?? "").toLowerCase();
  const mime = (input.mimeType ?? "").toLowerCase();
  return path.endsWith(".mov") || mime.includes("quicktime");
}

export async function remuxQuickTimeToMp4(input: Buffer): Promise<Buffer> {
  const ffmpegPath = (await import("ffmpeg-static")).default;
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary unavailable");
  }

  const dir = await mkdtemp(join(tmpdir(), "baxter-remux-"));
  const inPath = join(dir, "in.mov");
  const outPath = join(dir, "out.mp4");
  try {
    await writeFile(inPath, input);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        ffmpegPath,
        ["-y", "-i", inPath, "-c", "copy", "-movflags", "+faststart", "-f", "mp4", outPath],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg remux failed (code ${code}): ${stderr.slice(-500)}`));
      });
    });
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Companion poster path for a video object: `…/id.mov` → `…/id.poster.jpg`. */
export function posterStoragePathForVideo(videoStoragePath: string): string {
  const trimmed = videoStoragePath.trim();
  const dot = trimmed.lastIndexOf(".");
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${base}.poster.jpg`;
}
