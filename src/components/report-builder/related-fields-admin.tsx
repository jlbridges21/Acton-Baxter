"use client";

/**
 * Related job fields (admins): which fields of a budget line's JobTread job reports may read
 * on cost-item rows. Only fields that already exist on jobs can be approved; the join itself
 * is fixed (by job id). Viewer field access still applies to every approved field.
 */

import { useCallback, useState } from "react";
import { Link2, X } from "lucide-react";
import { aiFetch, errorMessage, Notice, Pill, selectClass, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";

type Field = { ref: string; key: string; label: string; type: string; category: string };
type Relationship = {
  id: "cost_items.job";
  label: string;
  key: string;
  description: string;
  linkedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  approved: Array<Field & { approvedBy: "default" | "admin"; filled: number }>;
  eligible: Field[];
};

export function RelatedFieldsAdmin({ className }: { className?: string }) {
  const [rels, setRels] = useState<Relationship[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");

  const load = useCallback(async () => {
    try {
      setRels(
        (await aiFetch<{ relationships: Relationship[] }>("/api/reports/admin/related-fields"))
          .relationships,
      );
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(load);

  const set = async (relationship: Relationship["id"], ref: string, enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setRels(
        (
          await aiFetch<{ relationships: Relationship[] }>("/api/reports/admin/related-fields", {
            method: "POST",
            body: JSON.stringify({ relationship, ref, enabled }),
          })
        ).relationships,
      );
      setPick("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={className}>
      <h2 className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]">
        <Link2 className="h-4 w-4" aria-hidden /> Related job fields
      </h2>
      {error ? (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      ) : null}
      {!rels && !error ? <p className="mt-2 text-sm text-[var(--acton-muted)]">Loading…</p> : null}
      {rels?.map((rel) => (
        <div key={rel.id} className="mt-2 space-y-3">
          <p className="text-sm text-[var(--acton-muted)]">
            {rel.description} Linked by <code>{rel.key}</code>: {rel.matchedRows.toLocaleString()}{" "}
            of {rel.linkedRows.toLocaleString()} job budget lines match a synced job
            {rel.unmatchedRows
              ? ` (${rel.unmatchedRows.toLocaleString()} point at jobs that aren't synced or were removed; their job fields stay blank)`
              : ""}
            .
          </p>
          <ul className="flex flex-wrap gap-2 text-xs">
            {rel.approved.map((f) => (
              <li key={f.key}>
                <Pill className="bg-slate-50 text-[var(--acton-navy)]">
                  <span title={`${f.ref} · ${f.type} · ${f.category}`}>{f.label}</span>
                  <span className="ml-1 text-[var(--acton-muted)]">
                    {rel.matchedRows ? `${Math.round((f.filled / rel.matchedRows) * 100)}%` : "–"}
                    {f.approvedBy === "default" ? " · default" : ""}
                  </span>
                  <button
                    type="button"
                    className="ml-1 rounded hover:text-red-700"
                    aria-label={`Remove ${f.label}`}
                    disabled={busy}
                    onClick={() => void set(rel.id, f.ref, false)}
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </Pill>
              </li>
            ))}
          </ul>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (pick) void set(rel.id, pick, true);
            }}
          >
            <div className="w-72">
              <select
                aria-label="Job field to approve"
                className={`${selectClass} h-9`}
                value={pick}
                onChange={(e) => setPick(e.target.value)}
              >
                <option value="">Approve another job field…</option>
                {rel.eligible.map((f) => (
                  <option key={f.key} value={f.ref}>
                    {f.label}
                    {f.category !== "general" ? ` (${f.category})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" disabled={busy || !pick}>
              Approve
            </Button>
          </form>
          <p className="text-xs text-[var(--acton-muted)]">
            Approved fields can be filtered, grouped, and shown on cost-item reports, and Dexter can
            use them. People still only see fields their report access allows.
          </p>
        </div>
      ))}
    </section>
  );
}
