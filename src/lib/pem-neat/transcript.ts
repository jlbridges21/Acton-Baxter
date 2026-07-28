/**
 * Chunk long PEM transcripts so beginning, middle, and end are all analyzed.
 * Never head+tail-only.
 */
export function stage0ValidateTranscript(transcript: string): {
  ok: boolean;
  notes: string[];
  error?: string;
} {
  const trimmed = transcript.trim();
  const compact = trimmed.replace(/\s+/g, " ");
  const notes: string[] = [];

  if (compact.length < 200) {
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

export type TranscriptChunk = {
  index: number;
  total: number;
  label: "beginning" | "middle" | "end" | "full";
  text: string;
};

const CHUNK_TARGET_CHARS = 28_000;

/**
 * Split transcript into overlapping paragraph-aware chunks covering start→end.
 */
export function chunkTranscript(transcript: string): TranscriptChunk[] {
  if (transcript.length <= CHUNK_TARGET_CHARS) {
    return [{ index: 0, total: 1, label: "full", text: transcript }];
  }

  const paragraphs = transcript.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (!current) {
      current = para;
      continue;
    }
    if (current.length + para.length + 2 <= CHUNK_TARGET_CHARS) {
      current = `${current}\n\n${para}`;
    } else {
      chunks.push(current);
      // overlap: keep last ~2k of previous chunk
      const overlap = current.slice(-2_000);
      current = `${overlap}\n\n${para}`;
    }
  }
  if (current) chunks.push(current);

  if (chunks.length === 0) {
    return [{ index: 0, total: 1, label: "full", text: transcript }];
  }

  return chunks.map((text, index) => {
    let label: TranscriptChunk["label"] = "middle";
    if (index === 0) label = "beginning";
    else if (index === chunks.length - 1) label = "end";
    return { index, total: chunks.length, label, text };
  });
}

/** @deprecated Prefer chunkTranscript — kept for callers expecting prepare API. */
export function prepareTranscriptForModel(transcript: string): {
  text: string;
  strategy: "full" | "chunked";
  notes: string[];
  chunks: TranscriptChunk[];
} {
  const chunks = chunkTranscript(transcript);
  if (chunks.length === 1) {
    return { text: transcript, strategy: "full", notes: [], chunks };
  }
  return {
    text: transcript,
    strategy: "chunked",
    notes: [
      `Transcript split into ${chunks.length} overlapping chunks covering beginning, middle, and end.`,
    ],
    chunks,
  };
}
