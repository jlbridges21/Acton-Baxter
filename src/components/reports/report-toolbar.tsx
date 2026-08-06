"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { DownloadPdfButton } from "./download-pdf-button";
import { RefreshResearchButton } from "./refresh-research-button";
import { Button } from "@/components/ui/button";

/**
 * Screen-only report actions. Kept in its own client component so
 * `ReportDocument` stays a Server Component — several sections read
 * jurisdiction rules through server-only modules.
 */
export function ReportToolbar({ reportId }: { reportId: string }) {
  const [copied, setCopied] = useState(false);

  async function copyReportLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <p className="text-sm text-[var(--acton-muted)]">
        Print-friendly report · target length under six pages
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copyReportLink()}>
          <Link2 className="h-4 w-4" />
          {copied ? "Link copied" : "Copy report link"}
        </Button>
        <RefreshResearchButton reportId={reportId} />
        <DownloadPdfButton />
      </div>
    </div>
  );
}
