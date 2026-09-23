/**
 * Extract an audio-only track from a video for Whisper transcription.
 * Keeps payloads under the 25MB transcription upload cap.
 */

import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** OpenAI audio transcriptions multipart upload limit. */
export const WHISPER_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export type AudioExtractResult =
  | { ok: true; bytes: Buffer; mimeType: "audio/mpeg"; byteSize: number }
  | { ok: false; reason: "no_audio_track" | "extract_failed"; message: string };

/**
 * Extract mono MP3 audio from a video container via ffmpeg-static.
 */
export async function extractAudioFromVideo(input: Buffer): Promise<AudioExtractResult> {
  const ffmpegPath = (await import("ffmpeg-static")).default;
  if (!ffmpegPath) {
    return { ok: false, reason: "extract_failed", message: "ffmpeg binary unavailable" };
  }

  const dir = await mkdtemp(join(tmpdir(), "baxter-audio-"));
  const inPath = join(dir, "in.bin");
  const outPath = join(dir, "out.mp3");
  try {
    await writeFile(inPath, input);
    const stderr = await runFfmpeg(ffmpegPath, [
      "-y",
      "-i",
      inPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "5",
      outPath,
    ]);

    let outStat;
    try {
      outStat = await stat(outPath);
    } catch {
      if (/does not contain any stream|no audio|Output file does not contain/i.test(stderr)) {
        return {
          ok: false,
          reason: "no_audio_track",
          message: "Video has no audio track",
        };
      }
      return { ok: false, reason: "extract_failed", message: stderr.slice(-400) || "no output" };
    }

    if (outStat.size < 64) {
      return {
        ok: false,
        reason: "no_audio_track",
        message: "Extracted audio was empty",
      };
    }

    let bytes = await readFile(outPath);
    // If still over Whisper's cap, re-encode more aggressively.
    if (bytes.byteLength > WHISPER_UPLOAD_MAX_BYTES) {
      const smallerPath = join(dir, "out-small.mp3");
      await runFfmpeg(ffmpegPath, [
        "-y",
        "-i",
        inPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "32k",
        smallerPath,
      ]);
      bytes = await readFile(smallerPath);
      if (bytes.byteLength > WHISPER_UPLOAD_MAX_BYTES) {
        return {
          ok: false,
          reason: "extract_failed",
          message: `Audio still exceeds ${WHISPER_UPLOAD_MAX_BYTES} bytes after compression`,
        };
      }
    }

    return {
      ok: true,
      bytes,
      mimeType: "audio/mpeg",
      byteSize: bytes.byteLength,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not contain any stream|no audio/i.test(message)) {
      return { ok: false, reason: "no_audio_track", message };
    }
    return { ok: false, reason: "extract_failed", message };
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
