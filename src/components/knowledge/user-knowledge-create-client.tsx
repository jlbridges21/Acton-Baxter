"use client";

import { useState } from "react";
import { KnowledgeEntryForm } from "@/components/admin/knowledge-entry-form";
import { UserDriveIngestPicker } from "@/components/knowledge/user-drive-ingest-picker";
import { cn } from "@/lib/utils";

type Tab = "write" | "drive";

/**
 * User create flow: manual title+content draft OR one-time Google Drive import.
 */
export function UserKnowledgeCreateClient() {
  const [tab, setTab] = useState<Tab>("write");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-[var(--acton-border)] pb-2">
        <button
          type="button"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-semibold",
            tab === "write"
              ? "bg-[var(--acton-navy)] text-white"
              : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
          )}
          onClick={() => setTab("write")}
        >
          Write a draft
        </button>
        <button
          type="button"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-semibold",
            tab === "drive"
              ? "bg-[var(--acton-navy)] text-white"
              : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
          )}
          onClick={() => setTab("drive")}
        >
          Add from Google Drive
        </button>
      </div>

      {tab === "write" ? (
        <KnowledgeEntryForm mode="create" variant="user" />
      ) : (
        <UserDriveIngestPicker />
      )}
    </div>
  );
}
