"use client";

/**
 * Collapsed-by-default transcript under a video thumbnail.
 * Timestamp taps seek the gallery player.
 */

import { useState } from "react";
import type { SiteInspectionMedia, TranscriptSegment } from "@/lib/inspections/record-types";

function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function InspectionVideoTranscript({
  media,
  onSeek,
}: {
  media: SiteInspectionMedia;
  onSeek: (seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);

  if (media.mediaType !== "video") return null;

  const status = media.transcriptStatus;
  if (!status) return null;

  const segments: TranscriptSegment[] = media.transcriptSegments ?? [];
  const label =
    status === "complete"
      ? "Transcript"
      : status === "no_speech_detected"
        ? "No speech detected"
        : status === "failed"
          ? "Transcription failed"
          : status === "processing"
            ? "Transcribing…"
            : "Transcript pending";

  return (
    <div className="mt-1 w-28 sm:w-32">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-1 rounded border border-[var(--acton-border)] bg-white px-1.5 py-1 text-left text-[10px] font-semibold text-[var(--acton-navy)]"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{label}</span>
        <span aria-hidden className="text-[var(--acton-muted)]">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="mt-1 max-h-40 overflow-y-auto rounded border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-1.5 text-[11px] leading-snug text-[var(--acton-navy)]">
          {status === "no_speech_detected" ? (
            <p className="text-[var(--acton-muted)]">No speech detected in this video.</p>
          ) : status === "failed" ? (
            <p className="text-red-700">{media.transcriptError ?? "Transcription failed"}</p>
          ) : status === "processing" || status === "pending" ? (
            <p className="text-[var(--acton-muted)]">Waiting for transcription…</p>
          ) : segments.length ? (
            <ul className="space-y-1.5">
              {segments.map((seg, i) => (
                <li key={`${seg.start}-${i}`}>
                  <button
                    type="button"
                    className="mr-1 font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                    onClick={() => onSeek(seg.start)}
                  >
                    {formatSeconds(seg.start)}
                  </button>
                  <span>{seg.text}</span>
                </li>
              ))}
            </ul>
          ) : media.transcriptText?.trim() ? (
            <p className="whitespace-pre-wrap">{media.transcriptText}</p>
          ) : (
            <p className="text-[var(--acton-muted)]">Empty transcript</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
