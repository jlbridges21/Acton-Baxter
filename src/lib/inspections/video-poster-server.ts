/**
 * Server-side video poster extraction via ffmpeg-static.
 * Sidesteps unreliable iOS hidden-<video> decoding.
 */

import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Seek slightly past zero — frame 0 is often black. */
export const POSTER_SEEK_SECONDS = 0.5;

export type PosterExtractResult =
  | { ok: true; bytes: Buffer; mimeType: "image/jpeg"; byteSize: number }
  | { ok: false; message: string };

/**
 * Extract a JPEG poster from a video buffer (~0.5s in, scaled to max 720 edge).
 */
export async function extractPosterFromVideo(input: Buffer): Promise<PosterExtractResult> {
  const ffmpegPath = (await import("ffmpeg-static")).default;
  if (!ffmpegPath) {
    return { ok: false, message: "ffmpeg binary unavailable" };
  }

  const dir = await mkdtemp(join(tmpdir(), "baxter-poster-"));
  const inPath = join(dir, "in.bin");
  const outPath = join(dir, "poster.jpg");
  try {
    await writeFile(inPath, input);
    const stderr = await runFfmpeg(ffmpegPath, [
      "-y",
      "-ss",
      String(POSTER_SEEK_SECONDS),
      "-i",
      inPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      "-vf",
      "scale='min(720,iw)':-2",
      outPath,
    ]);

    let outStat;
    try {
      outStat = await stat(outPath);
    } catch {
      return {
        ok: false,
        message: stderr.slice(-400) || "poster extract produced no output",
      };
    }
    if (outStat.size < 32) {
      return { ok: false, message: "poster extract produced empty file" };
    }
    const bytes = await readFile(outPath);
    return { ok: true, bytes, mimeType: "image/jpeg", byteSize: bytes.byteLength };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-500)}`));
    });
  });
}
