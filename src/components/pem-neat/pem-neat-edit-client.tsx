"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MIN_TRANSCRIPT_CHARS } from "@/lib/pem-neat/constants";
import type { SalespersonOption } from "@/lib/pem-neat/salespeople";
import type { PemNeatRecord } from "@/lib/pem-neat/types";

export function PemNeatEditClient({
  item,
  salespeople,
}: {
  item: PemNeatRecord;
  salespeople: SalespersonOption[];
}) {
  const router = useRouter();
  const [prospectName, setProspectName] = useState(item.prospect_name);
  const [salespersonUserId, setSalespersonUserId] = useState(
    item.salesperson_user_id ?? salespeople[0]?.id ?? "",
  );
  const [meetingDate, setMeetingDate] = useState(item.meeting_date ?? "");
  const [transcript, setTranscript] = useState(item.transcript);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState<"transcript" | "saved" | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedBanner(null);

    const compact = transcript.replace(/\s+/g, " ").trim();
    if (!prospectName.trim()) {
      setError("Prospect name is required.");
      return;
    }
    if (!salespersonUserId) {
      setError("Select a salesperson.");
      return;
    }
    if (compact.length < MIN_TRANSCRIPT_CHARS) {
      setError(
        "Transcript appears too short for a Partnership Evaluation Meeting. Paste the full meeting transcript.",
      );
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/pem-neats/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospectName: prospectName.trim(),
          salespersonUserId,
          meetingDate: meetingDate || null,
          transcript,
        }),
      });
      const data = (await response.json()) as {
        transcriptChanged?: boolean;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to save changes.");
      }
      if (data.transcriptChanged) {
        setSavedBanner("transcript");
      } else {
        setSavedBanner("saved");
        router.push(`/pem-neats/${item.id}`);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function onRegenerateNow() {
    setRegenerating(true);
    setError(null);
    try {
      const response = await fetch(`/api/pem-neats/${item.id}/generate`, { method: "POST" });
      const data = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(data.error?.message ?? "Regeneration failed");
      }
      router.push(`/pem-neats/${item.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed");
      setRegenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/pem-neats/${item.id}`}
          className="text-sm font-medium text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          ← Back to NEAT
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">Edit PEM NEAT</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Update source metadata or transcript. Changing the transcript marks the current analysis
          for regeneration.
        </p>
      </div>

      {savedBanner === "transcript" ? (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm font-semibold text-amber-900">Transcript updated</p>
          <p className="mt-1 text-sm text-amber-800">
            Regenerate the NEAT to analyze the new transcript. The previous successful generation
            remains in history.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={onRegenerateNow} disabled={regenerating}>
              {regenerating ? "Regenerating…" : "Regenerate Now"}
            </Button>
            <Link
              href={`/pem-neats/${item.id}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              Later
            </Link>
          </div>
        </Card>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <Card>
        <form onSubmit={onSave} className="space-y-5">
          <div>
            <label
              htmlFor="edit-prospect-name"
              className="block text-sm font-medium text-[var(--acton-navy)]"
            >
              Prospect Name
            </label>
            <input
              id="edit-prospect-name"
              value={prospectName}
              onChange={(e) => setProspectName(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-[var(--acton-border)] px-3 text-sm"
              required
              disabled={saving || regenerating || savedBanner === "transcript"}
            />
          </div>

          <div>
            <label
              htmlFor="edit-salesperson"
              className="block text-sm font-medium text-[var(--acton-navy)]"
            >
              Salesperson
            </label>
            <select
              id="edit-salesperson"
              value={salespersonUserId}
              onChange={(e) => setSalespersonUserId(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-[var(--acton-border)] px-3 text-sm"
              required
              disabled={saving || regenerating || savedBanner === "transcript"}
            >
              {salespeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="edit-meeting-date"
              className="block text-sm font-medium text-[var(--acton-navy)]"
            >
              Meeting Date
            </label>
            <input
              id="edit-meeting-date"
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-[var(--acton-border)] px-3 text-sm"
              disabled={saving || regenerating || savedBanner === "transcript"}
            />
          </div>

          <div>
            <label
              htmlFor="edit-transcript"
              className="block text-sm font-medium text-[var(--acton-navy)]"
            >
              Transcript
            </label>
            <textarea
              id="edit-transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={18}
              className="mt-1 w-full rounded-md border border-[var(--acton-border)] px-3 py-2 font-mono text-sm"
              disabled={saving || regenerating || savedBanner === "transcript"}
              required
            />
          </div>

          {savedBanner !== "transcript" ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/pem-neats/${item.id}`}
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                Cancel
              </Link>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
