"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RefreshResearchButton({ reportId }: { reportId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleRefresh() {
    const confirmed = window.confirm(
      "Refresh live research? This may call paid external APIs (ATTOM/RentCast) and public GIS services again.",
    );
    if (!confirmed) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/reports/${reportId}/refresh`, { method: "POST" });
      const payload = (await response.json()) as {
        reportId?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.reportId) {
        throw new Error(payload.error?.message ?? "Refresh failed");
      }
      window.location.href = `/reports/${payload.reportId}/processing`;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" onClick={handleRefresh} disabled={pending}>
        {pending ? "Refreshing..." : "Refresh live research"}
      </Button>
      {message ? <p className="text-xs text-red-700">{message}</p> : null}
    </div>
  );
}
