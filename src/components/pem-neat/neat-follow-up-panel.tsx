"use client";

import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/pem-neat/copy-button";
import { SectionHeading } from "@/components/pem-neat/section-heading";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";

export function NeatFollowUpPanel({
  followUpEmail,
}: {
  followUpEmail: PemNeatStructuredResult["followUpEmail"];
}) {
  const emailCopyText = [
    followUpEmail.subject ? `Subject: ${followUpEmail.subject}` : "Subject:",
    "",
    followUpEmail.body,
  ].join("\n");

  return (
    <Card className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeading>Customer Follow-Up</SectionHeading>
        <CopyButton getText={() => emailCopyText} label="Copy Email" copiedLabel="Copied" />
      </div>

      {followUpEmail.subject ? (
        <p className="text-sm">
          <span className="font-semibold text-[var(--acton-navy)]">Subject:</span>{" "}
          <span className="text-[var(--acton-navy)]">{followUpEmail.subject}</span>
        </p>
      ) : null}

      <div className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-4">
        <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap text-[var(--acton-navy)]">
          {followUpEmail.body}
        </pre>
      </div>
    </Card>
  );
}
