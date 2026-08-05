import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import type { AduCodeHighlights } from "@/lib/jurisdictions";

const SECTION_DISCLAIMER =
  "ADU code highlights are preparation material from configured jurisdiction documents and admin-maintained rules. They are not a code determination, zoning determination, or feasibility conclusion — verify with the governing jurisdiction.";

export function AduCodeHighlightsSection({ highlights }: { highlights: AduCodeHighlights }) {
  const jurisdictionLabel = highlights.jurisdictionName;

  return (
    <Card>
      <CardTitle>ADU code highlights</CardTitle>
      <p className="mt-1 text-sm text-[var(--acton-muted)]">
        {highlights.jurisdictionKey
          ? `Configured for ${jurisdictionLabel}`
          : "Governing jurisdiction could not be mapped to a supported connector"}
        {highlights.zoning ? ` · Zoning ${highlights.zoning}` : null}
      </p>

      {highlights.isEmpty ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-3 text-sm text-[var(--acton-navy)]">
          <p>
            No ADU code documents have been configured for {jurisdictionLabel} yet — an admin can
            add them at{" "}
            <Link href="/admin/jurisdictions" className="font-medium underline">
              /admin/jurisdictions
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {highlights.fellBackToGeneralRules ? (
            <p className="text-sm text-[var(--acton-muted)]">
              No zone-specific rules were configured for zoning{" "}
              <span className="font-medium text-[var(--acton-navy)]">{highlights.zoning}</span>.
              Showing jurisdiction-general rules.
            </p>
          ) : null}
          {highlights.usedZoneSpecificRules ? (
            <p className="text-sm text-[var(--acton-muted)]">
              Showing rules for zoning{" "}
              <span className="font-medium text-[var(--acton-navy)]">{highlights.zoning}</span>.
            </p>
          ) : null}

          {highlights.rules.length > 0 ? (
            <div>
              <h3 className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                Structured rules
              </h3>
              <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                {highlights.rules.map((rule) => (
                  <div key={rule.id} className="border-t border-[var(--acton-border)] pt-3">
                    <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                      {rule.label}
                      {rule.zoneKey ? ` (${rule.zoneKey})` : ""}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">
                      {rule.displayValue}
                    </dd>
                    <p className="mt-1 text-xs text-[var(--acton-muted)]">
                      Source: {rule.sourceCitation}
                    </p>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {highlights.documents.length > 0 ? (
            <div>
              <h3 className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                Code documents
              </h3>
              <ul className="mt-2 space-y-2">
                {highlights.documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--acton-border)] pt-2 text-sm"
                  >
                    <Link
                      href={doc.knowledgeViewerHref}
                      className="font-medium text-[var(--acton-navy)] underline"
                    >
                      {doc.title}
                    </Link>
                    {doc.sourceUrl ? (
                      <a
                        href={doc.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--acton-navy)] underline print:hidden"
                      >
                        Original source
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <p className="mt-4 text-xs leading-snug text-[var(--acton-muted)]">{SECTION_DISCLAIMER}</p>
    </Card>
  );
}
