/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReceiptLogClient } from "@/components/receipts/receipt-log-client";

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

  it("shows admin-only Receipt Log fourth action", () => {
    render(
      <div style={{ width: 375 }}>
        <ReceiptLogClient initialJobs={[]} isAdmin />
      </div>,
    );
    const link = screen.getByRole("link", { name: /Receipt Log/i });
    expect(link.getAttribute("href")).toBe("/receipts/log");
  });
});
