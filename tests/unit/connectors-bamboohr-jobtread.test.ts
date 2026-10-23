/**
 * BambooHR and JobTread cards on /admin/connectors: status mapping from the stored connection and
 * sync history, and their presence in the connector registry. Synthetic rows only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bambooHealthFrom } from "@/lib/connectors/bamboohr/health";
import { jobTreadHealthFrom } from "@/lib/connectors/jobtread/health";
import type { ConnectionRow as BambooRow } from "@/lib/bamboohr/connection";
import type { ConnectionRow as JtRow, SyncRunRow } from "@/lib/jobtread/sync";

const bamboo = (patch: Partial<BambooRow> = {}): BambooRow => ({
  id: "b1",
  company_domain: "acton",
  company_id: null,
  company_name: "Acton Construction",
  connected_email: "admin@example.com",
  connected_sub: null,
  requested_scopes: ["employee"],
  granted_scopes: ["employee"],
  encrypted_access_token: "secret-token",
  encrypted_refresh_token: "secret-refresh",
  access_token_expires_at: null,
  status: "connected",
  capabilities: {},
  capabilities_checked_at: null,
  refresh_lock_until: null,
  last_refresh_at: null,
  last_success_at: "2026-10-23T10:00:00.000Z",
  last_error: null,
  last_error_at: null,
  connected_by: null,
  created_at: "2026-10-20T00:00:00.000Z",
  updated_at: "2026-10-23T10:00:00.000Z",
  ...patch,
});

const jt = (patch: Partial<JtRow> = {}): JtRow => ({
  id: "default",
  organization_id: "org",
  organization_name: "Acton ADU",
  grant_name: null,
  grant_expires_at: null,
  grant_is_unrestricted: null,
  status: "connected",
  last_tested_at: null,
  last_error: null,
  sync_interval_minutes: 60,
  updated_at: "2026-10-23T10:00:00.000Z",
  ...patch,
});

const run = (patch: Partial<SyncRunRow> = {}): SyncRunRow => ({
  id: "r1",
  kind: "full",
  status: "succeeded",
  triggered_by: "cron",
  started_at: "2026-10-23T09:59:00.000Z",
  finished_at: "2026-10-23T10:00:00.000Z",
  api_requests: 4,
  records_seen: 312,
  records_upserted: 3,
  records_removed: 0,
  duration_ms: 60_000,
  error: null,
  ...patch,
});

describe("BambooHR connector card", () => {
  it("lists missing settings by name when not configured", () => {
    const h = bambooHealthFrom(null, ["BAMBOOHR_CLIENT_ID"]);
    expect(h).toMatchObject({ key: "bamboohr", status: "offline", label: "Not configured" });
    expect(h.details).toContain("BAMBOOHR_CLIENT_ID");
  });

  it("shows configured-but-not-connected as a warning", () => {
    expect(bambooHealthFrom(null, [])).toMatchObject({ status: "warning", label: "Not connected" });
    expect(bambooHealthFrom(bamboo({ status: "disconnected" }), [])).toMatchObject({
      label: "Not connected",
    });
  });

  it("is healthy when connected, with the last successful request as last sync, and never exposes tokens", () => {
    const h = bambooHealthFrom(bamboo(), []);
    expect(h).toMatchObject({
      status: "healthy",
      label: "Connected",
      lastSyncAt: "2026-10-23T10:00:00.000Z",
    });
    expect(JSON.stringify(h)).not.toContain("secret");
  });

  it("flags reauthorization, errors, and missing scopes", () => {
    expect(bambooHealthFrom(bamboo({ status: "reauthorization_required" }), [])).toMatchObject({
      status: "warning",
      label: "Reconnect required",
    });
    expect(bambooHealthFrom(bamboo({ status: "error", last_error: "HTTP 500" }), [])).toMatchObject(
      { status: "offline", lastError: "HTTP 500" },
    );
    expect(
      bambooHealthFrom(
        bamboo({ requested_scopes: ["employee", "employee:job"], granted_scopes: ["employee"] }),
        [],
      ),
    ).toMatchObject({ status: "warning", label: "Limited access" });
  });
});

describe("JobTread connector card", () => {
  it("names the missing grant key setting when not configured", () => {
    const h = jobTreadHealthFrom({ configured: false, row: null, lastSuccess: null, latest: null });
    expect(h).toMatchObject({ key: "jobtread", status: "offline", label: "Not configured" });
    expect(h.details).toContain("JOBTREAD_GRANT_KEY");
  });

  it("is healthy after a successful sync and reports what that sync saw", () => {
    const h = jobTreadHealthFrom({
      configured: true,
      row: jt(),
      lastSuccess: run(),
      latest: run(),
    });
    expect(h).toMatchObject({
      status: "healthy",
      lastSyncAt: "2026-10-23T10:00:00.000Z",
      itemsSynced: 312,
    });
  });

  it("warns when the latest sync failed but keeps the last good sync time", () => {
    const h = jobTreadHealthFrom({
      configured: true,
      row: jt(),
      lastSuccess: run(),
      latest: run({ id: "r2", status: "failed", error: "Rate limited" }),
    });
    expect(h).toMatchObject({
      status: "warning",
      label: "Last sync failed",
      lastError: "Rate limited",
      lastSyncAt: "2026-10-23T10:00:00.000Z",
    });
  });

  it("warns before the first sync and is offline when the grant check failed", () => {
    expect(
      jobTreadHealthFrom({ configured: true, row: jt(), lastSuccess: null, latest: null }),
    ).toMatchObject({ status: "warning", label: "Not synced yet" });
    expect(
      jobTreadHealthFrom({
        configured: true,
        row: jt({ status: "error", last_error: "AUTH_FAILED" }),
        lastSuccess: run(),
        latest: run(),
      }),
    ).toMatchObject({ status: "offline", lastError: "AUTH_FAILED" });
  });
});

describe("connector registry", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lists BambooHR and JobTread alongside the existing connectors", async () => {
    vi.stubEnv("ENABLE_MOCK_RESEARCH", "true");
    vi.stubEnv("BAMBOOHR_CLIENT_ID", "");
    vi.stubEnv("JOBTREAD_GRANT_KEY", "");
    const { listConnectorHealth } = await import("@/lib/connectors/registry");
    const health = await listConnectorHealth();
    const keys = health.map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "google_workspace",
        "slack",
        "gohighlevel",
        "jobtread",
        "bamboohr",
        "buildertrend",
        "domo",
      ]),
    );
    expect(health.find((h) => h.key === "bamboohr")).toMatchObject({ label: "Not configured" });
    expect(health.find((h) => h.key === "jobtread")).toMatchObject({ label: "Not configured" });
  });
});
