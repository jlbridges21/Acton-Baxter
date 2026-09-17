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
    expect(
      (screen.getByRole("button", { name: /Take photo of receipt/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: /Upload photo of receipt/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe("375px");
    expect(container.innerHTML).not.toMatch(/min-w-\[\d{3,}px\]/);
  });
});
