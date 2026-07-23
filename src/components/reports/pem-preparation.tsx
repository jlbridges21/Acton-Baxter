import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { PemPreparationRow } from "@/lib/research/db-types";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="border-t border-[var(--acton-border)] pt-3">
      <h3 className="text-sm font-semibold text-[var(--acton-navy)]">{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--acton-muted)]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function PemPreparationSection({ pem }: { pem: PemPreparationRow | null }) {
  if (!pem) return null;

  return (
    <Card className="print:break-before-page">
      <CardTitle>PEM preparation</CardTitle>
      <CardDescription className="mt-3 text-[15px] leading-relaxed text-[var(--acton-navy)]">
        {pem.overview}
      </CardDescription>
      <div className="mt-4 space-y-4">
        <ListBlock
          title="Important property findings"
          items={asStringArray(pem.property_findings)}
        />
        <ListBlock
          title="Property-specific questions"
          items={asStringArray(pem.property_questions)}
        />
        <ListBlock title="Verify during PEM" items={asStringArray(pem.verify_during_pem)} />
        <ListBlock
          title="Verify during Feasibility Package"
          items={asStringArray(pem.verify_during_feasibility)}
        />
        <ListBlock
          title="Verify through title or survey"
          items={asStringArray(pem.verify_through_title_or_survey)}
        />
        <ListBlock
          title="Verify with planning department"
          items={asStringArray(pem.verify_with_planning)}
        />
      </div>
    </Card>
  );
}
