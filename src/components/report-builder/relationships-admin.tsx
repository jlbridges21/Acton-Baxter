"use client";

/**
 * /reports/settings/relationships (admins): how report sources connect. Lookups bring
 * approved fields of a related record onto a source's rows (many-to-one); rollups aggregate
 * related records onto each parent (one-to-many). Both join on stable JobTread ids and never
 * multiply rows, so financial totals stay exact.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GitMerge, Trash2 } from "lucide-react";
import { aiFetch, errorMessage, Notice, useLoad } from "@/components/ai/ui";
import type { RelationshipSpec } from "@/lib/reports/spec";
import { ROLLUPS } from "@/lib/reports/relationships";
import { RelatedFieldsAdmin } from "./related-fields-admin";

const card = "rounded-lg border border-[var(--acton-border)] bg-white p-5";

export function RelationshipsAdmin() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reports/settings"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Data settings
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-[var(--acton-navy)]">
          <GitMerge className="h-5 w-5" aria-hidden /> Relationships
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
          How report sources connect, always by stable JobTread ids. Reports and Dexter use these to
          combine jobs, cost items, models, and commissions without duplicating records.
        </p>
      </div>
      <RelatedFieldsAdmin className={card} />
      <CompanyRelationships />
      <section className={card}>
        <h2 className="font-semibold text-[var(--acton-navy)]">Rollups (one-to-many)</h2>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Summarize related records onto each parent — for example a job&apos;s total budget cost
          from its cost items. Create one in the{" "}
          <Link href="/reports/metrics" className="underline">
            Metric Library
          </Link>{" "}
          (“From related records”), or ask Dexter.
        </p>
        <ul className="mt-3 divide-y divide-[var(--acton-border)] text-sm">
          {Object.values(ROLLUPS).map((r) => (
            <li key={r.id} className="py-2">
              <span className="font-semibold text-[var(--acton-navy)]">{r.label}</span>{" "}
              <code className="text-xs">{r.id}</code>
              <span className="block text-[var(--acton-muted)]">
                {r.description} Joined by <code>{r.childKey}</code> → {r.parent} id.
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type CompanyRelationship = {
  key: string;
  definition: RelationshipSpec;
  promotedFromReport: string | null;
  updatedAt: string;
};

/** Relationships Dexter or editors created in a report and an administrator promoted. */
function CompanyRelationships() {
  const [rows, setRows] = useState<CompanyRelationship[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRows(
        (
          await aiFetch<{ relationships: CompanyRelationship[] }>(
            "/api/reports/admin/relationships",
          )
        ).relationships,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(load);
  const archive = async (key: string) => {
    try {
      await aiFetch(`/api/reports/admin/relationships?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <section className={card}>
      <h2 className="font-semibold text-[var(--acton-navy)]">Company relationships</h2>
      <p className="mt-1 text-sm text-[var(--acton-muted)]">
        Reports can define their own joins (Dexter verifies the key on real records first). Ones an
        administrator promoted are listed here and available to every report.
      </p>
      {error ? (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      ) : null}
      {rows && !rows.length ? (
        <p className="mt-3 text-sm text-[var(--acton-muted)]">None promoted yet.</p>
      ) : null}
      <ul className="mt-3 divide-y divide-[var(--acton-border)] text-sm">
        {rows?.map((r) => {
          const d = r.definition;
          return (
            <li key={r.key} className="flex items-start justify-between gap-3 py-2">
              <span>
                <span className="font-semibold text-[var(--acton-navy)]">{d.label}</span>{" "}
                <code className="text-xs">{r.key}</code>
                <span className="block text-[var(--acton-muted)]">
                  {d.kind === "lookup"
                    ? `${d.from} → ${d.to} on ${d.key}: ${d.fields.join(", ")}`
                    : `${d.child} rolled up to ${d.parent} on ${d.childKey}`}
                  {r.promotedFromReport ? (
                    <>
                      {" · "}
                      <Link href={`/reports/${r.promotedFromReport}`} className="underline">
                        from report
                      </Link>
                    </>
                  ) : null}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Archive ${d.label}`}
                onClick={() => void archive(r.key)}
              >
                <Trash2 className="h-4 w-4 text-[var(--acton-muted)]" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
