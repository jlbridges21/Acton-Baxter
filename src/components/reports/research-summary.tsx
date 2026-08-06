import { ReportNotice, ReportSection } from "./report-section";

export function ResearchSummary({ summary }: { summary: string | null }) {
  return (
    <ReportSection
      id="research-summary"
      title="Research summary"
      description="Plain-language orientation to this property before you read the detail sections."
      sourceNote="Written from the sources listed under Sources — not a feasibility conclusion."
    >
      {summary ? (
        <p className="text-[15px] leading-relaxed text-[var(--acton-navy)]">{summary}</p>
      ) : (
        <ReportNotice>
          No research summary was generated for this report. The individual sections below still
          carry every value that was retrieved.
        </ReportNotice>
      )}
    </ReportSection>
  );
}
