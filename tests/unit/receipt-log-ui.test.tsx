/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReceiptLogClient } from "@/components/receipts/receipt-log-client";
import type { ExpenseJob } from "@/lib/receipts/types";

afterEach(() => cleanup());

const JOHNSON_JOB: ExpenseJob = {
  id: "job-johnson",
  label: "Johnson",
  projectNumber: "L01-26001",
  source: "project",
  isActive: true,
  sortOrder: 1,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function openManualForm(jobs: ExpenseJob[] = [JOHNSON_JOB]) {
  render(<ReceiptLogClient initialJobs={jobs} />);
  fireEvent.click(screen.getByRole("button", { name: /Enter manually/i }));
  return screen.getByPlaceholderText(/Search projects or type a one-off label/i);
}

describe("ReceiptLogClient mobile layout", () => {
  it("renders Log Expense chooser with all three actions at phone width", () => {
    const { container } = render(
      <div style={{ width: 375 }}>
        <ReceiptLogClient initialJobs={[]} />
      </div>,
    );
    expect(screen.getByRole("heading", { name: "Log Expense" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Enter manually/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Take photo of receipt/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Upload photo of receipt/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Receipt Log/i })).toBeNull();
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe("375px");
    expect(container.innerHTML).not.toMatch(/min-w-\[\d{3,}px\]/);
  });

  it("shows My Receipts secondary link for everyone", () => {
    render(
      <div style={{ width: 375 }}>
        <ReceiptLogClient initialJobs={[]} />
      </div>,
    );
    const mine = screen.getByRole("link", { name: /^My Receipts$/i });
    expect(mine.getAttribute("href")).toBe("/receipts/mine");
    expect(screen.queryByRole("link", { name: /Receipt Log/i })).toBeNull();
  });

  it("shows Receipt Log admin link alongside My Receipts for admins", () => {
    render(
      <div style={{ width: 375 }}>
        <ReceiptLogClient initialJobs={[]} isAdmin />
      </div>,
    );
    expect(screen.getByRole("link", { name: /^My Receipts$/i }).getAttribute("href")).toBe(
      "/receipts/mine",
    );
    expect(screen.getByRole("link", { name: /Receipt Log/i }).getAttribute("href")).toBe(
      "/receipts/log",
    );
  });
});

describe("ReceiptLogClient job create option", () => {
  it("shows matching jobs and pinned create for partial matches", () => {
    const input = openManualForm();
    fireEvent.change(input, { target: { value: "John" } });
    fireEvent.focus(input);

    expect(screen.getByRole("button", { name: /^Johnson$/i })).toBeTruthy();
    const create = screen.getByRole("button", { name: /\+ Create [“"]John[”"]/i });
    expect(create).toBeTruthy();
    expect(create.textContent).toMatch(/For this receipt only/i);

    // Create is pinned outside the scrollable results list (sibling of ul).
    const list = document.getElementById(input.getAttribute("aria-controls") ?? "");
    expect(list?.tagName).toBe("UL");
    expect(list?.contains(create)).toBe(false);
    expect(create.closest("[role='option']")?.previousElementSibling?.tagName).toBe("UL");
  });

  it("hides create on exact case-insensitive job label match", () => {
    const input = openManualForm();
    fireEvent.change(input, { target: { value: "johnson" } });
    fireEvent.focus(input);

    expect(screen.getByRole("button", { name: /^Johnson$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /\+ Create/i })).toBeNull();
  });

  it("shows only create when nothing matches", () => {
    const input = openManualForm();
    fireEvent.change(input, { target: { value: "Trailer repair" } });
    fireEvent.focus(input);

    expect(screen.queryByRole("button", { name: /^Johnson$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /\+ Create [“"]Trailer repair[”"]/i })).toBeTruthy();
  });

  it("does not offer create for whitespace-only input", () => {
    const input = openManualForm();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.focus(input);

    expect(screen.queryByRole("button", { name: /\+ Create/i })).toBeNull();
  });

  it("selecting create stores trimmed custom label via form state path", () => {
    const input = openManualForm();
    fireEvent.change(input, { target: { value: "  John  " } });
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("button", { name: /\+ Create [“"]John[”"]/i }));

    expect((input as HTMLInputElement).value).toBe("John");
    expect(screen.getByText("John")).toBeTruthy();
  });

  it("reaches create as the final keyboard option", () => {
    const input = openManualForm();
    fireEvent.change(input, { target: { value: "John" } });
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-option-1$/);

    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe("John");
  });
});
