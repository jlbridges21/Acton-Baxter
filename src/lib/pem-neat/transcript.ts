import { MIN_TRANSCRIPT_CHARS } from "./constants";

/** Soft character budget for a single-pass completion (leaves room for output). */
const SINGLE_PASS_CHAR_BUDGET = 90_000;
const HEAD_CHARS = 36_000;
const TAIL_CHARS = 36_000;

export function stage0ValidateTranscript(transcript: string): {
  ok: boolean;
  notes: string[];
  error?: string;
} {
  const trimmed = transcript.trim();
  const compact = trimmed.replace(/\s+/g, " ");
  const notes: string[] = [];

  if (compact.length < MIN_TRANSCRIPT_CHARS) {
    return {
      ok: false,
      notes,
      error:
        "Transcript appears too short for a Partnership Evaluation Meeting. Paste the full meeting transcript.",
    };
  }

  const hasSpeakerHints =
    /^(speaker|advisor|salesperson|prospect|homeowner|customer|jesse|client)\b/im.test(trimmed) ||
    /:\s/.test(trimmed.slice(0, 2000));
  if (!hasSpeakerHints) {
    notes.push("Speaker labels are unclear or missing; attribution confidence will be limited.");
  }

  const hasTimestamps = /\b\d{1,2}:\d{2}(:\d{2})?\b/.test(trimmed);
  if (!hasTimestamps) {
    notes.push("Timestamps not detected; do not invent timestamps in assessment.");
  }

  const looksCorrupted = (trimmed.match(/\uFFFD/g) ?? []).length > 20;
  if (looksCorrupted) {
    notes.push("Transcript may contain encoding corruption.");
  }

  const pemHints =
    /\b(budget|schedule|decision|adu|partner|builder|pain|why|next step|agenda|purpose)\b/i.test(
      trimmed,
    );
  if (!pemHints) {
    notes.push(
      "Content may not clearly resemble a Partnership Evaluation Meeting; analyze cautiously.",
    );
  }

  return { ok: true, notes };
}

export function prepareTranscriptForModel(transcript: string): {
  text: string;
  strategy: "full" | "head_tail_preserved";
  notes: string[];
} {
  if (transcript.length <= SINGLE_PASS_CHAR_BUDGET) {
    return { text: transcript, strategy: "full", notes: [] };
  }

  const head = transcript.slice(0, HEAD_CHARS);
  const tail = transcript.slice(-TAIL_CHARS);
  const omitted = transcript.length - HEAD_CHARS - TAIL_CHARS;
  const bridge = `\n\n[BAXTER_TRANSCRIPT_NOTE: Middle section of ${omitted} characters omitted for model context limits. Beginning and end preserved because Outcome and Post-Sell often occur at the end. Do not invent middle content. Mark incomplete sections NOT_DETERMINABLE when needed.]\n\n`;

  return {
    text: `${head}${bridge}${tail}`,
    strategy: "head_tail_preserved",
    notes: [
      `Transcript exceeded single-pass budget (${transcript.length} chars). Beginning and end preserved; middle omitted for model context only. Full original transcript remains stored.`,
    ],
  };
}
