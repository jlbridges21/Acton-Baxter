/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(""),
}));

import { NavigationProgress } from "@/components/layout/navigation-progress";

afterEach(() => cleanup());

describe("NavigationProgress", () => {
  it("appears immediately on Feedback, Slack, and CRM nav clicks", () => {
    const { unmount } = render(
      <div>
        <NavigationProgress />
        <a href="/admin/baxter/feedback">Feedback</a>
        <a href="/admin/slack">Slack</a>
        <a href="/admin/connectors/ghl">CRM</a>
      </div>,
    );

    const bar = screen.getByTestId("navigation-progress");
    expect(bar.getAttribute("data-active")).toBe("false");

    fireEvent.click(screen.getByText("Feedback"));
    expect(bar.getAttribute("data-active")).toBe("true");
    unmount();

    render(
      <div>
        <NavigationProgress />
        <a href="/admin/slack">Slack</a>
        <a href="/admin/connectors/ghl">CRM</a>
      </div>,
    );
    fireEvent.click(screen.getByText("Slack"));
    expect(screen.getByTestId("navigation-progress").getAttribute("data-active")).toBe("true");

    cleanup();
    render(
      <div>
        <NavigationProgress />
        <a href="/admin/connectors/ghl">CRM</a>
      </div>,
    );
    fireEvent.click(screen.getByText("CRM"));
    expect(screen.getByTestId("navigation-progress").getAttribute("data-active")).toBe("true");
  });
});
