"use client";

/** /reports/new — describe a report to Dexter; it opens as soon as Dexter saves it. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DexterChat } from "./dexter-chat";

const SUGGESTIONS = [
  "Show active projects by phase and project manager, with a table I can filter",
  "Build a design handoff view for one project: model, site conditions, utilities, milestones, and documents",
  "Compare the ADU models in the Product Library by base price and margin",
  "How many active projects are in permitting, and which ones?",
  "What data do you have access to?",
];

export function CreateWithDexter({
  canChat,
  dexterAvatarUrl,
  initialPrompt = "",
}: {
  initialPrompt?: string;
  canChat: boolean;
  dexterAvatarUrl: string | null;
}) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/reports"
        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Reports
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Create with Dexter</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Describe what you want to see. Dexter builds the report from JobTread data, tells you when
          a field isn&apos;t available, and saves it as a private report you can edit or share.
        </p>
      </div>
      <DexterChat
        reportId={null}
        avatarUrl={dexterAvatarUrl}
        initialDraft={initialPrompt}
        variant="inline"
        canChat={canChat}
        suggestions={SUGGESTIONS}
        onArtifact={(a) => router.push(a.url)}
      />
    </div>
  );
}
