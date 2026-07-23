import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReportConflictRow } from "@/lib/research/db-types";

function severityTone(severity: string) {
  if (severity === "critical") return "red" as const;
  if (severity === "warning") return "amber" as const;
  return "blue" as const;
}

export function ImportantInconsistencies({ conflicts }: { conflicts: ReportConflictRow[] }) {
  if (conflicts.length === 0) return null;

  return (
    <Card>
      <CardTitle>Important inconsistencies</CardTitle>
      <div className="mt-4 space-y-4">
        {conflicts.map((conflict) => {
          const values = Array.isArray(conflict.values_json)
            ? (conflict.values_json as Array<{ sourceName: string; value: string }>)
            : [];
          return (
            <div
              key={conflict.id}
              className="rounded-md border border-[var(--acton-border)] p-4 print:break-inside-avoid"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[var(--acton-navy)]">
                  {conflict.field_label}
                </p>
                <Badge tone={severityTone(conflict.severity)}>{conflict.severity}</Badge>
              </div>
              <p className="mt-2 text-sm text-[var(--acton-muted)]">{conflict.description}</p>
              <ul className="mt-3 space-y-1 text-sm text-[var(--acton-navy)]">
                {values.map((value) => (
                  <li key={`${conflict.id}-${value.sourceName}-${value.value}`}>
                    <span className="font-medium">{value.sourceName}:</span> {value.value}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm">
                <span className="font-semibold text-[var(--acton-navy)]">
                  Recommended verification:
                </span>{" "}
                <span className="text-[var(--acton-muted)]">{conflict.recommended_resolution}</span>
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
