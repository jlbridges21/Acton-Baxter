/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NeatAssessmentPanel } from "@/components/pem-neat/neat-assessment-panel";
import { PemNeatResultClient } from "@/components/pem-neat/pem-neat-result-client";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import type { PemNeatRecord } from "@/lib/pem-neat/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/hooks/use-async-run-status", () => ({
  useAsyncRunStatus: () => ({
    isTimedOut: false,
    refresh: vi.fn(),
    resumePolling: vi.fn(),
  }),
}));

function completedRecord(overrides: Partial<PemNeatRecord> = {}): PemNeatRecord {
  const structured = buildMockPemNeatResult({
    prospectName: "Alex Prospect",
    advisorName: "Jamie Advisor",
    meetingDate: "2026-03-15",
  });
  return {
    id: "11111111-1111-4111-8111-111111111111",
    prospect_name: "Alex Prospect",
    prospect_names: ["Alex Prospect"],
    salesperson_user_id: "user-1",
    salesperson_display_name: "Jamie Advisor",
    meeting_date: "2026-03-15",
    meeting_outcome: structured.salesIntelligence.meetingOutcome.classification,
    qualification: structured.salesIntelligence.qualification.classification,
    status: "completed",
    analysis_stale: false,
    generated_at: "2026-03-15T18:00:00.000Z",
    created_at: "2026-03-15T17:00:00.000Z",
    updated_at: "2026-03-15T18:00:00.000Z",
    created_by: "user-1",
    transcript: "Advisor: Purpose of today… Prospect: Mom lives alone…",
    transcript_hash: "abc",
    transcript_char_count: 40,
    current_generation_transcript_hash: "abc",
    neat_standard_version: "1.0",
    generation_error: null,
    last_error_code: null,
    generating_started_at: null,
    regenerated_at: null,
    model_provider: "mock",
    model_name: "mock",
    generation_latency_ms: 10,
    input_tokens: null,
    output_tokens: null,
    structured_result: structured,
    buildertrend_fields: structured.buildertrendFields ?? {},
    analysis_metadata: {},
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  };
}

describe("PEM NEAT PDF export presentation", () => {
  it("shows Export as PDF for a completed NEAT and triggers window.print", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PemNeatResultClient item={completedRecord()} />);

    const button = screen.getByTestId("pem-neat-export-pdf");
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("hides Export as PDF while generating or when failed without a result", () => {
    const { rerender } = render(
      <PemNeatResultClient
        item={completedRecord({ status: "generating", structured_result: {} })}
      />,
    );
    expect(screen.queryByTestId("pem-neat-export-pdf")).toBeNull();

    rerender(
      <PemNeatResultClient
        item={completedRecord({
          status: "failed",
          structured_result: {},
          generation_error: "boom",
        })}
      />,
    );
    expect(screen.queryByTestId("pem-neat-export-pdf")).toBeNull();
  });

  it("keeps NEAT content in the DOM when BuilderTrend tab is active (print tab-independence)", () => {
    render(<PemNeatResultClient item={completedRecord()} />);

    fireEvent.click(screen.getByRole("tab", { name: /BuilderTrend Custom Fields/i }));
    const neatPanel = screen.getByTestId("pem-neat-panel");
    expect(neatPanel.className).toMatch(/\bhidden\b/);
    expect(neatPanel.className).toMatch(/print:block/);
    expect(
      within(neatPanel).getAllByText(/Sales Intelligence|Customer Story/i).length,
    ).toBeGreaterThan(0);

    const btPanel = screen.getByTestId("pem-neat-buildertrend-panel");
    expect(btPanel.className).toMatch(/print:hidden/);
  });

  it("marks the source panel print-hidden and renders a print-only header", () => {
    render(<PemNeatResultClient item={completedRecord()} />);
    expect(screen.getByTestId("pem-neat-source-panel").className).toMatch(/print:hidden/);
    const printHeader = screen.getByTestId("pem-neat-print-header");
    expect(printHeader.className).toMatch(/print:block/);
    expect(within(printHeader).getByText("Internal — Acton ADU")).toBeTruthy();
    expect(within(printHeader).getByText("Alex Prospect")).toBeTruthy();
  });

  it("expands every score-category explanation for print", () => {
    const structured = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Jamie Advisor",
    });
    render(
      <NeatAssessmentPanel
        assessment={structured.assessment}
        qualification={structured.salesIntelligence.qualification}
      />,
    );

    const printDetails = document.querySelectorAll("[data-print-score-details]");
    expect(printDetails.length).toBe(structured.assessment.categories.length);
    expect(
      screen.getAllByText(/Fixture assessment|aging parent|prior contractor/i).length,
    ).toBeGreaterThan(0);
  });
});
