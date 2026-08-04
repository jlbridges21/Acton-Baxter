/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeedbackInquiryCard } from "@/components/admin/feedback-inquiry-card";
import type { BaxterInquiryAdminRow } from "@/lib/baxter-ai/feedback-inquiries";

afterEach(() => {
  cleanup();
});

function makeRow(overrides?: Partial<BaxterInquiryAdminRow>): BaxterInquiryAdminRow {
  const questionText = "Q" + "x".repeat(220);
  const answerText = "A" + "y".repeat(260);
  return {
    messageId: "m1",
    conversationId: "c1",
    createdAt: "2026-07-05T12:00:00.000Z",
    channel: "web",
    summarizedRating: "none",
    questionText,
    answerText,
    questionExcerpt: questionText.slice(0, 200),
    answerExcerpt: answerText.slice(0, 240),
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

describe("FeedbackInquiryCard See more / See less", () => {
  it("toggles full text independently per row", () => {
    const rowA = makeRow({ messageId: "a", askerLabel: "Alice" });
    const rowB = makeRow({
      messageId: "b",
      askerLabel: "Bob",
      questionText: "Q" + "z".repeat(220),
      answerText: "A" + "w".repeat(260),
    });
    rowB.questionExcerpt = rowB.questionText.slice(0, 200);
    rowB.answerExcerpt = rowB.answerText.slice(0, 240);

    render(
      <>
        <FeedbackInquiryCard row={rowA} />
        <FeedbackInquiryCard row={rowB} />
      </>,
    );

    const toggles = screen.getAllByRole("button", { name: "See more" });
    expect(toggles).toHaveLength(2);

    // Collapsed: excerpts only
    expect(screen.getByText(`Q: ${rowA.questionExcerpt}`)).toBeTruthy();
    expect(screen.queryByText(`Q: ${rowA.questionText}`)).toBeNull();

    fireEvent.click(toggles[0]!);
    expect(screen.getByRole("button", { name: "See less" })).toBeTruthy();
    expect(screen.getByText(`Q: ${rowA.questionText}`)).toBeTruthy();
    // Row B still collapsed
    expect(screen.getByText(`Q: ${rowB.questionExcerpt}`)).toBeTruthy();
    expect(screen.queryByText(`Q: ${rowB.questionText}`)).toBeNull();
    expect(screen.getAllByRole("button", { name: "See more" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "See less" }));
    expect(screen.getAllByRole("button", { name: "See more" })).toHaveLength(2);
    expect(screen.queryByText(`Q: ${rowA.questionText}`)).toBeNull();
  });

  it("hides the toggle when text is already fully shown in the excerpt", () => {
    render(
      <FeedbackInquiryCard
        row={makeRow({
          questionText: "Short Q",
          answerText: "Short A",
          questionExcerpt: "Short Q",
          answerExcerpt: "Short A",
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "See more" })).toBeNull();
  });
});
