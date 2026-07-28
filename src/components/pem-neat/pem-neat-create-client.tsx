"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MIN_TRANSCRIPT_CHARS } from "@/lib/pem-neat/constants";
import type { SalespersonOption } from "@/lib/pem-neat/salespeople";

export function PemNeatCreateClient({
  salespeople,
  defaultSalespersonId,
}: {
  salespeople: SalespersonOption[];
  defaultSalespersonId?: string;
}) {
  const router = useRouter();
  const [prospectName, setProspectName] = useState("");
  const [salespersonUserId, setSalespersonUserId] = useState(
    defaultSalespersonId && salespeople.some((s) => s.id === defaultSalespersonId)
      ? defaultSalespersonId
      : (salespeople[0]?.id ?? ""),
  );
  const [meetingDate, setMeetingDate] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

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

    setSubmitting(true);
    try {
      const response = await fetch("/api/pem-neats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospectName: prospectName.trim(),
          salespersonUserId,
          meetingDate: meetingDate || null,
          transcript,
        }),
      });
      const data = (await response.json()) as {
        id?: string;
        status?: string;
        message?: string;
        error?: { message?: string };
      };

      if (data.id) {
        router.push(`/pem-neats/${data.id}`);
        router.refresh();
        return;
      }

      if (!response.ok) {
        throw new Error(
          data.error?.message ??
            "We couldn't save your PEM NEAT. Check your connection and try again.",
        );
      }

      throw new Error(
        "Your transcript may have been saved, but we couldn't open the result page. Try again or check the library.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/pem-neats"
          className="text-sm font-medium text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          ← Back to library
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">New PEM NEAT</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Paste the Partnership Evaluation Meeting transcript. Baxter will generate structured sales
          intelligence — not a generic summary.
        </p>
      </div>

      <Card>
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="prospect-name"
              className="block text-sm font-medium text-[var(--acton-navy)]"
            >
              Prospect Name
            </label>
            <input
              id="prospect-name"
              value={prospectName}
              onChange={(e) => setProspectName(e.target.value)}
              placeholder="Betsy Smith"
              disabled={submitting}
              className="mt-1 h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)]"
              required
            />
          </div>

          <div>
            <label
              htmlFor="salesperson"
              className="block text-sm font-medium text-[var(--acton-navy)]"
            >
              Salesperson
            </label>
            <select
              id="salesperson"
              value={salespersonUserId}
              onChange={(e) => setSalespersonUserId(e.target.value)}
              disabled={submitting || salespeople.length === 0}
              className="mt-1 h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)]"
              required
            >
              {salespeople.length === 0 ? (
                <option value="">No Baxter users available</option>
              ) : (
                salespeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label
              htmlFor="meeting-date"
              className="block text-sm font-medium text-[var(--acton-navy)]"
            >
              Meeting Date <span className="font-normal text-[var(--acton-muted)]">(optional)</span>
            </label>
            <input
              id="meeting-date"
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              disabled={submitting}
              className="mt-1 h-10 w-full max-w-xs rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)]"
            />
          </div>

          <div>
            <label
              htmlFor="transcript"
              className="block text-sm font-medium text-[var(--acton-navy)]"
            >
              Partnership Evaluation Meeting Transcript
            </label>
            <textarea
              id="transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              disabled={submitting}
              rows={18}
              placeholder="Paste the full PEM transcript here…"
              className="mt-1 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)]"
              required
            />
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              Minimum ~{MIN_TRANSCRIPT_CHARS} characters. The transcript is the source of truth and
              is stored exactly as pasted.
            </p>
          </div>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          {submitting ? (
            <div className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-4 py-3">
              <p className="font-medium text-[var(--acton-navy)]">
                Analyzing Partnership Evaluation Meeting…
              </p>
              <p className="mt-1 text-sm text-[var(--acton-muted)]">
                Extracting customer intelligence and evaluating the Acton sales process.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={submitting || salespeople.length === 0}>
              {submitting ? "Generating…" : "Generate PEM NEAT"}
            </Button>
            <Link
              href="/pem-neats"
              className={cn(
                buttonVariants({ variant: "secondary" }),
                submitting && "pointer-events-none opacity-50",
              )}
            >
              Cancel
            </Link>
          </div>
        </form>
      </Card>

      {salespeople.length === 0 ? (
        <Card>
          <CardTitle>No salespeople found</CardTitle>
          <CardDescription>
            Baxter users are required for the salesperson selector. Ask an admin to ensure user
            profiles exist.
          </CardDescription>
        </Card>
      ) : null}
    </div>
  );
}
