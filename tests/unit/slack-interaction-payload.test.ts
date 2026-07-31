import { describe, expect, it } from "vitest";
import { parseSlackInteractionPayload } from "@/lib/slack/interaction-payload";

describe("parseSlackInteractionPayload", () => {
  it("parses real Slack form-urlencoded view_submission payloads", () => {
    const inner = {
      type: "view_submission",
      user: { id: "U123" },
      team: { id: "T123" },
      view: {
        id: "V123",
        hash: "abc",
        callback_id: "project_setup_search",
        private_metadata: "{}",
        state: { values: {} },
      },
    };
    const rawBody = `payload=${encodeURIComponent(JSON.stringify(inner))}`;
    const parsed = parseSlackInteractionPayload(rawBody);
    expect(parsed?.type).toBe("view_submission");
    expect(parsed?.user?.id).toBe("U123");
    expect(parsed?.view?.callback_id).toBe("project_setup_search");
    expect(parsed?.view?.hash).toBe("abc");
  });

  it("parses block_actions payloads the same way", () => {
    const inner = {
      type: "block_actions",
      user: { id: "U1" },
      actions: [{ action_id: "x" }],
    };
    const rawBody = `payload=${encodeURIComponent(JSON.stringify(inner))}`;
    expect(parseSlackInteractionPayload(rawBody)?.type).toBe("block_actions");
  });

  it("returns null for missing/malformed bodies without throwing", () => {
    expect(parseSlackInteractionPayload("")).toBeNull();
    expect(parseSlackInteractionPayload("foo=bar")).toBeNull();
    expect(parseSlackInteractionPayload("payload=%7B")).toBeNull();
    expect(() => parseSlackInteractionPayload("payload=not-json")).not.toThrow();
  });
});
