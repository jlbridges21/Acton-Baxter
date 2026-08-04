/**
 * Connection metadata lookup must support Slack DM requesters (slack_user_id)
 * the same way loadUserSearchCredential does — no memoization.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const maybeSingle = vi.fn();
const eq = vi.fn();
const limit = vi.fn();
const select = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createServiceClient: () => ({
    from: (...args: unknown[]) => from(...args),
  }),
}));

vi.mock("@/lib/security/secret-box", () => ({
  isTokenEncryptionConfigured: () => true,
  decryptSecret: (v: string) => v,
  encryptSecret: (v: string) => v,
}));

describe("getSlackSearchConnectionMetadataForRequester", () => {
  beforeEach(() => {
    vi.resetModules();
    maybeSingle.mockReset();
    eq.mockReset();
    limit.mockReset();
    select.mockReset();
    from.mockReset();

    const query: Record<string, unknown> = {};
    query.select = select.mockReturnValue(query);
    query.eq = eq.mockReturnValue(query);
    query.limit = limit.mockReturnValue(query);
    query.maybeSingle = maybeSingle;
    from.mockReturnValue(query);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("looks up by slack_user_id when baxterUserId is null (Slack DM path)", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        baxter_user_id: "profile-abc",
        slack_user_id: "U_EMPLOYEE",
        slack_team_id: "T_ACTON",
        slack_user_name: "Employee",
        granted_scopes: ["search:read.public"],
        status: "connected",
      },
      error: null,
    });

    const { getSlackSearchConnectionMetadataForRequester } =
      await import("@/lib/baxter-data/slack/connections");

    const result = await getSlackSearchConnectionMetadataForRequester({
      baxterUserId: null,
      slackUserId: "U_EMPLOYEE",
      slackTeamId: "T_ACTON",
    });

    expect(from).toHaveBeenCalledWith("slack_search_connections");
    expect(eq).toHaveBeenCalledWith("slack_user_id", "U_EMPLOYEE");
    expect(eq).toHaveBeenCalledWith("slack_team_id", "T_ACTON");
    expect(eq).not.toHaveBeenCalledWith("baxter_user_id", expect.anything());
    expect(result).toMatchObject({
      linked: true,
      resolvedVia: "slack_user_id",
      baxterUserId: "profile-abc",
      slackUserId: "U_EMPLOYEE",
      status: "connected",
    });
  });

  it("prefers baxter_user_id when present (web settings path)", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        baxter_user_id: "profile-abc",
        slack_user_id: "U_EMPLOYEE",
        slack_team_id: "T_ACTON",
        slack_user_name: "Employee",
        granted_scopes: [],
        status: "connected",
      },
      error: null,
    });

    const { getSlackSearchConnectionMetadataForRequester } =
      await import("@/lib/baxter-data/slack/connections");

    const result = await getSlackSearchConnectionMetadataForRequester({
      baxterUserId: "profile-abc",
      slackUserId: "U_EMPLOYEE",
      slackTeamId: "T_ACTON",
    });

    expect(eq).toHaveBeenCalledWith("baxter_user_id", "profile-abc");
    expect(result?.resolvedVia).toBe("baxter_user_id");
    expect(result?.linked).toBe(true);
  });

  it("returns not linked on a fresh miss, then linked after a new row appears", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({
      data: {
        baxter_user_id: "profile-abc",
        slack_user_id: "U_EMPLOYEE",
        slack_team_id: "T_ACTON",
        slack_user_name: "Employee",
        granted_scopes: ["search:read.public"],
        status: "connected",
      },
      error: null,
    });

    const { getSlackSearchConnectionMetadataForRequester } =
      await import("@/lib/baxter-data/slack/connections");

    const requester = {
      baxterUserId: null as string | null,
      slackUserId: "U_EMPLOYEE",
      slackTeamId: "T_ACTON",
    };

    const first = await getSlackSearchConnectionMetadataForRequester(requester);
    expect(first?.linked).toBe(false);

    const second = await getSlackSearchConnectionMetadataForRequester(requester);
    expect(second?.linked).toBe(true);
    expect(second?.resolvedVia).toBe("slack_user_id");
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });
});
