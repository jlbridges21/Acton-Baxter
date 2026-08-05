import { ExternalLink } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { SiteInspectionItem } from "@/lib/research/site-inspection";

/**
 * Reusable "Site Inspection Required" section.
 * Pass props-driven items — do not hardcode category copy here so later prompts
 * can move items out as they become automated.
 */
export function SiteInspectionRequired({
  items,
  title = "Site inspection required",
  description = "These categories cannot be determined reliably from available public or licensed data. Use this checklist before the PEM — verifying in person (or via title / recorded documents) is the expected path, not a failure of the report.",
}: {
  items: SiteInspectionItem[];
  title?: string;
  description?: string;
}) {
  if (items.length === 0) return null;

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <CardDescription className="mt-2">{description}</CardDescription>

      <div className="mt-5 space-y-5">
        {items.map((item) => (
          <section
            key={item.id}
            className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-4"
          >
            <h3 className="text-sm font-semibold text-[var(--acton-navy)]">{item.title}</h3>
            <p className="mt-1 text-sm text-[var(--acton-muted)]">{item.description}</p>

            {item.facts && item.facts.length > 0 ? (
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {item.facts.map((fact) => (
                  <div key={`${item.id}-${fact.label}`}>
                    <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                      {fact.label}
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm font-semibold text-[var(--acton-navy)]">
                      {fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {item.verifySteps.length > 0 ? (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-[var(--acton-navy)]">
                {item.verifySteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
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
          </section>
        ))}
      </div>
    </Card>
  );
}
