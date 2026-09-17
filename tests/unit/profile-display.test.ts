import { describe, expect, it } from "vitest";
import {
  buildProfileDisplayInfo,
  formatProfileDisplayLabel,
  resolveProfileDisplayName,
} from "@/lib/auth/profile-display";

describe("profile display name helper", () => {
  it("prefers full_name, then email, then truncated id", () => {
    expect(
      resolveProfileDisplayName({
        id: "db7d393c-aaaa-bbbb-cccc-dddddddddddd",
        fullName: "Jackson Bridges",
        email: "jackson.bridges@actonadu.com",
      }),
    ).toBe("Jackson Bridges");

    expect(
      resolveProfileDisplayName({
        id: "db7d393c-aaaa-bbbb-cccc-dddddddddddd",
        fullName: "  ",
        email: "james.parks@actonadu.com",
      }),
    ).toBe("james.parks@actonadu.com");

    expect(
      resolveProfileDisplayName({
        id: "db7d393c-aaaa-bbbb-cccc-dddddddddddd",
        fullName: null,
        email: null,
      }),
    ).toBe("User db7d393c");
  });

  it("keeps same-name accounts distinguishable via email in labels", () => {
    const a = formatProfileDisplayLabel({
      id: "id-1",
      fullName: "Jackson Bridges",
      email: "jackson.bridges21@gmail.com",
    });
    const b = formatProfileDisplayLabel({
      id: "id-2",
      fullName: "Jackson Bridges",
      email: "jackson.bridges@actonadu.com",
    });
    expect(a).toBe("Jackson Bridges (jackson.bridges21@gmail.com)");
    expect(b).toBe("Jackson Bridges (jackson.bridges@actonadu.com)");
    expect(a).not.toBe(b);
  });

  it("builds display info used by receipts / users / feedback", () => {
    const info = buildProfileDisplayInfo({
      id: "id-1",
      fullName: "Jackson Bridges",
      email: "jackson.bridges@actonadu.com",
    });
    expect(info.displayName).toBe("Jackson Bridges");
    expect(info.label).toContain("jackson.bridges@actonadu.com");
    expect(info.email).toBe("jackson.bridges@actonadu.com");
  });
});
