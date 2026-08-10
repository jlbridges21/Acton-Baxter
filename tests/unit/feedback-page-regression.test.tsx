/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FeedbackInquiryCard } from "@/components/admin/feedback-inquiry-card";
import { FeedbackFiltersPanel } from "@/components/admin/feedback-filters-panel";
import type { BaxterInquiryAdminRow } from "@/lib/baxter-ai/feedback-inquiries";
import {
  buildFeedbackFilterHref,
  countActiveFeedbackFilters,
  type FeedbackFiltersState,
} from "@/lib/baxter-ai/feedback-filter-url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

afterEach(() => {
  cleanup();
});

function makeRow(overrides?: Partial<BaxterInquiryAdminRow>): BaxterInquiryAdminRow {
  return {
    messageId: "m1",
    conversationId: "c1",
    createdAt: "2026-07-05T12:00:00.000Z",
    channel: "web",
    summarizedRating: "none",
    questionText: "Short Q",
    answerText: "Short A",
    questionExcerpt: "Short Q",
    answerExcerpt: "Short A",
    askerKey: "web:u1",
    askerLabel: "Tester",
    department: null,
    feedbackEntries: [],
    answerMode: null,
    sourceCount: 0,
    errorCode: null,
    ...overrides,
  };
}

const defaultFilters: FeedbackFiltersState = {
  range: "this_month",
  rating: "all",
  channel: "all",
  sort: "newest",
  askerKeys: [],
  departments: [],
  customStart: "",
  customEnd: "",
};

