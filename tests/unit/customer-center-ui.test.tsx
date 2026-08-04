/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerDossierClient } from "@/components/customers/customer-dossier-client";
import type { CustomerDossier } from "@/lib/dossier/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => cleanup());

function dossier(overrides?: Partial<CustomerDossier["ghl"]>): CustomerDossier {
  return {
    query: { contactId: "c1", pemNeatId: null, name: "Jane" },
    identity: { displayName: "Jane Smith", ghlContactId: "c1" },
    pagePath: "/customers/lookup?q=Jane",
    ghl: {
      status: "ok",
      contactId: "c1",
      contactName: "Jane Smith",
      email: "jane@example.com",
      phone: "555-0100",
      address: "123 Main St",
      city: "San Jose",
      state: "CA",
      postalCode: "95110",
      projectTypeConsidering: "Detached ADU",
      ownerName: "Alex",
      opportunities: [],
      snapshotText: null,
      ambiguous: false,
      clarificationMessage: null,
      error: null,
      ...overrides,
    },
    pemNeats: { status: "empty", records: [], error: null },
    projectSetup: { status: "empty", runs: [], emptyMessage: null, error: null },
    monitoring: { status: "omitted", findings: [], error: null },
  };
}

describe("Customer Center GHL section UI", () => {
  it("renders address/city/state/postal and project-type when present", () => {
    render(<CustomerDossierClient dossier={dossier()} isAdmin={false} initialQuery="Jane" />);
    expect(screen.getByText("123 Main St")).toBeTruthy();
    expect(screen.getByText("San Jose")).toBeTruthy();
    expect(screen.getByText("CA")).toBeTruthy();
    expect(screen.getByText("95110")).toBeTruthy();
    expect(screen.getByTestId("dossier-project-type").textContent).toMatch(/Detached ADU/);
  });

  it("omits project-type row when the custom field is absent", () => {
    render(
      <CustomerDossierClient
        dossier={dossier({ projectTypeConsidering: null })}
        isAdmin={false}
        initialQuery="Jane"
      />,
    );
    expect(screen.queryByTestId("dossier-project-type")).toBeNull();
  });
});
