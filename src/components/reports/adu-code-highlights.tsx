import { ExternalLink } from "lucide-react";
import Link from "next/link";
import {
  ReportFact,
  ReportFactGrid,
  ReportFactNote,
  ReportFootnote,
  ReportNotice,
  ReportSection,
} from "./report-section";
import type { AduCodeHighlights } from "@/lib/jurisdictions";
import {
  formatEnvelopeAreaDisplay,
  formatMaxSizeDisplay,
  type BuildableEnvelopeResult,
} from "@/lib/research/buildable-envelope";

const SECTION_DISCLAIMER =
  "ADU code highlights are preparation material from configured jurisdiction documents and admin-maintained rules. They are not a code determination, zoning determination, or feasibility conclusion — verify with the governing jurisdiction.";

function formatSetbackLine(input: {
  label: string;
  feet: number | null;
  citation: string | null;
}): string | null {
  if (input.feet == null || !input.citation) return null;
  return `${input.label}: ${input.feet.toLocaleString("en-US")} ft (${input.citation})`;
}

export function AduCodeHighlightsSection({
  highlights,
  buildable,
}: {
  highlights: AduCodeHighlights;
  buildable: BuildableEnvelopeResult;
}) {
  const jurisdictionLabel = highlights.jurisdictionName;
  const setbacks = buildable.setbacks;
  const setbackLines = [
    formatSetbackLine({
      label: "Front",
      feet: setbacks.front.feet,
      citation: setbacks.front.citation,
    }),
    formatSetbackLine({
      label: "Side",
      feet: setbacks.side.feet,
      citation: setbacks.side.citation,
    }),
    formatSetbackLine({
      label: "Rear",
      feet: setbacks.rear.feet,
      citation: setbacks.rear.citation,
    }),
  ].filter(Boolean) as string[];

  const hasSetbackSection = setbackLines.length > 0 || setbacks.scopeLabel === "none";

  return (
    <ReportSection
      id="adu-code"
      title="ADU code highlights"
      description="The setbacks, size caps, and code documents that govern a detached ADU on this parcel."
      sourceNote={`${
        highlights.jurisdictionKey
          ? `Source: admin-maintained rules and code documents for ${jurisdictionLabel}`
          : "Governing jurisdiction could not be mapped to a supported connector"
      }${highlights.zoning ? ` · Zoning ${highlights.zoning}` : ""}`}
    >
      {highlights.isEmpty && setbacks.scopeLabel === "none" ? (
        <ReportNotice variant="manual-review">
          No ADU code documents or setback rules have been configured for {jurisdictionLabel} yet —
          an admin can add them at{" "}
          <Link href="/admin/jurisdictions" className="font-medium underline">
            /admin/jurisdictions
          </Link>
          .
        </ReportNotice>
      ) : (
        <div className="space-y-5">
          {highlights.fellBackToGeneralRules || setbacks.fellBackToGeneralRules ? (
            <p className="text-sm text-[var(--acton-muted)]">
              No zone-specific rules were configured for zoning{" "}
              <span className="font-medium text-[var(--acton-navy)]">
                {highlights.zoning ?? setbacks.zoning}
              </span>
              . Showing jurisdiction-general rules — confirm zone-specific rules with the
              jurisdiction.
            </p>
          ) : null}
          {highlights.usedZoneSpecificRules || setbacks.usedZoneSpecificRules ? (
            <p className="text-sm text-[var(--acton-muted)]">
              Showing rules for zoning{" "}
              <span className="font-medium text-[var(--acton-navy)]">
                {highlights.zoning ?? setbacks.zoning}
              </span>
              .
            </p>
          ) : null}

          {hasSetbackSection ? (
            <div>
              <h3 className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                ADU setbacks
                {setbacks.scopeLabel === "zone-specific" && setbacks.zoning
                  ? ` · zone ${setbacks.zoning}`
                  : setbacks.scopeLabel === "general"
                    ? " · general — confirm zone-specific rules"
                    : ""}
              </h3>
              {setbackLines.length === 0 ? (
                <ReportNotice variant="manual-review" className="mt-2">
                  No setback rules configured — add{" "}
                  <span className="font-mono text-xs">adu_setback_front_ft</span>,{" "}
                  <span className="font-mono text-xs">adu_setback_side_ft</span>, and{" "}
                  <span className="font-mono text-xs">adu_setback_rear_ft</span> at{" "}
                  <Link href="/admin/jurisdictions" className="font-medium underline">
                    /admin/jurisdictions
                  </Link>
                  .
                </ReportNotice>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm font-semibold text-[var(--acton-navy)]">
                  {setbackLines.map((line) => (
                    <li key={line} className="border-t border-[var(--acton-border)] pt-2">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
              <ReportFootnote className="mt-2">{buildable.frontYardNote}</ReportFootnote>
            </div>
          ) : null}

          {buildable.status !== "no_rules" ? (
            <div>
              <h3 className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                Approximate buildable envelope
              </h3>
              {buildable.status === "ok" && buildable.areaSqFt != null ? (
                <p className="mt-2 text-sm font-semibold text-[var(--acton-navy)]">
                  {formatEnvelopeAreaDisplay(buildable.areaSqFt)}
                  {buildable.insetFeet != null
                    ? ` · uniform ${buildable.insetFeet.toLocaleString("en-US")} ft side/rear inset`
                    : ""}
                </p>
              ) : (
                <p className="mt-2 text-sm font-semibold text-[var(--acton-navy)]">
                  {buildable.statusMessage ?? "Envelope not drawn"}
                </p>
              )}
              {buildable.maxSize ? (
                <p className="mt-1 text-sm text-[var(--acton-navy)]">
                  {formatMaxSizeDisplay(buildable.maxSize)}
                </p>
              ) : (
                <ReportFootnote className="mt-1">
                  Jurisdiction max detached ADU size is not configured.
                </ReportFootnote>
              )}
              <ReportFootnote className="mt-2">{buildable.disclaimer}</ReportFootnote>
              <ReportFootnote className="mt-1">
                Cross-check recorded easements in the on-site checklist before relying on this
                envelope for placement.
              </ReportFootnote>
            </div>
          ) : null}

          {highlights.rules.length > 0 ? (
            <div>
              <h3 className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                Structured rules
              </h3>
              <ReportFactGrid columns={2} className="mt-2">
                {highlights.rules.map((rule) => (
                  <ReportFact
                    key={rule.id}
                    label={`${rule.label}${rule.zoneKey ? ` (${rule.zoneKey})` : ""}`}
                    value={rule.displayValue}
                  >
                    <ReportFactNote>Source: {rule.sourceCitation}</ReportFactNote>
                  </ReportFact>
                ))}
              </ReportFactGrid>
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

      <ReportFootnote className="mt-4">{SECTION_DISCLAIMER}</ReportFootnote>
    </ReportSection>
  );
}