describe("feedback page regression: server-safe filter href module", () => {
  it("keeps buildFeedbackFilterHref out of the client filters module source of truth", () => {
    // Exact failure mode: server page called a function that lived in a client component file.
    // The pure helper must live in a shared module so Load more (hasMore) can render on the server.
    const libPath = join(process.cwd(), "src/lib/baxter-ai/feedback-filter-url.ts");
    const pagePath = join(process.cwd(), "src/app/admin/baxter/feedback/page.tsx");
    const libSrc = readFileSync(libPath, "utf8");
    const pageSrc = readFileSync(pagePath, "utf8");
    expect(libSrc.trimStart().startsWith('"use client"')).toBe(false);
    expect(libSrc.trimStart().startsWith("'use client'")).toBe(false);
    expect(pageSrc).toContain("@/lib/baxter-ai/feedback-filter-url");
    expect(pageSrc).not.toMatch(
      /buildFeedbackFilterHref[\s\S]*from ["']@\/components\/admin\/feedback-filters-panel["']/,
    );
    // Calling the helper (as the server Load more link does) must not throw.
    expect(
      buildFeedbackFilterHref({
        range: "this_month",
        offset: 50,
        askerKeys: [],
        departments: [],
      }),
    ).toBe("/admin/baxter/feedback?range=this_month&offset=50");
  });

  it("builds Load more href with empty filters (plain page load state)", () => {
    expect(buildFeedbackFilterHref({ range: "this_month", offset: 50 })).toContain("offset=50");
    expect(countActiveFeedbackFilters(defaultFilters)).toBe(0);
  });

  it("builds href with multi-select filters applied", () => {
    const href = buildFeedbackFilterHref({
      range: "last_7_days",
      rating: "none",
      channel: "slack",
      sort: "oldest",
      askerKeys: ["slack:T1:U1", "web:abc"],
      departments: ["Sales"],
      offset: 50,
    });
    expect(href).toContain("asker=slack%3AT1%3AU1");
    expect(href).toContain("asker=web%3Aabc");
    expect(href).toContain("department=Sales");
    expect(href).toContain("offset=50");
  });
});

describe("FeedbackInquiryCard nullable / edge row shapes", () => {
  it("renders an inquiry with no feedback at all", () => {
    render(
      <FeedbackInquiryCard row={makeRow({ summarizedRating: "none", feedbackEntries: [] })} />,
    );
    expect(screen.getAllByText("No feedback").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Asked by Tester/)).toBeTruthy();
    expect(screen.getByText(/Unassigned/)).toBeTruthy();
  });

  it("renders a Slack asker with no matching profile (fallback label)", () => {
    render(
      <FeedbackInquiryCard
        row={makeRow({
          channel: "slack",
          askerKey: "slack:T1:U999",
          askerLabel: "Slack user U999",
          department: null,
          summarizedRating: "none",
          feedbackEntries: [],
        })}
      />,
    );
    expect(screen.getByText("Slack")).toBeTruthy();
    expect(screen.getByText(/Asked by Slack user U999/)).toBeTruthy();
    expect(screen.getByText(/Unassigned/)).toBeTruthy();
  });

  it("renders an asker whose department is null as Unassigned", () => {
    render(
      <FeedbackInquiryCard
        row={makeRow({
          askerLabel: "Pat",
          department: null,
        })}
      />,
    );
    expect(screen.getByText(/Asked by Pat · Unassigned/)).toBeTruthy();
  });

  it("does not throw when question/answer text fields are nullish", () => {
    render(
      <FeedbackInquiryCard
        row={makeRow({
          // Simulate a malformed/partial payload that previously could throw on .length
          questionText: null as unknown as string,
          answerText: null as unknown as string,
          questionExcerpt: null as unknown as string,
          answerExcerpt: null as unknown as string,
          askerLabel: null as unknown as string,
          feedbackEntries: null as unknown as [],
        })}
      />,
    );
    expect(screen.getByText(/Asked by Unknown/)).toBeTruthy();
    expect(screen.getAllByText("No feedback").length).toBeGreaterThanOrEqual(1);
  });

  it("renders a mixed page of edge-case rows without throwing", () => {
    const rows = [
      makeRow({ messageId: "1", summarizedRating: "none", feedbackEntries: [], department: null }),
      makeRow({
        messageId: "2",
        channel: "slack",
        askerLabel: "Slack user U1",
        department: null,
        summarizedRating: "negative",
        feedbackEntries: [
          {
            id: "f1",
            rating: "down",
            comment: null,
            createdAt: "2026-07-05T13:00:00.000Z",
            commenterLabel: "Slack user U1",
          },
        ],
      }),
      makeRow({
        messageId: "3",
        askerLabel: "Alex",
        department: "Sales",
        summarizedRating: "positive",
        feedbackEntries: [
          {
            id: "f2",
            rating: "up",
            comment: "Helpful",
            createdAt: "2026-07-05T14:00:00.000Z",
            commenterLabel: "Alex",
          },
        ],
      }),
      makeRow({
        messageId: "4",
        questionText: null as unknown as string,
        answerText: "",
        askerLabel: "",
        department: null,
      }),
    ];
    render(
      <>
        {rows.map((row) => (
          <FeedbackInquiryCard key={row.messageId} row={row} />
        ))}
      </>,
    );
    expect(screen.getAllByText(/Asked by/).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("Sales", { exact: false })).toBeTruthy();
  });
});

describe("FeedbackFiltersPanel with zero and multi filters", () => {
  it("renders with zero filters in the URL (defaults)", () => {
    render(
      <FeedbackFiltersPanel initial={defaultFilters} askerOptions={[]} departmentOptions={[]} />,
    );
    expect(screen.getByText("Date range:")).toBeTruthy();
    expect(screen.getByText("This month")).toBeTruthy();
    expect(screen.queryByText(/active/)).toBeNull();
  });

  it("renders with multi-select filters applied", () => {
    render(
      <FeedbackFiltersPanel
        initial={{
          ...defaultFilters,
          range: "last_7_days",
          askerKeys: ["web:1", "slack:T1:U1"],
          departments: ["Sales"],
          rating: "none",
        }}
        askerOptions={[
          { key: "web:1", label: "Web One", channel: "web" },
          { key: "slack:T1:U1", label: "Slack One", channel: "slack" },
        ]}
        departmentOptions={["Sales", "Ops"]}
      />,
    );
    expect(screen.getByText(/5 active/)).toBeTruthy();
    expect(screen.getByText("Last 7 days")).toBeTruthy();
  });
});
