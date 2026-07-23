import { z } from "zod";
import {
  getPublicEnv,
  publicEnvSchema,
  readPublicRaw,
  resetPublicEnvCacheForTests,
} from "./env.public";

const booleanFromString = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === "boolean") return value;
  return value.toLowerCase() === "true" || value === "1";
});

const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ATTOM_API_KEY: z.string().optional().default(""),
  RENTCAST_API_KEY: z.string().optional().default(""),
  ATTOM_BASE_URL: z.string().url().default("https://api.gateway.attomdata.com/propertyapi/v1.0.0"),
  RENTCAST_BASE_URL: z.string().url().default("https://api.rentcast.io/v1"),
  ALLOW_MOCK_FALLBACK: booleanFromString.default(false),
  EXTERNAL_API_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  EXTERNAL_API_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional().default(""),
  GOOGLE_MAPS_SERVER_API_KEY: z.string().optional().default(""),
  GOOGLE_MAPS_API_KEY: z.string().optional().default(""),
  MAPBOX_ACCESS_TOKEN: z.string().optional().default(""),
  AI_PROVIDER: z.enum(["openai", "anthropic", "deterministic"]).default("deterministic"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().optional().default("gpt-4o-mini"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().optional().default("claude-3-5-haiku-latest"),
  ENABLE_SLACK_INTEGRATION: booleanFromString.default(false),
  SLACK_SIGNING_SECRET: z.string().optional().default(""),
  SLACK_BOT_TOKEN: z.string().optional().default(""),
  SLACK_CLIENT_ID: z.string().optional().default(""),
  SLACK_CLIENT_SECRET: z.string().optional().default(""),
  SLACK_COMMAND_NAME: z.string().optional().default("/property"),
  SLACK_ALLOWED_TEAM_IDS: z.string().optional().default(""),
  SLACK_REPORT_USER_ID: z.string().optional().default(""),
  INTERNAL_CRON_SECRET: z.string().optional().default(""),
  E2E_TEST_AUTH_BYPASS: booleanFromString.default(false),
  E2E_TEST_USER_ID: z.string().optional().default(""),
  E2E_TEST_USER_EMAIL: z.string().optional().default(""),
  E2E_TEST_USER_NAME: z.string().optional().default("Test Salesperson"),
  E2E_TEST_USER_ROLE: z.enum(["admin", "salesperson"]).optional().default("salesperson"),
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export type AppEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: AppEnv | null = null;

function readServerRaw() {
  return {
    ...readPublicRaw(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ATTOM_API_KEY: process.env.ATTOM_API_KEY ?? "",
    RENTCAST_API_KEY: process.env.RENTCAST_API_KEY ?? "",
    ATTOM_BASE_URL:
      process.env.ATTOM_BASE_URL ?? "https://api.gateway.attomdata.com/propertyapi/v1.0.0",
    RENTCAST_BASE_URL: process.env.RENTCAST_BASE_URL ?? "https://api.rentcast.io/v1",
    ALLOW_MOCK_FALLBACK: process.env.ALLOW_MOCK_FALLBACK ?? "false",
    EXTERNAL_API_TIMEOUT_MS: process.env.EXTERNAL_API_TIMEOUT_MS ?? "12000",
    EXTERNAL_API_MAX_RETRIES: process.env.EXTERNAL_API_MAX_RETRIES ?? "2",
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
    GOOGLE_MAPS_SERVER_API_KEY: process.env.GOOGLE_MAPS_SERVER_API_KEY ?? "",
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? "",
    MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN ?? "",
    AI_PROVIDER: process.env.AI_PROVIDER ?? "deterministic",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
    ENABLE_SLACK_INTEGRATION: process.env.ENABLE_SLACK_INTEGRATION ?? "false",
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET ?? "",
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ?? "",
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID ?? "",
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET ?? "",
    SLACK_COMMAND_NAME: process.env.SLACK_COMMAND_NAME ?? "/property",
    SLACK_ALLOWED_TEAM_IDS: process.env.SLACK_ALLOWED_TEAM_IDS ?? "",
    SLACK_REPORT_USER_ID: process.env.SLACK_REPORT_USER_ID ?? "",
    INTERNAL_CRON_SECRET: process.env.INTERNAL_CRON_SECRET ?? "",
    E2E_TEST_AUTH_BYPASS: process.env.E2E_TEST_AUTH_BYPASS ?? "false",
    E2E_TEST_USER_ID: process.env.E2E_TEST_USER_ID ?? "",
    E2E_TEST_USER_EMAIL: process.env.E2E_TEST_USER_EMAIL ?? "",
    E2E_TEST_USER_NAME: process.env.E2E_TEST_USER_NAME ?? "Test Salesperson",
    E2E_TEST_USER_ROLE: process.env.E2E_TEST_USER_ROLE ?? "salesperson",
    NODE_ENV: process.env.NODE_ENV,
  };
}

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = serverEnvSchema.safeParse(readServerRaw());
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const env = parsed.data;

  if (!env.ENABLE_MOCK_RESEARCH) {
    const missingLiveKeys: string[] = [];
    if (!env.ATTOM_API_KEY) missingLiveKeys.push("ATTOM_API_KEY");
    if (!env.RENTCAST_API_KEY) missingLiveKeys.push("RENTCAST_API_KEY");
    if (missingLiveKeys.length > 0) {
      throw new Error(
        `ENABLE_MOCK_RESEARCH is false but required live keys are missing: ${missingLiveKeys.join(", ")}`,
      );
    }
  }

  if (env.AI_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
    throw new Error("AI_PROVIDER=openai requires OPENAI_API_KEY");
  }
  if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
  }

  if (env.ENABLE_SLACK_INTEGRATION) {
    const missingSlack: string[] = [];
    if (!env.SLACK_SIGNING_SECRET) missingSlack.push("SLACK_SIGNING_SECRET");
    if (!env.SLACK_BOT_TOKEN) missingSlack.push("SLACK_BOT_TOKEN");
    if (!env.SLACK_ALLOWED_TEAM_IDS) missingSlack.push("SLACK_ALLOWED_TEAM_IDS");
    if (!env.SLACK_REPORT_USER_ID) missingSlack.push("SLACK_REPORT_USER_ID");
    if (missingSlack.length > 0) {
      throw new Error(
        `ENABLE_SLACK_INTEGRATION is true but required Slack settings are missing: ${missingSlack.join(", ")}`,
      );
    }
  }

  if (env.ALLOW_MOCK_FALLBACK && env.NODE_ENV === "production") {
    throw new Error("ALLOW_MOCK_FALLBACK cannot be enabled in production");
  }

  if (env.E2E_TEST_AUTH_BYPASS && env.NODE_ENV === "production") {
    throw new Error("E2E_TEST_AUTH_BYPASS cannot be enabled in production");
  }

  if (env.E2E_TEST_USER_ID && !/^[0-9a-f-]{36}$/i.test(env.E2E_TEST_USER_ID)) {
    throw new Error("E2E_TEST_USER_ID must be a UUID when provided");
  }

  if (env.SLACK_REPORT_USER_ID && !/^[0-9a-f-]{36}$/i.test(env.SLACK_REPORT_USER_ID)) {
    throw new Error("SLACK_REPORT_USER_ID must be a UUID when provided");
  }

  cachedEnv = env;
  return env;
}

export { getPublicEnv };

export function resetEnvCacheForTests() {
  cachedEnv = null;
  resetPublicEnvCacheForTests();
}

export function hasGoogleMapsConfigured(env: AppEnv = getEnv()): boolean {
  return Boolean(
    env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    env.GOOGLE_MAPS_SERVER_API_KEY ||
    env.GOOGLE_MAPS_API_KEY,
  );
}
