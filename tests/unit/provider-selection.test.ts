import { describe, expect, it } from "vitest";
import { selectJurisdictionConnector } from "@/lib/connectors/california/registry";
import { selectPropertyProvider } from "@/lib/providers/provider-registry";

describe("provider selection", () => {
  it("selects the San Jose connector for San Jose addresses", () => {
    const connector = selectJurisdictionConnector({
      city: "San Jose",
      county: "Santa Clara",
      state: "CA",
    });
    expect(connector.key).toBe("ca-san-jose");
  });

  it("selects the Santa Clara County connector when city is unknown but county matches", () => {
    const connector = selectJurisdictionConnector({
      city: null,
      county: "Santa Clara",
      state: "CA",
    });
    expect(connector.key).toBe("ca-santa-clara-county");
  });

  it("falls back when no jurisdiction matches", () => {
    const connector = selectJurisdictionConnector({
      city: "Unknownville",
      county: "Nowhere",
      state: "CA",
    });
    expect(connector.key).toBe("fallback");
  });

  it("resolves property providers by key", () => {
    expect(selectPropertyProvider("attom")?.key).toBe("attom");
    expect(selectPropertyProvider("rentcast")?.key).toBe("rentcast");
    expect(selectPropertyProvider("missing")).toBeNull();
  });
});
