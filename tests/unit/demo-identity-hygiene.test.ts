import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_CUSTOMER_NAME, DEMO_PROSPECT_NAME } from "@/lib/demo-identity";
import { buildSlashHelpText } from "@/lib/slack/slash-commands";
import { baxterHelpText } from "@/lib/baxter-ai/commands";
import { resetEnvCacheForTests } from "@/lib/env";

const ROOT = join(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("demo identity hygiene (user-facing)", () => {
  it("exports fictional demo names", () => {
    expect(DEMO_PROSPECT_NAME).toBe("John Doe");
    expect(DEMO_CUSTOMER_NAME).toBe("Jane Doe");
  });

  it("help copy does not use real customer example names", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
    process.env.NEXT_PUBLIC_APP_URL = "https://acton-baxter.vercel.app";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.ENABLE_SLACK_INTEGRATION = "true";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_ALLOWED_TEAM_IDS = "T_ACTON";
    resetEnvCacheForTests();

    const slash = buildSlashHelpText();
    const web = baxterHelpText("web");
    for (const text of [slash, web]) {
      expect(text).not.toContain("Robert Vertin");
      expect(text).not.toContain("Lori Harris");
      expect(text).not.toContain("Rachel Redmond");
      expect(text).not.toContain("Carter French");
    }
  });

  it("PEM create form placeholder is fictional", () => {
    const src = read("src/components/pem-neat/pem-neat-create-client.tsx");
    expect(src).toContain(`placeholder="${DEMO_PROSPECT_NAME}"`);
    expect(src).not.toContain("Robert Vertin");
    expect(src).not.toContain("Betsy Smith");
  });

  it("PEM clarification examples use fictional prospect", () => {
    const src = read("src/lib/baxter-data/pem-neats/evidence.ts");
    expect(src).toContain(`for example: ${DEMO_PROSPECT_NAME}`);
    expect(src).not.toMatch(/for example: Robert Vertin/);
  });
});
