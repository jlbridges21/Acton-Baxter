import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname localhost --port 3100",
    url: "http://localhost:3100",
    // Always start a dedicated server so E2E_TEST_AUTH_BYPASS and mock mode are applied.
    // Set PLAYWRIGHT_REUSE_SERVER=true only when you intentionally reuse a matching local server.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 120_000,
    env: {
      ...process.env,
      E2E_TEST_AUTH_BYPASS: "true",
      ENABLE_MOCK_RESEARCH: "true",
      ALLOW_MOCK_FALLBACK: "false",
      // Force mock address resolution; do not inherit live Google keys from the shell.
      NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "",
      GOOGLE_MAPS_SERVER_API_KEY: "",
      GOOGLE_MAPS_API_KEY: "",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      APP_BASE_URL: "http://localhost:3100",
      E2E_TEST_USER_ID: "00000000-0000-4000-8000-000000000001",
      E2E_TEST_USER_EMAIL: "test@actonadu.local",
      E2E_TEST_USER_NAME: "Test Salesperson",
      E2E_TEST_USER_ROLE: "salesperson",
    },
  },
});
