import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export function ResearchSummary({ summary }: { summary: string | null }) {
  return (
    <Card>
      <CardTitle>Research summary</CardTitle>
      <CardDescription className="mt-3 text-[15px] leading-relaxed text-[var(--acton-navy)]">
        {summary ?? "Summary not available."}
      </CardDescription>
    </Card>
  );
}
