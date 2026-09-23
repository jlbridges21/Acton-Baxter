/**
 * Per-item AI summary from transcripts + inspector notes.
 * Evidence discipline: state only what was said/written — no invented findings.
 */

import "server-only";

import { getEnv } from "@/lib/env";
import { buildOpenAiJsonRequest, extractOpenAiResponsesText } from "@/lib/openai/json-request";

export type SummarizeItemInput = {
  itemTitle: string;
  guideNotes: string | null;
  inspectorNotes: string;
  transcripts: Array<{ mediaId: string; text: string; status: string }>;
};

export type SummarizeItemResult =
  { kind: "complete"; summary: string } | { kind: "failed"; message: string };

const SYSTEM = `You write short field-inspection summaries for Acton ADU site visits.

Rules:
- Use ONLY what appears in the video transcript(s) and the inspector's typed notes.
- Do NOT invent findings, measurements, defects, or recommendations that nobody stated.
- If transcripts say "no speech" / are empty and notes are empty, say that no spoken content or notes were available.
- Ground the summary in the checklist item title (and guide notes for context about what the item is about).
- 2–5 concise sentences. Plain language. No markdown headings.
- Return JSON: { "summary": "..." }`;

/**
 * Generate a read-only AI summary for one checklist item that has video.
 */
export async function summarizeInspectionItem(
  input: SummarizeItemInput,
  options?: { fetchImpl?: typeof fetch },
): Promise<SummarizeItemResult> {
  const env = getEnv();
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    return { kind: "failed", message: "OPENAI_API_KEY is not configured" };
  }

  const model = (env.OPENAI_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const transcriptBlock =
    input.transcripts.length === 0
      ? "(no transcripts)"
      : input.transcripts
          .map((t, i) => {
            if (t.status === "no_speech_detected" || !t.text.trim()) {
              return `Video ${i + 1}: [no speech detected]`;
            }
            if (t.status === "failed") {
              return `Video ${i + 1}: [transcription failed]`;
            }
            return `Video ${i + 1}:\n${t.text.trim()}`;
          })
          .join("\n\n");

  const userPrompt = [
    `Checklist item: ${input.itemTitle}`,
    input.guideNotes?.trim()
      ? `Guide notes (what this item is about):\n${input.guideNotes.trim()}`
      : null,
    `Inspector notes:\n${input.inspectorNotes.trim() || "(none)"}`,
    `Video transcripts:\n${transcriptBlock}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const built = buildOpenAiJsonRequest({
    model,
    maxOutputTokens: 400,
    temperature: 0.2,
    jsonObject: true,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(built.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(built.body),
    });
    const raw = await response.text();
    if (!response.ok) {
      return { kind: "failed", message: `Summary HTTP ${response.status}: ${raw.slice(0, 200)}` };
    }
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      data = null;
    }
    const content =
      (data ? extractOpenAiResponsesText(data) : null) ||
      (typeof (data as { choices?: Array<{ message?: { content?: string } }> } | null)?.choices?.[0]
        ?.message?.content === "string"
        ? (data as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content
        : null);
    if (!content?.trim()) {
      return { kind: "failed", message: "Empty summary response" };
    }
    let summary = content.trim();
    try {
      const parsed = JSON.parse(content) as { summary?: unknown };
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        summary = parsed.summary.trim();
      }
    } catch {
      // plain text fallback
    }
    return { kind: "complete", summary };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
