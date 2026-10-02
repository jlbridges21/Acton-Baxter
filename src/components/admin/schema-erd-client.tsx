"use client";

import dynamic from "next/dynamic";
import type { SchemaErd } from "@/lib/schema-erd/types";

const SchemaErdCanvas = dynamic(
  () => import("@/components/admin/schema-erd-canvas").then((mod) => mod.SchemaErdCanvas),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[240px] bg-[var(--acton-gray-50)]" />,
  },
);

export function SchemaErdClient({
  schema,
  error,
  userId,
}: {
  schema: SchemaErd | null;
  error: string | null;
  userId: string;
}) {
  if (!schema) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-lg rounded-md border border-[var(--acton-border)] bg-white p-6 text-sm text-[var(--acton-navy)]">
          <h1 className="text-base font-semibold">Schema diagram is unavailable</h1>
          <p className="mt-2">Run migration 064 in the Baxter SQL editor, then reload this page.</p>
          {error ? (
            <p className="mt-3 text-xs break-words text-[var(--acton-muted)]">{error}</p>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="h-full min-h-0">
      <SchemaErdCanvas schema={schema} userId={userId} />
    </div>
  );
}
