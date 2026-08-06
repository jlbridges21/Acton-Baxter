import { ClipboardCheck, ExternalLink } from "lucide-react";
import { ReportFact, ReportFactGrid, ReportSection } from "./report-section";
import type { SiteInspectionItem } from "@/lib/research/site-inspection";

/**
 * Reusable on-site checklist section.
 * Pass props-driven items — do not hardcode category copy here so later prompts
 * can move items out as they become automated.
 */
export function SiteInspectionRequired({
  items,
  title = "On-site checklist",
  description = "The questions no public dataset can answer for this parcel. Work through these before or during the PEM — verifying in person (or via title / recorded documents) is the expected path, not a gap in the report.",
}: {
  items: SiteInspectionItem[];
  title?: string;
  description?: string;
}) {
  if (items.length === 0) return null;

  return (
    <ReportSection
      id="site-inspection"
      title={title}
      description={description}
      sourceNote={`${items.length} ${items.length === 1 ? "item" : "items"} to confirm on site or through recorded documents.`}
    >
      <ol className="space-y-4">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-4 print:break-inside-avoid print:p-2"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--acton-navy)] text-xs font-semibold text-white"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[var(--acton-navy)]">{item.title}</h3>
                <p className="mt-1 text-sm text-[var(--acton-muted)]">{item.description}</p>

                {item.facts && item.facts.length > 0 ? (
                  <ReportFactGrid columns={2} className="mt-3">
                    {item.facts.map((fact) => (
                      <ReportFact
                        key={`${item.id}-${fact.label}`}
                        label={fact.label}
                        value={fact.value}
                      />
                    ))}
                  </ReportFactGrid>
                ) : null}

                {item.verifySteps.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 text-sm text-[var(--acton-navy)]">
                    {item.verifySteps.map((step) => (
                      <li key={step} className="flex items-start gap-2">
                        <ClipboardCheck
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--acton-muted)]"
                          aria-hidden
                        />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {item.links && item.links.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 print:hidden">
                    {item.links.map((link) => (
                      <li key={link.href}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                        >
                          {link.label}
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.links && item.links.length > 0 ? (
                  <ul className="mt-3 hidden space-y-1 text-xs break-all text-[var(--acton-muted)] print:block">
                    {item.links.map((link) => (
                      <li key={`print-${link.href}`}>
                        {link.label}: {link.href}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </ReportSection>
  );
}
