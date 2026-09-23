/**
 * OpenAI Whisper transcription for site-inspection videos.
 */

import "server-only";

import { getEnv } from "@/lib/env";
import type { TranscriptSegment } from "../record-types";

export type TranscribeResult =
  | {
      kind: "complete";
      text: string;
      segments: TranscriptSegment[];
    }
  | { kind: "no_speech_detected"; message: string }
  | { kind: "failed"; message: string };

/**
 * Transcribe an audio Buffer via OpenAI audio/transcriptions (verbose_json + segments).
 */
export async function transcribeAudioBuffer(input: {
  bytes: Buffer;
  filename?: string;
  mimeType?: string;
  fetchImpl?: typeof fetch;
}): Promise<TranscribeResult> {
  const env = getEnv();
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    return { kind: "failed", message: "OPENAI_API_KEY is not configured" };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  const blob = new Blob([new Uint8Array(input.bytes)], {
    type: input.mimeType ?? "audio/mpeg",
  });
  form.append("file", blob, input.filename ?? "audio.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  try {
    const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        kind: "failed",
        message: `Whisper HTTP ${response.status}: ${text.slice(0, 240)}`,
      };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { kind: "failed", message: "Whisper returned non-JSON" };
    }

    const fullText = typeof data.text === "string" ? data.text.trim() : "";
    const segments = parseSegments(data.segments);

    if (!fullText && segments.every((s) => !s.text.trim())) {
      return {
        kind: "no_speech_detected",
        message: "No speech detected in the audio",
      };
    }

    return {
      kind: "complete",
      text:
        fullText ||
        segments
          .map((s) => s.text)
          .join(" ")
          .trim(),
      segments,
    };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseSegments(raw: unknown): TranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: TranscriptSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const start = typeof row.start === "number" ? row.start : Number(row.start);
    const end = typeof row.end === "number" ? row.end : Number(row.end);
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({ start, end, text });
  }
  return out;
}
